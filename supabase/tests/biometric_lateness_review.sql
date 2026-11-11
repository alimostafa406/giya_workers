-- All financial review changes in this test roll back. No attendance/event writes.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare source jsonb; e jsonb; a public.attendance; w public.workers; evidence jsonb;
 saved public.worker_biometric_lateness_review; line public.payroll_line;
 d date; clk time; expected integer; before_att text; before_events text; before_pay text; actor_id text:=auth.uid()::text;
 lock_id uuid; lock_status text; monday date; calculated_amount numeric;
begin
 select s into strict source from jsonb_array_elements(public.admin_get_biometric_lateness_review(current_date-31,current_date)) s
 where not (s->>'locked')::boolean and (s->'evidence'->>'raw_minutes')::integer>0
 and s->'calculation'->>'unavailable_reason' is null
 and exists(select 1 from public.worker_payroll_compensation c where c.worker_id=(s->'worker'->>'id')::uuid and c.currency_code='CDF'
   and c.effective_from<=(s->'attendance'->>'attendance_date')::date and (c.effective_to is null or c.effective_to>=(s->'attendance'->>'attendance_date')::date)) limit 1;
 d:=(source->'attendance'->>'attendance_date')::date;
 select * into strict a from public.attendance where id=(source->'attendance'->>'id')::uuid;
 select * into strict w from public.workers where id=a.worker_id;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into before_att from public.attendance x;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into before_events from public.biometric_attendance_events x;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) into before_pay from public.payroll_line x;
 -- Local composite variables only: test the same server schedule/calculator.
 a.attendance_date:='2026-11-09'; a.attendance_source:='biometric'; a.status:='present'; a.manual_override:=false; a.biometric_sync_metadata:='{}'; w.attendance_shift:='day';
 for clk,expected in select * from (values(time '07:59',0),(time '08:00',0),(time '08:01',1),(time '08:35:19',35)) cases(t,m) loop
   a.check_in:=clk; evidence:=private.biometric_lateness_evidence(a,w,'Team');
   assert (evidence->>'raw_minutes')::integer=expected,'Exact minute calculation failed';
 end loop;
 a.attendance_date:='2026-11-14'; evidence:=private.biometric_lateness_evidence(a,w,'Maison');
 assert (evidence->>'raw_minutes')::integer=35 and (evidence->>'scheduled_start')::timestamp::time=time '08:00','Saturday/Maison schedule changed';
 assert private.biometric_lateness_evidence(a,w,'Chauffeur') is null,'Invented Chauffeur scheduled arrival';
 a.attendance_date:='2026-11-15'; assert private.biometric_lateness_evidence(a,w,'Team') is null,'Invented Sunday day schedule';
 w.attendance_shift:='night'; a.check_in:='17:35:19';
 assert (private.biometric_lateness_evidence(a,w,'Team')->>'raw_minutes')::integer=35,'Night schedule incorrect';
 a.check_in:='00:20:00'; evidence:=private.biometric_lateness_evidence(a,w,'Team');
 assert (evidence->>'raw_minutes')::integer=440 and (evidence->>'raw_check_in')::date=a.attendance_date+1,'Night cross-midnight date incorrect';
 assert evidence->>'source_fingerprint'<>source->'evidence'->>'source_fingerprint','Changed evidence fingerprint did not change';

 calculated_amount:=round((source->'calculation'->>'daily_wage')::numeric/(source->'calculation'->>'scheduled_paid_minutes')::numeric*30,2);
 e:=jsonb_build_object('worker_id',source->'worker'->>'id','decision','approved','approved_minutes',30,'deduction_amount',2000,
   'calculation_fingerprint',source->'calculation'->>'fingerprint',
   'note','Rollback-only lateness regression','source_fingerprint',source->'evidence'->>'source_fingerprint','expected_version',coalesce((source->'review'->>'version')::integer,0));
 perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e));
 select * into strict saved from public.worker_biometric_lateness_review where worker_id=(e->>'worker_id')::uuid and attendance_date=d;
 assert saved.approved_minutes=30 and saved.deduction_amount=calculated_amount and saved.actor=auth.uid(),'Automatic approval value or actor lost';
 assert saved.calculation_snapshot->>'mode'='automatic_daily_wage_v1','Calculation basis not audited';
 assert saved.raw_minutes=(source->'evidence'->>'raw_minutes')::integer and saved.raw_check_in=(source->'evidence'->>'raw_check_in')::timestamp,'Raw evidence overwritten';
 assert saved.history->-1->>'note'=e->>'note' and saved.history->-1->>'actor'=actor_id,'Audit lost';
 line.worker_id:=saved.worker_id; line.attendance_period_start:=d; line.attendance_period_end:=d; line.currency_code_snapshot:='CDF';
 line.attendance_summary_snapshot:=jsonb_build_object('lateness_deductions',private.lateness_payroll_sources(saved.worker_id,d,d,'CDF'));
 line.calculation_snapshot:=jsonb_build_object('late_deduction',calculated_amount,'late_before_amount',5000); line.deduction_amount:=calculated_amount; line.final_amount:=5000-calculated_amount;
 perform private.assert_lateness_payroll_line(line);
 begin
   perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e)); raise exception 'Stale version accepted';
 exception when raise_exception then if sqlerrm<>'Review changed; reload' then raise; end if; end;
 e:=e||jsonb_build_object('expected_version',saved.version,'source_fingerprint','changed');
 begin
   perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e)); raise exception 'Stale evidence accepted';
 exception when raise_exception then if sqlerrm<>'Biometric evidence changed; reload and review again' then raise; end if; end;
 e:=e||jsonb_build_object('source_fingerprint',source->'evidence'->>'source_fingerprint');
 begin
   perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e,e||jsonb_build_object('worker_id','ffffffff-ffff-ffff-ffff-ffffffffffff','decision','rejected',
     'calculation_fingerprint',private.lateness_calculation_context('ffffffff-ffff-ffff-ffff-ffffffffffff',d)->>'fingerprint'))); raise exception 'Invalid batch accepted';
 exception when raise_exception then if sqlerrm<>'Worker not eligible' then raise; end if; end;
 assert saved.version=(select version from public.worker_biometric_lateness_review where worker_id=saved.worker_id and attendance_date=d),'Partial batch write';
 e:=e||jsonb_build_object('approved_minutes',20,'deduction_amount',1000,'decision','rejected');
 perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e));
 assert private.lateness_payroll_sources(saved.worker_id,d,d,'CDF')='[]'::jsonb,'Rejected deduction payable';
 assert (select count(*) from public.worker_biometric_lateness_review where worker_id=saved.worker_id and attendance_date=d)=1,'Duplicate review';
 begin perform private.assert_lateness_payroll_line(line); raise exception 'Old draft accepted';
 exception when raise_exception then if sqlerrm<>'Lateness review changed; refresh weekly payroll Draft' then raise; end if; end;
 monday:=d-(extract(isodow from d)::integer-1);
 -- A rollback-only test-currency run exercises all real payroll lock states.
 insert into public.payroll_run(payment_type,weekly_period_start,weekly_period_end,scheduled_payment_date,currency_code,rule_set_id,status,created_by)
 values('weekly',monday,monday+5,monday+5,'XTS',(select id from public.payroll_rule_set where is_active limit 1),'reviewed',auth.uid()) returning id into lock_id;
 foreach lock_status in array array['reviewed','finalized','paid'] loop
   if lock_status<>'reviewed' then update public.payroll_run set status=lock_status where id=lock_id; end if;
   begin perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e)); raise exception 'Payroll lock bypassed';
   exception when raise_exception then if sqlerrm<>'Payroll locked' then raise; end if; end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.admin_decide_biometric_lateness(d,jsonb_build_array(e)); raise exception 'Non-admin allowed';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_get_biometric_lateness_review(d,d); raise exception 'Non-admin read allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',actor_id,true);
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from public.attendance x),'Attendance changed';
 assert before_events=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from public.biometric_attendance_events x),'Events changed';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.id)::text,'')) from public.payroll_line x),'Payroll snapshots changed';
end $$;
rollback;
select 'PASS: exact schedules/minutes, adjustment/audit, stale evidence/version, atomicity, admin-only, payroll guard, no evidence/history changes' verification;
