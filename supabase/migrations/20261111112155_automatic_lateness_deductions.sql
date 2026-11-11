-- Reuse the existing protected review write path; money is now server-derived.
-- No attendance, biometric, existing review or finalized payroll rows are rewritten.
alter table public.worker_biometric_lateness_review add column calculation_snapshot jsonb not null default '{}';

create function private.lateness_calculation_context(p_worker uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.workers; a public.attendance; c public.worker_payroll_compensation; r public.payroll_rule_set;
 team_name text; payment text; start_at timestamp; end_at timestamp; paid_minutes integer;
 daily_wage numeric; factor numeric; basis text; reason text; result jsonb;
begin
 select * into w from public.workers where id=p_worker;
 select name into team_name from public.teams where id=w.team_id;
 select payment_type into payment from public.worker_payroll_profile where worker_id=w.id;
 select * into a from public.attendance where worker_id=w.id and attendance_date=p_date;
 select * into c from public.worker_payroll_compensation where worker_id=w.id and payment_type=payment
   and effective_from<=p_date and (effective_to is null or effective_to>=p_date) order by effective_from desc,created_at desc limit 1;
 select * into r from public.payroll_rule_set where is_active and effective_from<=p_date
   and (effective_to is null or effective_to>=p_date) order by effective_from desc limit 1;
 -- Official paid span from attendance_business_rules.workday_schedule, not the
 -- early-checkout qualification/grace threshold (including Maison's 16:00).
 -- No unpaid-break deduction exists in the canonical schedule.
 if w.attendance_shift='night' then start_at:=p_date+time '17:00'; end_at:=p_date+1+time '06:30';
 elsif team_name='Chauffeur' or extract(isodow from p_date)=7 then reason:='لا يوجد دوام مدفوع معتمد لهذا التاريخ';
 else
   start_at:=p_date+time '08:00';
   end_at:=p_date+case when extract(isodow from p_date)=6 then time '14:30' else time '17:00' end;
 end if;
 paid_minutes:=extract(epoch from end_at-start_at)/60;
 -- Same factor as finalAttendanceStatus + calculatePayrollLine.baseEffect.
 -- From the canonical final-status effective date, a real biometric punch makes
 -- legacy late/half-day rows present; older dates retain the half-day rule.
 factor:=case when a.status='present' then 1
   when p_date>=date '2026-10-13' and a.attendance_source='biometric' and not coalesce(a.manual_override,false)
     and a.status in ('late','half_day','in_progress','pending') and (a.check_in is not null or a.check_out is not null) then 1
   when a.status='late' and (a.attendance_day_fraction=1 or a.check_out is not null) then 1
   when a.status in ('late','half_day') then coalesce(r.half_day_multiplier,0.5) else 0 end;
 if payment='weekly' and c.daily_rate is not null then daily_wage:=round(c.daily_rate*factor,2); basis:='weekly_daily_rate';
 elsif payment='monthly' and coalesce(c.monthly_salary,(select monthly_salary from public.worker_payroll_profile where worker_id=w.id)) is not null then
   -- monthlyDailyValue is the existing monthly payroll daily equivalent. Its
   -- two-decimal currency rounding is canonical; do not round per-minute rates.
   daily_wage:=round(round(coalesce(c.monthly_salary,(select monthly_salary from public.worker_payroll_profile where worker_id=w.id))/coalesce(nullif(r.monthly_working_day_divisor,0),26),2)*factor,2);
   basis:='monthly_daily_equivalent';
 else reason:=coalesce(reason,'الأجر اليومي المعتمد غير محدد'); end if;
 if c.currency_code is distinct from 'CDF' then reason:=coalesce(reason,'يلزم أجر معتمد بعملة CDF'); end if;
 if factor<=0 then reason:=coalesce(reason,'لا يوجد أجر يوم مدفوع لهذا التاريخ'); end if;
 result:=jsonb_build_object('mode','automatic_daily_wage_v1','daily_wage',daily_wage,'scheduled_paid_minutes',paid_minutes,
   'scheduled_start',start_at,'scheduled_end',end_at,'currency_code',c.currency_code,'wage_basis',basis,
   'compensation_id',c.id,'rule_id',r.id,'attendance_factor',factor,'monthly_divisor',coalesce(r.monthly_working_day_divisor,26),
   'value_per_minute',daily_wage/nullif(paid_minutes,0),'unavailable_reason',reason);
 return result||jsonb_build_object('fingerprint',md5(result::text));
end $$;

alter function public.admin_decide_biometric_lateness(date,jsonb) set schema private;
alter function private.admin_decide_biometric_lateness(date,jsonb) rename to lateness_decision_core;
revoke all on function private.lateness_decision_core(date,jsonb) from public,anon,authenticated;
alter function public.admin_get_biometric_lateness_review(date,date) set schema private;
alter function private.admin_get_biometric_lateness_review(date,date) rename to lateness_read_core;
revoke all on function private.lateness_read_core(date,date) from public,anon,authenticated;

create function public.admin_decide_biometric_lateness(p_date date,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; context jsonb; prepared jsonb:='[]'; result jsonb; amount numeric; minutes integer; target_worker_id uuid;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch'; end if;
 lock table public.payroll_run in share mode;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
   if coalesce(entry->>'approved_minutes','')!~'^[0-9]{1,4}$' then raise exception 'Invalid approved minutes'; end if;
   minutes:=(entry->>'approved_minutes')::integer;
   if minutes>1440 then raise exception 'Invalid approved minutes'; end if;
   target_worker_id:=(entry->>'worker_id')::uuid;
   perform 1 from public.workers where workers.id=target_worker_id for share;
   perform 1 from public.worker_payroll_profile where worker_id=target_worker_id for share;
   perform 1 from public.worker_payroll_compensation where worker_id=target_worker_id for share;
   perform 1 from public.payroll_rule_set where is_active for share;
   perform 1 from public.attendance where worker_id=target_worker_id and attendance_date=p_date for update;
   context:=private.lateness_calculation_context(target_worker_id,p_date);
   if entry->>'decision'='approved' and context->>'unavailable_reason' is not null then raise exception '%',context->>'unavailable_reason'; end if;
   if entry->>'calculation_fingerprint' is distinct from context->>'fingerprint' then raise exception 'Wage or schedule changed; reload and review again'; end if;
   amount:=case when entry->>'decision'='approved' then round((context->>'daily_wage')::numeric/(context->>'scheduled_paid_minutes')::numeric*minutes,2) else 0 end;
   -- Caller-supplied money is intentionally ignored, never trusted.
   prepared:=prepared||jsonb_build_array(entry||jsonb_build_object('deduction_amount',amount,'calculation_snapshot',context));
 end loop;
 result:=private.lateness_decision_core(p_date,prepared);
 for entry in select value from jsonb_array_elements(prepared) loop
   update public.worker_biometric_lateness_review r set calculation_snapshot=entry->'calculation_snapshot',
     history=jsonb_set(r.history,array[(jsonb_array_length(r.history)-1)::text],(r.history->-1)||jsonb_build_object('mode','automatic_daily_wage_v1','calculation',entry->'calculation_snapshot'))
     where worker_id=(entry->>'worker_id')::uuid and attendance_date=p_date;
 end loop;
 return result;
end $$;

create or replace function private.lateness_payroll_sources(p_worker uuid,p_start date,p_end date,p_currency text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('date',r.attendance_date,'version',r.version,
   'source_fingerprint',r.source_fingerprint,'approved_minutes',r.approved_minutes,
   'deduction_amount',r.deduction_amount,'actor',r.actor,'decided_at',r.decided_at) order by r.attendance_date),'[]')
 from public.worker_biometric_lateness_review r join public.attendance a on a.id=r.source_attendance_id
 join public.workers w on w.id=r.worker_id left join public.teams t on t.id=w.team_id
 where r.worker_id=p_worker and r.attendance_date between p_start and p_end and r.decision='approved' and p_currency=r.currency_code
 and r.source_fingerprint=private.biometric_lateness_evidence(a,w,t.name)->>'source_fingerprint'
 and (r.calculation_snapshot->>'mode' is distinct from 'automatic_daily_wage_v1'
   or r.calculation_snapshot->>'fingerprint'=private.lateness_calculation_context(w.id,r.attendance_date)->>'fingerprint');
$$;

create function public.admin_get_biometric_lateness_review(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; row jsonb; context jsonb; answer jsonb:='[]';
begin
 -- The original read core retains its exact active-admin/range protections.
 rows:=private.lateness_read_core(p_start,p_end);
 for row in select value from jsonb_array_elements(rows) loop
   context:=private.lateness_calculation_context((row->'worker'->>'id')::uuid,(row->'attendance'->>'attendance_date')::date);
   answer:=answer||jsonb_build_array(row||jsonb_build_object('calculation',context));
 end loop;
 return answer;
end $$;
revoke all on function private.lateness_calculation_context(uuid,date) from public,anon,authenticated;
revoke all on function public.admin_get_biometric_lateness_review(date,date),public.admin_decide_biometric_lateness(date,jsonb) from public,anon;
grant execute on function public.admin_get_biometric_lateness_review(date,date),public.admin_decide_biometric_lateness(date,jsonb) to authenticated;
notify pgrst,'reload schema';
