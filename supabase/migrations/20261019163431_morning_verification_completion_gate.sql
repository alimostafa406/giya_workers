-- Applied production version: 20261019163431 (Supabase MCP migration history).
-- Extend existing verification, keep snapshots immutable, expose one completion gate.
create table private.morning_processing_operation (
  id uuid primary key default gen_random_uuid(), operation text not null,
  date_from date, date_to date, identity_dependency boolean not null default false,
  status text not null check(status in ('running','complete','failed')),
  started_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  error text, resolved_by uuid references private.morning_processing_operation(id),
  check(date_to is null or date_from<=date_to)
);
alter table private.morning_processing_operation enable row level security;
revoke all on private.morning_processing_operation from public,anon,authenticated;
create index morning_processing_open_idx on private.morning_processing_operation(status) where resolved_by is null;

create function public.agent_morning_processing(p_id uuid,p_operation text,p_date_from date,
  p_date_to date,p_identity boolean,p_status text,p_error text) returns uuid
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare job private.morning_processing_operation%rowtype; result uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||(now() at time zone 'Africa/Kinshasa')::date::text,0));
  if p_id is null then
    if p_status<>'running' then raise exception 'Start operation first'; end if;
    insert into private.morning_processing_operation(operation,date_from,date_to,identity_dependency,status)
      values(p_operation,p_date_from,p_date_to,p_identity,'running') returning id into result;
  else
    select * into strict job from private.morning_processing_operation where id=p_id for update;
    if job.status<>'running' or p_status not in ('complete','failed') then raise exception 'Invalid operation transition'; end if;
    update private.morning_processing_operation set status=p_status,error=p_error,completed_at=clock_timestamp() where id=p_id;
    if p_status='complete' then
      update private.morning_processing_operation set resolved_by=p_id where status='failed' and resolved_by is null
        and operation=job.operation and date_from is not distinct from job.date_from
        and date_to is not distinct from job.date_to and identity_dependency=job.identity_dependency;
    end if;
    result:=p_id;
  end if;
  return result;
end $$;
revoke all on function public.agent_morning_processing(uuid,text,date,date,boolean,text,text) from public,anon,authenticated;
grant execute on function public.agent_morning_processing(uuid,text,date,date,boolean,text,text) to service_role;

-- Hash values, not volatile sync/heartbeat timestamps. Later checkout and punches
-- after 11 do not change the morning evidence version.
create function private.morning_input_versions(p_date date) returns jsonb
language sql stable security definer set search_path=public,private,pg_temp as $$
select jsonb_build_object(
 'roster',md5(coalesce((select jsonb_agg(jsonb_build_array(w.id,w.is_active,w.attendance_shift,w.team_id,
   w.operational_start_date,w.employee_code,w.full_name,c.classification,t.name) order by w.id)::text
   from public.workers w left join public.worker_staff_classification c on c.worker_id=w.id
   left join public.teams t on t.id=w.team_id),'[]')),
 'mapping',md5(jsonb_build_array(
   (select jsonb_agg(jsonb_build_array(id,worker_id,device_id,device_employee_no,is_active,mapping_review_state) order by id) from public.biometric_worker_mapping),
   (select jsonb_agg(jsonb_build_array(worker_id,participation_state) order by worker_id) from public.worker_biometric_participation),
   (select jsonb_agg(to_jsonb(r)-'updated_at'-'created_at' order by r.device_id,r.device_employee_no) from public.biometric_device_identity_review r)
 )::text),
 'evidence',md5(jsonb_build_array(
   (select jsonb_agg(jsonb_build_array(id,worker_id,device_id,device_employee_no,event_timestamp) order by id)
     from public.biometric_attendance_events where attendance_date=p_date
     and event_timestamp between ((p_date+time '06:30') at time zone 'Africa/Kinshasa') and ((p_date+time '11:00') at time zone 'Africa/Kinshasa')),
   (select jsonb_agg(jsonb_build_array(worker_id,check_in<=time '11:00',
     manual_override is true and biometric_sync_metadata->'supervisor_morning_review'->>'source'='supervisor_sheet') order by worker_id)
     from public.attendance where attendance_date=p_date and (check_in<=time '11:00' or manual_override is true))
 )::text));
$$;
revoke all on function private.morning_input_versions(date) from public,anon,authenticated;
create function public.agent_morning_input_versions(p_date date) returns jsonb
language sql stable security definer set search_path=public,private,pg_temp as $$ select private.morning_input_versions(p_date); $$;
revoke all on function public.agent_morning_input_versions(date) from public,anon,authenticated;
grant execute on function public.agent_morning_input_versions(date) to service_role;

