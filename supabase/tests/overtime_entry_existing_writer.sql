-- Isolated historical attendance fixtures; every change rolls back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date:='2000-01-03'; ids uuid[]; request uuid:=gen_random_uuid(); result jsonb; stamp timestamptz;
  run_id uuid; rule_id uuid; before_row jsonb; after_row jsonb; audit_count integer;
  event_id uuid; event_before jsonb; choice text;
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
      (ids[2],d,'present','08:15','19:00','biometric',false,'{}'),
      (ids[3],d,'present','08:00','17:05','biometric',false,'{"checkout_serial":"actual-test-evidence"}');
  insert into public.biometric_attendance_events(worker_id,attendance_date,event_timestamp,device_id,event_identity,device_employee_no)
    values(ids[3],d,(d+time '17:05') at time zone 'Africa/Kinshasa','overtime-regression','overtime-'||request::text,'064') returning id into event_id;
  select to_jsonb(e) into event_before from public.biometric_attendance_events e where id=event_id;
  select to_jsonb(a) into before_row from public.attendance a where worker_id=ids[1] and attendance_date=d;
  select updated_at into stamp from public.attendance where worker_id=ids[1] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(request,d,'manual_overtime_duration','Weekly team overtime entry (SET duration)',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[1],'minutes',90,'expected_updated_at',stamp),
      jsonb_build_object('worker_id',ids[2],'minutes',120,'expected_updated_at',(select updated_at from attendance where worker_id=ids[2] and attendance_date=d))));
  assert result->>'updated'='2','Batch save failed';
  select to_jsonb(a) into after_row from public.attendance a where worker_id=ids[1] and attendance_date=d;
  assert after_row->>'emergency_overtime_minutes'='90' and after_row->>'manual_override'='true';
  assert after_row->'check_in'=before_row->'check_in' and after_row->'check_out'=before_row->'check_out'
    and after_row->'status'=before_row->'status' and after_row->'biometric_sync_metadata'=before_row->'biometric_sync_metadata'
    and after_row->'attendance_source'=before_row->'attendance_source' and after_row->'recorded_by'=before_row->'recorded_by'
    and after_row->'note'=before_row->'note','Evidence/status/source changed';
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
  select to_jsonb(a) into before_row from attendance a where worker_id=ids[3] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Preserve real checkout',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[3],'minutes',120,'expected_updated_at',(select updated_at from attendance where worker_id=ids[3] and attendance_date=d))));
  assert result->>'updated'='1','Ngiambila-like checkout duration rejected';
  select to_jsonb(a) into after_row from attendance a where worker_id=ids[3] and attendance_date=d;
  assert after_row->>'emergency_overtime_minutes'='120' and after_row->>'check_out'='17:05:00'
    and after_row->>'check_in'='08:00:00' and after_row->>'attendance_source'='biometric';
  assert (after_row-'manual_override'-'emergency_overtime_mode'-'emergency_overtime_minutes'-'updated_at')
    =(before_row-'manual_override'-'emergency_overtime_mode'-'emergency_overtime_minutes'-'updated_at'),'Non-overtime fields changed';
  assert event_before=(select to_jsonb(e) from biometric_attendance_events e where id=event_id),'Raw event changed';
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_checkout','Duration never unlocks real punches',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[3],'checkout','20:00','expected_updated_at',after_row->>'updated_at')));
  assert result->'results'->0->>'reason'='existing_real_checkout','Duration override unlocked real checkout editing';
  assert after_row=(select to_jsonb(a) from attendance a where worker_id=ids[3] and attendance_date=d);
  -- A real manual attendance protection remains distinct from a checkout.
  update public.attendance set manual_override=true,emergency_overtime_mode=null,emergency_overtime_minutes=null,
    biometric_sync_metadata=jsonb_build_object('supervisor_morning_review',jsonb_build_object('choice','M'))
    where worker_id=ids[3] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Protected manual attendance',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[3],'minutes',120,'expected_updated_at',(select updated_at from attendance where worker_id=ids[3] and attendance_date=d))));
  assert result->'results'->0->>'reason'='protected_manual_attendance';
  -- Canonical full-day presence is sufficient, even with no biometric times.
  -- P/O attendance decisions and their full audit metadata must remain intact.
  foreach choice in array array['P','O','canonical'] loop
    update public.attendance set status='present',attendance_day_fraction=1,
      check_in=null,check_out=null,manual_override=(choice<>'canonical'),
      attendance_source=case when choice='canonical' then 'outside_work' else 'manual' end,
      emergency_overtime_mode=null,emergency_overtime_minutes=null,
      biometric_sync_metadata=case when choice='canonical' then '{}'::jsonb else
        jsonb_build_object('supervisor_morning_review',jsonb_build_object('choice',choice,'source','supervisor_sheet')) end
      where worker_id=ids[1] and attendance_date=d;
    select to_jsonb(a) into before_row from attendance a where worker_id=ids[1] and attendance_date=d;
    result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Canonical present null punches',null,
      jsonb_build_array(jsonb_build_object('worker_id',ids[1],'minutes',120,'expected_updated_at',before_row->>'updated_at')));
    assert result->>'updated'='1', 'Canonical present rejected: '||choice||' '||result::text;
    select to_jsonb(a) into after_row from attendance a where worker_id=ids[1] and attendance_date=d;
    assert (after_row-'manual_override'-'emergency_overtime_mode'-'emergency_overtime_minutes'-'updated_at')
      =(before_row-'manual_override'-'emergency_overtime_mode'-'emergency_overtime_minutes'-'updated_at'), 'Protected decision/evidence changed';
    assert (after_row->>'check_in') is null and (after_row->>'check_out') is null,'Fake punches';
    -- The separate punch-editing workflow has not gained a null-checkin exception.
    result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_checkout','No fabricated punch editing',null,
      jsonb_build_array(jsonb_build_object('worker_id',ids[1],'checkout','20:00','expected_updated_at',after_row->>'updated_at')));
    assert result->'results'->0->>'reason'='valid_check_in_required';
  end loop;
  foreach choice in array array['A','M'] loop
    update public.attendance set status='absent',attendance_day_fraction=0,check_in=null,check_out=null,
      manual_override=true,emergency_overtime_mode=null,emergency_overtime_minutes=null,
      biometric_sync_metadata=jsonb_build_object('supervisor_morning_review',jsonb_build_object('choice',choice))
      where worker_id=ids[1] and attendance_date=d;
    select to_jsonb(a) into before_row from attendance a where worker_id=ids[1] and attendance_date=d;
    result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Protect absence/medical',null,
      jsonb_build_array(jsonb_build_object('worker_id',ids[1],'minutes',120,'expected_updated_at',before_row->>'updated_at')));
    assert result->'results'->0->>'reason'='protected_manual_attendance';
    assert before_row=(select to_jsonb(a) from attendance a where worker_id=ids[1] and attendance_date=d);
  end loop;
  -- Punch editing mode must still refuse an existing real checkout.
  update public.attendance set manual_override=false where worker_id=ids[3] and attendance_date=d;
  result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_checkout','Do not change punch',null,
    jsonb_build_array(jsonb_build_object('worker_id',ids[3],'checkout','20:00','expected_updated_at',(select updated_at from attendance where worker_id=ids[3] and attendance_date=d))));
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
select 'SET with/without checkout, batch, audit, no fake punches, unchanged events/source/status, finalized/paid guards: PASS' verification;
