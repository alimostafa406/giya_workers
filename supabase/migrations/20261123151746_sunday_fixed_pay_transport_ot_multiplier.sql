-- New Sunday-specific compensation starts next Sunday. Earlier Sunday rules,
-- approvals and ledger amounts remain frozen under their original model.
alter table public.worker_sunday_settings add column sunday_fixed_pay numeric(14,2) check(sunday_fixed_pay>=0);
alter table public.worker_sunday_settings add column sunday_transport numeric(14,2) not null default 0 check(sunday_transport>=0);
alter table public.worker_sunday_settings add column overtime_multiplier numeric(8,3) not null default 1 check(overtime_multiplier>0 and overtime_multiplier<=10);
alter table public.worker_sunday_payment add column base_amount numeric(14,2) check(base_amount>=0);
alter table public.worker_sunday_payment add column transport_amount numeric(14,2) not null default 0 check(transport_amount>=0);
alter table public.worker_sunday_payment drop constraint worker_sunday_payment_amount_valid;
alter table public.worker_sunday_payment add constraint worker_sunday_payment_amount_valid
 check(amount=round(coalesce(base_amount,round(daily_value*multiplier,2))+transport_amount,2));

do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.worker_sunday_settings_for_date(uuid,date)'::regprocedure);
 definition:=replace(definition,'return coalesce(selected', 'selected:=coalesce(selected,jsonb_build_object(''custom'',false));'||chr(10)||
 $new$ if p_date>=date '2026-11-29' then
  selected:=jsonb_build_object('sunday_fixed_pay',null,'sunday_transport',0,'overtime_multiplier',1)||selected||jsonb_build_object('pay_model','sunday_specific');
 end if;
 if selected->>'custom'='false' and p_date<date '2026-11-29' then selected:=null;end if;
 return coalesce(selected$new$);
 -- Keep the original defaults even when no custom row exists.
 definition:=replace(definition,'selected:=coalesce(selected,jsonb_build_object(''custom'',false));',
 $new$selected:=coalesce(selected,jsonb_build_object('worker_id',p_worker,'enabled',true,'checkin_cutoff','08:20:00','shift_end','14:00:00','checkout_threshold','13:30:00','pay_multiplier',2,'overtime_start','14:00:00','overtime_requires_approval',true,'note',null,'version',0,'custom',false));$new$);
 -- Original helper adds custom=true; preserve whether a custom row exists.
 definition:=replace(definition,'selected||jsonb_build_object(''custom'',true)', 'selected||jsonb_build_object(''custom'',current_row.worker_id is not null and (selected->>''version'')::integer>0)');
 execute definition;
 definition:=pg_get_functiondef('public.admin_save_worker_sunday_settings(uuid,jsonb,integer)'::regprocedure);
 definition:=replace(definition,'effective_from,updated_by,version,history)', 'effective_from,updated_by,version,history,sunday_fixed_pay,sunday_transport,overtime_multiplier)');
 definition:=replace(definition,'auth.uid(),1,''[]'')', 'auth.uid(),1,''[]'',nullif(p_settings->>''sunday_fixed_pay'','''')::numeric,coalesce(nullif(p_settings->>''sunday_transport'','''')::numeric,0),coalesce(nullif(p_settings->>''overtime_multiplier'','''')::numeric,1))');
 definition:=replace(definition,'effective_from=excluded.effective_from,', 'sunday_fixed_pay=excluded.sunday_fixed_pay,sunday_transport=excluded.sunday_transport,overtime_multiplier=excluded.overtime_multiplier,effective_from=excluded.effective_from,');
 execute definition;
end $$;

create function private.sunday_pay_components(p_worker uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 with config as(select private.worker_sunday_settings_for_date(p_worker,p_date) cfg),
 source as(
  select p.payment_type,c.id,c.daily_rate,c.monthly_salary,c.overtime_rate_per_hour,c.currency_code,r.id rule_id,r.monthly_working_day_divisor,cfg
  from public.worker_payroll_profile p cross join config
  left join lateral(select * from public.worker_payroll_compensation c where c.worker_id=p_worker and c.payment_type=p.payment_type
    and((c.effective_from<=p_date and(c.effective_to is null or c.effective_to>=p_date))
     or(c.effective_from<=(now() at time zone 'Africa/Kinshasa')::date and(c.effective_to is null or c.effective_to>=(now() at time zone 'Africa/Kinshasa')::date)))
    order by(c.effective_from<=p_date and(c.effective_to is null or c.effective_to>=p_date))desc,c.effective_from desc limit 1)c on true
  left join lateral(select * from public.payroll_rule_set r where r.is_active and r.effective_from<=p_date order by effective_from desc limit 1)r on true
  where p.worker_id=p_worker
 ), amounts as(
  select *,case when cfg->>'pay_model'='sunday_specific' and payment_type='monthly' then (cfg->>'sunday_fixed_pay')::numeric
    when payment_type='weekly' then daily_rate else round(monthly_salary/nullif(monthly_working_day_divisor,0),2) end daily,
   case when cfg->>'pay_model'='sunday_specific' then case when payment_type='monthly' then 1 else 2 end else (cfg->>'pay_multiplier')::numeric end factor
  from source
 )
 select jsonb_build_object('payment_type',payment_type,'daily_value',daily,'multiplier',factor,'base_amount',round(daily*factor,2),
  'transport_amount',case when cfg->>'pay_model'='sunday_specific' then coalesce((cfg->>'sunday_transport')::numeric,0) else 0 end,
  'currency',currency_code,'compensation_term_id',id,'rule_set_id',rule_id,
  'normal_hourly_rate',overtime_rate_per_hour,'overtime_rate',overtime_rate_per_hour*coalesce((cfg->>'overtime_multiplier')::numeric,1)) from amounts;
$$;
revoke all on function private.sunday_pay_components(uuid,date) from public,anon,authenticated,service_role;

create or replace function private.accrue_automatic_sunday_base(p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('automatic_sunday_base:'||p_date::text,0));
 lock table public.payroll_run in share mode;
 insert into public.worker_sunday_payment(worker_id,work_date,payment_type_snapshot,compensation_term_id,rule_set_id,currency_code,daily_value,multiplier,base_amount,transport_amount,amount,confirmed_by,note)
 select w.id,p_date,pay.c->>'payment_type',(pay.c->>'compensation_term_id')::uuid,(pay.c->>'rule_set_id')::uuid,pay.c->>'currency',
  (pay.c->>'daily_value')::numeric,(pay.c->>'multiplier')::numeric,(pay.c->>'base_amount')::numeric,(pay.c->>'transport_amount')::numeric,
  round((pay.c->>'base_amount')::numeric+(pay.c->>'transport_amount')::numeric,2),auth.uid(),jsonb_build_object('source','automatic_sunday_attendance','at',now(),'evidence',e.evidence,'compensation',pay.c)::text
 from public.workers w cross join lateral(select private.sunday_work_evidence(w.id,p_date) evidence)e
 cross join lateral(select private.sunday_pay_components(w.id,p_date)c)pay
 where coalesce((e.evidence->>'eligible')::boolean,false) and pay.c->>'currency' is not null and (pay.c->>'base_amount')::numeric>=0
  and(p_date>=date '2026-11-29' or (pay.c->>'base_amount')::numeric>0)
  and pay.c->>'compensation_term_id' is not null and pay.c->>'rule_set_id' is not null
  and(exists(select 1 from public.biometric_attendance_events b where b.worker_id=w.id and b.attendance_date=p_date)or exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date))
  and not exists(select 1 from public.worker_sunday_payment s where s.worker_id=w.id and s.work_date=p_date)
  and not exists(select 1 from public.payroll_run pr where pr.status in('reviewed','finalized','paid') and
   ((pr.payment_type='weekly' and p_date+1 between pr.weekly_period_start and pr.weekly_period_end)
    or exists(select 1 from public.payroll_line pl where pl.payroll_run_id=pr.id and pl.worker_id=w.id and p_date between pl.attendance_period_start and pl.attendance_period_end)))
 on conflict(worker_id,work_date) do nothing;
end $$;

do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 definition:=replace(definition,'''hourly_rate'',term.overtime_rate_per_hour,', '''normal_hourly_rate'',term.overtime_rate_per_hour,''hourly_rate'',term.overtime_rate_per_hour*coalesce((c.sunday_settings->>''overtime_multiplier'')::numeric,1),');
 execute definition;
end $$;
create function private.ensure_sunday_specific_payment(p_worker uuid,p_date date,p_actor uuid,p_viewer uuid) returns public.worker_sunday_payment
language plpgsql security definer set search_path='' as $$
declare pay jsonb;stored public.worker_sunday_payment;
begin
 if num_nonnulls(p_actor,p_viewer)<>1 then raise exception 'Actor required' using errcode='42501';end if;
 if p_date is null or extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date then raise exception 'Invalid Sunday';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_worker::text||':'||p_date::text||':sunday_payment',0));
 lock table public.payroll_run in share mode;
 select * into stored from public.worker_sunday_payment where worker_id=p_worker and work_date=p_date for update;
 if found then
  if stored.payment_status='cancelled' then raise exception 'Cancelled Sunday payment requires separate review';end if;
  return stored;
 end if;
 if not coalesce((private.sunday_work_evidence(p_worker,p_date)->>'eligible')::boolean,false) then raise exception 'Sunday attendance incomplete';end if;
 if exists(select 1 from public.payroll_run pr where pr.status in('reviewed','finalized','paid') and
  ((pr.payment_type='weekly' and p_date+1 between pr.weekly_period_start and pr.weekly_period_end)
   or exists(select 1 from public.payroll_line pl where pl.payroll_run_id=pr.id and pl.worker_id=p_worker and p_date between pl.attendance_period_start and pl.attendance_period_end))) then raise exception 'Payroll locked';end if;
 pay:=private.sunday_pay_components(p_worker,p_date);
 if pay->>'base_amount' is null or pay->>'currency' is null or pay->>'compensation_term_id' is null or pay->>'rule_set_id' is null then raise exception 'Sunday pay configuration required';end if;
 insert into public.worker_sunday_payment(worker_id,work_date,payment_type_snapshot,compensation_term_id,rule_set_id,currency_code,daily_value,multiplier,base_amount,transport_amount,amount,confirmed_by,confirmed_by_viewer_id,note)
 values(p_worker,p_date,pay->>'payment_type',(pay->>'compensation_term_id')::uuid,(pay->>'rule_set_id')::uuid,pay->>'currency',(pay->>'daily_value')::numeric,(pay->>'multiplier')::numeric,
  (pay->>'base_amount')::numeric,(pay->>'transport_amount')::numeric,round((pay->>'base_amount')::numeric+(pay->>'transport_amount')::numeric,2),p_actor,p_viewer,jsonb_build_object('source','automatic_sunday_attendance','compensation',pay,'at',now())::text)
 on conflict(worker_id,work_date) do nothing returning * into stored;
 if stored.id is null then select * into stored from public.worker_sunday_payment where worker_id=p_worker and work_date=p_date;end if;
 return stored;
end $$;
revoke all on function private.ensure_sunday_specific_payment(uuid,date,uuid,uuid) from public,anon,authenticated,service_role;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.viewer_confirm_sunday_core(uuid,date,text,uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'if extract(isodow from p_work_date)',
  $new$if p_work_date>=date '2026-11-29' then return private.ensure_sunday_specific_payment(p_worker_id,p_work_date,p_source_actor,p_viewer_actor);end if;
 if extract(isodow from p_work_date)$new$);
 execute definition;
end $$;
notify pgrst,'reload schema';
