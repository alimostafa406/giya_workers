-- Read/guard checks only; no successful approval writes.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare r public.extra_day_overtime_review;rows jsonb;before_rows jsonb;source jsonb;before_hash text;count_owned integer:=0;amount numeric:=0;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by worker_id,attendance_date)::text,'')) into before_hash from public.worker_biometric_overtime_review x;
 rows:=private.viewer_payroll_reviews_core('2026-11-12','2026-11-12');
 before_rows:=private.viewer_payroll_reviews_before_extra_day('2026-11-12','2026-11-12');
 assert (select jsonb_agg(value-'extra_day_payable') from jsonb_array_elements(rows))=before_rows,'Underlying candidate evidence changed';
 for r in select * from public.extra_day_overtime_review where work_date='2026-11-12' and decision='approved' loop
   assert private.extra_day_owns_hourly_date(r.worker_id,r.work_date),'Payable extra-day ownership missing';
   select value into strict source from jsonb_array_elements(rows) where value->'worker'->>'id'=r.worker_id::text;
   assert source->>'extra_day_payable'='true','Daily payload missing ownership';
   assert jsonb_array_length(private.extra_day_payroll_sources(r.worker_id,r.work_date,r.work_date))=1,'Premium not exactly once';
   begin
     perform private.viewer_biometric_ot_core(r.work_date,jsonb_build_array(jsonb_build_object('worker_id',r.worker_id,'decision','approved','minutes',60)),auth.uid(),null,null);
     raise exception 'Hourly approval bypassed Double OT';
   exception when raise_exception then
     if sqlerrm<>'Approved Double Overtime replaces hourly overtime for this worker/date' then raise;end if;
   end;
   -- Another date can legitimately have its own approval while this audit runs.
   if jsonb_array_length(private.extra_day_payroll_sources(r.worker_id,r.work_date+1,r.work_date+1))=0
     and not exists(select 1 from public.payroll_line l join public.payroll_run p on p.id=l.payroll_run_id
       cross join lateral jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]')) s
       where l.worker_id=r.worker_id and p.status in ('reviewed','finalized','paid') and s->>'date'=(r.work_date+1)::text) then
     assert not private.extra_day_owns_hourly_date(r.worker_id,r.work_date+1),'Unowned other date hidden';
   end if;
   count_owned:=count_owned+1;amount:=amount+r.approved_amount;
 end loop;
 assert count_owned=19 and amount=391500,'Approved population/premium changed';
 assert (select count(*) from jsonb_array_elements(rows) where (value->>'extra_day_payable')::boolean)=19,'Other workers hidden';
 assert before_hash=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by worker_id,attendance_date)::text,'')) from public.worker_biometric_overtime_review x),'Hourly approval records mutated';
end $$;
rollback;
select 'PASS: 19 exact worker/dates owned, 391500 unchanged, other dates/workers/evidence retained, stale-browser hourly approval blocked without writes' verification;
