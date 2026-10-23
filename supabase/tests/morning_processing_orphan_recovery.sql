-- Transactional processing fixtures only. No attendance, events, mappings,
-- workers, review or payroll records are written. All fixtures roll back.
begin;
do $tests$
declare
 d date:=date '1999-01-04'; job uuid; replacement uuid; execution uuid:=gen_random_uuid();
 state jsonb; evidence jsonb; proof jsonb; coverage jsonb; run_id uuid; before_start timestamptz;
begin
 assert not exists(select 1 from private.morning_report_completion where attendance_date=d), 'Fixture date already finalized';
 assert not has_function_privilege('authenticated','public.agent_recover_morning_processing(uuid,jsonb)','execute'), 'Recovery exposed to authenticated';
 assert not has_function_privilege('anon','public.agent_recover_morning_processing(uuid,jsonb)','execute'), 'Recovery exposed to anon';
 select jsonb_agg(jsonb_build_object('device_id',device_id,'state','complete','query_start','06:30:00',
   'query_end','11:00:00','segment_count',1,'segments_complete',1,
   'segments',jsonb_build_array(jsonb_build_object('state','complete','pagination_complete',true))))
 into coverage from (select distinct device_id from public.attendance_agent_device_status) s;
 proof:=jsonb_build_object('cutoff','11:00:00','coverage',coverage,'persistence_complete',true,
   'reconciliation_complete',true,'versions',private.morning_input_versions(d));
 insert into public.attendance_verification_run(work_date,verification_type,status,started_at,completed_at,
   unresolved_worker_count,unknown_biometric_status_count,device_failure_summary)
 values(d,'morning','complete',now(),now(),0,0,jsonb_build_object('cutoff_verification',proof)) returning id into run_id;
 job:=public.agent_morning_processing_begin(gen_random_uuid(),'orphan_fixture',d,d,false,execution,'fixture-host',123,'birth');
 evidence:=jsonb_build_object('kind','owner_execution_inactive','observer_host','fixture-host',
   'observer_execution_id',execution,'owner_execution_id',execution,'owner_pid',123,
   'owner_process_token','birth','confirmed_execution_inactive',true,'observed_at',clock_timestamp());

 -- 1 fresh genuinely running operation blocks; 2 old start + active heartbeat still blocks.
 assert private.morning_verification_ready(d)->>'verification_complete'='false','Live job did not block';
 assert public.agent_recover_morning_processing(job,evidence)->>'reason'='fresh_heartbeat','Fresh job was recovered';
 update private.morning_processing_operation set started_at=now()-interval '8 hours' where id=job;
 perform public.agent_morning_processing_heartbeat(execution,array[job]);
 assert public.agent_recover_morning_processing(job,evidence)->>'reason'='fresh_heartbeat','Old active job was recovered';

 -- 3 age without death evidence fails closed; missing retry also fails closed.
 update private.morning_processing_operation set heartbeat_at=now()-interval '3 hours' where id=job;
 begin
   perform public.agent_recover_morning_processing(job,evidence-'confirmed_execution_inactive');
   raise exception 'Missing inactivity evidence accepted';
 exception when raise_exception then
   if sqlerrm='Missing inactivity evidence accepted' then raise; end if;
 end;
 assert public.agent_recover_morning_processing(job,evidence)->>'reason'='successful_same_scope_retry_required','No-retry recovery fabricated success';
 insert into private.morning_processing_operation(operation,date_from,date_to,identity_dependency,status,started_at,completed_at)
 values('orphan_fixture',d,d,false,'complete',now()-interval '2 hours',now()-interval '1 hour') returning id into replacement;
 select started_at into before_start from private.morning_processing_operation where id=job;

 -- 4,5,6,9 inactive execution + actual retry resolves an orphan, preserves history.
 state:=public.agent_recover_morning_processing(job,evidence);
 assert state->>'recovered'='true','Orphan with completed retry not recovered';
 assert exists(select 1 from private.morning_processing_operation where id=job and started_at=before_start
   and status='failed' and resolved_by=replacement and resolution_reason='stale_orphaned_processing_record'
   and stale_detected_at is not null and resolution_evidence->>'prior_status'='running'),'Audit history lost';
 assert public.agent_recover_morning_processing(job,evidence)->>'recovered'='true','Recovery retry not idempotent';
 assert private.morning_verification_ready(d)->>'verification_complete'='true','Resolved stale job still blocks';

 -- Dead-process observation is also accepted, but PID creation token equality is rejected.
 job:=public.agent_morning_processing_begin(gen_random_uuid(),'orphan_fixture',d,d,false,execution,'fixture-host',123,'birth');
 update private.morning_processing_operation set started_at=now()-interval '8 hours',heartbeat_at=now()-interval '3 hours' where id=job;
 evidence:=evidence||jsonb_build_object('kind','owner_process_exited','observed_process_token','birth');
 begin
   perform public.agent_recover_morning_processing(job,evidence);
   raise exception 'Live PID accepted as dead';
 exception when raise_exception then
   if sqlerrm='Live PID accepted as dead' then raise; end if;
 end;
 evidence:=evidence||jsonb_build_object('observed_process_token',null);
 assert public.agent_recover_morning_processing(job,evidence)->>'recovered'='true','Dead execution not recovered';

 -- 7 historical attendance-only stale job cannot block the fixture day.
 job:=public.agent_morning_processing(null,'historical_fixture',d-1,d-1,false,'running',null);
 assert private.morning_verification_ready(d)->>'verification_complete'='true','Historical job blocked another date';

 -- 8 relevant active job still fences finalization.
 job:=public.agent_morning_processing_begin(gen_random_uuid(),'live_fixture',d,d,false,execution,'fixture-host',123,'birth');
 assert private.morning_verification_ready(d)->>'verification_complete'='false','Relevant live job did not block';
 perform public.agent_morning_processing_finish(job,execution,'complete',null);
 perform public.agent_morning_processing_finish(job,execution,'complete',null); -- lost terminal response
 assert private.morning_verification_ready(d)->>'verification_complete'='true','Completed job blocks';

 -- 10 legacy timeout + failed terminal acknowledgement, with full cutoff proof.
 insert into private.morning_processing_operation(operation,date_from,date_to,identity_dependency,status,started_at)
 values('current_attendance',d,d,false,'running',now()-interval '4 hours') returning id into job;
 select started_at into before_start from private.morning_processing_operation where id=job;
 insert into private.morning_processing_operation(operation,date_from,date_to,identity_dependency,status,started_at,completed_at)
 values('current_attendance',d,d,false,'complete',now()-interval '2 hours',now()-interval '1 hour');
 evidence:=jsonb_build_object('kind','legacy_terminal_failure','confirmed_execution_inactive',true,
   'observed_at',clock_timestamp(),'original_started_at',before_start,'failure_at',now()-interval '3 hours',
   'failure_log','fixture: execution unwound','failure_error','ReadTimeout','terminal_write_error','NameResolutionError');
 assert private.morning_verification_ready(d)->>'verification_complete'='false','Legacy orphan did not block before recovery';
 assert public.agent_recover_morning_processing(job,evidence)->>'recovered'='true','Legacy orphan not recovered';
 assert private.morning_verification_ready(d)->>'verification_complete'='true','Legacy recovery bypassed or failed readiness';
 state:=private.complete_morning_report(d);
 assert state->>'state'='FINAL','Full cutoff scenario did not finalize';
 assert exists(select 1 from private.morning_report_completion where attendance_date=d),'Completion not persisted';
 assert exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=d),'Snapshot not persisted';
end $tests$;
rollback;
