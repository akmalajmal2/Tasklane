-- Tasklane migration v2, part B. Run AFTER migration-v2a-enum.sql has succeeded.

alter table public.tasks alter column estimate_hours drop not null;

drop function if exists public.transition_task(uuid, public.task_status, public.task_status, text);

-- ------------------------------------------------------- tasks
--
-- Intake rule
--   Managers (and workspace admins) create tasks straight into "To do".
--   Everyone else *proposes* a task: it lands in "Proposed" and nobody can start
--   it until a manager approves it (editing due date / estimate / priority /
--   assignee on the way). A manager can also decline it with a reason; the
--   proposer can then revise and resubmit, or withdraw it.
create or replace function public.create_task(
  p_project uuid, p_title text, p_description text, p_priority public.task_priority,
  p_requires_testing boolean, p_estimate numeric, p_due timestamptz, p_assignee uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); mgr boolean := public.can_manage(p_project);
  proj public.projects; t public.tasks; out jsonb := '[]'::jsonb; st public.task_status; actor text; u record;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.can_view(p_project) then raise exception 'You are not a member of this project'; end if;
  if p_requires_testing is null then raise exception 'Say whether this task needs testing'; end if;
  if p_estimate is not null and (p_estimate <= 0 or p_estimate > 999) then
    raise exception 'Estimate must be between 0.5 and 999 hours (or leave it empty)';
  end if;
  if p_due is null or p_due <= now() then raise exception 'Pick a due date in the future'; end if;
  if p_assignee is not null then
    if not exists (select 1 from public.project_members where project_id = p_project and user_id = p_assignee) then
      raise exception 'The assignee must be a project member';
    end if;
    if not mgr and p_assignee <> me then
      raise exception 'Only managers can assign work to other people. Leave it unassigned and a manager will decide.';
    end if;
  end if;

  st := case when mgr then 'todo'::public.task_status else 'proposed'::public.task_status end;
  update public.projects set task_seq = task_seq + 1 where id = p_project returning * into proj;
  insert into public.tasks (project_id, number, title, description, priority, status, requires_testing,
                            estimate_hours, due_at, assignee_id, reporter_id, updated_by)
  values (p_project, proj.task_seq, btrim(p_title), coalesce(p_description, ''), p_priority, st,
          p_requires_testing, p_estimate, p_due, p_assignee, me, me)
  returning * into t;
  insert into public.task_events (task_id, project_id, actor_id, kind, to_status)
  values (t.id, p_project, me, case when mgr then 'created' else 'proposed' end, st);

  if mgr then
    if p_assignee is not null and p_assignee <> me then
      out := out || public._notify(p_assignee, p_project, t.id, 'assigned',
               proj.key || '-' || t.number || ' was assigned to you', t.title,
               '/projects/' || p_project || '?task=' || t.id);
    end if;
  else
    select full_name into actor from public.profiles where id = me;
    for u in select user_id from public.project_members
              where project_id = p_project and role = 'manager' and user_id <> me loop
      out := out || public._notify(u.user_id, p_project, t.id, 'proposal',
               proj.key || '-' || t.number || ' needs your approval',
               actor || ' proposed “' || t.title || '”',
               '/projects/' || p_project || '?task=' || t.id);
    end loop;
  end if;
  return jsonb_build_object('task', to_jsonb(t), 'notified', out);
end $$;

