-- Run once on an existing database (SQL Editor).
-- When you invite someone who already has an account, they get an in-app notification right away
-- (bell + toast + the invitation appears on their Projects page) without refreshing.

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
