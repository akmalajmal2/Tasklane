-- Tasklane v11. Run once on an existing database (SQL Editor). Safe to run again.
-- Adds: task comments, e-mail notification preferences, editing your own profile name,
--       clearing notifications, and archiving completed tasks.
-- (A brand-new database made with schema.sql already contains all of this. Do not run it there.)

-- ============================================================ profile: name + e-mail preferences
alter table public.profiles add column if not exists mute_email text[] not null default '{}';

-- Which preference group a notification kind belongs to. NULL = always e-mailed (e.g. invitations).
create or replace function public._email_group(p_kind text)
returns text language sql immutable as $$
  select case
    when p_kind in ('assigned', 'unassigned')                                   then 'assignments'
    when p_kind in ('proposal', 'proposal_approved', 'proposal_declined')       then 'proposals'
    when p_kind in ('moved', 'review_requested', 'testing_requested', 'approved', 'rejected',
                    'test_passed', 'test_failed', 'reopened')                   then 'reviews'
    when p_kind = 'overdue'                                                     then 'overdue'
    when p_kind = 'comment'                                                     then 'comments'
    else null
  end
$$;

-- Same behaviour as before, except: a muted group is still shown in the app, but no e-mail payload is returned.
create or replace function public._notify(
  p_user uuid, p_project uuid, p_task uuid, p_kind text, p_title text, p_body text, p_link text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.profiles;
begin
  select * into pr from public.profiles where id = p_user;
  if not found then return '[]'::jsonb; end if;
  insert into public.notifications (user_id, project_id, task_id, kind, title, body, link)
  values (p_user, p_project, p_task, p_kind, p_title, p_body, p_link);
  if public._email_group(p_kind) = any (pr.mute_email) then return '[]'::jsonb; end if;
  return jsonb_build_object('email', pr.email, 'name', pr.full_name,
                            'title', p_title, 'body', p_body, 'link', p_link);
end $$;
revoke all on function public._notify(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.update_my_profile(p_name text, p_mute text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n text := btrim(coalesce(p_name, '')); mute text[];
begin
  if me is null then raise exception 'Not signed in'; end if;
  if char_length(n) < 1 or char_length(n) > 80 then raise exception 'Enter your name (1 to 80 characters)'; end if;
  select coalesce(array_agg(distinct g), '{}') into mute
    from unnest(coalesce(p_mute, '{}')) g
   where g in ('assignments', 'proposals', 'reviews', 'overdue', 'comments');
  update public.profiles set full_name = n, mute_email = mute where id = me;
  return jsonb_build_object('full_name', n, 'mute_email', to_jsonb(mute));
end $$;
revoke execute on function public.update_my_profile(text, text[]) from public, anon;
grant  execute on function public.update_my_profile(text, text[]) to authenticated;

-- ============================================================ task comments
create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;
drop policy if exists comments_read on public.task_comments;
create policy comments_read on public.task_comments for select to authenticated using (public.can_view(project_id));
revoke all on public.task_comments from anon;
revoke insert, update, delete on public.task_comments from authenticated;
grant select on public.task_comments to authenticated;

create or replace function public.add_comment(p_task uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); t public.tasks; pr public.projects; c public.task_comments;
  v_body text := btrim(coalesce(p_body, '')); actor text; lnk text; target uuid; out jsonb := '[]'::jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into t from public.tasks where id = p_task;
  if not found then raise exception 'Task not found'; end if;
  if not public.can_view(t.project_id) then raise exception 'You do not have access to this project'; end if;
  if char_length(v_body) < 1 then raise exception 'Write a comment first'; end if;
  if char_length(v_body) > 2000 then raise exception 'Comments are limited to 2000 characters'; end if;

  insert into public.task_comments (task_id, project_id, author_id, body)
  values (t.id, t.project_id, me, v_body) returning * into c;

  select * into pr from public.projects where id = t.project_id;
  select full_name into actor from public.profiles where id = me;
  lnk := '/projects/' || t.project_id || '?task=' || t.id;
  -- Tell the assignee and the person who proposed it (never the author), if they are still on the project.
  for target in
    select distinct x from (values (t.assignee_id), (t.reporter_id)) v(x)
     where x is not null and x <> me
       and exists (select 1 from public.project_members m where m.project_id = t.project_id and m.user_id = x)
  loop
    out := out || public._notify(target, t.project_id, t.id, 'comment',
             coalesce(actor, 'Someone') || ' commented on ' || pr.key || '-' || t.number, left(v_body, 140), lnk);
  end loop;
  return jsonb_build_object('comment', to_jsonb(c), 'notified', out);
end $$;
revoke execute on function public.add_comment(uuid, text) from public, anon;
grant  execute on function public.add_comment(uuid, text) to authenticated;

create or replace function public.delete_comment(p_comment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.task_comments;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from public.task_comments where id = p_comment;
  if not found then raise exception 'Comment not found'; end if;
  if not (c.author_id = auth.uid() or public.can_manage(c.project_id)) then
    raise exception 'You can only delete your own comments';
  end if;
  delete from public.task_comments where id = c.id;
end $$;
revoke execute on function public.delete_comment(uuid) from public, anon;
grant  execute on function public.delete_comment(uuid) to authenticated;

alter table public.task_comments replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments') then
    alter publication supabase_realtime add table public.task_comments;
  end if;
end $$;

-- ============================================================ clear notifications
create or replace function public.clear_notifications(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.notifications where user_id = auth.uid() and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.clear_notifications(uuid[]) from public, anon;
grant  execute on function public.clear_notifications(uuid[]) to authenticated;

-- ============================================================ archive completed tasks
alter table public.tasks add column if not exists archived_at timestamptz;

-- A card that leaves "Completed" (reopened, moved) is automatically un-archived.
create or replace function public._clear_archive()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from 'done' and new.archived_at is not null then new.archived_at := null; end if;
  return new;
end $$;
drop trigger if exists tasks_clear_archive on public.tasks;
create trigger tasks_clear_archive before update on public.tasks
  for each row execute function public._clear_archive();

create or replace function public.archive_task(p_task uuid, p_archive boolean)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare t public.tasks; me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.can_manage(t.project_id) then raise exception 'Only a manager can archive or restore tasks'; end if;
  if t.status <> 'done' then raise exception 'Only completed tasks can be archived'; end if;
  update public.tasks
     set archived_at = case when p_archive then now() else null end, updated_by = me, updated_at = now()
   where id = t.id returning * into t;
  insert into public.task_events (task_id, project_id, actor_id, kind)
  values (t.id, t.project_id, me, case when p_archive then 'archived' else 'unarchived' end);
  return t;
end $$;
revoke execute on function public.archive_task(uuid, boolean) from public, anon;
grant  execute on function public.archive_task(uuid, boolean) to authenticated;

-- Archive every completed task of a project in one go. Returns the updated rows.
create or replace function public.archive_done(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.can_manage(p_project) then raise exception 'Only a manager can archive tasks'; end if;
  with u as (
    update public.tasks set archived_at = now(), updated_by = me, updated_at = now()
     where project_id = p_project and status = 'done' and archived_at is null
    returning *
  ), e as (
    insert into public.task_events (task_id, project_id, actor_id, kind)
    select id, project_id, me, 'archived' from u
    returning 1
  )
  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into out from u;
  return out;
end $$;
revoke execute on function public.archive_done(uuid) from public, anon;
grant  execute on function public.archive_done(uuid) to authenticated;

notify pgrst, 'reload schema';
