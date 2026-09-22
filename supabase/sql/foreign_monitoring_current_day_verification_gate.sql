-- REVIEW / EXECUTE MANUALLY. Central publication gate for the read-only
-- foreign-attendance viewer. The viewer receives no current-day Normal Worker
-- roster, attendance, or biometric evidence until the canonical final morning
-- verification has completed. Historical dates remain unchanged.
--
-- This does not grant the viewer access to attendance_verification_run. Both
-- session validation and the readiness decision remain inside these existing
-- SECURITY DEFINER, token-authenticated read wrappers.

begin;

create or replace function public.get_normal_worker_attendance(
  p_attendance_date date,
  p_session_token text
)
returns table (
  worker_id uuid,
  worker_name text,
  team_name text,
  attendance_date date,
  status text,
  check_in time,
  check_out time
)
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_today_complete boolean := false;
begin
  if p_attendance_date is null then
    raise exception 'attendance date is required' using errcode='22004';
  end if;

  perform public.foreign_monitoring_require_session(p_session_token);

  if p_attendance_date = v_today then
    select exists (
      select 1
      from public.attendance_verification_run verification
      where verification.work_date = v_today
        and verification.verification_type = 'morning'
        and verification.status = 'complete'
    ) into v_today_complete;

    -- Fail closed: returning zero rows avoids leaking a provisional roster to
    -- alternate legacy callers while preserving the established session flow.
    if not v_today_complete then
      perform public.foreign_monitoring_touch_session(p_session_token);
      return;
    end if;
  end if;

  return query
  select
    w.id,
    w.full_name::text,
    coalesce(t.name,'')::text,
    p_attendance_date,
    a.status::text,
    a.check_in,
    a.check_out
  from public.workers w
  left join public.teams t on t.id=w.team_id
  left join public.attendance a
    on a.worker_id=w.id
   and a.attendance_date=p_attendance_date
  where w.is_active=true
    and not exists (
      select 1
      from public.worker_staff_classification c
      where c.worker_id=w.id
        and c.classification='special_staff'
    )
  order by w.full_name;

  perform public.foreign_monitoring_touch_session(p_session_token);
end $$;

create or replace function public.get_normal_worker_attendance_report(
  p_date_from date,
  p_date_to date,
  p_session_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb;
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_requests_today boolean := false;
  v_today_complete boolean := false;
begin
  if p_date_from is null or p_date_to is null then
    raise exception 'date range is required' using errcode='22004';
  end if;
  if p_date_to<p_date_from or (p_date_to-p_date_from)>31 then
    raise exception 'date range must be between 1 and 32 calendar days' using errcode='22023';
  end if;

  -- Both manager and administrator are valid normal-report readers.
  perform public.foreign_monitoring_require_session(p_session_token);

  v_requests_today := p_date_from <= v_today and p_date_to >= v_today;
  if v_requests_today then
    select exists (
      select 1
      from public.attendance_verification_run verification
      where verification.work_date = v_today
        and verification.verification_type = 'morning'
        and verification.status = 'complete'
    ) into v_today_complete;

    -- Return an explicit successful empty publication. An RPC error would let
    -- a browser retain an older provisional snapshot in React state.
    if not v_today_complete then
      perform public.foreign_monitoring_touch_session(p_session_token);
      return jsonb_build_object(
        'dateFrom', p_date_from,
        'dateTo', p_date_to,
        'reportAvailable', false,
        'withheldCurrentDay', true,
        'workers', '[]'::jsonb,
        'teams', '[]'::jsonb,
        'attendance', '[]'::jsonb,
        'mappedBiometricEvents', '[]'::jsonb
      );
    end if;
  end if;

  with
  normal_workers as materialized (
    select w.id,w.team_id,w.full_name,w.employee_code,w.phone,w.created_at
    from public.workers w
    where w.is_active=true
      and not exists (
        select 1 from public.worker_staff_classification c
        where c.worker_id=w.id and c.classification='special_staff'
      )
  ),
  worker_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'teamId',w.team_id,'fullName',w.full_name,
      'employeeCode',w.employee_code,'phone',w.phone,'createdAt',w.created_at
    ) order by w.created_at desc),'[]'::jsonb) value
    from normal_workers w
  ),
  team_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'name',t.name,'isActive',t.is_active,
      'supervisorId',t.supervisor_id,
      'supervisorName',coalesce(s.full_name,s.username,''),
      'supervisorPhone',coalesce(s.phone,'')
    ) order by t.name),'[]'::jsonb) value
    from public.teams t
    left join public.supervisors s on s.id=t.supervisor_id
  ),
  attendance_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'workerId',a.worker_id,'date',a.attendance_date,
      'status',a.status,'checkIn',a.check_in,'checkOut',a.check_out,
      'note',a.note,'attendanceSource',a.attendance_source,
      'manualOverride',a.manual_override,
      'biometricMetadata',a.biometric_sync_metadata,
      'createdAt',a.created_at,'updatedAt',a.updated_at
    ) order by a.attendance_date,a.worker_id,a.updated_at),'[]'::jsonb) value
    from public.attendance a
    join normal_workers w on w.id=a.worker_id
    where a.attendance_date between p_date_from and p_date_to
  ),
  mapped_events as (
    select resolved.worker_id,e.attendance_date,e.event_timestamp
    from public.biometric_attendance_events e
    cross join lateral (
      select m.worker_id
      from public.biometric_worker_mapping m
      where m.is_active=true
        and m.mapping_review_state='confirmed'
        and btrim(m.device_employee_no)=btrim(e.device_employee_no)
        and (m.device_id=e.device_id or m.device_id is null)
      order by case when m.device_id=e.device_id then 0 else 1 end,m.updated_at desc,m.id
      limit 1
    ) resolved
    join normal_workers w on w.id=resolved.worker_id
    where e.device_employee_no is not null
      and e.attendance_date between p_date_from and p_date_to
  ),
  event_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'workerId',worker_id,'date',attendance_date,'timestamp',event_timestamp
    ) order by attendance_date,worker_id,event_timestamp),'[]'::jsonb) value
    from mapped_events
  )
  select jsonb_build_object(
    'dateFrom',p_date_from,'dateTo',p_date_to,
    'reportAvailable', true,
    'withheldCurrentDay', false,
    'workers',w.value,'teams',t.value,'attendance',a.value,'mappedBiometricEvents',e.value
  ) into v_result
  from worker_json w cross join team_json t cross join attendance_json a cross join event_json e;

  perform public.foreign_monitoring_touch_session(p_session_token);
  return v_result;
end $$;

-- Preserve the existing read-only browser role boundary. No table grants or
-- verification-run grants are added by this migration.
revoke all on function public.get_normal_worker_attendance(date,text) from public,anon,authenticated;
grant execute on function public.get_normal_worker_attendance(date,text) to anon,authenticated;
revoke all on function public.get_normal_worker_attendance_report(date,date,text) from public,anon,authenticated;
grant execute on function public.get_normal_worker_attendance_report(date,date,text) to anon,authenticated;

commit;