create table private.morning_report_completion (
  attendance_date date primary key,
  verification_run_id uuid not null references public.attendance_verification_run(id),
  completed_at timestamptz not null default clock_timestamp(), proof jsonb not null
);
alter table private.morning_report_completion enable row level security;
revoke all on private.morning_report_completion from public,anon,authenticated;
-- Agent-created snapshots have no human administrator; never impersonate one.
alter table private.supervisor_review_daily_snapshot alter column finalized_by drop not null;

create function private.morning_verification_ready(p_date date) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare run public.attendance_verification_run%rowtype; proof jsonb; reasons jsonb:='[]'; pending integer; required text[];
begin
  if exists(select 1 from private.morning_report_completion where attendance_date=p_date) then
    return jsonb_build_object('state','FINAL','verification_complete',true);
  end if;
  if now() < (p_date+time '11:00') at time zone 'Africa/Kinshasa' then
    return jsonb_build_object('state','BEFORE_CUTOFF','verification_complete',false);
  end if;
  select * into run from public.attendance_verification_run where work_date=p_date and verification_type='morning'
    order by created_at desc,id desc limit 1;
  proof:=run.device_failure_summary->'cutoff_verification';
  if run.id is null or run.status<>'complete' or run.completed_at is null or run.completed_at<(p_date+time '11:00') at time zone 'Africa/Kinshasa'
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
    where status in ('running','failed') and resolved_by is null
      and (identity_dependency or date_from is null or p_date between date_from and coalesce(date_to,date_from));
  if pending>0 then reasons:=reasons||'"relevant_processing_pending"'::jsonb; end if;
  if proof->'versions' is distinct from private.morning_input_versions(p_date) then
    reasons:=reasons||'"verification_inputs_changed"'::jsonb;
  end if;
  return jsonb_build_object('state','PROCESSING_AFTER_CUTOFF','verification_complete',reasons='[]'::jsonb,
    'reasons',reasons,'pending_relevant',pending,'verification_run_id',run.id,'proof',proof);
end $$;
revoke all on function private.morning_verification_ready(date) from public,anon,authenticated;

create function private.complete_morning_report(p_date date) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare readiness jsonb; population jsonb; stored jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||p_date::text,0));
  -- Existing historical snapshots are never rewritten or re-decided.
  if p_date < (now() at time zone 'Africa/Kinshasa')::date and exists(
    select 1 from private.supervisor_review_daily_snapshot where attendance_date=p_date) then
    return jsonb_build_object('state','FINAL','verification_complete',true);
  end if;
  -- Stabilize inputs across version check, population calculation and insert.
  lock table public.workers,public.teams,public.worker_staff_classification,public.biometric_worker_mapping,
    public.worker_biometric_participation,public.biometric_device_identity_review,
    public.biometric_attendance_events,public.attendance,public.attendance_verification_run in share mode;
  readiness:=private.morning_verification_ready(p_date);
  if readiness->>'state'='FINAL' or readiness->>'verification_complete'<>'true' then return readiness; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,
    'team_id',w.team_id,'team_name',t.name,'biometric_id',coalesce(ids.value,'—')) order by w.id),'[]')
    into population from public.workers w join public.teams t on t.id=w.team_id
    left join public.worker_staff_classification c on c.worker_id=w.id
    left join lateral (select string_agg(device_employee_no,' · ' order by device_employee_no) value from (
      select distinct device_employee_no from public.biometric_worker_mapping m where m.worker_id=w.id
        and m.is_active is true and m.mapping_review_state='confirmed') x) ids on true
    where w.is_active is true and public.is_day_attendance_shift(w.attendance_shift)
      and coalesce(c.classification,'normal')='normal' and t.name<>'Adminstration'
      and (w.operational_start_date is null or w.operational_start_date<=p_date)
      and (not private.has_morning_evidence_at_cutoff(w.id,p_date) or exists(select 1 from public.attendance a
        where a.worker_id=w.id and a.attendance_date=p_date and a.manual_override is true
        and a.biometric_sync_metadata->'supervisor_morning_review'->>'source'='supervisor_sheet'));
  select workers into stored from private.supervisor_review_daily_snapshot where attendance_date=p_date;
  if stored is not null and (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(stored) x)
    is distinct from (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(population) x) then
    return jsonb_build_object('state','PROCESSING_AFTER_CUTOFF','verification_complete',false,'reasons',jsonb_build_array('existing_snapshot_population_differs'));
  end if;
  insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers,source)
    values(p_date,(p_date+time '11:00') at time zone 'Africa/Kinshasa',auth.uid(),population,'morning_verification_complete')
    on conflict(attendance_date) do nothing;
  insert into private.morning_report_completion(attendance_date,verification_run_id,proof)
    values(p_date,(readiness->>'verification_run_id')::uuid,readiness->'proof') on conflict do nothing;
  return jsonb_build_object('state','FINAL','verification_complete',true);
