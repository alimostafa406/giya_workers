-- REVIEW / EXECUTE MANUALLY. Freeze the public normal-worker morning report
-- when the canonical morning verification completes. Browser callers receive
-- only the snapshot for today; no attendance, worker, or payroll data changes.

begin;

create table if not exists public.foreign_monitoring_normal_report_snapshot (
  report_date date primary key,
  verification_run_id uuid not null references public.attendance_verification_run(id),
  payload jsonb not null,
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);

alter table public.foreign_monitoring_normal_report_snapshot enable row level security;
revoke all on table public.foreign_monitoring_normal_report_snapshot from public, anon, authenticated;

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

create or replace function public.foreign_monitoring_publish_normal_report_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.verification_type='morning' and new.status='complete' then
    insert into public.foreign_monitoring_normal_report_snapshot (report_date,verification_run_id,payload)
    values (new.work_date,new.id,public.foreign_monitoring_normal_report_payload(new.work_date,new.work_date))
    on conflict (report_date) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists foreign_monitoring_publish_normal_report_snapshot on public.attendance_verification_run;
create trigger foreign_monitoring_publish_normal_report_snapshot
after insert or update of status on public.attendance_verification_run
for each row execute function public.foreign_monitoring_publish_normal_report_snapshot();

-- If this migration is installed after today's verification already completed,
-- publish once from its immutable completion. Existing snapshots remain frozen.
insert into public.foreign_monitoring_normal_report_snapshot (report_date,verification_run_id,payload)
select v.work_date,v.id,public.foreign_monitoring_normal_report_payload(v.work_date,v.work_date)
from public.attendance_verification_run v
where v.work_date=(now() at time zone 'Africa/Kinshasa')::date
  and v.verification_type='morning' and v.status='complete'
on conflict (report_date) do nothing;

create or replace function public.get_normal_worker_attendance_report(
  p_date_from date,p_date_to date,p_session_token text
)
returns jsonb
language plpgsql
volatile security definer set search_path=public,pg_temp
as $$
declare v_today date := (now() at time zone 'Africa/Kinshasa')::date;
declare v_snapshot jsonb;
begin
  if p_date_from is null or p_date_to is null then raise exception 'date range is required' using errcode='22004'; end if;
  if p_date_to<p_date_from or (p_date_to-p_date_from)>31 then raise exception 'date range must be between 1 and 32 calendar days' using errcode='22023'; end if;
  perform public.foreign_monitoring_require_session(p_session_token);
  if p_date_from<=v_today and p_date_to>=v_today then
    select payload into v_snapshot from public.foreign_monitoring_normal_report_snapshot where report_date=v_today;
    if v_snapshot is null then
      perform public.foreign_monitoring_touch_session(p_session_token);
      return jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to,'reportAvailable',false,'withheldCurrentDay',true,'finalizedSnapshot',false,'workers','[]'::jsonb,'teams','[]'::jsonb,'attendance','[]'::jsonb,'mappedBiometricEvents','[]'::jsonb);
    end if;
    perform public.foreign_monitoring_touch_session(p_session_token);
    return v_snapshot;
  end if;
  select public.foreign_monitoring_normal_report_payload(p_date_from,p_date_to) into v_snapshot;
  perform public.foreign_monitoring_touch_session(p_session_token);
  return v_snapshot;
end $$;

revoke all on function public.foreign_monitoring_normal_report_payload(date,date) from public,anon,authenticated;
revoke all on function public.foreign_monitoring_publish_normal_report_snapshot() from public,anon,authenticated;
revoke all on function public.get_normal_worker_attendance_report(date,date,text) from public,anon,authenticated;
grant execute on function public.get_normal_worker_attendance_report(date,date,text) to anon,authenticated;

commit;
