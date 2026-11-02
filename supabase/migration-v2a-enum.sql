-- Tasklane migration v2, part A (existing databases only; fresh projects run schema.sql instead).
-- Run this on its own FIRST. Postgres must commit the new enum values before functions can use them.
alter type public.task_status add value if not exists 'proposed';
alter type public.task_status add value if not exists 'declined';
