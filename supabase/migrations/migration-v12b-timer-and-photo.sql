-- v12b: profile photo, On hold lane, work timer. Run AFTER migration-v12a-on-hold-enum.sql (a separate run).
-- Needs v7 (and v11) already applied. Safe to run again.
-- =====================================================================
-- v12: profile photo, "On hold" lane, work timer
--   * profiles.avatar_url      small JPEG (data URL) captured at sign-up step 2
--   * tasks.worked_seconds / timer_started_at / timer_pause_reason
--   * only ONE in-progress task per person: starting another moves the
--     current one to On hold and stops its clock (done by a trigger, so every
--     path through the app is covered)
--   * set_task_timer()         called by the browser when the camera / idle
--                              detector says the person is there or away
--   * transition_task()        now also handles In progress <-> On hold
-- =====================================================================

-- ------------------------------------------------------------ profile photo
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles drop constraint if exists profiles_avatar_ok;
alter table public.profiles add constraint profiles_avatar_ok
  check (avatar_url is null or (avatar_url like 'data:image/jpeg;base64,%' and length(avatar_url) <= 60000));

-- Sign-up sends the photo inside the user metadata; copy it to the profile and drop it from the
-- metadata so it does not travel in every session token.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare av text := new.raw_user_meta_data ->> 'avatar';
begin
  insert into public.profiles (id, email, full_name, is_admin, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    not exists (select 1 from public.profiles),
    case when av like 'data:image/jpeg;base64,%' and length(av) <= 60000 then av end
  );
  if av is not null then
    update auth.users set raw_user_meta_data = raw_user_meta_data - 'avatar' where id = new.id;
  end if;
  return new;
end $$;

