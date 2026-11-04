-- v18: a clock left running by a closed browser no longer counts the whole time away. Safe to run again.
-- Before: reopening the app a day later showed 24 h, and kept counting it, until the card was moved.
-- Now the first sign of life settles the old stretch at "last heartbeat + 2 minutes" and starts a fresh one.

-- Called by the assignee's browser. p_running = true also acts as the heartbeat.
create or replace function public.set_task_timer(p_task uuid, p_running boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tasks; me uuid := auth.uid(); ping timestamptz; stop_at timestamptz;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if t.assignee_id is distinct from me or t.status <> 'in_progress' then
    raise exception 'STALE: this task is no longer in progress for you';
  end if;

  if p_running then
    -- The browser that ran this clock may have vanished (tab closed, computer off): it reports in every ~40 s,
    -- so a long silence means that stretch ended at its last sign of life + 2 minutes. Settle it, then start afresh.
    if t.timer_started_at is not null then
      select ping_at into ping from public.task_timer_pings where task_id = t.id;
      if coalesce(ping, t.timer_started_at) < now() - interval '3 minutes' then
        stop_at := coalesce(ping, t.timer_started_at) + interval '2 minutes';
        update public.tasks set
          worked_seconds = worked_seconds + greatest(0, floor(extract(epoch from stop_at - t.timer_started_at)))::int,
          timer_started_at = null
        where id = t.id returning * into t;
      end if;
    end if;
    if t.timer_started_at is null then
      update public.tasks set timer_started_at = now(), timer_pause_reason = null where id = t.id returning * into t;
    end if;
    insert into public.task_timer_pings (task_id, ping_at) values (t.id, now())
      on conflict (task_id) do update set ping_at = now();
  elsif t.timer_started_at is not null then
    select ping_at into ping from public.task_timer_pings where task_id = t.id;
    stop_at := least(now(), coalesce(ping, t.timer_started_at) + interval '2 minutes');
    update public.tasks set
      worked_seconds = worked_seconds + greatest(0, floor(extract(epoch from stop_at - t.timer_started_at)))::int,
      timer_started_at = null,
      timer_pause_reason = left(coalesce(nullif(btrim(p_reason), ''), 'away'), 20)
    where id = t.id returning * into t;
  elsif t.timer_pause_reason is distinct from left(coalesce(nullif(btrim(p_reason), ''), 'away'), 20) then
    update public.tasks set timer_pause_reason = left(coalesce(nullif(btrim(p_reason), ''), 'away'), 20)
     where id = t.id returning * into t;
  end if;
  return to_jsonb(t);
end $$;

notify pgrst, 'reload schema';
