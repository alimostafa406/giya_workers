-- READ-ONLY production schema audit. Do not modify data or schema.

select
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'attendance'
order by ordinal_position;

select
  c.conname as constraint_name,
  c.contype as constraint_type,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.attendance'::regclass
order by c.contype, c.conname;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'attendance'
order by indexname;
