-- Action priority is separate from payable ownership. No decision/history updates.
create or replace function private.payroll_biometric_reviews_with_extra_days(p_start date,p_end date,p_extra_days jsonb)
returns jsonb language sql security definer set search_path='' as $$
 with owned as materialized (
   select (e->>'worker_id')::uuid worker_id,(e->>'work_date')::date work_date
   from jsonb_array_elements(p_extra_days) e
   where e->'payroll_source' is not null and e->'payroll_source'<>'null'::jsonb
   union
   select l.worker_id,(s->>'date')::date
   from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
   cross join lateral jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]')) s
   where l.attendance_period_start<=p_end and l.attendance_period_end>=p_start
     and r.status in ('reviewed','finalized','paid')
     and s->>'date' between p_start::text and p_end::text and (s->>'extra_days')::numeric>0
 ), blocked as materialized (
   select distinct (e->>'worker_id')::uuid worker_id,(e->>'work_date')::date work_date
   from jsonb_array_elements(p_extra_days) e where e->>'status' in('pending','approved','stale')
 ), rows as materialized (
   select value item,ordinality ord
   from jsonb_array_elements(private.viewer_payroll_reviews_before_extra_day(p_start,p_end)) with ordinality
 )
 select coalesce(jsonb_agg(item||jsonb_build_object('extra_day_payable',o.worker_id is not null,
   'extra_day_review_blocked',o.worker_id is not null or b.worker_id is not null) order by ord),'[]'::jsonb)
 from rows left join owned o on o.worker_id=(item->'worker'->>'id')::uuid
   and o.work_date=(item->'attendance'->>'attendance_date')::date
 left join blocked b on b.worker_id=(item->'worker'->>'id')::uuid
   and b.work_date=(item->'attendance'->>'attendance_date')::date;
$$;
create or replace function private.viewer_biometric_ot_core(p_date date,p_entries jsonb,p_source_actor uuid,p_viewer_actor uuid,p_viewer_username text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; extra_reviews jsonb;
begin
 if p_date is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch';end if;
 lock table public.payroll_run in share mode;
 -- Same locks/order as Double OT; read decisions only after obtaining locks.
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
   perform pg_advisory_xact_lock(hashtextextended((entry->>'worker_id')||':'||p_date::text||':extra_day',0));
 end loop;
 extra_reviews:=private.payroll_extra_day_reviews(p_date,p_date);
 for entry in select value from jsonb_array_elements(p_entries) loop
   if entry->>'decision'='approved' and (
     private.extra_day_owns_hourly_date((entry->>'worker_id')::uuid,p_date)
     or exists(select 1 from jsonb_array_elements(extra_reviews) e
       where e->>'worker_id'=entry->>'worker_id' and e->>'work_date'=p_date::text and e->>'status' in('pending','approved','stale'))
   ) then raise exception 'Double Overtime review has priority for this worker/date; resolve it before hourly approval'; end if;
 end loop;
 return private.viewer_biometric_ot_before_extra_day(p_date,p_entries,p_source_actor,p_viewer_actor,p_viewer_username);
end $$;
revoke all on function private.payroll_biometric_reviews_with_extra_days(date,date,jsonb),private.viewer_biometric_ot_core(date,jsonb,uuid,uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';
