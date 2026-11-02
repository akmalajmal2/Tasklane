-- Run once on an existing database (SQL Editor). Safe to run again.
-- Makes sure live updates work: the tables the app listens to must be in the "supabase_realtime"
-- publication. Older databases (set up before this was added to schema.sql) may be missing some,
-- which is why a new invitation only showed up after a manual refresh.

do $$
declare t text;
begin
  foreach t in array array['tasks','notifications','project_members','project_invites'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
