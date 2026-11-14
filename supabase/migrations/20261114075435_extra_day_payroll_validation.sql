create function private.assert_extra_day_payroll(l public.payroll_line) returns void language plpgsql security definer set search_path='' as $$
declare sources jsonb; amount numeric; total_minutes numeric; day jsonb;
begin
 sources:=private.extra_day_payroll_sources(l.worker_id,l.attendance_period_start,l.attendance_period_end);
 select coalesce(sum((value->>'amount')::numeric),0) into amount from jsonb_array_elements(sources);
 if sources<>coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]')
   or amount<>coalesce((l.calculation_snapshot->>'extra_day_amount')::numeric,0)
   or jsonb_array_length(sources)<>coalesce((l.calculation_snapshot->>'extra_days')::integer,0)
   or coalesce(l.bonus_amount,0)<amount then raise exception 'Extra-day premium changed; refresh Draft'; end if;
 if jsonb_array_length(sources)=0 then return; end if;
 if exists(select 1 from public.worker_weekly_overtime_override where worker_id=l.worker_id and minutes>0 and week_start=l.attendance_period_start)
   or exists(select 1 from jsonb_array_elements(sources) s where s->>'currency'<>l.currency_code_snapshot) then raise exception 'Extra day conflicts with currency/undated weekly OT'; end if;
 for day in select value from jsonb_array_elements(sources) loop
   if not exists(select 1 from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]')) d
     where d->>'date'=day->>'date' and (d->>'minutes')::numeric=0) then raise exception 'Hourly OT overlaps approved extra day'; end if;
 end loop;
 select coalesce(sum((value->>'minutes')::numeric),0) into total_minutes from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]'));
 if total_minutes<0 or total_minutes<>coalesce((l.calculation_snapshot->>'evening_overtime_minutes')::numeric,0)
   or (total_minutes>0 and nullif(l.compensation_snapshot->>'overtime_rate_per_hour','') is null)
   or l.overtime_amount<>(case when total_minutes=0 then 0 else round(total_minutes/60*(l.compensation_snapshot->>'overtime_rate_per_hour')::numeric,2) end)
   or l.final_amount<>round(l.base_amount+l.transport_amount+l.overtime_amount+l.holiday_amount+l.bonus_amount-l.deduction_amount-l.advance_amount+l.manual_adjustment_amount,2)
   then raise exception 'Extra-day payroll totals do not reconcile'; end if;
end $$;
create or replace function private.guard_extra_day_payroll() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.payroll_line; run public.payroll_run;
begin
 if tg_table_name='payroll_line' then
   select * into run from public.payroll_run where id=new.payroll_run_id for update;
   if run.payment_type='weekly' and run.status='draft' then perform private.assert_extra_day_payroll(new); end if;
 elsif new.payment_type='weekly' and old.status='draft' and new.status='reviewed' then
   for l in select * from public.payroll_line where payroll_run_id=new.id loop perform private.assert_extra_day_payroll(l); end loop;
 end if;
 return new;
end $$;
revoke all on function private.assert_extra_day_payroll(public.payroll_line) from public,anon,authenticated;
