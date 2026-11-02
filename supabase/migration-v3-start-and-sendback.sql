-- Run once on an existing database (SQL Editor).
-- 1) Only the assignee can start a task (managers no longer can).
-- 2) Only the assignee can send for review or move back to To do.
-- 3) A review "send back" now returns the task to To do instead of In progress.

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

revoke execute on all functions in schema public from public, anon;
