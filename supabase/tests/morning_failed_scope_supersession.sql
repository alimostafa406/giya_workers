-- Isolated fixtures; all changes (including test snapshots) roll back.
begin;
do $$
declare d date:=(now() at time zone 'Africa/Kinshasa')::date;
 coverage jsonb; proof jsonb; altered jsonb; run_id uuid; job_id uuid; state jsonb;
 scenario text; n integer:=0; att_hash text; pay_hash text; snapshot_hash text;
begin
 assert (now() at time zone 'Africa/Kinshasa')::time>=time '11:00','Run after cutoff';
 lock table public.workers,public.teams,public.worker_staff_classification,public.biometric_worker_mapping,
 public.worker_biometric_participation,public.biometric_device_identity_review,
 public.biometric_attendance_events,public.attendance,public.attendance_verification_run,public.payroll_line in share mode;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) into att_hash from attendance a;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'')) into pay_hash from payroll_line p;
 -- Rollback-only isolation from live processing and an already finalized day.
 update private.morning_processing_operation set resolved_by=id where resolved_by is null;
 delete from private.morning_report_completion where attendance_date=d;
 delete from private.supervisor_review_daily_snapshot where attendance_date=d;
 select jsonb_agg(jsonb_build_object('device_id',device_id,'state','complete','query_start','06:30:00',
 'query_end','11:00:00','segment_count',1,'segments_complete',1,
 'segments',jsonb_build_array(jsonb_build_object('state','complete','pagination_complete',true)))) into coverage
 from (select distinct device_id from attendance_agent_device_status) devices;
 proof:=jsonb_build_object('coverage',coverage,'cutoff','11:00:00','persistence_complete',true,
 'reconciliation_complete',true,'versions',private.morning_input_versions(d));
 foreach scenario in array array['partial','pagination','persistence','reconciliation','versions','unresolved','unknown','failures','newer_job','identity','running','multiday','unknown_operation','valid'] loop
  n:=n+1; altered:=proof;
  if scenario='partial' then altered:=jsonb_set(altered,'{coverage,0,state}','"partial"'); end if;
  if scenario='pagination' then altered:=jsonb_set(altered,'{coverage,0,segments,0,pagination_complete}','false'); end if;
  if scenario='persistence' then altered:=jsonb_set(altered,'{persistence_complete}','false'); end if;
  if scenario='reconciliation' then altered:=jsonb_set(altered,'{reconciliation_complete}','false'); end if;
  if scenario='versions' then altered:=jsonb_set(altered,'{versions,evidence}','"old"'); end if;
  insert into attendance_verification_run(work_date,verification_type,status,started_at,completed_at,created_at,
    unresolved_worker_count,unknown_biometric_status_count,device_failure_summary)
  values(d,'morning',case when scenario='unresolved' then 'incomplete' else 'complete' end,now()-interval '10 minutes',now()-interval '1 minute',clock_timestamp()+n*interval '1 second',
    case when scenario='unresolved' then 1 else 0 end,case when scenario='unknown' then 1 else 0 end,
    jsonb_build_object('failures',case when scenario='failures' then '["device failed"]'::jsonb else '[]'::jsonb end,'cutoff_verification',altered)) returning id into run_id;
  insert into private.morning_processing_operation(operation,date_from,date_to,identity_dependency,status,started_at,completed_at,error)
  values(case when scenario='unknown_operation' then 'unknown' else 'helper_attendance' end,d,
    case when scenario='multiday' then d+1 else d end,scenario='identity',
    case when scenario='running' then 'running' else 'failed' end,now()-interval '2 hours',
    case when scenario='running' then null when scenario='newer_job' then now() else now()-interval '1 hour' end,'Original partial-read error') returning id into job_id;
  state:=private.complete_morning_report(d);
  if scenario='valid' then
    assert state->>'state'='FINAL','Complete later certificate did not finalize';
    assert (select superseded_by_run_id=run_id and resolved_at is not null and status='failed' and error='Original partial-read error'
      and resolution_reason='superseded_by_complete_morning_verification' and resolution_evidence->'cutoff_certificate'=proof
      from private.morning_processing_operation where id=job_id),'Recovery audit was not preserved';
  else
    assert state->>'state'='PROCESSING_AFTER_CUTOFF','Unsafe scenario finalized: '||scenario;
    assert (select superseded_by_run_id is null from private.morning_processing_operation where id=job_id),'Unsafe job cleared: '||scenario;
  end if;
  update private.morning_processing_operation set resolved_by=id where id=job_id;
 end loop;
 select md5(workers::text) into snapshot_hash from private.supervisor_review_daily_snapshot where attendance_date=d;
 -- Later failures/version drift must never hide or rebuild the persisted FINAL.
 insert into private.morning_processing_operation(operation,date_from,date_to,status,error) values('helper_attendance',d,d,'failed','Later failure');
 insert into attendance_verification_run(work_date,verification_type,status,completed_at,created_at,device_failure_summary)
 values(d,'morning','complete',now(),clock_timestamp()+interval '1 hour','{}');
 assert private.complete_morning_report(d)->>'state'='FINAL','Final report regressed';
 assert private.morning_verification_ready(d)->>'state'='FINAL','Status endpoint regressed';
 assert (select md5(workers::text)=snapshot_hash from private.supervisor_review_daily_snapshot where attendance_date=d),'Population changed after final';
 assert (select count(*)=1 from private.morning_report_completion where attendance_date=d),'Completion not persisted once';
 assert att_hash=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from attendance a),'Attendance changed';
 assert pay_hash=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'')) from payroll_line p),'Payroll changed';
end $$;
select 'supersession scope/certificate/audit, frozen final population, attendance/payroll unchanged: PASS' as verification;
rollback;
