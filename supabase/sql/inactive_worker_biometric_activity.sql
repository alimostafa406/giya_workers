-- REVIEW / EXECUTE MANUALLY: read-only admin activity for inactive workers.
-- This function never changes workers, teams, mappings, events, or attendance.

create or replace function public.get_inactive_worker_biometric_activity(
  p_attendance_date date default ((now() at time zone 'Africa/Kinshasa')::date)
)
returns table (
  event_id uuid,
  attendance_date date,
  event_timestamp timestamptz,
  device_id text,
  device_employee_no text,
  device_name text,
  worker_id uuid,
  worker_name text,
  employee_code text,
  team_name text,
  resolution_reason text
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
  if p_attendance_date is null then
    raise exception 'Attendance date is required' using errcode = '22004';
  end if;

  return query
  with candidates as (
    select
      e.id as event_id,
      e.attendance_date,
      e.event_timestamp,
      e.device_id,
      e.device_employee_no,
      e.device_name,
      m.id as mapping_id,
      m.worker_id,
      case when m.device_id = e.device_id then 1 else 2 end as mapping_priority
    from public.biometric_attendance_events as e
    join public.biometric_worker_mapping as m
      on btrim(m.device_employee_no) = btrim(e.device_employee_no)
     and m.is_active is true
     and m.mapping_review_state = 'confirmed'
     and (m.device_id = e.device_id or m.device_id is null)
    where e.attendance_date = p_attendance_date
      and e.device_employee_no is not null
  ),
  preferred_priority as (
    select c.event_id, min(c.mapping_priority) as mapping_priority
    from candidates as c
    group by c.event_id
  ),
  resolved as (
    select
      c.event_id,
      c.attendance_date,
      c.event_timestamp,
      c.device_id,
      c.device_employee_no,
      c.device_name,
      (array_agg(c.worker_id order by c.mapping_id))[1] as worker_id
    from candidates as c
    join preferred_priority as p
      on p.event_id = c.event_id
     and p.mapping_priority = c.mapping_priority
    group by c.event_id, c.attendance_date, c.event_timestamp, c.device_id, c.device_employee_no, c.device_name
    having count(distinct c.worker_id) = 1
  )
  select
    r.event_id,
    r.attendance_date,
    r.event_timestamp,
    r.device_id,
    r.device_employee_no,
    r.device_name,
    w.id,
    w.full_name::text,
    w.employee_code::text,
    t.name::text,
    'inactive_worker'::text
  from resolved as r
  join public.workers as w
    on w.id = r.worker_id
   and w.is_active is false
  left join public.teams as t on t.id = w.team_id
  order by r.event_timestamp desc;
end;
$$;

revoke all on function public.get_inactive_worker_biometric_activity(date) from public;
grant execute on function public.get_inactive_worker_biometric_activity(date) to authenticated;
