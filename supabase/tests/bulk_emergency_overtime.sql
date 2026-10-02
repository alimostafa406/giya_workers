-- Run after bulk_emergency_overtime.sql. Every fixture/change rolls back.
begin;
do $$
declare
  v_admin uuid;
  v_team uuid;
  v_worker_one uuid;
  v_worker_two uuid;
  v_worker_three uuid;
  v_rule_set uuid;
  v_run uuid;
  v_date date := date '2026-09-21';
  v_updated timestamptz;
  v_request uuid := gen_random_uuid();
  v_result jsonb;
begin
  select id into v_admin from public.admins where is_active is true limit 1;
  select id into v_team from public.teams where name = 'Zarour' and is_active is true limit 1;
  if v_admin is null or v_team is null then
    raise exception 'Test requires an active admin and the Zarour team';
  end if;
  if has_function_privilege('anon',
    'public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)', 'EXECUTE')
    or has_table_privilege('anon','public.attendance_emergency_overtime_audit','SELECT')
    or has_table_privilege('authenticated','public.attendance_emergency_overtime_audit','INSERT') then
    raise exception 'Emergency overtime privileges are too broad';
  end if;

  insert into public.workers(team_id,full_name,is_active)
    values (v_team,'EMERGENCY TEST ONE',true) returning id into v_worker_one;
  insert into public.workers(team_id,full_name,is_active)
    values (v_team,'EMERGENCY TEST TWO',true) returning id into v_worker_two;
  insert into public.workers(team_id,full_name,is_active)
    values (v_team,'EMERGENCY TEST FINALIZED',true) returning id into v_worker_three;
  insert into public.attendance(worker_id,attendance_date,status,check_in,attendance_source,manual_override)
    values (v_worker_one,v_date,'half_day',time '07:30','biometric',false),
           (v_worker_two,v_date,'half_day',time '07:45','biometric',false),
           (v_worker_three,v_date,'half_day',time '07:50','biometric',false);
  select updated_at into v_updated from public.attendance
    where worker_id=v_worker_one and attendance_date=v_date;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);

  v_result := public.admin_apply_bulk_emergency_overtime(v_request,v_date,'manual_checkout',
    'Power outage',null,jsonb_build_array(jsonb_build_object(
      'worker_id',v_worker_one,'expected_updated_at',v_updated,'checkout','21:00')));
  if (v_result->>'updated')::integer<>1 or not exists (
    select 1 from public.attendance where worker_id=v_worker_one and attendance_date=v_date
      and status='present' and check_out=time '21:00' and manual_override is true
      and attendance_source='manual' and emergency_overtime_mode='manual_checkout') then
    raise exception 'Manual checkout did not produce protected full attendance';
  end if;
  if (select count(*) from public.attendance_emergency_overtime_audit
      where request_id=v_request and worker_id=v_worker_one and source='manual_emergency')<>1 then
    raise exception 'Manual checkout audit was not written';
  end if;
  v_result := public.admin_apply_bulk_emergency_overtime(v_request,v_date,'manual_checkout',
    'Power outage',null,jsonb_build_array(jsonb_build_object(
      'worker_id',v_worker_one,'expected_updated_at',v_updated,'checkout','21:00')));
  if (v_result->>'skipped')::integer<>1 or (select count(*)
      from public.attendance_emergency_overtime_audit where request_id=v_request)<>1 then
    raise exception 'Repeated request is not idempotent';
  end if;

  select updated_at into v_updated from public.attendance
    where worker_id=v_worker_two and attendance_date=v_date;
  v_result := public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),v_date,
    'manual_overtime_duration','Network outage','Confirmed by supervisor',
    jsonb_build_array(jsonb_build_object('worker_id',v_worker_two,
      'expected_updated_at',v_updated,'minutes',210)));
  if (v_result->>'updated')::integer<>1 or not exists (
    select 1 from public.attendance where worker_id=v_worker_two and attendance_date=v_date
      and status='half_day' and check_out is null and manual_override is true
      and emergency_overtime_mode='manual_overtime_duration'
      and emergency_overtime_minutes=210) then
    raise exception 'Direct duration changed checkout/status or was not protected';
  end if;
  select id into v_rule_set from public.payroll_rule_set limit 1;
  insert into public.payroll_run(payment_type,weekly_period_start,weekly_period_end,
    scheduled_payment_date,currency_code,rule_set_id,status)
    values ('weekly',v_date,v_date+5,v_date+5,'ZZZ',v_rule_set,'draft') returning id into v_run;
  insert into public.payroll_line(payroll_run_id,worker_id,attendance_period_start,
    attendance_period_end,payment_due_date,worker_name_snapshot,
    payment_type_snapshot,currency_code_snapshot)
    values(v_run,v_worker_three,v_date,v_date+5,v_date+5,
      'EMERGENCY TEST FINALIZED','weekly','ZZZ');
  update public.payroll_run set status='finalized' where id=v_run;
  select updated_at into v_updated from public.attendance
    where worker_id=v_worker_three and attendance_date=v_date;
  v_result := public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),v_date,
    'manual_checkout','Power outage',null,jsonb_build_array(jsonb_build_object(
      'worker_id',v_worker_three,'expected_updated_at',v_updated,'checkout','21:00')));
  if (v_result->>'skipped')::integer<>1 or exists (
    select 1 from public.attendance where worker_id=v_worker_three and check_out is not null) then
    raise exception 'Finalized payroll period was mutated';
  end if;
  v_result := public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),v_date,
    'manual_checkout','Power outage',null,jsonb_build_array(
      jsonb_build_object('worker_id',v_worker_one,
        'expected_updated_at',(select updated_at from public.attendance where worker_id=v_worker_one),'checkout','22:00'),
      jsonb_build_object('worker_id',v_worker_two,
        'expected_updated_at',(select updated_at from public.attendance where worker_id=v_worker_two),'checkout','invalid')));
  if (v_result->>'updated')::integer<>1 or (v_result->>'failed')::integer<>1 then
    raise exception 'Per-worker partial failure was not reported';
  end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
  begin
    perform public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),v_date,
      'manual_checkout','Power outage',null,'[]'::jsonb);
    raise exception 'Non-admin access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
