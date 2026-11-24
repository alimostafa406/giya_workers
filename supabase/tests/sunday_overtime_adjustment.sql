-- Run against an authorized source-admin session. Real evidence, rollback only.
begin;
do $test$
declare s jsonb; result jsonb; current_review public.worker_biometric_overtime_review; amount numeric; n integer;
begin
 if not public.is_admin() then raise exception 'Run as the authorized administrator';end if;
 select value into s from jsonb_array_elements(private.sunday_hourly_sources('2026-11-22')) where value->'worker'->>'employee_code'='71';
 if s is null or (s->>'raw_minutes')::integer<>301 then raise exception 'Expected real juresse evidence';end if;
 foreach n in array array[270,330,300] loop
  select * into current_review from public.worker_biometric_overtime_review where worker_id=(s->'worker'->>'id')::uuid and attendance_date='2026-11-22';
  result:=public.admin_decide_biometric_overtime('2026-11-22',jsonb_build_array(jsonb_build_object(
   'worker_id',s->'worker'->>'id','minutes',n,'decision','approved','original_biometric_minutes',301,'note','Sunday review regression',
   'source_fingerprint',s->>'source_fingerprint','expected_version',coalesce(current_review.version,0))));
  select * into current_review from public.worker_biometric_overtime_review where worker_id=(s->'worker'->>'id')::uuid and attendance_date='2026-11-22';
  amount:=round(n::numeric*(s->>'hourly_rate')::numeric/60,2);
  if current_review.minutes<>n or (current_review.history->-1->>'raw_overtime_minutes')::integer<>301
    or (current_review.history->-1->>'approved_amount')::numeric<>amount then raise exception 'Adjustment/audit mismatch';end if;
 end loop;
 begin
  perform public.admin_decide_biometric_overtime('2026-11-22',jsonb_build_array(jsonb_build_object(
   'worker_id',s->'worker'->>'id','minutes',300,'decision','approved','original_biometric_minutes',301,'note','',
   'source_fingerprint','stale','expected_version',current_review.version)));
  raise exception 'Stale evidence accepted';
 exception when others then if sqlerrm='Stale evidence accepted' or sqlerrm not like 'Biometric evidence changed%' then raise;end if;
 end;
end $test$;
rollback;