-- Managers edit anything that is not done. The proposer may edit their own
-- proposal while it is Proposed or Declined (editing a declined one resubmits it).
create or replace function public.update_task(
  p_task uuid, p_title text, p_description text, p_priority public.task_priority,
  p_requires_testing boolean, p_estimate numeric, p_due timestamptz, p_assignee uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  old public.tasks; t public.tasks; me uuid := auth.uid(); out jsonb := '[]'::jsonb;
  ref text; actor text; mgr boolean; owner boolean; resubmit boolean; u record;
begin
  select * into old from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  mgr   := public.can_manage(old.project_id);
  owner := old.reporter_id = me and old.status in ('proposed', 'declined');
  if not (mgr or owner) then raise exception 'Only managers can edit tasks'; end if;
  if old.status = 'done' then raise exception 'Reopen this task before editing it'; end if;
  if p_requires_testing is null then raise exception 'Say whether this task needs testing'; end if;
  if p_estimate is not null and (p_estimate <= 0 or p_estimate > 999) then
    raise exception 'Estimate must be between 0.5 and 999 hours (or leave it empty)';
  end if;
  if p_due is distinct from old.due_at and p_due <= now() then raise exception 'Pick a due date in the future'; end if;
  if p_requires_testing <> old.requires_testing and old.status = 'testing' then
    raise exception 'Testing has already started, so this setting can no longer change';
  end if;
  if p_assignee is not null and not exists (
       select 1 from public.project_members where project_id = old.project_id and user_id = p_assignee) then
    raise exception 'The assignee must be a project member';
  end if;
  if not mgr and p_assignee is not null and p_assignee <> me then
    raise exception 'Only a manager can assign work to other people';
  end if;
  if p_assignee is null and old.status not in ('todo', 'proposed', 'declined') then
    raise exception 'Tasks that are underway need an assignee';
  end if;

  resubmit := not mgr and old.status = 'declined';
  update public.tasks set
    title = btrim(p_title), description = coalesce(p_description, ''), priority = p_priority,
    requires_testing = p_requires_testing, estimate_hours = p_estimate, due_at = p_due,
    assignee_id = p_assignee, updated_by = me, updated_at = now(),
    status = case when resubmit then 'proposed'::public.task_status else status end,
    last_decision_note = case when resubmit then null else last_decision_note end,
    overdue_notified_at = case when p_due is distinct from old.due_at then null else overdue_notified_at end
  where id = p_task returning * into t;

  select key || '-' || t.number into ref from public.projects where id = t.project_id;
  select full_name into actor from public.profiles where id = me;
  insert into public.task_events (task_id, project_id, actor_id, kind, from_status, to_status)
  values (t.id, t.project_id, me,
          case when resubmit then 'resubmitted'
               when t.assignee_id is distinct from old.assignee_id then 'reassigned' else 'edited' end,
          case when resubmit then old.status end, case when resubmit then t.status end);

  if resubmit then
    for u in select user_id from public.project_members
              where project_id = t.project_id and role = 'manager' and user_id <> me loop
      out := out || public._notify(u.user_id, t.project_id, t.id, 'proposal',
               ref || ' was revised and needs approval', actor || ' resubmitted “' || t.title || '”',
               '/projects/' || t.project_id || '?task=' || t.id);
    end loop;
  elsif t.status not in ('proposed', 'declined') and t.assignee_id is distinct from old.assignee_id then
    if t.assignee_id is not null and t.assignee_id <> me then
      out := out || public._notify(t.assignee_id, t.project_id, t.id, 'assigned',
               ref || ' was assigned to you', t.title, '/projects/' || t.project_id || '?task=' || t.id);
    end if;
    if old.assignee_id is not null and old.assignee_id <> me then
      out := out || public._notify(old.assignee_id, t.project_id, t.id, 'unassigned',
               ref || ' was reassigned', t.title, '/projects/' || t.project_id || '?task=' || t.id);
    end if;
  end if;
  return jsonb_build_object('task', to_jsonb(t), 'notified', out);
end $$;

-- Approve a proposal. The manager may change the details in the same step; the
-- proposer is told exactly what was adjusted. Only after this can anyone start it.
create or replace function public.approve_task(
  p_task uuid, p_title text, p_description text, p_priority public.task_priority,
  p_requires_testing boolean, p_estimate numeric, p_due timestamptz, p_assignee uuid, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  old public.tasks; t public.tasks; me uuid := auth.uid(); out jsonb := '[]'::jsonb;
  ref text; actor text; note text := nullif(btrim(coalesce(p_note, '')), '');
  changed text[] := '{}'; summary text; other_approvers int;
begin
  select * into old from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.can_manage(old.project_id) then raise exception 'Only a manager can approve a task'; end if;
  if old.status not in ('proposed', 'declined') then
    raise exception 'STALE: this task is no longer waiting for approval';
  end if;
  select count(*) into other_approvers from public.profiles p
   where p.id <> me and (p.is_admin or exists (
     select 1 from public.project_members m
      where m.user_id = p.id and m.project_id = old.project_id and m.role = 'manager'));
  if old.reporter_id = me and other_approvers > 0 then
    raise exception 'You cannot approve your own proposal. Ask another manager.';
  end if;
  if p_requires_testing is null then raise exception 'Say whether this task needs testing'; end if;
  if p_estimate is not null and (p_estimate <= 0 or p_estimate > 999) then
    raise exception 'Estimate must be between 0.5 and 999 hours (or leave it empty)';
  end if;
  if p_due is null or p_due <= now() then raise exception 'Pick a due date in the future before approving'; end if;
  if p_assignee is not null and not exists (
       select 1 from public.project_members where project_id = old.project_id and user_id = p_assignee) then
    raise exception 'The assignee must be a project member';
  end if;

  if p_due is distinct from old.due_at then changed := array_append(changed, 'due date'); end if;
  if p_estimate is distinct from old.estimate_hours then changed := array_append(changed, 'estimate'); end if;
  if p_priority is distinct from old.priority then changed := array_append(changed, 'priority'); end if;
  if p_assignee is distinct from old.assignee_id then changed := array_append(changed, 'assignee'); end if;
  if p_requires_testing is distinct from old.requires_testing then changed := array_append(changed, 'testing requirement'); end if;
  summary := case when array_length(changed, 1) > 0 then 'Adjusted: ' || array_to_string(changed, ', ') else null end;

  update public.tasks set
    title = btrim(p_title), description = coalesce(p_description, ''), priority = p_priority,
    requires_testing = p_requires_testing, estimate_hours = p_estimate, due_at = p_due,
    assignee_id = p_assignee, status = 'todo', last_decision_note = null,
    updated_by = me, updated_at = now(), overdue_notified_at = null
  where id = p_task returning * into t;

  select key || '-' || t.number into ref from public.projects where id = t.project_id;
  select full_name into actor from public.profiles where id = me;
  insert into public.task_events (task_id, project_id, actor_id, kind, from_status, to_status, note)
  values (t.id, t.project_id, me, 'approved_proposal', old.status, 'todo',
          nullif(concat_ws(E'\n', summary, note), ''));

  if t.reporter_id is not null and t.reporter_id <> me then
    out := out || public._notify(t.reporter_id, t.project_id, t.id, 'proposal_approved',
             ref || ' was approved',
             concat_ws('. ', actor || ' approved “' || t.title || '”', summary, note),
             '/projects/' || t.project_id || '?task=' || t.id);
  end if;
  if t.assignee_id is not null and t.assignee_id <> me and t.assignee_id is distinct from t.reporter_id then
    out := out || public._notify(t.assignee_id, t.project_id, t.id, 'assigned',
             ref || ' was assigned to you', t.title, '/projects/' || t.project_id || '?task=' || t.id);
  end if;
  return jsonb_build_object('task', to_jsonb(t), 'notified', out);
end $$;

-- Managers delete anything; a proposer may withdraw their own pending/declined proposal.
create or replace function public.delete_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pid uuid; rep uuid; st public.task_status;
begin
  select project_id, reporter_id, status into pid, rep, st from public.tasks where id = p_task;
  if pid is null then raise exception 'Task not found'; end if;
  if not (public.can_manage(pid) or (rep = auth.uid() and st in ('proposed', 'declined'))) then
    raise exception 'Only managers can delete tasks';
  end if;
  delete from public.tasks where id = p_task;
end $$;

-- The workflow. p_from is the status the caller saw; if the card has moved
-- since (someone else approved it, say) the move is refused as STALE.
-- p_override lets a manager/admin move a card anywhere outside the normal
-- workflow (any column, with a mandatory reason that is logged and sent to the assignee).
create or replace function public.transition_task(
  p_task uuid, p_from public.task_status, p_to public.task_status, p_note text default null,
  p_override boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.tasks; me uuid := auth.uid(); adm boolean := public.is_admin();
  r public.project_role; mgr boolean; note text := nullif(btrim(coalesce(p_note, '')), '');
  out jsonb := '[]'::jsonb; ref text; actor text; link text; u record;
  other_approvers int; other_testers int; has_testers boolean;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;

  r := public.member_role(t.project_id);
  mgr := adm or r = 'manager';
  if r is null and not adm then raise exception 'You are not a member of this project'; end if;
  if t.status <> p_from then
    raise exception 'STALE: this card was already moved to %', replace(t.status::text, '_', ' ');
  end if;

  select full_name into actor from public.profiles where id = me;
  select key || '-' || t.number into ref from public.projects where id = t.project_id;
  link := '/projects/' || t.project_id || '?task=' || t.id;

  select count(*) into other_approvers from public.profiles p
   where p.id <> me and (p.is_admin or exists (
     select 1 from public.project_members m
      where m.user_id = p.id and m.project_id = t.project_id and m.role = 'manager'));
  select count(*) into other_testers from public.project_members
   where project_id = t.project_id and role = 'tester' and user_id <> me;
  has_testers := exists (select 1 from public.project_members where project_id = t.project_id and role = 'tester');

  if p_from in ('proposed', 'declined') or p_to in ('proposed', 'declined') then
    -- Intake lane: only "decline a proposal" is a plain move; approval has its own function.
    if p_from = 'proposed' and p_to = 'declined' then
      if not mgr then raise exception 'Only a manager can decline a proposal'; end if;
      if note is null then raise exception 'Say why it is declined so the proposer can revise it'; end if;
      t.last_decision_note := note;
      if t.reporter_id is not null and t.reporter_id <> me then
        out := out || public._notify(t.reporter_id, t.project_id, t.id, 'proposal_declined',
                 ref || ' was declined', actor || ': ' || note, link);
      end if;
    else
      raise exception 'Proposals are approved or declined by a manager. Open the task and use Review proposal.';
    end if;

  elsif p_override then
    if not mgr then raise exception 'Only a manager can move a card outside the workflow'; end if;
    if p_from = p_to then raise exception 'The card is already there'; end if;
    if note is null then raise exception 'Add a reason. It is logged and sent to the assignee.'; end if;
    if t.assignee_id is null and p_to <> 'todo' then raise exception 'Assign this task before moving it'; end if;
    if p_to = 'testing' and not t.requires_testing then raise exception 'This task does not need testing'; end if;
    if t.assignee_id = me and other_approvers > 0 and p_to in ('testing', 'done') then
      raise exception 'You cannot approve your own task, even as an override. Ask another manager.';
    end if;
    if p_to = 'in_progress' then
      t.started_at := coalesce(t.started_at, now());
      t.last_decision_note := note;
    elsif p_to = 'in_review' then
      t.review_requested_at := now();
      t.last_decision_note := null;
    else
      t.last_decision_note := null;
    end if;
    if t.assignee_id is not null and t.assignee_id <> me then
      out := out || public._notify(t.assignee_id, t.project_id, t.id, 'moved',
               ref || ' was moved to ' || replace(p_to::text, '_', ' '), actor || ': ' || note, link);
    end if;

  elsif p_from = 'todo' and p_to = 'in_progress' then
    if t.assignee_id is null then
      if mgr then raise exception 'Assign this task to someone before starting it'; end if;
      t.assignee_id := me;                      -- a team member picks up an unassigned card
    elsif t.assignee_id <> me then
      raise exception 'Only the person this task is assigned to can start it';
    end if;
    t.started_at := coalesce(t.started_at, now());

  elsif p_from = 'in_progress' and p_to = 'todo' then
    if t.assignee_id is distinct from me then raise exception 'Only the assignee can move this task back to To do'; end if;

  elsif p_from = 'in_progress' and p_to = 'in_review' then
    if t.assignee_id is null then raise exception 'Assign this task before sending it for review'; end if;
    if t.assignee_id <> me then raise exception 'Only the assignee can send this task for review'; end if;
    t.review_requested_at := now();
    t.last_decision_note := null;
    for u in select user_id from public.project_members
              where project_id = t.project_id and role = 'manager' and user_id <> me loop
      out := out || public._notify(u.user_id, t.project_id, t.id, 'review_requested',
               ref || ' is ready for review', actor || ' sent “' || t.title || '” for review', link);
    end loop;

  elsif p_from = 'in_review' and p_to in ('testing', 'done', 'todo') then
    if not mgr then raise exception 'Only a manager can approve or reject a review'; end if;
    if t.assignee_id = me and other_approvers > 0 then
      raise exception 'You cannot review your own task. Ask another manager.';
    end if;
    if p_to = 'testing' and not t.requires_testing then raise exception 'This task does not need testing'; end if;
    if p_to = 'done' and t.requires_testing then raise exception 'This task needs testing before it can be completed'; end if;
    if p_to = 'todo' then
      if note is null then raise exception 'Add a note so the assignee knows what to fix'; end if;
      t.last_decision_note := note;
      if t.assignee_id is not null and t.assignee_id <> me then
        out := out || public._notify(t.assignee_id, t.project_id, t.id, 'rejected',
                 ref || ' was sent back', actor || ': ' || note, link);
      end if;
    else
      t.last_decision_note := null;
      if t.assignee_id is not null and t.assignee_id <> me then
        out := out || public._notify(t.assignee_id, t.project_id, t.id, 'approved',
                 ref || ' was approved', actor || ' approved “' || t.title || '”', link);
      end if;
      if p_to = 'testing' then
        for u in select user_id from public.project_members
                  where project_id = t.project_id and role = 'tester' and user_id <> me loop
          out := out || public._notify(u.user_id, t.project_id, t.id, 'testing_requested',
                   ref || ' is ready to test', t.title, link);
        end loop;
      end if;
    end if;

  elsif p_from = 'testing' and p_to in ('done', 'in_progress') then
    if not (r = 'tester' or (mgr and not has_testers)) then
      raise exception 'Only a tester can pass or fail testing';
    end if;
    if t.assignee_id = me and other_testers > 0 then raise exception 'You cannot test your own task'; end if;
    if p_to = 'in_progress' then
      if note is null then raise exception 'Describe what failed so the assignee can fix it'; end if;
      t.last_decision_note := note;
      if t.assignee_id is not null and t.assignee_id <> me then
        out := out || public._notify(t.assignee_id, t.project_id, t.id, 'test_failed',
                 ref || ' failed testing', actor || ': ' || note, link);
      end if;
    else
      t.last_decision_note := null;
      if t.assignee_id is not null and t.assignee_id <> me then
        out := out || public._notify(t.assignee_id, t.project_id, t.id, 'test_passed',
                 ref || ' passed testing', t.title, link);
      end if;
    end if;

  elsif p_from = 'done' and p_to = 'in_progress' then
    if not mgr then raise exception 'Only a manager can reopen a completed task'; end if;
    if note is null then raise exception 'Add a note explaining why this is reopened'; end if;
    if t.assignee_id is null then raise exception 'Assign this task before reopening it'; end if;
    t.last_decision_note := note;
    if t.assignee_id <> me then
      out := out || public._notify(t.assignee_id, t.project_id, t.id, 'reopened',
               ref || ' was reopened', actor || ': ' || note, link);
    end if;

  else
    raise exception 'That move is not allowed in this workflow';
  end if;

  update public.tasks set
    status = p_to, assignee_id = t.assignee_id, started_at = t.started_at,
    review_requested_at = t.review_requested_at, last_decision_note = t.last_decision_note,
    completed_at = case when p_to = 'done' then now() when p_from = 'done' then null else completed_at end,
    updated_by = me, updated_at = now()
  where id = t.id returning * into t;

  insert into public.task_events (task_id, project_id, actor_id, kind, from_status, to_status, note)
  values (t.id, t.project_id, me, case when p_override then 'override' else 'moved' end, p_from, p_to, note);

  return jsonb_build_object('task', to_jsonb(t), 'notified', out);
end $$;


-- Re-apply grants (idempotent).
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated, service_role;
revoke all on function public._notify(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.flag_overdue() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