create or replace function public.set_my_avatar(p_avatar text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_avatar is not null and not (p_avatar like 'data:image/jpeg;base64,%' and length(p_avatar) <= 60000) then
    raise exception 'That photo could not be used. Take it again.';
  end if;
  update public.profiles set avatar_url = p_avatar where id = auth.uid();
  return p_avatar;
end $$;

-- ------------------------------------------------------------ timer columns
alter table public.tasks add column if not exists worked_seconds     integer not null default 0;
alter table public.tasks add column if not exists timer_started_at   timestamptz;      -- set while the clock runs
alter table public.tasks add column if not exists timer_pause_reason text;              -- away / idle / locked / sleep / camera / offline

-- Last sign of life from the browser that runs the clock. Kept out of `tasks` so heartbeats do not
-- generate realtime traffic. If a browser dies, time is only counted up to its last heartbeat + 2 min.
create table if not exists public.task_timer_pings (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  ping_at timestamptz not null default now()
);
alter table public.task_timer_pings enable row level security;
revoke all on public.task_timer_pings from anon, authenticated;

-- ------------------------------------------------- one active task per person
create or replace function public._tasks_timer_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare ping timestamptz; stop_at timestamptz; other record;
begin
  -- A held card always has an owner (e.g. when its owner is removed from the project).
  if new.status = 'on_hold' and new.assignee_id is null then new.status := 'todo'; end if;

  if new.status is not distinct from old.status and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  -- Stop the clock when the card leaves In progress or changes hands.
  if old.timer_started_at is not null and (new.status <> 'in_progress' or new.assignee_id is distinct from old.assignee_id) then
    select ping_at into ping from public.task_timer_pings where task_id = old.id;
    stop_at := least(now(), coalesce(ping, old.timer_started_at) + interval '2 minutes');
    new.worked_seconds := old.worked_seconds + greatest(0, floor(extract(epoch from stop_at - old.timer_started_at)))::int;
    new.timer_started_at := null;
    new.timer_pause_reason := null;
  end if;

  if new.status = 'in_progress' and (old.status <> 'in_progress' or new.assignee_id is distinct from old.assignee_id) then
    -- The assignee starting or resuming their own card starts the clock; any other way in
    -- (reopened, failed testing, manager override) waits until the assignee is back at the camera.
    if new.assignee_id is not null and new.assignee_id = auth.uid() and old.status in ('todo', 'on_hold') then
      new.timer_started_at := now();
      new.timer_pause_reason := null;
      insert into public.task_timer_pings (task_id, ping_at) values (new.id, now())
        on conflict (task_id) do update set ping_at = now();
    else
      new.timer_started_at := null;
      new.timer_pause_reason := 'waiting';
    end if;

    -- Only one card in progress per person: park the others on hold.
    if new.assignee_id is not null then
      for other in select id, project_id from public.tasks
                    where assignee_id = new.assignee_id and status = 'in_progress' and id <> new.id for update loop
        update public.tasks set status = 'on_hold', updated_by = coalesce(new.updated_by, auth.uid()), updated_at = now()
         where id = other.id;
        insert into public.task_events (task_id, project_id, actor_id, kind, from_status, to_status, note)
        values (other.id, other.project_id, coalesce(new.updated_by, auth.uid()), 'moved', 'in_progress', 'on_hold',
                'Paused automatically because another task was started');
      end loop;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tasks_timer_guard on public.tasks;
create trigger tasks_timer_guard before update on public.tasks
  for each row execute function public._tasks_timer_guard();

-- ------------------------------------------------------------ start / stop the clock
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

-- Safety net for browsers that vanished while the clock was running (call from the cron route).
create or replace function public.sweep_stale_timers()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select t.id, t.timer_started_at, coalesce(p.ping_at, t.timer_started_at) as last_ping
             from public.tasks t left join public.task_timer_pings p on p.task_id = t.id
            where t.status = 'in_progress' and t.timer_started_at is not null
              and coalesce(p.ping_at, t.timer_started_at) < now() - interval '3 minutes' loop
    update public.tasks set
      worked_seconds = worked_seconds + greatest(0, floor(extract(epoch from least(now(), r.last_ping + interval '2 minutes') - r.timer_started_at)))::int,
      timer_started_at = null, timer_pause_reason = 'offline'
    where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------ workflow: On hold
-- The existing transition_task() keeps doing everything it did; this wrapper only adds the
-- In progress <-> On hold moves (and On hold -> To do). Re-running this file is safe, and it
-- re-wraps the function if an older migration replaced it.
do $$
declare src text;
begin
  select prosrc into src from pg_proc
   where proname = 'transition_task' and pronamespace = 'public'::regnamespace and pronargs = 5;
  if src is not null and src not like '%_transition_task_core%' then
    drop function if exists public._transition_task_core(uuid, public.task_status, public.task_status, text, boolean);
    alter function public.transition_task(uuid, public.task_status, public.task_status, text, boolean)
      rename to _transition_task_core;
  end if;
end $$;

create or replace function public.transition_task(
  p_task uuid, p_from public.task_status, p_to public.task_status, p_note text default null,
  p_override boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tasks; me uuid := auth.uid();
begin
  if not coalesce(p_override, false) and (p_from = 'on_hold' or p_to = 'on_hold') then
    if me is null then raise exception 'Not signed in'; end if;
    select * into t from public.tasks where id = p_task for update;
    if not found then raise exception 'Task not found'; end if;
    if t.status <> p_from then
      raise exception 'STALE: this card was already moved to %', replace(t.status::text, '_', ' ');
    end if;
    if not ((p_from = 'in_progress' and p_to = 'on_hold') or (p_from = 'on_hold' and p_to in ('in_progress', 'todo'))) then
      raise exception 'That move is not allowed in this workflow';
    end if;
    if t.assignee_id is distinct from me then
      raise exception 'Only the person this task is assigned to can put it on hold or resume it';
    end if;
    update public.tasks set
      status = p_to,
      started_at = case when p_to = 'in_progress' then coalesce(started_at, now()) else started_at end,
      updated_by = me, updated_at = now()
    where id = t.id returning * into t;
    insert into public.task_events (task_id, project_id, actor_id, kind, from_status, to_status)
    values (t.id, t.project_id, me, 'moved', p_from, p_to);
    return jsonb_build_object('task', to_jsonb(t), 'notified', '[]'::jsonb);
  end if;
  return public._transition_task_core(p_task, p_from, p_to, p_note, coalesce(p_override, false));
end $$;

-- ------------------------------------------------------------ permissions
revoke execute on function public._transition_task_core(uuid, public.task_status, public.task_status, text, boolean) from public, anon, authenticated;
revoke execute on function public.transition_task(uuid, public.task_status, public.task_status, text, boolean) from public, anon;
grant  execute on function public.transition_task(uuid, public.task_status, public.task_status, text, boolean) to authenticated, service_role;
revoke execute on function public.set_task_timer(uuid, boolean, text) from public, anon;
grant  execute on function public.set_task_timer(uuid, boolean, text) to authenticated;
revoke execute on function public.set_my_avatar(text) from public, anon;
grant  execute on function public.set_my_avatar(text) to authenticated;
revoke all on function public.sweep_stale_timers() from public, anon, authenticated;
grant  execute on function public.sweep_stale_timers() to service_role;
revoke all on function public._tasks_timer_guard() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';
