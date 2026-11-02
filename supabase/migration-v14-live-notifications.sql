-- Tasklane v14. Run once on an existing database (SQL Editor). Safe to run again.
-- Fixes "the other user does not see the invitation / notification until a refresh (or at all)".
--   1. every table the app listens to is in the realtime publication
--   2. notifications can be read by their owner (and deleted rows carry the full old row)
--   3. create_invite() notifies someone who already has an account (the v9 behaviour, re-applied)
-- (A brand-new database made with schema.sql already contains all of this. Do not run it there.)
-- The last statement shows which tables are live: you should see 4 rows.

-- 1) realtime publication
do $$
declare t text;
begin
  foreach t in array array['tasks', 'notifications', 'project_members', 'project_invites'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 2) notifications: owner can read, full old row on delete, read_at can be flipped
alter table public.notifications replica identity full;
alter table public.notifications enable row level security;
drop policy if exists notices_read on public.notifications;
create policy notices_read on public.notifications for select to authenticated using (user_id = auth.uid());
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 3) inviting someone who already has an account creates their notification right away
create or replace function public.create_invite(p_project uuid, p_email text, p_role public.project_role)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.project_invites; pr public.projects; me public.profiles; em text := lower(btrim(p_email)); uid uuid;
begin
  if not public.can_manage(p_project) then raise exception 'Only managers can invite people'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid e-mail address'; end if;
  if exists (select 1 from public.project_members m join public.profiles p on p.id = m.user_id
             where m.project_id = p_project and lower(p.email) = em) then
    raise exception '% is already a member of this project', em;
  end if;
  -- Re-inviting replaces any pending invite (this is how "resend" works).
  update public.project_invites set status = 'revoked', responded_at = now()
   where project_id = p_project and lower(email) = em and status = 'pending';
  insert into public.project_invites (project_id, email, role, invited_by)
  values (p_project, em, p_role, auth.uid()) returning * into i;
  select * into pr from public.projects where id = p_project;
  select * into me from public.profiles where id = auth.uid();
  -- Someone who already has an account sees the invitation instantly (bell + toast + Projects page).
  select id into uid from public.profiles where lower(email) = em;
  if uid is not null and uid <> auth.uid() then
    perform public._notify(uid, p_project, null, 'invite_received',
              coalesce(me.full_name, 'A manager') || ' invited you to ' || pr.name,
              'Join as ' || p_role || '. Open it to accept or decline.', '/invite/' || i.token);
  end if;
  return jsonb_build_object('token', i.token, 'email', i.email, 'role', i.role,
                            'project_name', pr.name, 'inviter_name', me.full_name);
end $$;
revoke execute on function public.create_invite(uuid, text, public.project_role) from public, anon;
grant  execute on function public.create_invite(uuid, text, public.project_role) to authenticated;

notify pgrst, 'reload schema';

-- Check: expect 4 rows (notifications, project_invites, project_members, tasks).
select tablename as live_table from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('tasks', 'notifications', 'project_members', 'project_invites')
 order by 1;
