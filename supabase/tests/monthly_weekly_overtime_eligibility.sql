-- All test writes are rolled back, including overrides and temporary payroll locks.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare mw uuid; ww uuid; bad uuid; d date:=date_trunc('week',date '2099-01-05')::date;
  actor text:=auth.uid()::text; rejected boolean; run_id uuid; rule_id uuid; state text;
  before_att text; before_pay text; before_profiles text;
begin
  select w.id into mw from workers w join teams t on t.id=w.team_id join worker_payroll_profile p on p.worker_id=w.id
    left join worker_staff_classification c on c.worker_id=w.id
    where w.is_active and p.payment_type='monthly' and coalesce(c.classification,'normal')='normal'
      and t.name not in ('Adminstration','Chauffeur') and (w.operational_start_date is null or w.operational_start_date<=d+5) limit 1;
  select w.id into ww from workers w join teams t on t.id=w.team_id join worker_payroll_profile p on p.worker_id=w.id
    left join worker_staff_classification c on c.worker_id=w.id
    where w.is_active and p.payment_type='weekly' and coalesce(c.classification,'normal')='normal'
      and t.name not in ('Adminstration','Chauffeur') and (w.operational_start_date is null or w.operational_start_date<=d+5) limit 1;
  assert mw is not null and ww is not null,'Eligible real-data fixtures missing';
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) into before_att from attendance a where worker_id in (mw,ww);
  select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) into before_pay from payroll_line l where worker_id in (mw,ww);
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by worker_id)::text,'')) into before_profiles from worker_payroll_profile p where worker_id in (mw,ww);
  perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',mw,'minutes',1500,'expected_version',0),jsonb_build_object('worker_id',ww,'minutes',120,'expected_version',0)));
  assert (select minutes=1500 and version=1 from worker_weekly_overtime_override where worker_id=mw and week_start=d),'Monthly 25h not saved';
  perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',mw,'minutes',1620,'expected_version',1)));
  rejected:=false;
  begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',mw,'minutes',60,'expected_version',1)));
    exception when others then rejected:=sqlerrm='Weekly overtime changed; reload'; end;
  assert rejected,'Stale version accepted';
  perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',mw,'minutes',null,'expected_version',2)));
  assert (select minutes is null and version=3 and jsonb_array_length(history)=3 and source='manual' and updated_by=auth.uid() from worker_weekly_overtime_override where worker_id=mw and week_start=d),'Monthly clear/audit failed';
  for bad in select id from workers where is_active is not true or team_id is null loop
    rejected:=false;
    begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',bad,'minutes',60,'expected_version',0)));
      exception when others then rejected:=sqlerrm like 'Worker not eligible:%'; end;
    assert rejected,'Inactive/unassigned worker accepted';
  end loop;
  for bad in select w.id from workers w join teams t on t.id=w.team_id left join worker_staff_classification c on c.worker_id=w.id
    where t.name in ('Adminstration','Chauffeur') or coalesce(c.classification,'normal')<>'normal' loop
    rejected:=false;
    begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',bad,'minutes',60,'expected_version',0)));
      exception when others then rejected:=sqlerrm like 'Worker not eligible:%'; end;
    assert rejected,'Operational exclusion accepted';
  end loop;
  rejected:=false;
  begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id','00000000-0000-0000-0000-000000000000','minutes',60,'expected_version',0)));
    exception when others then rejected:=sqlerrm like 'Worker not eligible:%'; end;
  assert rejected,'Invalid worker accepted';
  select id into rule_id from payroll_rule_set limit 1;
  insert into payroll_run(payment_type,weekly_period_start,weekly_period_end,scheduled_payment_date,currency_code,rule_set_id,status)
    values('weekly',d,d+5,d+5,'ZZZ',rule_id,'draft') returning id into run_id;
  foreach state in array array['reviewed','finalized','paid'] loop
    update payroll_run set status=state where id=run_id;
    rejected:=false;
    begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',mw,'minutes',1500,'expected_version',3)));
      exception when others then rejected:=sqlerrm='Payroll week locked'; end;
    assert rejected,'Locked week accepted';
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  rejected:=false;
  begin perform admin_set_weekly_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',mw,'minutes',1500,'expected_version',3)));
    exception when insufficient_privilege then rejected:=true; end;
  assert rejected,'Unauthorized caller accepted';
  perform set_config('request.jwt.claim.sub',actor,true);
  assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from attendance a where worker_id in (mw,ww)),'Attendance changed';
  assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) from payroll_line l where worker_id in (mw,ww)),'Payroll changed';
  assert before_profiles=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by worker_id)::text,'')) from worker_payroll_profile p where worker_id in (mw,ww)),'Monthly salary/profile changed';
  assert not has_function_privilege('anon','public.admin_set_weekly_overtime(date,jsonb)','execute');
  assert not has_table_privilege('authenticated','public.worker_weekly_overtime_override','insert');
  assert (select relrowsecurity from pg_class where oid='public.worker_weekly_overtime_override'::regclass);
end $$;
rollback;
select 'monthly/weekly set, edit, clear, history/version, operational scope, locks, authorization, salary/attendance/payroll unchanged: PASS' as verification;
