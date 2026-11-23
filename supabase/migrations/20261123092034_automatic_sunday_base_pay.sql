-- Automatic Sunday base requires the FIRST valid punch inside 08:00–08:20.
create or replace function private.sunday_work_evidence(p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.attendance;morning timestamp;checkout timestamp;first_at timestamp;last_at timestamp;punches bigint;
 eligible boolean:=false;reason text;display_in timestamp;display_out timestamp;answer jsonb;
begin
 if extract(isodow from p_date)<>7 then return jsonb_build_object('eligible',false,'reason','ineligible','punch_count',0);end if;
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date;
 select count(distinct local_time),min(local_time),max(local_time),
   min(local_time) filter(where local_time>=p_date+time '08:00' and local_time<=p_date+time '08:20'),
   max(local_time) filter(where local_time>=p_date+time '13:30')
 into punches,first_at,last_at,morning,checkout
 from(select e.event_timestamp at time zone 'Africa/Kinshasa' local_time from public.biometric_attendance_events e
   where e.worker_id=p_worker and e.attendance_date between p_date and p_date+1
   and e.event_timestamp>=(p_date+time '06:30') at time zone 'Africa/Kinshasa'
   and e.event_timestamp<=((p_date+1)+time '02:00') at time zone 'Africa/Kinshasa'
   and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=p_worker) valid;
 morning:=case when first_at between p_date+time '08:00' and p_date+time '08:20' then first_at end;
 if a.manual_override then
   eligible:=a.status='present' and coalesce(a.attendance_day_fraction,0)>0 and coalesce(a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}','') not in('A','M');
   answer:=jsonb_build_object('eligible',eligible,'reason',case when eligible then 'manual' else 'protected' end,'manual',true,'morning',a.check_in,'checkout',a.check_out);
 else
   eligible:=punches>=2 and morning is not null and checkout is not null;
   reason:=case when eligible then 'eligible' when morning is null and checkout is null then 'ineligible' when morning is null then 'missing_in' else 'missing_out' end;
   answer:=jsonb_build_object('eligible',eligible,'reason',reason,'manual',false,'morning',to_char(morning,'HH24:MI:SS'),'checkout',to_char(checkout,'HH24:MI:SS'));
 end if;
 -- Never display manual clocks as device punches, or repeat one punch as both ends.
 display_in:=coalesce(morning,case when checkout is null then first_at end);
 display_out:=coalesce(checkout,case when punches>1 and last_at is distinct from display_in then last_at end);
 return answer||jsonb_build_object('punch_count',punches,'first_punch',to_char(first_at,'HH24:MI:SS'),'last_punch',to_char(last_at,'HH24:MI:SS'),
   'display_check_in',to_char(display_in,'HH24:MI:SS'),'display_check_out',to_char(display_out,'HH24:MI:SS'));
end $$;
revoke all on function private.sunday_work_evidence(uuid,date) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

-- The existing unique worker/date ledger and payroll reservation/settlement
-- triggers remain the only payment path. This is entitlement, not cash paid.
create or replace function private.accrue_automatic_sunday_base(p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('automatic_sunday_base:'||p_date::text,0));
 lock table public.payroll_run in share mode;
 insert into public.worker_sunday_payment(worker_id,work_date,payment_type_snapshot,compensation_term_id,rule_set_id,currency_code,daily_value,multiplier,amount,confirmed_by,note)
 select w.id,p_date,p.payment_type,c.id,r.id,c.currency_code,
   round(case when p.payment_type='monthly' then c.monthly_salary/r.monthly_working_day_divisor else c.daily_rate end,2),2,
   round(round(case when p.payment_type='monthly' then c.monthly_salary/r.monthly_working_day_divisor else c.daily_rate end,2)*2,2),auth.uid(),
   jsonb_build_object('source','automatic_sunday_attendance','rule','first_0800_0820_checkout_1330','at',now(),'evidence',e.evidence)::text
 from public.workers w join public.worker_payroll_profile p on p.worker_id=w.id
 cross join lateral(select private.sunday_work_evidence(w.id,p_date) evidence)e
 cross join lateral(select * from public.worker_payroll_compensation c where c.worker_id=w.id and c.payment_type=p.payment_type
   and ((c.effective_from<=p_date and(c.effective_to is null or c.effective_to>=p_date))
     or(c.effective_from<=(now() at time zone 'Africa/Kinshasa')::date and(c.effective_to is null or c.effective_to>=(now() at time zone 'Africa/Kinshasa')::date)))
   order by (c.effective_from<=p_date and(c.effective_to is null or c.effective_to>=p_date)) desc,c.effective_from desc limit 1)c
 cross join lateral(select * from public.payroll_rule_set r where r.is_active and r.effective_from<=p_date order by r.effective_from desc limit 1)r
 where coalesce((e.evidence->>'eligible')::boolean,false) and c.currency_code is not null
   and (exists(select 1 from public.biometric_attendance_events b where b.worker_id=w.id and b.attendance_date=p_date)
     or exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date))
   and case when p.payment_type='monthly' then c.monthly_salary>0 and r.monthly_working_day_divisor>0 else c.daily_rate>0 end
   and not exists(select 1 from public.worker_sunday_payment s where s.worker_id=w.id and s.work_date=p_date)
   and not exists(select 1 from public.payroll_run pr where pr.status in('reviewed','finalized','paid') and
     ((pr.payment_type='weekly' and p_date+1 between pr.weekly_period_start and pr.weekly_period_end)
      or exists(select 1 from public.payroll_line pl where pl.payroll_run_id=pr.id and pl.worker_id=w.id and p_date between pl.attendance_period_start and pl.attendance_period_end)))
 on conflict(worker_id,work_date) do nothing;
end $$;
revoke all on function private.accrue_automatic_sunday_base(date) from public,anon,authenticated,service_role;

-- Both Sunday report and weekly payroll already consume this same RPC.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.admin_get_sunday_payroll(date)'::regprocedure);
 if position('private.accrue_automatic_sunday_base(p_date)' in definition)=0 then
  definition:=replace(definition,'return jsonb_build_object(', 'perform private.accrue_automatic_sunday_base(p_date);'||chr(10)||' return jsonb_build_object(');
  execute definition;
 end if;
end $$;
