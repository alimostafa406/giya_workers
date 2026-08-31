-- REVIEW / EXECUTE MANUALLY: admin-only classification of observed biometric
-- events that could not safely create attendance. This is read-only reporting:
-- it does not create attendance, mappings, workers, or device identities.

create or replace function public.get_unresolved_biometric_attendance(
  p_attendance_date date default ((now() at time zone 'Africa/Kinshasa')::date)
)
returns table (
  event_id uuid,
  attendance_date date,
  event_timestamp timestamptz,
  device_id text,
  device_employee_no text,
  device_name text,
  resolution_reason text,
  mapping_review_state text,
  worker_id uuid,
  worker_name text,
  employee_code text,
  worker_is_active boolean,
  staff_classification text,
  is_valid_morning_punch boolean
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
  with observed as (
    select
      e.id as event_id,
      e.attendance_date,
      e.event_timestamp,
      e.device_id,
      e.device_employee_no,
      e.device_name,
      ((e.event_timestamp at time zone 'Africa/Kinshasa')::time between time '07:00:00' and time '09:00:00') as valid_morning
    from public.biometric_attendance_events as e
    where e.attendance_date = p_attendance_date
      and e.device_employee_no is not null
  ),
  candidate as (
    select
      o.*,
      m.id as mapping_id,
      m.worker_id as mapped_worker_id,
      m.mapping_review_state,
      m.device_id as mapping_device_id,
      case when m.device_id = o.device_id then 1 else 2 end as mapping_priority
    from observed as o
    left join public.biometric_worker_mapping as m
      on m.device_employee_no = o.device_employee_no
     and m.is_active is true
     and (m.device_id = o.device_id or m.device_id is null)
  ),
  preferred_priority as (
    select
      c.event_id,
      coalesce(
        min(c.mapping_priority) filter (where c.mapping_review_state = 'confirmed'),
        min(c.mapping_priority)
      ) as priority
    from candidate as c
    group by c.event_id
  ),
  preferred as (
    select c.*
    from candidate as c
    join preferred_priority as p
      on p.event_id = c.event_id
     and (c.mapping_priority = p.priority or (p.priority is null and c.mapping_id is null))
  ),
  classified as (
    select
      p.event_id,
      p.attendance_date,
      p.event_timestamp,
      p.device_id,
      p.device_employee_no,
      p.device_name,
      p.valid_morning,
      count(p.mapping_id) filter (where p.mapping_review_state = 'confirmed') as confirmed_count,
      count(distinct p.mapped_worker_id) filter (where p.mapping_review_state = 'confirmed') as confirmed_owner_count,
      count(distinct p.mapped_worker_id) as evidence_owner_count,
      (array_agg(p.mapping_review_state order by p.mapping_priority, p.mapping_id)
        filter (where p.mapping_id is not null))[1] as review_state,
      (array_agg(p.mapped_worker_id order by p.mapping_priority, p.mapping_id)
        filter (where p.mapping_id is not null))[1] as mapped_worker_id
    from preferred as p
    group by p.event_id, p.attendance_date, p.event_timestamp, p.device_id, p.device_employee_no, p.device_name, p.valid_morning
  ),
  resolved as (
    select
      c.*,
      w.full_name,
      w.employee_code,
      w.is_active,
      coalesce(sc.classification, 'normal') as classification,
      a.id as attendance_id,
      a.attendance_source,
      a.manual_override,
      case
        when c.confirmed_owner_count > 1 or (c.confirmed_count = 0 and c.evidence_owner_count > 1) then 'ambiguous'
        when c.confirmed_count = 0 and c.evidence_owner_count > 0 then 'needs_review'
        when c.confirmed_count = 0 then 'unmapped'
        when w.id is null or w.is_active is false then 'inactive_worker'
        when a.id is null then 'attendance_not_applied'
        else 'resolved'
      end as reason
    from classified as c
    left join public.workers as w on w.id = c.mapped_worker_id
    left join public.worker_staff_classification as sc on sc.worker_id = w.id
    left join public.attendance as a
      on a.worker_id = w.id
     and a.attendance_date = c.attendance_date
  )
  select
    r.event_id,
    r.attendance_date,
    r.event_timestamp,
    r.device_id,
    r.device_employee_no,
    r.device_name,
    r.reason,
    r.review_state,
    r.mapped_worker_id,
    r.full_name::text,
    r.employee_code::text,
    r.is_active,
    r.classification::text,
    r.valid_morning
  from resolved as r
  where r.valid_morning is true
    and r.reason <> 'resolved'
  order by
    case r.reason
      when 'ambiguous' then 1
      when 'needs_review' then 2
      when 'attendance_not_applied' then 3
      when 'inactive_worker' then 4
      else 5
    end,
    r.event_timestamp;
end;
$$;

revoke all on function public.get_unresolved_biometric_attendance(date) from public;
grant execute on function public.get_unresolved_biometric_attendance(date) to authenticated;
