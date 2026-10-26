begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date:='2026-10-23'; sources jsonb; picked jsonb; entries jsonb; result jsonb; e jsonb;
 actor_id text:=auth.uid()::text; before_att text; before_pay text; before_profiles text;
 rejected boolean; run_id uuid; rule_id uuid; state text;
begin
 sources:=admin_get_biometric_overtime_review(d,d);
 select jsonb_agg(s) into picked from (select distinct on (value#>>'{worker,payment_type}') value as s
   from jsonb_array_elements(sources) where not (value->>'locked')::boolean
   and (value#>>'{attendance,check_out}')::time>=time '18:00'
   order by value#>>'{worker,payment_type}',value#>>'{worker,id}') chosen;
 assert jsonb_array_length(picked)=2,'Need weekly and monthly real biometric fixtures';
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) into before_att from attendance a where attendance_date=d;
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) into before_pay from payroll_line l;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by worker_id)::text,'')) into before_profiles from worker_payroll_profile p;
 select jsonb_agg(jsonb_build_object('worker_id',s#>>'{worker,id}','minutes',60,'decision','approved','source_fingerprint',s->>'source_fingerprint','expected_version',coalesce((s#>>'{review,version}')::integer,0))) into entries from jsonb_array_elements(picked) s;
 result:=admin_decide_biometric_overtime(d,entries);
 assert jsonb_array_length(result)=2,'Bulk approval failed';
 for e in select value from jsonb_array_elements(entries) loop
  assert (select decision='approved' and minutes=60 and actor=auth.uid() and source_fingerprint=e->>'source_fingerprint' and version=(e->>'expected_version')::integer+1
    from worker_biometric_overtime_review where worker_id=(e->>'worker_id')::uuid and attendance_date=d),'Decision audit missing';
 end loop;
 rejected:=false;
 begin perform admin_decide_biometric_overtime(d,entries); exception when others then rejected:=sqlerrm='Review changed; reload'; end;
 assert rejected,'Concurrent stale version accepted';
 select jsonb_agg(entry_value||jsonb_build_object('decision','rejected','expected_version',(entry_value->>'expected_version')::integer+1)) into entries from jsonb_array_elements(entries) as batch(entry_value);
 perform admin_decide_biometric_overtime(d,entries);
 for e in select value from jsonb_array_elements(entries) loop
  assert (select decision='rejected' and jsonb_array_length(history)>=2 and version=(e->>'expected_version')::integer+1 from worker_biometric_overtime_review where worker_id=(e->>'worker_id')::uuid and attendance_date=d),'Reject/history missing';
 end loop;
 select jsonb_agg(entry_value||jsonb_build_object('expected_version',(entry_value->>'expected_version')::integer+1)) into entries from jsonb_array_elements(entries) as batch(entry_value);
 rejected:=false;
 begin perform admin_decide_biometric_overtime(d,jsonb_set(entries,'{0,source_fingerprint}','"changed"'::jsonb)); exception when others then rejected:=sqlerrm='Biometric evidence changed; reload and review again'; end;
 assert rejected,'Stale biometric fingerprint accepted';
 select id into rule_id from payroll_rule_set limit 1;
 insert into payroll_run(payment_type,weekly_period_start,weekly_period_end,scheduled_payment_date,currency_code,rule_set_id,status)
   values('weekly',d-4,d+1,d+1,'ZZZ',rule_id,'draft') returning id into run_id;
 foreach state in array array['reviewed','finalized','paid'] loop
  update payroll_run set status=state where id=run_id;
  rejected:=false;
  begin perform admin_decide_biometric_overtime(d,entries); exception when others then rejected:=sqlerrm='Payroll locked'; end;
  assert rejected,'Locked payroll allowed decision change';
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 rejected:=false;
 begin perform admin_decide_biometric_overtime(d,entries); exception when insufficient_privilege then rejected:=true; end;
 assert rejected,'Unauthenticated decision accepted';
 rejected:=false;
 begin perform admin_get_biometric_overtime_review(d,d); exception when insufficient_privilege then rejected:=true; end;
 assert rejected,'Unauthenticated read accepted';
 perform set_config('request.jwt.claim.sub',actor_id,true);
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'')) from attendance a where attendance_date=d),'Attendance mutated';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by id)::text,'')) from payroll_line l),'Payroll lines mutated';
 assert before_profiles=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by worker_id)::text,'')) from worker_payroll_profile p),'Salary/profile mutated';
 assert not has_function_privilege('anon','public.admin_get_biometric_overtime_review(date,date)','execute');
 assert not has_function_privilege('anon','public.admin_decide_biometric_overtime(date,jsonb)','execute');
 assert not has_table_privilege('authenticated','public.worker_biometric_overtime_review','update');
end $$;
rollback;
select 'bulk approve/reject, monthly/weekly, history/version, stale fingerprints, authorization, payroll locks, no attendance/salary/payroll mutations: PASS' as verification;
