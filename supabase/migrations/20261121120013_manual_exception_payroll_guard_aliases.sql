create or replace function private.assert_manual_exception_payroll(l public.payroll_line) returns void language plpgsql security definer set search_path='' as $$
declare exception_row public.worker_manual_overtime_exception;day_value jsonb;
begin
 for exception_row in select * from public.worker_manual_overtime_exception where worker_id=l.worker_id and work_date between l.attendance_period_start and l.attendance_period_end and active loop
   select value into day_value from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]')) where value->>'date'=exception_row.work_date::text;
   if day_value is null or day_value->>'source'<>'manual_exception' or day_value->'manual_exception' is distinct from private.manual_exception_snapshot(exception_row) or(day_value->>'minutes')::integer<>exception_row.extra_minutes or exception_row.currency_code<>l.currency_code_snapshot then raise exception 'Manual exception changed; refresh payroll Draft';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]')) day_item where day_item ? 'manual_exception' and not exists(select 1 from public.worker_manual_overtime_exception stored where stored.worker_id=l.worker_id and stored.work_date=(day_item->>'date')::date and stored.active and private.manual_exception_snapshot(stored)=day_item->'manual_exception')) then raise exception 'Manual exception removed; refresh payroll Draft';end if;
end $$;
revoke all on function private.assert_manual_exception_payroll(public.payroll_line) from public,anon,authenticated;
