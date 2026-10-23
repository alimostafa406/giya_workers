-- Processing bookkeeping only. Existing readiness and attendance rules are unchanged.
alter table private.morning_processing_operation
  add column updated_at timestamptz not null default clock_timestamp(),
  add column heartbeat_at timestamptz,
  add column owner_execution_id uuid,
  add column owner_host text,
  add column owner_pid integer,
  add column owner_process_token text,
  add column stale_detected_at timestamptz,
  add column resolution_reason text,
  add column resolution_evidence jsonb;
-- Migration time is not an execution heartbeat.
update private.morning_processing_operation set updated_at=coalesce(completed_at,started_at);

create function public.agent_morning_processing_begin(p_id uuid,p_operation text,p_date_from date,
 p_date_to date,p_identity boolean,p_execution_id uuid,p_host text,p_pid integer,p_process_token text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||(now() at time zone 'Africa/Kinshasa')::date::text,0));
 if p_id is null or p_execution_id is null or coalesce(p_host,'')='' or (p_pid is null or p_pid<=0) or coalesce(p_process_token,'')='' then
   raise exception 'Execution identity required';
 end if;
 insert into private.morning_processing_operation(id,operation,date_from,date_to,identity_dependency,status,
   owner_execution_id,owner_host,owner_pid,owner_process_token,heartbeat_at)
 values(p_id,p_operation,p_date_from,p_date_to,p_identity,'running',
   p_execution_id,p_host,p_pid,p_process_token,clock_timestamp());
 return p_id;
end $$;

create function public.agent_morning_processing_heartbeat(p_execution_id uuid,p_job_ids uuid[])
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare affected integer;
begin
 update private.morning_processing_operation set heartbeat_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=any(p_job_ids) and owner_execution_id=p_execution_id and status='running' and resolved_by is null;
 get diagnostics affected=row_count;
 return affected;
end $$;

create function public.agent_morning_processing_finish(p_id uuid,p_execution_id uuid,p_status text,p_error text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare job private.morning_processing_operation%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||(now() at time zone 'Africa/Kinshasa')::date::text,0));
 select * into strict job from private.morning_processing_operation where id=p_id for update;
 if job.owner_execution_id is distinct from p_execution_id or p_status not in ('complete','failed') then
   raise exception 'Owner and terminal state required';
 end if;
 if job.status=p_status then return p_id; end if; -- lost response: idempotent retry
 if job.status<>'running' then raise exception 'Conflicting terminal state'; end if;
 perform public.agent_morning_processing(p_id,job.operation,null,null,job.identity_dependency,p_status,p_error);
 update private.morning_processing_operation set updated_at=clock_timestamp(),heartbeat_at=clock_timestamp() where id=p_id;
 return p_id;
end $$;

create function public.agent_morning_processing_candidates(p_host text)
returns jsonb language sql stable security definer set search_path=public,private,pg_temp as $$
 select coalesce(jsonb_agg(to_jsonb(o)),'[]') from private.morning_processing_operation o
 where status='running' and resolved_by is null and owner_host=p_host
 and coalesce(heartbeat_at,started_at)<now()-interval '2 minutes';
$$;

