-- REVIEW / EXECUTE MANUALLY: retain unmapped biometric observations in the
-- existing append-only event table and expose an admin-only rolling review.
-- This does not create attendance, mappings, workers, or payroll records.

alter table public.biometric_attendance_events
  add column if not exists device_employee_no text,
  add column if not exists device_name text;

-- Unmapped observations intentionally have no workers.id until an admin
-- confirms a mapping. The existing foreign key remains in force when present.
alter table public.biometric_attendance_events
  alter column worker_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'biometric_attendance_events_employee_no_not_blank'
      and conrelid = 'public.biometric_attendance_events'::regclass
  ) then
    alter table public.biometric_attendance_events
      add constraint biometric_attendance_events_employee_no_not_blank
      check (device_employee_no is null or btrim(device_employee_no) <> '');
  end if;
end;
$$;

-- Best-effort enrichment for existing resolved observations. Rows whose old
-- mapping no longer exists remain valid historical observations.
update public.biometric_attendance_events as e
set device_employee_no = m.device_employee_no,
    device_name = coalesce(e.device_name, m.device_name)
from public.biometric_worker_mapping as m
where e.device_employee_no is null
  and e.worker_id = m.worker_id
  and m.is_active is true
  and m.mapping_review_state = 'confirmed'
  and (
    m.device_id = e.device_id
    or (
      m.device_id is null
      and not exists (
        select 1 from public.biometric_worker_mapping as exact_mapping
        where exact_mapping.worker_id = e.worker_id
          and exact_mapping.device_id = e.device_id
          and exact_mapping.is_active is true
          and exact_mapping.mapping_review_state = 'confirmed'
      )
    )
  );

create index if not exists biometric_attendance_events_employee_date_time_idx
  on public.biometric_attendance_events (device_employee_no, attendance_date, event_timestamp desc)
  where device_employee_no is not null;

create or replace function public.get_recent_unmapped_biometric_identities(
  p_end_date date,
  p_days integer default 7
)
returns table (
  device_employee_no text,
  device_name text,
  latest_event_at timestamptz,
  recent_event_count bigint,
  devices_seen text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Active admin access is required';
  end if;
  if p_end_date is null then
    raise exception 'End date is required' using errcode = '22004';
  end if;
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'Days must be between 1 and 31' using errcode = '22023';
  end if;

  return query
  select
    e.device_employee_no::text,
    (array_agg(e.device_name order by e.event_timestamp desc)
      filter (where e.device_name is not null))[1]::text as device_name,
    max(e.event_timestamp) as latest_event_at,
    count(*)::bigint as recent_event_count,
    array_agg(distinct e.device_id order by e.device_id)::text[] as devices_seen
  from public.biometric_attendance_events as e
  where e.device_employee_no is not null
    and e.attendance_date between (p_end_date - (p_days - 1)) and p_end_date
    and not exists (
      select 1
      from public.biometric_worker_mapping as m
      where m.device_employee_no = e.device_employee_no
        and m.is_active is true
        and (m.device_id = e.device_id or m.device_id is null)
    )
    and not exists (
      select 1
      from public.biometric_device_identity_review as r
      where r.device_employee_no = e.device_employee_no
        and (r.device_id = e.device_id or r.device_id is null)
        and r.review_state = 'ignored'
    )
  group by e.device_id, e.device_employee_no
  order by max(e.event_timestamp) desc, e.device_id, e.device_employee_no;
end;
$$;

revoke all on function public.get_recent_unmapped_biometric_identities(date, integer) from public;
grant execute on function public.get_recent_unmapped_biometric_identities(date, integer) to authenticated;
