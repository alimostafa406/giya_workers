-- Verification only: no production writes.
do $$
declare w uuid; r public.extra_day_overtime_review; prior jsonb; sources jsonb;
begin
 select id into strict w from public.workers where employee_code='143' and full_name='PUATI';
 assert (select count(*)=3 and sum(approved_amount)=75000 from public.extra_day_overtime_review
   where worker_id=w and work_date in ('2026-11-23','2026-11-25','2026-11-26') and decision='approved');
 for r in select * from public.extra_day_overtime_review where worker_id=w and work_date in ('2026-11-23','2026-11-25','2026-11-26') loop
  assert r.decision='approved' and r.approved_amount=25000;
  assert r.source_fingerprint=private.extra_day_source(r.rule_snapshot,w,r.work_date)->>'fingerprint';
  assert r.history->-1->>'action'='authorized_retroactive_salary_correction';
  assert r.history->-1->>'old_monthly_salary'='0' and r.history->-1->>'corrected_monthly_salary'='650000';
  prior:=r.history->-1->'previous';
  assert r.actor::text=prior->>'actor' and r.decided_at=(prior->>'decided_at')::timestamptz;
  assert r.rule_snapshot=prior->'rule_snapshot' and r.version=(prior->>'version')::integer+1;
 end loop;
 sources:=private.extra_day_payroll_sources(w,'2026-11-23','2026-11-28');
 assert jsonb_array_length(sources)=3;
 assert (select sum((p->>'amount')::numeric)=75000 from jsonb_array_elements(sources)p);
 assert (select count(*)=3 from public.worker_payroll_compensation where worker_id=w and payment_type='monthly'
  and effective_from=effective_to and effective_from in ('2026-11-23','2026-11-25','2026-11-26')
  and monthly_salary=650000 and daily_transport_allowance=20000 and overtime_rate_per_hour=3500);
 assert exists(select 1 from public.worker_payroll_compensation where worker_id=w and effective_from='2026-10-31' and monthly_salary=0),'Old salary history erased';
 assert not exists(select 1 from public.payroll_line l join public.payroll_run p on p.id=l.payroll_run_id where l.worker_id=w
  and l.attendance_period_start<='2026-11-28' and l.attendance_period_end>='2026-11-23' and p.status in ('finalized','paid'));
end $$;
