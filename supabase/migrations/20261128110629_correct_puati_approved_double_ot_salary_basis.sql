-- User-authorized correction of erroneous zero salary for three approved dates.
-- Existing approvals are corrected in place; no new decision or payment is created.
do $correction$
declare target uuid; dates date[]:=array[date '2026-11-23',date '2026-11-25',date '2026-11-26'];
 day date; old_term public.worker_payroll_compensation%rowtype; new_term_id uuid;
 prior public.extra_day_overtime_review%rowtype; before_source jsonb; corrected_source jsonb; divisor numeric;
 audit jsonb; approval_count integer;
begin
 select id into strict target from public.workers where employee_code='143' and full_name='PUATI';
 -- Serialize against payroll creation, review, finalization and payment.
 lock table public.payroll_run,public.payroll_line in share mode;
 if exists(select 1 from public.payroll_run where payment_type='weekly' and weekly_period_start<=date '2026-11-28'
   and weekly_period_end>=date '2026-11-23' and status in ('reviewed','finalized','paid'))
 or exists(select 1 from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
   where l.worker_id=target and l.attendance_period_start<=date '2026-11-28' and l.attendance_period_end>=date '2026-11-23'
   and r.status in ('reviewed','finalized','paid')) then
   raise exception 'BLOCKED: PUATI payroll week is reviewed/finalized/paid';
 end if;
 if not exists(select 1 from public.worker_payroll_profile where worker_id=target and payment_type='monthly' and monthly_salary=650000) then
   raise exception 'PUATI monthly salary basis differs from authorized CDF 650000'; end if;
 select count(*) into approval_count from public.extra_day_overtime_review where worker_id=target and work_date=any(dates) and decision='approved';
 if approval_count<>3 then raise exception 'Expected exactly three existing approved PUATI decisions'; end if;
 if (select count(*) from public.extra_day_overtime_review where worker_id=target and work_date=any(dates)
   and decision='approved' and approved_amount=25000 and history @> '[{"action":"authorized_retroactive_salary_correction","correction":"puati_20261123_25_26_salary650000"}]')=3 then return; end if;
 foreach day in array dates loop
   perform pg_advisory_xact_lock(hashtextextended(target::text||':'||day::text,0));
   if private.extra_day_locked(target,day) then raise exception 'BLOCKED: PUATI date % is payroll locked',day; end if;
   select * into strict prior from public.extra_day_overtime_review where worker_id=target and work_date=day and decision='approved' for update;
   if prior.approved_amount<>0 or prior.currency_code<>'CDF' then raise exception 'Unexpected existing approved PUATI amount'; end if;
   before_source:=private.extra_day_source(prior.rule_snapshot,target,day);
   if before_source->>'fingerprint'<>prior.source_fingerprint or (before_source->>'qualified')::boolean is not true
     or (before_source->>'daily_wage')::numeric<>0 then raise exception 'PUATI source changed; review before correction'; end if;
   select * into strict old_term from public.worker_payroll_compensation where worker_id=target and payment_type='monthly'
     and effective_from<=day and (effective_to is null or effective_to>=day) order by effective_from desc,created_at desc limit 1 for update;
   if old_term.monthly_salary<>0 or old_term.currency_code<>'CDF' then raise exception 'Expected erroneous historical CDF zero salary'; end if;
   select monthly_working_day_divisor into divisor from public.payroll_rule_set where is_active and effective_from<=day
     and (effective_to is null or effective_to>=day) order by effective_from desc limit 1;
   if divisor is distinct from 26 then raise exception 'Canonical monthly divisor differs from 26'; end if;
   -- Preserve the old zero term. This one-day correction takes dated precedence
   -- and copies transport/hourly rate unchanged. Other dates remain untouched.
   insert into public.worker_payroll_compensation(worker_id,payment_type,effective_from,effective_to,currency_code,daily_rate,
     daily_transport_allowance,overtime_rate_per_hour,overtime_start_time,monthly_salary,monthly_payroll_cycle_start_date)
   values(target,'monthly',day,day,old_term.currency_code,old_term.daily_rate,old_term.daily_transport_allowance,
     old_term.overtime_rate_per_hour,old_term.overtime_start_time,650000,old_term.monthly_payroll_cycle_start_date)
   returning id into new_term_id;
   corrected_source:=private.extra_day_source(prior.rule_snapshot,target,day);
   if (corrected_source->>'daily_wage')::numeric<>25000 or (corrected_source->>'qualified')::boolean is not true
     or (before_source-array['fingerprint','daily_wage','proposed_premium']) is distinct from
        (corrected_source-array['fingerprint','daily_wage','proposed_premium']) then
     raise exception 'Correction changed evidence or eligibility instead of salary basis only'; end if;
   audit:=jsonb_build_object('action','authorized_retroactive_salary_correction','correction','puati_20261123_25_26_salary650000',
     'at',clock_timestamp(),'source','authorized_database_maintenance','database_actor',session_user,
     'reason','User confirmed historical salary CDF 0 was erroneous; CDF 650000 applies to these approved Double OT dates',
     'work_date',day,'old_monthly_salary',0,'corrected_monthly_salary',650000,'monthly_divisor',divisor,
     'old_daily_wage',0,'corrected_daily_wage',25000,'old_compensation',to_jsonb(old_term),'correction_compensation_id',new_term_id,
     'previous',to_jsonb(prior)-'history','corrected_source',corrected_source);
   update public.extra_day_overtime_review set approved_amount=(corrected_source->>'daily_wage')::numeric,
     source_snapshot=corrected_source,source_fingerprint=corrected_source->>'fingerprint',version=prior.version+1,
     history=prior.history||jsonb_build_array(audit)
   where rule_id=prior.rule_id and worker_id=target and work_date=day;
 end loop;
 if (select sum(approved_amount) from public.extra_day_overtime_review where worker_id=target and work_date=any(dates) and decision='approved')<>75000 then
   raise exception 'Corrected approved Double OT total differs from CDF 75000'; end if;
end;
$correction$;
