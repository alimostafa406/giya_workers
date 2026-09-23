-- REVIEW / EXECUTE MANUALLY.  A null value preserves the historic behaviour:
-- the worker is operational for every date for which they are active.  A value
-- limits operational roster, attendance and payroll eligibility to that date
-- and later without altering historical attendance rows.

alter table public.workers
  add column if not exists operational_start_date date;

comment on column public.workers.operational_start_date is
  'Optional first operational attendance date. Null preserves existing worker history and eligibility.';
