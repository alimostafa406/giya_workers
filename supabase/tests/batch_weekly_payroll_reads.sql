begin transaction read only;
select set_config('request.jwt.claim.sub','fbf1dedc-2c5f-49f9-981f-65250179520c',true);
do $$
declare context jsonb; item jsonb; rows jsonb; premium_rows jsonb; started timestamptz:=clock_timestamp();
begin
 context:=public.admin_get_payroll_overtime_context('2026-11-09','2026-11-14');
 rows:=context->'biometricOvertimeReviews';premium_rows:=context->'extraDayReviews';
 assert jsonb_array_length(rows)>0,'Missing biometric rows';
 assert not exists(select 1 from jsonb_array_elements(rows) r where (r->'attendance'->>'attendance_date')::date not between date '2026-11-09' and date '2026-11-14'),'Unbounded biometric history';
 assert not exists(select 1 from jsonb_array_elements(premium_rows) r where (r->>'work_date')::date not between date '2026-11-09' and date '2026-11-14'),'Unbounded Double OT history';
 assert (select count(*)=count(distinct (r->'worker'->>'id',r->'attendance'->>'attendance_date')) from jsonb_array_elements(rows)r),'Duplicate biometric rows';
 for item in select value from jsonb_array_elements(rows) where (value->>'extra_day_payable')::boolean loop
   assert private.extra_day_owns_hourly_date((item->'worker'->>'id')::uuid,(item->'attendance'->>'attendance_date')::date),'Changed canonical Double OT ownership';
 end loop;
 for item in select value from jsonb_array_elements(rows) where not (value->>'extra_day_payable')::boolean limit 10 loop
   assert not private.extra_day_owns_hourly_date((item->'worker'->>'id')::uuid,(item->'attendance'->>'attendance_date')::date),'Hourly candidate incorrectly retained';
 end loop;
 assert not has_function_privilege('anon','public.admin_get_payroll_overtime_context(date,date)','execute'),'Anonymous access allowed';
 assert not has_function_privilege('authenticated','private.payroll_extra_day_reviews(date,date)','execute'),'Private evidence API exposed';
 begin perform public.admin_get_payroll_overtime_context('2026-11-14','2026-11-09');
   raise exception 'Invalid range accepted';
 exception when raise_exception then if sqlerrm<>'Invalid review range' then raise; end if; end;
end $$;
rollback;
select 'PASS: week-bounded batch, unique worker/date, canonical Double OT ownership, protected access, read-only evidence and payroll' verification;
