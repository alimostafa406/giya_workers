-- Reuse processing recovery history; never delete or reinterpret a failed attempt as success.
alter table private.morning_processing_operation
  add column superseded_by_run_id uuid references public.attendance_verification_run(id),
  add column resolved_at timestamptz;

create or replace function private.morning_verification_ready(p_date date) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare run public.attendance_verification_run%rowtype; proof jsonb; reasons jsonb:='[]'; pending integer; required text[];
begin
  if exists(select 1 from private.morning_report_completion where attendance_date=p_date) or exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=p_date) then
    return jsonb_build_object('state','FINAL','verification_complete',true);
  end if;
  if now() < (p_date+time '11:00') at time zone 'Africa/Kinshasa' then
    return jsonb_build_object('state','BEFORE_CUTOFF','verification_complete',false);
  end if;
  select * into run from public.attendance_verification_run where work_date=p_date and verification_type='morning'
    order by created_at desc,id desc limit 1;
  proof:=run.device_failure_summary->'cutoff_verification';
  if run.id is null or run.status<>'complete' or run.completed_at is null or run.completed_at<(p_date+time '11:00') at time zone 'Africa/Kinshasa'
    or coalesce(jsonb_array_length(run.device_failure_summary->'failures'),0)<>0
    or coalesce(run.unresolved_worker_count,-1)<>0 or coalesce(run.unknown_biometric_status_count,-1)<>0 then
    reasons:=reasons||'"verification_incomplete"'::jsonb;
  end if;
  select array_agg(distinct device_id) into required from public.attendance_agent_device_status;
  if proof is null or proof='null'::jsonb or coalesce(jsonb_array_length(proof->'coverage'),0)=0
    or proof->>'cutoff' is distinct from '11:00:00'
    or proof->>'persistence_complete' is distinct from 'true'
    or proof->>'reconciliation_complete' is distinct from 'true'
    or exists(select 1 from jsonb_array_elements(proof->'coverage') q
      where q->>'state' is distinct from 'complete' or q->>'query_end' is distinct from '11:00:00'
        or q->>'query_start' is null or (q->>'query_start')::time>time '06:30'
        or coalesce((q->>'segment_count')::integer,0)=0
        or q->>'segment_count' is distinct from q->>'segments_complete'
        or coalesce(jsonb_array_length(q->'segments'),0)=0
        or exists(select 1 from jsonb_array_elements(q->'segments') s where s->>'state' is distinct from 'complete'
          or s->>'pagination_complete' is distinct from 'true'))
    or exists(select 1 from unnest(required) d where not exists(select 1 from jsonb_array_elements(proof->'coverage') q where q->>'device_id'=d)) then
    reasons:=reasons||'"cutoff_coverage_incomplete"'::jsonb;
  end if;
  select count(*) into pending from private.morning_processing_operation
    where status in ('running','failed') and resolved_by is null and superseded_by_run_id is null
      and (identity_dependency or date_from is null or p_date between date_from and coalesce(date_to,date_from));
  if pending>0 then reasons:=reasons||'"relevant_processing_pending"'::jsonb; end if;
  if proof->'versions' is distinct from private.morning_input_versions(p_date) then
    reasons:=reasons||'"verification_inputs_changed"'::jsonb;
  end if;
  return jsonb_build_object('state','PROCESSING_AFTER_CUTOFF','verification_complete',reasons='[]'::jsonb,
    'reasons',reasons,'pending_relevant',pending,'verification_run_id',run.id,'proof',proof);
end $$;
revoke all on function private.morning_verification_ready(date) from public,anon,authenticated;

-- All main/viewer/supervisor/agent completion paths already call this gate.
alter function private.complete_morning_report(date) rename to complete_morning_report_before_scope_supersession;
revoke all on function private.complete_morning_report_before_scope_supersession(date) from public,anon,authenticated;

create function private.complete_morning_report(p_date date) returns jsonb
language plpgsql volatile security definer set search_path=public,private,pg_temp as $$
declare readiness jsonb; run public.attendance_verification_run%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||p_date::text,0));
  -- Persisted population wins forever, independently of future agent cycles.
  if exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=p_date) then
    return jsonb_build_object('state','FINAL','verification_complete',true);
  end if;
  lock table public.workers,public.teams,public.worker_staff_classification,public.biometric_worker_mapping,
    public.worker_biometric_participation,public.biometric_device_identity_review,
    public.biometric_attendance_events,public.attendance,public.attendance_verification_run in share mode;
  readiness:=private.morning_verification_ready(p_date);
  -- The complete existing certificate must pass EVERY check except pending jobs.
  -- Never rely on elapsed time, a bare complete status, or client-supplied proof.
  if readiness->>'state'='PROCESSING_AFTER_CUTOFF'
    and readiness->'reasons'='["relevant_processing_pending"]'::jsonb then
    select * into strict run from public.attendance_verification_run
      where id=(readiness->>'verification_run_id')::uuid;
    update private.morning_processing_operation o set
      superseded_by_run_id=run.id,resolved_at=clock_timestamp(),updated_at=clock_timestamp(),
      resolution_reason='superseded_by_complete_morning_verification',
      resolution_evidence=coalesce(o.resolution_evidence,'{}'::jsonb)||jsonb_build_object(
        'superseded_by_run_id',run.id,'resolved_at',clock_timestamp(),
        'verification_started_at',run.started_at,'verification_completed_at',run.completed_at,
        'attendance_date',p_date,'cutoff_certificate',readiness->'proof',
        'prior_status',o.status,'prior_error',o.error,'prior_completed_at',o.completed_at)
    where o.status='failed' and o.resolved_by is null and o.superseded_by_run_id is null
      and o.operation in ('helper_attendance','current_attendance')
      and not o.identity_dependency and o.date_from=p_date and o.date_to=p_date
      and o.completed_at is not null and run.started_at>o.completed_at
      and run.completed_at>=run.started_at;
    -- Running/stale jobs still require the existing trusted execution-inactivity
    -- recovery workflow; unknown operations/identity/multi-day work stay blocked.
  end if;
  return private.complete_morning_report_before_scope_supersession(p_date);
end $$;
revoke all on function private.complete_morning_report(date) from public,anon,authenticated;
notify pgrst,'reload schema';
