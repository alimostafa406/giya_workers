begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare wid uuid; d date:='2000-01-03'; result jsonb; before_att text; before_pay text; run_id uuid; rule_id uuid; rejected boolean;
begin
  select w.id into wid from workers w join worker_payroll_profile p on p.worker_id=w.id
    left join worker_staff_classification c on c.worker_id=w.id
    where w.is_active and p.payment_type='weekly' and coalesce(c.classification,'normal')='normal'
      and (w.operational_start_date is null or w.operational_start_date<=d+5) limit 1;
  assert wid is not null;
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) into before_att from attendance a where worker_id=wid;
  select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) into before_pay from payroll_line l where worker_id=wid;
  result:=admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',1500,'expected_version',0)));
  assert result->0->>'minutes'='1500';
  perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',1620,'expected_version',1)));
  rejected:=false;
  begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',999,'expected_version',1)));
    exception when others then rejected:=sqlerrm='Weekly overtime changed; reload'; end;
  assert rejected,'Stale update accepted';
  perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',0,'expected_version',2)));
  assert (select minutes=0 from worker_weekly_overtime_override where worker_id=wid and week_start=d),'Explicit zero lost';
  perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',null,'expected_version',3)));
  assert (select minutes is null and version=4 and jsonb_array_length(history)=4 and source='manual' and updated_by=auth.uid()
    from worker_weekly_overtime_override where worker_id=wid and week_start=d),'Clear/audit missing';
  assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from attendance a where worker_id=wid),'Attendance changed';
  assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) from payroll_line l where worker_id=wid),'Payroll changed';
  select id into rule_id from payroll_rule_set limit 1;
  insert into payroll_run(payment_type,weekly_period_start,weekly_period_end,scheduled_payment_date,currency_code,rule_set_id,status)
    values('weekly',d,d+5,d+5,'ZZZ',rule_id,'draft') returning id into run_id;
  update payroll_run set status='finalized' where id=run_id;
  rejected:=false;
  begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',1500,'expected_version',4)));
    exception when others then rejected:=sqlerrm='Payroll week locked'; end;
  assert rejected,'Finalized lock missing';
  update payroll_run set status='paid' where id=run_id;
  rejected:=false;
  begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',null,'expected_version',4)));
    exception when others then rejected:=sqlerrm='Payroll week locked'; end;
  assert rejected,'Paid lock missing';
  assert not has_function_privilege('anon','public.admin_set_weekly_overtime(date,jsonb)','execute');
  assert not has_table_privilege('authenticated','public.worker_weekly_overtime_override','insert');
end $$;
rollback;
select 'weekly 25h, replace, zero, clear, audit, stale-version, locks, no attendance/payroll mutation: PASS' verification;
