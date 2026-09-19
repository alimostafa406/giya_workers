-- REVIEW / EXECUTE MANUALLY: durable authority for final morning verification.
-- Additive only. This migration does not alter attendance, workers, mappings,
-- biometric events, payroll, or historical records.

create table if not exists public.attendance_verification_run (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  verification_type text not null check (verification_type in ('morning')),
  status text not null check (status in ('pending', 'running', 'complete', 'incomplete', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  target_worker_count integer not null default 0 check (target_worker_count >= 0),
  workers_expected_count integer not null default 0 check (workers_expected_count >= 0),
  workers_with_checkin_count integer not null default 0 check (workers_with_checkin_count >= 0),
  workers_verified_no_event_count integer not null default 0 check (workers_verified_no_event_count >= 0),
  verified_worker_count integer not null default 0 check (verified_worker_count >= 0),
  recovered_worker_count integer not null default 0 check (recovered_worker_count >= 0),
  unresolved_worker_count integer not null default 0 check (unresolved_worker_count >= 0),
  recovered_event_count integer not null default 0 check (recovered_event_count >= 0),
  roster_worker_ids uuid[] not null default array[]::uuid[],
  device_failure_summary jsonb not null default '{}'::jsonb,
  agent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_verification_run_date_type_key unique (work_date, verification_type),
  constraint attendance_verification_run_completion_valid check (
    (status = 'complete' and completed_at is not null and unresolved_worker_count = 0)
    or status <> 'complete'
  )
);

create table if not exists public.attendance_verification_worker (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.attendance_verification_run(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete restrict,
  verification_result text not null check (
    verification_result in ('attendance_present', 'recovered', 'verified_no_event', 'manual_protected', 'unresolved')
  ),
  relevant_query_count integer not null default 0 check (relevant_query_count >= 0),
  evidence_event_count integer not null default 0 check (evidence_event_count >= 0),
  verification_details jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_verification_worker_run_worker_key unique (run_id, worker_id)
);

create index if not exists attendance_verification_worker_result_idx
  on public.attendance_verification_worker (run_id, verification_result);

create or replace function public.set_attendance_verification_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists attendance_verification_run_set_updated_at on public.attendance_verification_run;
create trigger attendance_verification_run_set_updated_at
before update on public.attendance_verification_run
for each row execute function public.set_attendance_verification_updated_at();

drop trigger if exists attendance_verification_worker_set_updated_at on public.attendance_verification_worker;
create trigger attendance_verification_worker_set_updated_at
before update on public.attendance_verification_worker
for each row execute function public.set_attendance_verification_updated_at();

alter table public.attendance_verification_run enable row level security;
alter table public.attendance_verification_worker enable row level security;

drop policy if exists attendance_verification_run_admin_select on public.attendance_verification_run;
create policy attendance_verification_run_admin_select
on public.attendance_verification_run for select to authenticated
using (public.is_admin());

drop policy if exists attendance_verification_worker_admin_select on public.attendance_verification_worker;
create policy attendance_verification_worker_admin_select
on public.attendance_verification_worker for select to authenticated
using (public.is_admin());

revoke all on table public.attendance_verification_run from public, anon, authenticated;
revoke all on table public.attendance_verification_worker from public, anon, authenticated;
grant select on table public.attendance_verification_run to authenticated;
grant select on table public.attendance_verification_worker to authenticated;
grant select, insert, update on table public.attendance_verification_run to service_role;
grant select, insert, update on table public.attendance_verification_worker to service_role;
