-- REVIEW / EXECUTE MANUALLY: immutable Final Morning Verification run lifecycle.
-- This migration changes verification-run bookkeeping only. It does not modify
-- attendance, workers, biometric mappings/events, participation, or payroll.

-- A work date may have more than one historical verification attempt. The UUID
-- primary key remains the durable run identity. At most one non-complete attempt
-- may be retried for a date/type at a time.
alter table public.attendance_verification_run
  drop constraint if exists attendance_verification_run_date_type_key;

create unique index if not exists attendance_verification_run_one_open_attempt_idx
  on public.attendance_verification_run (work_date, verification_type)
  where status <> 'complete';

create index if not exists attendance_verification_run_latest_complete_idx
  on public.attendance_verification_run (work_date, verification_type, completed_at desc)
  where status = 'complete';

-- Completed headers are immutable historical snapshots. Current-state child
-- rows may still converge independently by their existing (run_id, worker_id)
-- key, but no process may rewrite or delete the completed run header.
create or replace function public.protect_completed_attendance_verification_run()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'complete' then
    raise exception 'Completed attendance verification runs are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_completed_attendance_verification_run() from public;

drop trigger if exists attendance_verification_run_protect_complete
  on public.attendance_verification_run;
create trigger attendance_verification_run_protect_complete
before update or delete on public.attendance_verification_run
for each row execute function public.protect_completed_attendance_verification_run();
