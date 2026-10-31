-- Exercise real PAYIKE RPC paths, then roll back every test write.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare wid uuid; d date:=date '2026-10-26'; a public.attendance%rowtype;
  result jsonb; old_version integer; before_att text; before_ot text; before_pay text; rejected boolean;
begin
  select w.id into wid from public.workers w join public.teams t on t.id=w.team_id
    join public.worker_payroll_profile p on p.worker_id=w.id
    where w.employee_code='63' and w.full_name='PAYIKE' and t.name='Chauffeur' and w.is_active and p.payment_type='monthly';
  assert wid is not null,'PAYIKE fixture missing';
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into before_att from public.attendance x where worker_id=wid;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by week_start)::text,'')) into before_ot from public.worker_weekly_overtime_override x where worker_id=wid;
  select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into before_pay from public.payroll_line x;
  -- Subtransaction intentionally rolls back successful weekly/daily calls.
  begin
    select coalesce((select version from public.worker_weekly_overtime_override where worker_id=wid and week_start=d),0) into old_version;
    result:=public.admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',300,'expected_version',old_version)));
    assert (select minutes=300 and version=old_version+1 from public.worker_weekly_overtime_override where worker_id=wid and week_start=d),'Weekly manual save failed';
    assert (result->0->>'minutes')::integer=300,'Weekly response incorrect';
    rejected:=false;
    begin perform public.admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',60,'expected_version',old_version)));
      exception when others then rejected:=sqlerrm='Weekly overtime changed; reload'; end;
    assert rejected,'Stale version guard lost';
    select * into a from public.attendance where worker_id=wid and attendance_date=d;
    result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_overtime_duration','Rollback-only Chauffeur verification',null,
      jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',120,'expected_updated_at',a.updated_at)));
    assert (result->>'updated')::integer=1,'Daily manual duration failed';
    assert (select emergency_overtime_minutes=120 and check_in is not distinct from a.check_in and check_out is not distinct from a.check_out
      and status=a.status and attendance_source=a.attendance_source from public.attendance where id=a.id),'Real attendance evidence changed';
    result:=public.admin_apply_bulk_emergency_overtime(gen_random_uuid(),d,'manual_checkout','Rollback-only checkout exclusion test',null,
      jsonb_build_array(jsonb_build_object('worker_id',wid,'checkout','23:00','expected_updated_at',now())));
    assert result->'results'->0->>'reason'='worker_not_eligible','Chauffeur manual-checkout restriction lost';
    assert not exists(select 1 from jsonb_array_elements(public.admin_get_biometric_overtime_review(d,d+5)) r where r->'worker'->>'id'=wid::text),'Chauffeur entered biometric review';
    raise exception sqlstate 'ZX001' using message='ROLLBACK_TEST_WRITES';
  exception when sqlstate 'ZX001' then null;
  end;
  assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.attendance x where worker_id=wid),'Attendance not restored';
  assert before_ot=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by week_start)::text,'')) from public.worker_weekly_overtime_override x where worker_id=wid),'Overrides not restored';
  assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.payroll_line x),'Payroll changed';
  assert not has_function_privilege('anon','public.admin_set_weekly_overtime(date,jsonb)','execute');
  assert not has_function_privilege('anon','public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)','execute');
end $$;
rollback;
select 'PAYIKE weekly/daily manual RPC saves, stale version, biometric/checkout exclusion, unchanged attendance/overrides/payroll: PASS' as verification;
