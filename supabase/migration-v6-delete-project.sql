-- Run once on an existing database (SQL Editor).
-- Only the person who CREATED a project can delete it. Everything inside it
-- (tasks, history, members, invites, notifications) is removed by the foreign keys.

create or replace function public.delete_project(p_project uuid, p_confirm_key text)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.projects;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into pr from public.projects where id = p_project;
  if not found then raise exception 'Project not found'; end if;
  if pr.created_by is distinct from auth.uid() then
    raise exception 'Only the person who created this project can delete it';
  end if;
  if upper(btrim(coalesce(p_confirm_key, ''))) <> pr.key then
    raise exception 'Type the project key exactly to confirm';
  end if;
  delete from public.projects where id = p_project;
end $$;

revoke execute on function public.delete_project(uuid, text) from public, anon;
grant  execute on function public.delete_project(uuid, text) to authenticated;

-- Refresh the API schema cache so the new function is callable immediately.
notify pgrst, 'reload schema';