create function public.agent_recover_morning_processing(p_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,pg_temp as $$
declare job private.morning_processing_operation%rowtype; replacement private.morning_processing_operation%rowtype;
 kind text:=p_evidence->>'kind'; proof jsonb; failed_at timestamptz; observed_at timestamptz; horizon timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||(now() at time zone 'Africa/Kinshasa')::date::text,0));
 select * into strict job from private.morning_processing_operation where id=p_id for update;
 if job.stale_detected_at is not null then return jsonb_build_object('recovered',true,'id',job.id,'resolved_by',job.resolved_by); end if;
 if job.status<>'running' or job.resolved_by is not null then return jsonb_build_object('recovered',false,'reason','not_running'); end if;
 horizon:=coalesce(job.heartbeat_at,job.started_at);
 if horizon>=clock_timestamp()-interval '2 minutes' then return jsonb_build_object('recovered',false,'reason','fresh_heartbeat'); end if;
 observed_at:=(p_evidence->>'observed_at')::timestamptz;
 if observed_at is null or observed_at<clock_timestamp()-interval '5 minutes' or observed_at>clock_timestamp()+interval '30 seconds'
   or p_evidence->>'confirmed_execution_inactive' is distinct from 'true' then
   raise exception 'Fresh trusted inactivity evidence required';
 end if;
 if kind in ('owner_process_exited','owner_execution_inactive') then
   if job.owner_execution_id is null
     or p_evidence->>'owner_execution_id' is distinct from job.owner_execution_id::text
     or p_evidence->>'observer_host' is distinct from job.owner_host
     or (p_evidence->>'owner_pid')::integer is distinct from job.owner_pid
     or p_evidence->>'owner_process_token' is distinct from job.owner_process_token then
     raise exception 'Owner evidence does not match operation';
   end if;
   if kind='owner_process_exited' and (not p_evidence ? 'observed_process_token'
      or p_evidence->>'observed_process_token' is not distinct from job.owner_process_token) then
     raise exception 'Process is not proven exited or replaced';
   end if;
   if kind='owner_execution_inactive' and p_evidence->>'observer_execution_id' is distinct from job.owner_execution_id::text then
     raise exception 'Only the originating execution can attest its inactive operation';
   end if;
 elsif kind='legacy_terminal_failure' then
   -- Legacy records have no owner identity. Require explicit service-role log
   -- attestation AND a fully current cutoff certificate before resolving.
   if job.owner_execution_id is not null or job.operation<>'current_attendance' or job.identity_dependency
     or job.date_from is null or job.date_to is distinct from job.date_from
     or (p_evidence->>'original_started_at')::timestamptz is distinct from job.started_at
     or coalesce(p_evidence->>'failure_log','')='' or coalesce(p_evidence->>'failure_error','')=''
     or coalesce(p_evidence->>'terminal_write_error','')='' then raise exception 'Legacy failure evidence required'; end if;
   failed_at:=(p_evidence->>'failure_at')::timestamptz;
   if failed_at is null or failed_at<job.started_at or failed_at>observed_at then raise exception 'Invalid failure time'; end if;
   proof:=private.morning_verification_ready(job.date_from);
   if proof->>'state'='FINAL' then
     -- An existing immutable completion is already the stronger certificate.
     null;
   elsif proof->'reasons' is null or not (proof->'reasons' <@ '["relevant_processing_pending"]'::jsonb)
      or proof->'proof' is null or proof->'proof'='null'::jsonb then
     return jsonb_build_object('recovered',false,'reason','current_cutoff_certificate_required');
   end if;
   horizon:=greatest(horizon,failed_at);
 else raise exception 'Unknown inactivity evidence kind';
 end if;
 -- A dead execution is a failed attempt, not a successful import. Only an
 -- actual later completed retry of precisely the same scope can supersede it.
 select * into replacement from private.morning_processing_operation
 where operation=job.operation and date_from is not distinct from job.date_from
   and date_to is not distinct from job.date_to and identity_dependency=job.identity_dependency
   and status='complete' and started_at>horizon and completed_at is not null
 order by completed_at desc,id desc limit 1;
 if replacement.id is null then return jsonb_build_object('recovered',false,'reason','successful_same_scope_retry_required'); end if;
 update private.morning_processing_operation set status='failed',completed_at=coalesce(failed_at,clock_timestamp()),
   updated_at=clock_timestamp(),stale_detected_at=clock_timestamp(),
   error=coalesce(job.error,p_evidence->>'failure_error','Originating execution inactive; terminal status was not acknowledged'),
   resolution_reason='stale_orphaned_processing_record',resolved_by=replacement.id,
   resolution_evidence=p_evidence||jsonb_build_object('recovered_at',clock_timestamp(),'replacement_id',replacement.id,
     'replacement_completed_at',replacement.completed_at,'prior_status',job.status,'prior_error',job.error,
     'prior_heartbeat_at',job.heartbeat_at,'prior_completed_at',job.completed_at)
 where id=job.id;
 return jsonb_build_object('recovered',true,'id',job.id,'status','failed','resolved_by',replacement.id);
end $$;

revoke all on function public.agent_morning_processing_begin(uuid,text,date,date,boolean,uuid,text,integer,text) from public,anon,authenticated;
revoke all on function public.agent_morning_processing_heartbeat(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.agent_morning_processing_finish(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.agent_morning_processing_candidates(text) from public,anon,authenticated;
revoke all on function public.agent_recover_morning_processing(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.agent_morning_processing_begin(uuid,text,date,date,boolean,uuid,text,integer,text) to service_role;
grant execute on function public.agent_morning_processing_heartbeat(uuid,uuid[]) to service_role;
grant execute on function public.agent_morning_processing_finish(uuid,uuid,text,text) to service_role;
grant execute on function public.agent_morning_processing_candidates(text) to service_role;
grant execute on function public.agent_recover_morning_processing(uuid,jsonb) to service_role;
