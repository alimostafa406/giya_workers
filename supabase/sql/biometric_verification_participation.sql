-- REVIEW / EXECUTE MANUALLY: explicit, auditable biometric participation scope.
-- Additive only. This migration does not alter attendance, workers, mappings,
-- biometric events, payroll, or existing verification evidence.

create table if not exists public.worker_biometric_participation (
  worker_id uuid primary key references public.workers(id) on delete restrict,
  participation_state text not null check (
    participation_state in ('enrolled', 'not_enrolled', 'unknown')
  ),
  decision_source text not null check (btrim(decision_source) <> ''),
  decision_note text,
  decided_at timestamptz not null default now(),
  decided_by uuid references public.admins(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_biometric_participation_audit (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  previous_state text check (
    previous_state is null or previous_state in ('enrolled', 'not_enrolled', 'unknown')
  ),
  new_state text not null check (
    new_state in ('enrolled', 'not_enrolled', 'unknown')
  ),
  decision_source text not null check (btrim(decision_source) <> ''),
  decision_note text,
  decided_at timestamptz not null,
  decided_by uuid references public.admins(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create index if not exists worker_biometric_participation_audit_worker_time_idx
  on public.worker_biometric_participation_audit (worker_id, recorded_at desc);
create index if not exists worker_biometric_participation_decided_by_idx
  on public.worker_biometric_participation (decided_by)
  where decided_by is not null;
create index if not exists worker_biometric_participation_audit_decided_by_idx
  on public.worker_biometric_participation_audit (decided_by)
  where decided_by is not null;

create or replace function public.set_worker_biometric_participation_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.audit_worker_biometric_participation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
    or old.participation_state is distinct from new.participation_state
    or old.decision_source is distinct from new.decision_source
    or old.decision_note is distinct from new.decision_note
    or old.decided_at is distinct from new.decided_at
    or old.decided_by is distinct from new.decided_by then
    insert into public.worker_biometric_participation_audit (
      worker_id, previous_state, new_state, decision_source,
      decision_note, decided_at, decided_by
    ) values (
      new.worker_id,
      case when tg_op = 'INSERT' then null else old.participation_state end,
      new.participation_state, new.decision_source,
      new.decision_note, new.decided_at, new.decided_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists worker_biometric_participation_set_updated_at
  on public.worker_biometric_participation;
create trigger worker_biometric_participation_set_updated_at
before update on public.worker_biometric_participation
for each row execute function public.set_worker_biometric_participation_updated_at();

drop trigger if exists worker_biometric_participation_audit_change
  on public.worker_biometric_participation;
create trigger worker_biometric_participation_audit_change
after insert or update on public.worker_biometric_participation
for each row execute function public.audit_worker_biometric_participation();

alter table public.worker_biometric_participation enable row level security;
alter table public.worker_biometric_participation_audit enable row level security;

drop policy if exists worker_biometric_participation_admin_select
  on public.worker_biometric_participation;
create policy worker_biometric_participation_admin_select
on public.worker_biometric_participation for select to authenticated
using (public.is_admin());

drop policy if exists worker_biometric_participation_audit_admin_select
  on public.worker_biometric_participation_audit;
create policy worker_biometric_participation_audit_admin_select
on public.worker_biometric_participation_audit for select to authenticated
using (public.is_admin());

revoke all on table public.worker_biometric_participation from public, anon, authenticated;
revoke all on table public.worker_biometric_participation_audit from public, anon, authenticated;
grant select on table public.worker_biometric_participation to authenticated;
grant select on table public.worker_biometric_participation_audit to authenticated;
grant select, insert, update on table public.worker_biometric_participation to service_role;
grant select, insert on table public.worker_biometric_participation_audit to service_role;

-- A confirmed active mapping is already an explicit, durable enrollment fact.
-- This does not use device inventory, names, employee codes, or inferred matches.
insert into public.worker_biometric_participation (
  worker_id, participation_state, decision_source, decision_note
)
select distinct
  mapping.worker_id,
  'enrolled',
  'confirmed_mapping_backfill',
  'Initialized from an existing active confirmed biometric mapping'
from public.biometric_worker_mapping as mapping
where mapping.is_active is true
  and mapping.mapping_review_state = 'confirmed'
on conflict (worker_id) do nothing;

alter table public.attendance_verification_run
  add column if not exists active_normal_roster_count integer not null default 0
    check (active_normal_roster_count >= 0),
  add column if not exists biometric_in_scope_count integer not null default 0
    check (biometric_in_scope_count >= 0),
  add column if not exists non_biometric_excluded_count integer not null default 0
    check (non_biometric_excluded_count >= 0),
  add column if not exists unknown_biometric_status_count integer not null default 0
    check (unknown_biometric_status_count >= 0),
  add column if not exists biometric_in_scope_worker_ids uuid[] not null default array[]::uuid[],
  add column if not exists non_biometric_excluded_worker_ids uuid[] not null default array[]::uuid[],
  add column if not exists unknown_biometric_status_worker_ids uuid[] not null default array[]::uuid[];

alter table public.attendance_verification_worker
  drop constraint if exists attendance_verification_worker_verification_result_check;
alter table public.attendance_verification_worker
  add constraint attendance_verification_worker_verification_result_check check (
    verification_result in (
      'attendance_present', 'recovered', 'verified_no_event',
      'manual_protected', 'unresolved', 'not_enrolled_excluded'
    )
  );
