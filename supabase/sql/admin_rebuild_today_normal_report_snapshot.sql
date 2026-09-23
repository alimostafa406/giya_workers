-- REVIEW / EXECUTE MANUALLY.  A deliberate administrator-only republish for
-- today's already-finalized public normal-worker report.  It never changes
-- attendance, verification, biometric mappings, payroll, or past snapshots.

begin;

-- Keep the public report payload aligned with the same date-aware operational
-- roster rule used by the main application.  This is especially important for
-- a same-day manual republish after an operational start-date correction.
create or replace function public.foreign_monitoring_normal_report_payload(
  p_date_from date,
  p_date_to date
)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with
  normal_workers as materialized (
    select w.id,w.team_id,w.full_name,w.employee_code,w.phone,w.created_at
    from public.workers w
    left join public.teams t on t.id=w.team_id
    where w.is_active=true
      and (w.operational_start_date is null or w.operational_start_date <= p_date_to)
      and t.name is distinct from 'Adminstration'
      and not exists (
        select 1 from public.worker_staff_classification c
        where c.worker_id=w.id and c.classification='special_staff'
      )
  ),
  worker_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'teamId',w.team_id,'fullName',w.full_name,
      'employeeCode',w.employee_code,'phone',w.phone,'createdAt',w.created_at
    ) order by w.created_at desc),'[]'::jsonb) value from normal_workers w
  ),
  team_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'name',t.name,'isActive',t.is_active,
      'supervisorId',t.supervisor_id,
      'supervisorName',coalesce(s.full_name,s.username,''),
      'supervisorPhone',coalesce(s.phone,'')
    ) order by t.name),'[]'::jsonb) value
    from public.teams t left join public.supervisors s on s.id=t.supervisor_id
    where t.name is distinct from 'Adminstration'
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
    from public.attendance a join normal_workers w on w.id=a.worker_id
    where a.attendance_date between p_date_from and p_date_to
  ),
  mapped_events as (
    select resolved.worker_id,e.attendance_date,e.event_timestamp
    from public.biometric_attendance_events e
    cross join lateral (
      select m.worker_id from public.biometric_worker_mapping m
      where m.is_active=true and m.mapping_review_state='confirmed'
        and btrim(m.device_employee_no)=btrim(e.device_employee_no)
        and (m.device_id=e.device_id or m.device_id is null)
      order by case when m.device_id=e.device_id then 0 else 1 end,m.updated_at desc,m.id limit 1
    ) resolved
    join normal_workers w on w.id=resolved.worker_id
    where e.device_employee_no is not null
      and e.attendance_date between p_date_from and p_date_to
  ),
  event_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'workerId',worker_id,'date',attendance_date,'timestamp',event_timestamp
    ) order by attendance_date,worker_id,event_timestamp),'[]'::jsonb) value from mapped_events
  )
  select jsonb_build_object(
    'dateFrom',p_date_from,'dateTo',p_date_to,'reportAvailable',true,
    'withheldCurrentDay',false,'finalizedSnapshot',true,
    'workers',w.value,'teams',t.value,'attendance',a.value,'mappedBiometricEvents',e.value
  ) from worker_json w cross join team_json t cross join attendance_json a cross join event_json e;
$$;

create or replace function public.admin_rebuild_today_normal_report_snapshot()
returns table(report_date date, verification_run_id uuid, finalized_at timestamptz)
language plpgsql
volatile
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_verification_run_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;

  select v.id into v_verification_run_id
  from public.attendance_verification_run v
  where v.work_date=v_today
    and v.verification_type='morning'
    and v.status='complete'
  order by v.completed_at desc nulls last,v.created_at desc
  limit 1;

  if v_verification_run_id is null then
    raise exception 'today morning verification is not complete' using errcode='P0001';
  end if;

  return query
  insert into public.foreign_monitoring_normal_report_snapshot as snapshot (
    report_date,verification_run_id,payload,finalized_at
  ) values (
    v_today,v_verification_run_id,
    public.foreign_monitoring_normal_report_payload(v_today,v_today),now()
  )
  on conflict (report_date) do update
    set verification_run_id=excluded.verification_run_id,
        payload=excluded.payload,
        finalized_at=excluded.finalized_at
  returning snapshot.report_date,snapshot.verification_run_id,snapshot.finalized_at;
end;
$$;

revoke all on function public.admin_rebuild_today_normal_report_snapshot() from public,anon;
grant execute on function public.admin_rebuild_today_normal_report_snapshot() to authenticated;

commit;
