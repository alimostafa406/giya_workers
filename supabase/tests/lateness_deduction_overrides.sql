begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare entries jsonb; saved jsonb; e jsonb; r public.worker_biometric_lateness_review; d date:=date '2026-11-11';
 before_att text; before_pay text; expected numeric;
begin
 select jsonb_agg(jsonb_build_object('worker_id',s->'worker'->>'id','decision','pending',
   'approved_minutes',coalesce((s->'review'->>'approved_minutes')::integer,(s->'evidence'->>'raw_minutes')::integer),
   'adjusted_deduction',2000,'adjustment_source','bulk','note','Rollback-only bulk deduction regression',
   'source_fingerprint',s->'evidence'->>'source_fingerprint','calculation_fingerprint',s->'calculation'->>'fingerprint',
   'expected_version',coalesce((s->'review'->>'version')::integer,0))) into entries
 from (select value s from jsonb_array_elements(public.admin_get_biometric_lateness_review(d,d))
   where not (value->>'locked')::boolean and value->'calculation'->>'unavailable_reason' is null and (value->'evidence'->>'raw_minutes')::integer>0 limit 5) x;
 assert jsonb_array_length(entries)=5,'Need five real eligible candidates';
 select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) into before_att from public.attendance a where attendance_date=d;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) into before_pay from public.payroll_line p;
 saved:=public.admin_decide_biometric_lateness(d,entries);
 assert jsonb_array_length(saved)=5,'Bulk lost workers';
 for e in select value from jsonb_array_elements(saved) loop
   assert e->>'decision'='pending' and (e->>'deduction_amount')::numeric=0 and (e->>'adjusted_deduction')::numeric=2000,'Bulk auto-approved or lost override';
   assert e->>'automatic_deduction' is not null and e->'history'->-1->>'adjustment_source'='bulk'
     and e->'history'->-1->>'actor'=auth.uid()::text and e->'history'->-1->>'at' is not null,'Bulk audit/automatic value missing';
 end loop;
 e:=entries->0;
 select * into strict r from public.worker_biometric_lateness_review where worker_id=(e->>'worker_id')::uuid and attendance_date=d;
 assert private.lateness_payroll_sources(r.worker_id,d,d,'CDF')='[]'::jsonb,'Pending deduction payable';
 e:=e||jsonb_build_object('decision','approved','expected_version',r.version);
 perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e));
 select * into r from public.worker_biometric_lateness_review where worker_id=r.worker_id and attendance_date=d;
 assert r.deduction_amount=2000 and r.automatic_deduction is not null,'Approved override not effective';
 assert jsonb_array_length(private.lateness_payroll_sources(r.worker_id,d,d,'CDF'))=1,'Double payroll deduction';
 e:=e||jsonb_build_object('expected_version',r.version,'adjusted_deduction',null,'adjustment_source','single');
 perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e));
 select * into r from public.worker_biometric_lateness_review where worker_id=r.worker_id and attendance_date=d;
 assert r.adjusted_deduction is null and r.deduction_amount=r.automatic_deduction,'Clear failed to restore automatic deduction';
 e:=e||jsonb_build_object('expected_version',r.version,'decision','rejected','adjusted_deduction',2000);
 perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e));
 assert private.lateness_payroll_sources(r.worker_id,d,d,'CDF')='[]'::jsonb,'Rejected deduction payable';
 assert before_att=(select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) from public.attendance a where attendance_date=d),'Attendance mutated';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) from public.payroll_line p),'Payroll history mutated';
end $$;
rollback;
select 'PASS: five pending bulk overrides, original auto values, actual admin audit, approval=2000, reset=auto, reject=0, no attendance/payroll writes' verification;
