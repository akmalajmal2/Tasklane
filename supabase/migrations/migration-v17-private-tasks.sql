-- v17: people only see their own work (replaces v16). Safe to run again.
--
-- Who can see a task. The database decides, so the board, history, comments, files, live updates and
-- work timers all follow the same rule:
--   * managers of the project (and workspace admins on projects they have not joined): every task
--   * everyone else:
--       - tasks assigned to them
--       - their own proposal while it still waits for a decision (Proposed / Declined)
--       - approved, unassigned "To do" cards (the pool anyone may pick up)
--       - testers also see cards waiting in "In testing", because they are the ones who pass or fail them
-- So a manager's own tasks, and other people's tasks and timers, are never shown to a developer.
-- v16 also let a proposer keep seeing the card after a manager gave it to someone else; v17 does not.

create or replace function public.task_visible(p_project uuid, p_assignee uuid, p_reporter uuid, p_status public.task_status)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view(p_project) and (
       public.can_manage(p_project)
    or p_assignee = auth.uid()
    or (p_reporter = auth.uid() and p_status in ('proposed', 'declined'))
    or (p_assignee is null and p_status = 'todo')
    or (p_status = 'testing' and public.member_role(p_project) = 'tester')
  )
$$;

create or replace function public.can_see_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task and public.task_visible(t.project_id, t.assignee_id, t.reporter_id, t.status))
$$;

grant execute on function public.task_visible(uuid, uuid, uuid, public.task_status) to authenticated;
grant execute on function public.can_see_task(uuid) to authenticated;

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.task_visible(project_id, assignee_id, reporter_id, status));

drop policy if exists events_read on public.task_events;
create policy events_read on public.task_events for select to authenticated
  using (public.can_see_task(task_id));

drop policy if exists comments_read on public.task_comments;
create policy comments_read on public.task_comments for select to authenticated
  using (public.can_see_task(task_id));

-- Attached files live under <project id>/<task id>/<file>: they follow the task.
drop policy if exists task_files_read   on storage.objects;
drop policy if exists task_files_upload on storage.objects;
create policy task_files_read on storage.objects for select to authenticated
  using (case when bucket_id = 'task-files' and array_length(storage.foldername(name), 1) >= 2
              then public.can_see_task(((storage.foldername(name))[2])::uuid) else false end);
create policy task_files_upload on storage.objects for insert to authenticated
  with check (case when bucket_id = 'task-files' and array_length(storage.foldername(name), 1) >= 2
                   then public.can_see_task(((storage.foldername(name))[2])::uuid) else false end);

-- Commenting needs access to the task, not just to the project.
do $$
declare def text; newdef text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'add_comment' and p.prokind = 'f';
  if def is not null then
    newdef := replace(def,
      'if not public.can_view(t.project_id) then raise exception ''You do not have access to this project''; end if;',
      'if not public.can_see_task(t.id) then raise exception ''You do not have access to this task''; end if;');
    if newdef <> def then execute newdef; raise notice 'add_comment patched'; end if;
  end if;
end $$;

notify pgrst, 'reload schema';
