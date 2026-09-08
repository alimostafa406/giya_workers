-- REVIEW ONLY: additive preparation for timestamp-aware attendance sessions.
-- Do not execute until the shadow model has been reviewed and explicitly approved.
-- This migration does not update attendance, payroll, biometric events, workers,
-- mappings, verification evidence, or any historical row.

alter table public.attendance
  add column if not exists check_in_at timestamptz,
  add column if not exists check_out_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_timestamp_order_valid'
  ) then
    alter table public.attendance
      add constraint attendance_timestamp_order_valid check (
        check_out_at is null
        or (check_in_at is not null and check_out_at >= check_in_at)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and conname = 'attendance_timestamp_work_date_valid'
  ) then
    alter table public.attendance
      add constraint attendance_timestamp_work_date_valid check (
        (check_in_at is null or (check_in_at at time zone 'Africa/Kinshasa')::date = attendance_date)
        and (
          check_out_at is null
          or (check_out_at at time zone 'Africa/Kinshasa')::date
            between attendance_date and (attendance_date + 1)
        )
      );
  end if;
end
$$;

create index if not exists attendance_worker_check_in_at_idx
  on public.attendance (worker_id, check_in_at)
  where check_in_at is not null;

create table if not exists public.biometric_attendance_event_assignment (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.biometric_attendance_events(id) on delete restrict,
  worker_id uuid references public.workers(id) on delete restrict,
  work_date date not null,
  assignment_result text not null check (assignment_result in (
    'current_session', 'previous_session', 'ambiguous_review',
    'duplicate', 'invalid_event_type'
  )),
  attendance_role text not null check (attendance_role in (
    'check_in', 'check_out', 'intermediate', 'none'
  )),
  assignment_reason text not null check (length(btrim(assignment_reason)) > 0),
  algorithm_version text not null check (length(btrim(algorithm_version)) > 0),
  assigned_at timestamptz not null default now(),
  constraint biometric_attendance_event_assignment_version_unique
    unique (event_id, algorithm_version),
  constraint biometric_attendance_event_assignment_role_valid check (
    (
      assignment_result in ('current_session', 'previous_session')
      and worker_id is not null
      and attendance_role in ('check_in', 'check_out', 'intermediate')
    )
    or (
      assignment_result in ('ambiguous_review', 'duplicate', 'invalid_event_type')
      and attendance_role = 'none'
    )
  )
);

create index if not exists biometric_attendance_event_assignment_worker_date_idx
  on public.biometric_attendance_event_assignment (worker_id, work_date, assigned_at);

create index if not exists biometric_attendance_event_assignment_review_idx
  on public.biometric_attendance_event_assignment (work_date, assigned_at)
  where assignment_result = 'ambiguous_review';

create or replace function public.reject_biometric_attendance_assignment_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Biometric attendance event assignments are append-only';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.biometric_attendance_event_assignment'::regclass
      and tgname = 'biometric_attendance_event_assignment_append_only'
      and not tgisinternal
  ) then
    create trigger biometric_attendance_event_assignment_append_only
    before update or delete on public.biometric_attendance_event_assignment
    for each row execute function public.reject_biometric_attendance_assignment_mutation();
  end if;
end
$$;

alter table public.biometric_attendance_event_assignment enable row level security;

revoke all on table public.biometric_attendance_event_assignment from public, anon, authenticated;
revoke all on function public.reject_biometric_attendance_assignment_mutation() from public, anon, authenticated;
grant select, insert on table public.biometric_attendance_event_assignment to service_role;
grant execute on function public.reject_biometric_attendance_assignment_mutation() to service_role;

comment on column public.attendance.check_in_at is
  'Nullable date-aware session check-in; legacy check_in remains available during compatibility rollout.';
comment on column public.attendance.check_out_at is
  'Nullable date-aware session checkout, including a safe following-day checkout; legacy check_out remains available during compatibility rollout.';
comment on table public.biometric_attendance_event_assignment is
  'Append-only shadow/audit decisions assigning immutable biometric events to semantic attendance work sessions.';
