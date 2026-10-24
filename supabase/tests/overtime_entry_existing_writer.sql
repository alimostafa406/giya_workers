-- No schema/RPC changes. Isolated historical attendance fixtures, all rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date:='2000-01-03'; ids uuid[]; request uuid:=gen_random_uuid(); result jsonb; stamp timestamptz;
  run_id uuid; rule_id uuid; before_row jsonb; after_row jsonb; audit_count integer;
begin
  select array_agg(id order by id) into ids from (
    select w.id from public.workers w join public.teams t on t.id=w.team_id
    left join public.worker_staff_classification c on c.worker_id=w.id
    where w.is_active and (w.operational_start_date is null or w.operational_start_date<=d)
      and t.name not in ('Adminstration','Chauffeur') and coalesce(c.classification,'normal')='normal'
      and not exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=d)
    order by w.id limit 3) x;
  assert cardinality(ids)=3,'Need three eligible isolated fixture workers';
  insert into public.attendance(worker_id,attendance_date,status,check_in,check_out,attendance_source,manual_override,biometric_sync_metadata)
    values(ids[1],d,'half_day','08:00',null,'biometric',false,'{"real_evidence":"unchanged"}'),
      (ids[2],d,'half_day','08:15',null,'biometric',false,'{}'),
      (ids[3],d,'present','08:00','19:00','biometric',false,'{}');
  select to_jsonb(a) into before_row from public.attendance a where worker_id=ids[1] and attendance_date=d;
  select updated_at into stamp from public.attendance where worker_id=ids[1] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(request,d,'manual_overtime_duration','Weekly team overtime entry (SET duration)',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[1],'minutes',90,'expected_updated_at',stamp),
      jsonb_build_object('worker_id',ids[2],'minutes',120,'expected_updated_at',(select updated_at from attendance where worker_id=ids[2] and attendance_date=d))));
  assert result->>'updated'='2','Batch save failed';
  select to_jsonb(a) into after_row from public.attendance a where worker_id=ids[1] and attendance_date=d;
  assert after_row->>'emergency_overtime_minutes'='90' and after_row->>'manual_override'='true';
  assert after_row->'check_in'=before_row->'check_in' and after_row->'check_out'=before_row->'check_out'
    and after_row->'status'=before_row->'status' and after_row->'biometric_sync_metadata'=before_row->'biometric_sync_metadata','Evidence/status changed';
  assert (select count(*) from public.attendance_emergency_overtime_audit where request_id=request)=2;
  assert exists(select 1 from public.attendance_emergency_overtime_audit where request_id=request and worker_id=ids[1]
    and previous_value=before_row and new_value=after_row and applied_by=auth.uid());
  result:=public.admin_apply_bulk_emergency_overtime(request,d,'manual_overtime_duration','Retry',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[1],'minutes',90,'expected_updated_at',stamp)));
  assert result->>'skipped'='1' and result->'results'->0->>'reason'='already_applied','Retry doubled';
  select updated_at into stamp from public.attendance where worker_id=ids[1] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','SET 120 not ADD',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[1],'minutes',120,'expected_updated_at',stamp)));
  assert result->>'updated'='1' and (select emergency_overtime_minutes from attendance where worker_id=ids[1] and attendance_date=d)=120,'SET became ADD';
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Preserve real checkout',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[3],'minutes',120,'expected_updated_at',(select updated_at from attendance where worker_id=ids[3] and attendance_date=d))));
  assert result->'results'->0->>'reason'='existing_real_checkout';
  select id into rule_id from public.payroll_rule_set limit 1;
  insert into public.payroll_run(payment_type,weekly_period_start,weekly_period_end,scheduled_payment_date,currency_code,rule_set_id,status)
    values('weekly',d,d+5,d+5,'ZZZ',rule_id,'draft') returning id into run_id;
  insert into public.payroll_line(payroll_run_id,worker_id,attendance_period_start,attendance_period_end,payment_due_date,worker_name_snapshot,payment_type_snapshot,currency_code_snapshot)
    values(run_id,ids[2],d,d+5,d+5,'Overtime read-only fixture','weekly','ZZZ');
  update public.payroll_run set status='finalized' where id=run_id;
  select to_jsonb(a) into before_row from attendance a where worker_id=ids[2] and attendance_date=d;
  select count(*) into audit_count from attendance_emergency_overtime_audit where worker_id=ids[2] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Blocked payroll',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[2],'minutes',240,'expected_updated_at',before_row->>'updated_at')));
  assert result->'results'->0->>'reason'='payroll_finalized_or_paid';
  assert before_row=(select to_jsonb(a) from attendance a where worker_id=ids[2] and attendance_date=d);
  assert audit_count=(select count(*) from attendance_emergency_overtime_audit where worker_id=ids[2] and attendance_date=d);
  update public.payroll_run set status='paid' where id=run_id;
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Blocked paid payroll',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[2],'minutes',240,'expected_updated_at',before_row->>'updated_at')));
  assert result->'results'->0->>'reason'='payroll_finalized_or_paid';
  assert before_row=(select to_jsonb(a) from attendance a where worker_id=ids[2] and attendance_date=d);
  assert not has_function_privilege('anon','public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)','execute');
  -- No biometric event, mapping, worker or existing payroll record is modified.
end $$;
rollback;
select 'SET duration, batch, idempotency, immutable real times/status/metadata, audit and finalized payroll guard: PASS' verification;
