-- v12a: adds the "On hold" status.
-- Run this file ALONE first (it must commit before v12b can use the new value).
-- Safe to run again. Brand-new databases (schema.sql) already have it: skip.
alter type public.task_status add value if not exists 'on_hold';
