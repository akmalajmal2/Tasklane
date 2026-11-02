-- Run once on an existing database (SQL Editor).
-- Adds a manual card order inside each column + a manager-only reorder function.

alter table public.tasks add column if not exists position double precision;

-- Seed: keep today's look (priority, then due date) as the starting order, per column.
update public.tasks t set position = s.rn * 1000
from (
  select id, row_number() over (
    partition by project_id, status
    order by case priority::text when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, due_at
  ) as rn
  from public.tasks
) s
where s.id = t.id and t.position is null;

-- New cards land at the bottom of their column (epoch milliseconds is always larger than the seeds).
alter table public.tasks alter column position set default (extract(epoch from clock_timestamp()) * 1000);
alter table public.tasks alter column position set not null;

-- A card that changes column goes to the bottom of the new column, unless the caller set a position.
create or replace function public.tasks_bump_position()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.position is not distinct from old.position then
    new.position := extract(epoch from clock_timestamp()) * 1000;
  end if;
  return new;
end $$;

drop trigger if exists tasks_bump_position on public.tasks;
create trigger tasks_bump_position before update on public.tasks
  for each row execute function public.tasks_bump_position();

-- Managers / admins put a card anywhere in its column.
create or replace function public.reorder_task(p_task uuid, p_position double precision)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare t public.tasks; me uuid := auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into t from public.tasks where id = p_task for update;
  if not found then raise exception 'Task not found'; end if;
  if not (public.is_admin() or public.member_role(t.project_id) = 'manager') then
    raise exception 'Only a manager can reorder cards';
  end if;
  update public.tasks set position = p_position, updated_by = me, updated_at = now()
   where id = t.id returning * into t;
  return t;
end $$;

revoke execute on function public.reorder_task(uuid, double precision) from public, anon;
grant  execute on function public.reorder_task(uuid, double precision) to authenticated;
