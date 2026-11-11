-- Verify with the user's real case, but roll back every financial decision.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare s jsonb; e jsonb; r public.worker_biometric_lateness_review; original_att jsonb; original_pay text; ctx jsonb;
begin
 select value into strict s from jsonb_array_elements(public.admin_get_biometric_lateness_review('2026-11-11','2026-11-11')) where value->'worker'->>'employee_code'='111';
 assert s->'evidence'->>'raw_minutes'='155','ABDOUL raw minutes changed';
 assert s->'calculation'->>'wage_basis'='monthly_daily_equivalent','Monthly daily equivalent not reused';
 assert (s->'calculation'->>'daily_wage')::numeric=26923.08 and (s->'calculation'->>'scheduled_paid_minutes')::integer=540,'ABDOUL calculation basis incorrect';
 select to_jsonb(a) into original_att from public.attendance a where id=(s->'attendance'->>'id')::uuid;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) into original_pay from public.payroll_line p;
 e:=jsonb_build_object('worker_id',s->'worker'->>'id','decision','approved','approved_minutes',155,'deduction_amount',1,
   'source_fingerprint',s->'evidence'->>'source_fingerprint','calculation_fingerprint',s->'calculation'->>'fingerprint','expected_version',coalesce((s->'review'->>'version')::integer,0));
 perform public.admin_decide_biometric_lateness('2026-11-11',jsonb_build_array(e));
 select * into strict r from public.worker_biometric_lateness_review where worker_id=(s->'worker'->>'id')::uuid and attendance_date='2026-11-11';
 assert r.deduction_amount=7727.92 and r.raw_minutes=155 and r.approved_minutes=155,'Server accepted client money or rounded rate early';
 assert r.history->-1->>'mode'='automatic_daily_wage_v1' and r.actor=auth.uid(),'Automatic audit/actor lost';
 e:=e||jsonb_build_object('approved_minutes',120,'expected_version',r.version);
 perform public.admin_decide_biometric_lateness('2026-11-11',jsonb_build_array(e));
 select * into strict r from public.worker_biometric_lateness_review where worker_id=r.worker_id and attendance_date=r.attendance_date;
 assert r.deduction_amount=5982.91 and r.raw_minutes=155 and r.approved_minutes=120,'Approved minutes did not recalculate';
 assert jsonb_array_length(private.lateness_payroll_sources(r.worker_id,r.attendance_date,r.attendance_date,'CDF'))=1,'Duplicate or missing payroll deduction';
 e:=e||jsonb_build_object('expected_version',r.version,'calculation_fingerprint','stale');
 begin perform public.admin_decide_biometric_lateness('2026-11-11',jsonb_build_array(e)); raise exception 'Stale wage context accepted';
 exception when raise_exception then if sqlerrm<>'Wage or schedule changed; reload and review again' then raise; end if; end;
 e:=e||jsonb_build_object('calculation_fingerprint',s->'calculation'->>'fingerprint','decision','rejected');
 perform public.admin_decide_biometric_lateness('2026-11-11',jsonb_build_array(e));
 assert private.lateness_payroll_sources(r.worker_id,r.attendance_date,r.attendance_date,'CDF')='[]'::jsonb,'Rejected deduction payable';
 assert (select deduction_amount from public.worker_biometric_lateness_review where worker_id=r.worker_id and attendance_date=r.attendance_date)=0,'Rejected deduction not zero';
 ctx:=private.lateness_calculation_context(r.worker_id,'2026-11-14');
 assert (ctx->>'scheduled_paid_minutes')::integer=390,'Saturday official schedule lost';
 select private.lateness_calculation_context(w.id,'2026-11-11') into ctx from public.workers w where attendance_shift='night' limit 1;
 if ctx is not null then assert (ctx->>'scheduled_paid_minutes')::integer=810,'Cross-midnight night span lost'; end if;
 select private.lateness_calculation_context(w.id,'2026-11-11') into ctx from public.workers w join public.teams t on t.id=w.team_id where t.name='Maison' and w.attendance_shift='day' limit 1;
 if ctx is not null then assert (ctx->>'scheduled_paid_minutes')::integer=540,'Maison checkout qualification incorrectly changed official paid span'; end if;
 select private.lateness_calculation_context(w.id,'2026-11-11') into ctx from public.workers w join public.teams t on t.id=w.team_id where t.name='Chauffeur' and w.attendance_shift='day' limit 1;
 if ctx is not null then assert ctx->>'unavailable_reason' is not null and ctx->>'scheduled_paid_minutes' is null,'Invented Chauffeur paid schedule'; end if;
 assert original_att=(select to_jsonb(a) from public.attendance a where id=(s->'attendance'->>'id')::uuid),'Raw attendance modified';
 assert original_pay=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) from public.payroll_line p),'Payroll history modified';
end $$;
rollback;
select 'PASS: ABDOUL 155=7727.92 / 120=5982.91, automatic audit, no client money, stale context, schedules, reject=0, no attendance/payroll mutation' verification;
