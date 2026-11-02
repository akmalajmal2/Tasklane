-- v15: project roles are respected, even for workspace admins. Safe to run again.
--
-- Before: a workspace admin counted as a manager on EVERY project, even one they had been invited to
-- as developer / tester. So an invited admin could not propose tasks (their tasks were created
-- straight into "To do") and could approve their own work.
-- Now: if a person is a member of a project, their project role decides. A workspace admin only acts
-- as manager on projects they have NOT joined (oversight, rescue).

create or replace function public.can_manage(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when public.member_role(p) is not null
              then public.member_role(p) = 'manager'
              else public.is_admin() end
$$;

-- The workflow functions below checked is_admin() on their own. Patch them in place, whatever shape
-- the earlier migrations left them in (the text is edited, so nothing else about them changes).
do $$
declare r record; def text; newdef text; n int := 0;
begin
  for r in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and p.proname in ('_transition_task_core', 'transition_task', 'approve_task', 'reorder_task')
  loop
    def := pg_get_functiondef(r.oid);
    newdef := def;
    -- who counts as a manager
    newdef := replace(newdef, 'mgr := adm or r = ''manager'';', 'mgr := public.can_manage(t.project_id);');
    newdef := replace(newdef, 'if not (public.is_admin() or public.member_role(t.project_id) = ''manager'') then',
                              'if not public.can_manage(t.project_id) then');
    -- "other approvers": an admin who joined this project as developer / tester is not an approver
    newdef := regexp_replace(newdef,
      '\(p\.is_admin or exists \((\s*select 1 from public\.project_members m\s+where m\.user_id = p\.id and m\.project_id = ([a-z_]+\.project_id))',
      '((p.is_admin and not exists (select 1 from public.project_members mm where mm.user_id = p.id and mm.project_id = \2)) or exists (\1',
      'g');
    if newdef <> def then
      execute newdef;
      n := n + 1;
      raise notice 'patched %', r.proname;
    end if;
  end loop;
  raise notice 'v15: % function(s) patched', n;
end $$;

notify pgrst, 'reload schema';
