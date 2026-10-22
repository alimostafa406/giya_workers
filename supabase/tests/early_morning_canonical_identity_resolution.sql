-- Rollback-only integration: real RPC, triggers, identity guards and atomic submit.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare ids uuid[]; w uuid; other uuid; code text:='review-test-'||gen_random_uuid()::text;
  device text:='review-test-device'; d date:='2000-01-04'; e1 uuid; e2 uuid; r1 uuid; r2 uuid;
  context jsonb; saved jsonb; choices jsonb; population jsonb; result jsonb; before_payroll text;
begin
  select array_agg(id order by id) into ids from (select id from public.workers where attendance_shift='day' order by id limit 2) x;
  other:=ids[1]; w:=ids[2];
  assert not exists(select 1 from public.attendance where attendance_date in (d,d-1) and worker_id=any(ids));
  assert not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=d);
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) into before_payroll from public.payroll_line p;
  assert not has_function_privilege('authenticated','private.confirmed_biometric_identity_worker(text,text)','execute');
  insert into public.biometric_worker_mapping(worker_id,device_employee_no,is_active,mapping_review_state)
    values(w,code,true,'confirmed');
  assert private.confirmed_biometric_identity_worker(device,code)=w,'Legacy fallback';
  -- Whitespace-normalized ambiguity must fail even if a legacy unique index
  -- permits distinct raw strings. No production index is disabled for tests.
  insert into public.biometric_worker_mapping(worker_id,device_employee_no,is_active,mapping_review_state)
    values(other,' '||code||' ',true,'confirmed');
  assert private.confirmed_biometric_identity_worker(device,code) is null,'Ambiguous legacy accepted';
  delete from public.biometric_worker_mapping where device_employee_no=' '||code||' ';
  insert into public.biometric_worker_mapping(worker_id,device_id,device_employee_no,is_active,mapping_review_state)
    values(other,device,code,true,'confirmed');
  assert private.confirmed_biometric_identity_worker(device,code)=other,'Exact scope must win';
  delete from public.biometric_worker_mapping where device_id=device and device_employee_no=code;
  insert into public.biometric_worker_mapping(worker_id,device_id,device_employee_no,is_active,mapping_review_state)
    values(w,device,'0'||code,true,'confirmed');
  assert private.confirmed_biometric_identity_worker(device,'0'||code)=w;
  assert private.confirmed_biometric_identity_worker(device,'00'||code) is null,'Leading zero coerced';
  insert into public.biometric_device_identity_review(device_id,device_employee_no,review_state) values(device,code,'ignored');
  assert private.confirmed_biometric_identity_worker(device,code) is null,'Ignored identity accepted';
  delete from public.biometric_device_identity_review where device_id=device and device_employee_no=code;

  insert into public.attendance(worker_id,attendance_date,status,check_in,check_out,review_approved_check_out_at,attendance_source,manual_override)
    values(w,d-1,'present','08:00','01:29:20',(d+time '01:29:20') at time zone 'Africa/Kinshasa','biometric',false);
  insert into public.biometric_attendance_events(worker_id,attendance_date,event_timestamp,device_id,event_identity,device_employee_no)
    values(w,d,(d+time '01:25:23') at time zone 'Africa/Kinshasa',device,code||'-1',code) returning id into e1;
  insert into public.biometric_attendance_events(worker_id,attendance_date,event_timestamp,device_id,event_identity,device_employee_no)
    values(w,d,(d+time '01:29:20') at time zone 'Africa/Kinshasa',device,code||'-2',code) returning id into e2;
  select id into r1 from public.biometric_early_morning_review where event_id=e1;
  select id into r2 from public.biometric_early_morning_review where event_id=e2;
  assert r1 is not null and r2 is not null;
  select jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'employee_code',employee_code,'team_id',team_id,'team_name','Review test') order by id)
    into population from public.workers where id=any(ids);
  insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
    values(d,(d+time '11:00') at time zone 'Africa/Kinshasa',auth.uid(),population);
  choices:=jsonb_build_object(w::text,'A',other::text,'A');
  context:=public.admin_supervisor_review_draft(d);
  saved:=public.admin_supervisor_review_draft(d,'save',context->>'snapshot_token',0,context->>'official_token',choices);
  begin
    perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
    raise exception 'Pending review allowed absence';
  exception when check_violation then
    assert sqlerrm like 'pending early-morning biometric review prevents absence%';
  end;
  assert not exists(select 1 from public.attendance where attendance_date=d and worker_id=any(ids)),'Partial writes';
  assert (select results=choices and status='draft' and revision=1 from private.supervisor_review_draft where attendance_date=d),'Draft lost';
  -- A conflicting exact owner must not silently fall back to the matching legacy owner.
  insert into public.biometric_worker_mapping(worker_id,device_id,device_employee_no,is_active,mapping_review_state)
    values(other,device,code,true,'confirmed');
  begin
    perform public.resolve_early_morning_biometric_review(r1,'previous_workday_checkout');
    raise exception 'Conflicting exact owner accepted';
  exception when check_violation then
    assert sqlerrm like 'raw event worker conflicts%';
  end;
  delete from public.biometric_worker_mapping where device_id=device and device_employee_no=code;
  perform public.resolve_early_morning_biometric_review(r1,'previous_workday_checkout');
  assert (select review_approved_check_out_at=(d+time '01:29:20') at time zone 'Africa/Kinshasa'
    and check_out=time '01:29:20' from public.attendance where worker_id=w and attendance_date=d-1),'Earlier review regressed real checkout';
  perform public.resolve_early_morning_biometric_review(r2,'previous_workday_checkout');
  perform public.resolve_early_morning_biometric_review(r2,'previous_workday_checkout'); -- idempotent
  assert not exists(select 1 from public.biometric_early_morning_review where event_id in(e1,e2) and review_status<>'resolved');
  assert (select review_approved_check_out_at=(d+time '01:29:20') at time zone 'Africa/Kinshasa'
    and manual_override is false from public.attendance where worker_id=w and attendance_date=d-1);
  result:=public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  assert result->>'status'='finalized' and result->'results'=choices;
  assert (select count(*) from public.attendance where attendance_date=d and worker_id=any(ids) and status='absent' and manual_override)=2;
  assert (select count(*) from public.biometric_attendance_events where id in(e1,e2))=2,'Raw events lost';
  assert before_payroll=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payroll_line p),'Payroll changed';
end $$;
rollback;
select 'canonical identity, legacy review, exact conflicts, leading zeros, atomic draft submit, payroll safety: PASS' verification;
