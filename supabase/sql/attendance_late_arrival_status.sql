-- REVIEW / EXECUTE MANUALLY: add the auditable late-arrival attendance state.
-- Deploy this migration before starting agent code that writes status = 'late'.
-- This migration changes no workers, mappings, teams, or attendance timestamps.

alter table public.attendance
  drop constraint if exists attendance_status_check;

alter table public.attendance
  add constraint attendance_status_check
  check (status in ('pending', 'in_progress', 'present', 'late', 'half_day', 'absent'));

create or replace function public.set_attendance_day_fraction_from_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.attendance_day_fraction := case new.status
    when 'present' then 1.0
    when 'late' then case when new.check_out is null then 0.5 else 1.0 end
    when 'half_day' then 0.5
    when 'absent' then 0
    when 'pending' then null
    when 'in_progress' then null
    else null
  end;
  return new;
end;
$$;

drop trigger if exists attendance_set_day_fraction_from_status on public.attendance;
create trigger attendance_set_day_fraction_from_status
before insert or update of status, check_in, check_out on public.attendance
for each row
execute function public.set_attendance_day_fraction_from_status();

alter table public.attendance
  drop constraint if exists attendance_day_fraction_by_status_valid;

alter table public.attendance
  add constraint attendance_day_fraction_by_status_valid
  check (
    (status = 'present' and attendance_day_fraction = 1.0)
    or (
      status = 'late'
      and check_in is not null
      and (
        (check_out is null and attendance_day_fraction = 0.5)
        or (check_out is not null and attendance_day_fraction = 1.0)
      )
    )
    or (status = 'half_day' and attendance_day_fraction = 0.5)
    or (status = 'absent' and attendance_day_fraction = 0)
    or (status in ('pending', 'in_progress') and attendance_day_fraction is null)
  );

alter table public.attendance
  drop constraint if exists attendance_workflow_times_valid;

alter table public.attendance
  add constraint attendance_workflow_times_valid
  check (
    (status = 'pending' and check_in is null and check_out is null)
    or (status = 'in_progress' and check_in is not null and check_out is null)
    or (status = 'half_day' and check_in is not null and check_out is null)
    or (status = 'late' and check_in is not null)
    or status in ('present', 'absent')
  );

comment on constraint attendance_status_check on public.attendance is
  'late records preserve a genuine post-08:00 biometric check-in and cannot be finalized as absent.';
