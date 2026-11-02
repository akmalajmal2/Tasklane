-- v13: sign-in "no profile" fix. Safe to run again, on any database that already has the v12 schema.
-- 1) ensure_my_profile(): the app calls it when a signed-in person has no profiles row, and it creates it.
-- 2) re-creates the sign-up trigger so new accounts always get a profile.
-- 3) backfills every existing account that has no profile.

create or replace function public.ensure_my_profile()
returns void language plpgsql security definer set search_path = public as $$
declare u auth.users;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into u from auth.users where id = auth.uid();
  if not found then return; end if;
  insert into public.profiles (id, email, full_name, is_admin)
  values (
    u.id, u.email,
    coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
    not exists (select 1 from public.profiles)
  )
  on conflict (id) do nothing;
end $$;

revoke execute on function public.ensure_my_profile() from public, anon;
grant  execute on function public.ensure_my_profile() to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name, is_admin)
select u.id, u.email,
       coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
       false
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Somebody has to run the workspace: the oldest account, and only when there is no admin yet.
-- (Never flag every backfilled account: admins count as managers on projects they have not joined.)
update public.profiles set is_admin = true
 where id = (select id from public.profiles order by created_at limit 1)
   and not exists (select 1 from public.profiles where is_admin);

notify pgrst, 'reload schema';
