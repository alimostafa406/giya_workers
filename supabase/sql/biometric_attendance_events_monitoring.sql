-- REVIEW ONLY: append-only biometric observations for foreign-worker monitoring.
-- This does not alter attendance, mappings, payroll, or existing worker data.

create table if not exists public.biometric_attendance_events (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  attendance_date date not null,
  event_timestamp timestamptz not null,
  device_id text not null check (length(trim(device_id)) > 0),
  event_identity text not null check (length(trim(event_identity)) > 0),
  created_at timestamptz not null default now(),
  constraint biometric_attendance_events_device_identity_key unique (device_id, event_identity)
);

create index if not exists biometric_attendance_events_worker_date_time_idx
  on public.biometric_attendance_events (worker_id, attendance_date, event_timestamp);

alter table public.biometric_attendance_events enable row level security;

-- No direct public table access. The local Agent uses service_role; the public
-- viewer receives only an aggregate through the narrow SECURITY DEFINER RPC.
revoke all on table public.biometric_attendance_events from public, anon, authenticated;
grant select, insert on table public.biometric_attendance_events to service_role;

create or replace function public.get_foreign_worker_monitoring(p_attendance_date date)
returns table (
  worker_id uuid,
  worker_name text,
  team_name text,
  monitoring_status text,
  first_punch_time time,
  last_punch_time time,
  punch_times time[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_attendance_date is null then
    raise exception 'attendance date is required' using errcode = '22004';
  end if;

  if p_attendance_date < date '2000-01-01'
    or p_attendance_date > (current_date + 366) then
    raise exception 'attendance date is outside the allowed range' using errcode = '22007';
  end if;

  return query
  select
    w.id as worker_id,
    w.full_name::text as worker_name,
    coalesce(t.name, '')::text as team_name,
    case when count(e.id) > 0 then 'present' else 'not_present' end as monitoring_status,
    min((e.event_timestamp at time zone 'Africa/Kinshasa')::time) as first_punch_time,
    max((e.event_timestamp at time zone 'Africa/Kinshasa')::time) as last_punch_time,
    coalesce(
      array_agg((e.event_timestamp at time zone 'Africa/Kinshasa')::time order by e.event_timestamp)
        filter (where e.id is not null),
      array[]::time[]
    ) as punch_times
  from public.workers as w
  left join public.teams as t
    on t.id = w.team_id
  left join public.biometric_attendance_events as e
    on e.worker_id = w.id
    and e.attendance_date = p_attendance_date
  where w.is_active is true
    and exists (
      select 1
      from public.worker_staff_classification as c
      where c.worker_id = w.id
        and c.classification = 'special_staff'
    )
  group by w.id, w.full_name, t.name
  order by w.full_name;
end;
$$;

revoke all on function public.get_foreign_worker_monitoring(date) from public;
grant execute on function public.get_foreign_worker_monitoring(date) to anon, authenticated;
