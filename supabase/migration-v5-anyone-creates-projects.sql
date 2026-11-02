-- Run once on an existing database (SQL Editor).
-- Any signed-in user can create a project; the creator becomes that project's manager.
-- (Workspace admins are unchanged: they still see and manage every project.)

create or replace function public.create_project(p_key text, p_name text, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr public.projects;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Give the project a name'; end if;
  if upper(btrim(coalesce(p_key, ''))) !~ '^[A-Z][A-Z0-9]{1,5}$' then
    raise exception 'The key must be 2 to 6 letters or digits and start with a letter';
  end if;
  insert into public.projects (key, name, description, created_by)
  values (upper(btrim(p_key)), btrim(p_name), coalesce(p_description, ''), auth.uid())
  returning * into pr;
  insert into public.project_members (project_id, user_id, role) values (pr.id, auth.uid(), 'manager');
  return to_jsonb(pr);
exception when unique_violation then
  raise exception 'A project with the key % already exists', upper(btrim(p_key));
end $$;

revoke execute on function public.create_project(text, text, text) from public, anon;
grant  execute on function public.create_project(text, text, text) to authenticated;

-- Refresh the API schema cache so the new function is callable immediately.
notify pgrst, 'reload schema';