end $$;
revoke all on function private.complete_morning_report(date) from public,anon,authenticated;

-- Keep the existing A/P/O/M overlay and historical fallback unchanged.
alter function private.final_supervisor_review(date,boolean) rename to final_supervisor_review_before_completion_gate;
revoke all on function private.final_supervisor_review_before_completion_gate(date,boolean) from public,anon,authenticated;
create function private.final_supervisor_review(p_date date,p_finalize boolean) returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare state jsonb;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  if p_date=(now() at time zone 'Africa/Kinshasa')::date and now()>=(p_date+time '11:00') at time zone 'Africa/Kinshasa' then
    state:=private.complete_morning_report(p_date);
    if state->>'state'<>'FINAL' then return jsonb_build_object('available',false,'exact_population',false,
      'state','PROCESSING_AFTER_CUTOFF','workers','[]'::jsonb,'teams','[]'::jsonb,'attendance','[]'::jsonb); end if;
  end if;
  return private.final_supervisor_review_before_completion_gate(p_date,false)||coalesce(state,'{}'::jsonb);
end $$;
revoke all on function private.final_supervisor_review(date,boolean) from public,anon,authenticated;
-- Recreate SQL wrapper so its stored function dependency targets the new gate.
create or replace function public.admin_get_final_supervisor_review(p_date date,p_finalize boolean default false) returns jsonb
language sql volatile security invoker set search_path=public,private,pg_temp as $$ select private.final_supervisor_review(p_date,p_finalize); $$;
grant execute on function private.final_supervisor_review(date,boolean) to authenticated;

alter function public.foreign_monitoring_live_missing_morning_payload(date) rename to foreign_monitoring_missing_before_completion_gate;
create function public.foreign_monitoring_live_missing_morning_payload(p_date date) returns jsonb
language plpgsql volatile security definer set search_path=public,private,pg_temp as $$
declare state jsonb;
begin
  if p_date=(now() at time zone 'Africa/Kinshasa')::date and now()>=(p_date+time '11:00') at time zone 'Africa/Kinshasa' then
    state:=private.complete_morning_report(p_date);
    if state->>'state'<>'FINAL' then return jsonb_build_object('date',p_date,'reportAvailable',false,
      'source','final_snapshot_pending','state','PROCESSING_AFTER_CUTOFF','finalized',false,
      'groups','[]'::jsonb,'teams','[]'::jsonb,'missingWorkers',0); end if;
  end if;
  return public.foreign_monitoring_missing_before_completion_gate(p_date)||coalesce(state,'{}'::jsonb);
end $$;
revoke all on function public.foreign_monitoring_live_missing_morning_payload(date) from public,anon,authenticated;
-- Existing public wrapper retains its session and publication gate. Dynamic
-- PL/pgSQL dispatch resolves the new function; writes require VOLATILE callers.
alter function public.get_live_normal_missing_morning_report(date,text) volatile;
create function public.admin_morning_report_status(p_date date) returns jsonb
language plpgsql volatile security definer set search_path=public,private,pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  return private.complete_morning_report(p_date)-'proof'-'reasons'-'pending_relevant'-'verification_run_id';
end $$;
revoke all on function public.admin_morning_report_status(date) from public,anon,authenticated;
grant execute on function public.admin_morning_report_status(date) to authenticated;
create function public.get_live_normal_missing_morning_status(p_date date,p_session_token text default null) returns jsonb
language plpgsql volatile security definer set search_path=public,private,pg_temp as $$
declare report jsonb;
begin
  -- Never bypass the existing viewer session/publication access check.
  report:=public.get_live_normal_missing_morning_report(p_date,p_session_token);
  return jsonb_build_object('state',report->>'state','reportAvailable',report->'reportAvailable','source',report->>'source');
end $$;
revoke all on function public.get_live_normal_missing_morning_status(date,text) from public,anon,authenticated;
grant execute on function public.get_live_normal_missing_morning_status(date,text) to anon,authenticated;
notify pgrst,'reload schema';
