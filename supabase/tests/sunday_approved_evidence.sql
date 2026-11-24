-- Real evidence and existing approvals; ALL changes are rolled back.
begin;
do $test$
declare s jsonb;w uuid;v integer;before_raw text;after_raw text;raw_minutes integer;
 saved jsonb;updated_source jsonb;cfg jsonb;actor uuid:=auth.uid();before_review jsonb;
begin
 if not public.is_admin() then raise exception 'Authorized admin session required';end if;
 select value into s from jsonb_array_elements(private.sunday_hourly_sources('2026-11-22')) where value->'worker'->>'employee_code'='71';
 w:=(s->'worker'->>'id')::uuid;raw_minutes:=(s->>'raw_minutes')::integer;
 if w is null or raw_minutes<>301 then raise exception 'Expected real juresse evidence';end if;
 before_review:=s->'review';
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.event_timestamp,e.event_identity)::text,'')) into before_raw from public.biometric_attendance_events e where worker_id=w and attendance_date between '2026-11-22' and '2026-11-23';
 saved:=public.admin_save_sunday_evidence(w,'2026-11-22','2026-11-22 08:00:00+01','2026-11-22 18:30:00+01',270,false,'rollback verification',coalesce((s->'approved_evidence'->>'version')::integer,0),s->>'source_fingerprint');
 select value into updated_source from jsonb_array_elements(private.sunday_hourly_sources('2026-11-22')) where value->'worker'->>'id'=w::text;
 if updated_source->>'raw_minutes'<>'301' or updated_source->>'suggested_approved_minutes'<>'270'
  or updated_source->>'source_fingerprint'=before_review->>'source_fingerprint' then raise exception 'Raw/approved separation or stale transition failed';end if;
 cfg:=private.sunday_work_evidence(w,'2026-11-22');
 if not(cfg->>'eligible')::boolean or cfg->>'display_check_in'<>'08:00:00' or cfg->>'display_check_out'<>'18:30:00' then raise exception 'Approved evidence not used for Sunday eligibility/display';end if;
 -- A save is NOT an approval; original decision fingerprint is untouched.
 if updated_source->'review' is distinct from before_review then raise exception 'Edit silently altered approval';end if;
 perform public.admin_decide_biometric_overtime('2026-11-22',jsonb_build_array(jsonb_build_object('worker_id',w,'minutes',255,'decision','approved','original_biometric_minutes',301,'note','Manual duration after suggested 270','source_fingerprint',updated_source->>'source_fingerprint','expected_version',before_review->>'version')));
 select value into updated_source from jsonb_array_elements(private.sunday_hourly_sources('2026-11-22')) where value->'worker'->>'id'=w::text;
 if updated_source->'review'->>'minutes'<>'255' then raise exception 'Manual duration override failed';end if;
 begin
  perform public.admin_save_sunday_evidence(w,'2026-11-22',null,null,null,true,'stale version',0,updated_source->>'source_fingerprint');
  raise exception 'Stale version accepted';
 exception when others then if sqlerrm not like 'Evidence override changed%' then raise;end if;end;
 saved:=public.admin_save_sunday_evidence(w,'2026-11-22',null,null,null,true,'Reset original',1,updated_source->>'source_fingerprint');
 cfg:=private.sunday_work_evidence(w,'2026-11-22');
 if cfg ? 'admin_evidence_override' then raise exception 'Reset did not restore raw';end if;
 if (select jsonb_array_length(history) from public.worker_sunday_evidence_override where worker_id=w and work_date='2026-11-22')<>2 then raise exception 'Missing audit history';end if;
 if (select history->-1->>'previous_approved_overtime_minutes' from public.worker_sunday_evidence_override where worker_id=w and work_date='2026-11-22')<>'255' then raise exception 'Audit lost most recent approved duration';end if;
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.event_timestamp,e.event_identity)::text,'')) into after_raw from public.biometric_attendance_events e where worker_id=w and attendance_date between '2026-11-22' and '2026-11-23';
 if before_raw<>after_raw then raise exception 'Biometric mutation';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.admin_save_sunday_evidence(w,'2026-11-22',null,null,null,true,'unauthorized',2,'any');
  raise exception 'Non-admin accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
end $test$;
rollback;
