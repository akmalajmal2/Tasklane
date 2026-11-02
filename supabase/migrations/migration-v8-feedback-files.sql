-- Run once on an existing database (SQL Editor).
-- Lets the person who sends a card back (or declines / fails / reopens it) attach photos or PDFs to
-- their remark. Files live in a private Storage bucket; only project members can open them.

-- 1) The files attached to the CURRENT remark (cleared automatically when the remark changes).
alter table public.tasks add column if not exists last_decision_files jsonb not null default '[]'::jsonb;

create or replace function public._clear_decision_files()
returns trigger language plpgsql as $$
begin
  if (new.last_decision_note is distinct from old.last_decision_note or new.status is distinct from old.status)
     and new.last_decision_files is not distinct from old.last_decision_files then
    new.last_decision_files := '[]'::jsonb;
  end if;
  return new;
end $$;

drop trigger if exists tasks_clear_files on public.tasks;
create trigger tasks_clear_files before update on public.tasks
  for each row execute function public._clear_decision_files();

-- 2) Private bucket: 5 MB per file, images and PDFs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Object paths look like  <project id>/<task id>/<file>. CASE keeps the uuid cast away from other buckets.
drop policy if exists task_files_read   on storage.objects;
drop policy if exists task_files_upload on storage.objects;
drop policy if exists task_files_remove on storage.objects;

create policy task_files_read on storage.objects for select to authenticated
  using (case when bucket_id = 'task-files' then public.can_view(((storage.foldername(name))[1])::uuid) else false end);
create policy task_files_upload on storage.objects for insert to authenticated
  with check (case when bucket_id = 'task-files' then public.can_view(((storage.foldername(name))[1])::uuid) else false end);
create policy task_files_remove on storage.objects for delete to authenticated
  using (case when bucket_id = 'task-files' then public.can_manage(((storage.foldername(name))[1])::uuid) else false end);

-- 3) Attach the uploaded files to the remark. Only whoever wrote the remark can do this.
create or replace function public.set_decision_files(p_task uuid, p_files jsonb)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare t public.tasks; me uuid := auth.uid(); f jsonb;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if not public.can_view(t.project_id) then raise exception 'You are not a member of this project'; end if;
  if t.updated_by is distinct from me then raise exception 'Only the person who wrote the remark can attach files to it'; end if;
  if t.last_decision_note is null then raise exception 'There is no remark to attach files to'; end if;
  if jsonb_typeof(p_files) <> 'array' then raise exception 'Invalid file list'; end if;
  if jsonb_array_length(p_files) > 5 then raise exception 'Attach at most 5 files'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if left(coalesce(f ->> 'path', ''), length(t.project_id::text || '/' || t.id::text || '/')) <> t.project_id::text || '/' || t.id::text || '/' then
      raise exception 'Invalid file path';
    end if;
    if coalesce(f ->> 'type', '') not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf') then
      raise exception 'Only photos and PDFs can be attached';
    end if;
  end loop;
  update public.tasks set last_decision_files = p_files where id = t.id returning * into t;
  return t;
end $$;

revoke execute on function public.set_decision_files(uuid, jsonb) from public, anon;
grant  execute on function public.set_decision_files(uuid, jsonb) to authenticated;
revoke execute on function public._clear_decision_files() from public, anon, authenticated;

notify pgrst, 'reload schema';
