-- Transactional fixtures only. No workers, attendance, mappings or snapshots changed.
begin;
do $$
declare d date:=(now() at time zone 'Africa/Kinshasa')::date; proof jsonb; coverage jsonb;
  run_id uuid; job uuid; state jsonb;
begin
  assert not exists(select 1 from private.morning_report_completion where attendance_date=d), 'Run before live certification';
  state:=private.morning_verification_ready(d);
  assert state->>'verification_complete'='false','Early complete run incorrectly certified cutoff';
  select jsonb_agg(jsonb_build_object('device_id',device_id,'state','complete','query_start','06:30:00',
    'query_end','11:00:00','segment_count',1,'segments_complete',1,
    'segments',jsonb_build_array(jsonb_build_object('state','complete','pagination_complete',true)))) into coverage
    from (select distinct device_id from public.attendance_agent_device_status) sources;
  proof:=jsonb_build_object('coverage',coverage,'cutoff','11:00:00','persistence_complete',true,
    'reconciliation_complete',true,'versions',private.morning_input_versions(d));
  insert into public.attendance_verification_run(work_date,verification_type,status,started_at,completed_at,
    unresolved_worker_count,unknown_biometric_status_count,device_failure_summary)
    values(d,'morning','complete',now(),now(),0,0,jsonb_build_object('cutoff_verification',proof)) returning id into run_id;
  assert private.morning_verification_ready(d)->>'verification_complete'='true','Complete coverage rejected';
  job:=public.agent_morning_processing(null,'test_old_checkout',d-1,d-1,false,'running',null);
  assert private.morning_verification_ready(d)->>'verification_complete'='true','Unrelated yesterday checkout blocked today';
  perform public.agent_morning_processing(job,'test_old_checkout',null,null,false,'complete',null);
  job:=public.agent_morning_processing(null,'test_old_identity',d-1,d-1,true,'running',null);
  assert private.morning_verification_ready(d)->>'verification_complete'='false','Identity work did not block today';
  perform public.agent_morning_processing(job,'test_old_identity',null,null,true,'failed','test failure');
  assert private.morning_verification_ready(d)->>'verification_complete'='false','Failure published partial report';
  job:=public.agent_morning_processing(null,'test_old_identity',d-1,d-1,true,'running',null);
  perform public.agent_morning_processing(job,'test_old_identity',null,null,true,'complete',null);
  assert private.morning_verification_ready(d)->>'verification_complete'='true','Successful retry did not clear failure';
  proof:=jsonb_set(proof,'{versions,evidence}','"stale"');
  insert into public.attendance_verification_run(work_date,verification_type,status,started_at,completed_at,created_at,
    unresolved_worker_count,unknown_biometric_status_count,device_failure_summary)
    values(d,'morning','complete',now(),now(),clock_timestamp()+interval '1 second',0,0,jsonb_build_object('cutoff_verification',proof));
  assert private.morning_verification_ready(d)->>'verification_complete'='false','Stale evidence version accepted';
  -- All clients are withheld by the SAME backend result, even with an older snapshot.
  state:=public.foreign_monitoring_live_missing_morning_payload(d);
  assert state->>'state'='PROCESSING_AFTER_CUTOFF' and state->'groups'='[]'::jsonb,'Viewer leaked a partial list';
  perform set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
  state:=public.admin_get_final_supervisor_review(d,true);
  assert state->>'state'='PROCESSING_AFTER_CUTOFF' and state->'workers'='[]'::jsonb,'Admin/supervisor leaked partial list';
end $$;
rollback;
