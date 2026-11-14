-- A payable extra day owns only this worker/date; evidence and old reviews remain stored.
create function private.extra_day_owns_hourly_date(p_worker uuid,p_date date)
returns boolean language sql stable security definer set search_path='' as $$
 select jsonb_array_length(private.extra_day_payroll_sources(p_worker,p_date,p_date))>0
 or exists(select 1 from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
   cross join lateral jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]')) s
   where l.worker_id=p_worker and r.status in ('reviewed','finalized','paid') and s->>'date'=p_date::text and (s->>'extra_days')::numeric>0);
$$;
alter function private.viewer_payroll_reviews_core(date,date) rename to viewer_payroll_reviews_before_extra_day;
create function private.viewer_payroll_reviews_core(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;item jsonb;answer jsonb:='[]';
begin
 rows:=private.viewer_payroll_reviews_before_extra_day(p_start,p_end);
 for item in select value from jsonb_array_elements(rows) loop
   answer:=answer||jsonb_build_array(item||jsonb_build_object('extra_day_payable',
     private.extra_day_owns_hourly_date((item->'worker'->>'id')::uuid,(item->'attendance'->>'attendance_date')::date)));
 end loop;
 return answer;
end $$;

-- A stale browser must not approve hourly OT after Double OT takes ownership.
-- Serialize on the same worker/date lock used by the existing extra-day decision.
alter function private.viewer_biometric_ot_core(date,jsonb,uuid,uuid,text) rename to viewer_biometric_ot_before_extra_day;
create function private.viewer_biometric_ot_core(p_date date,p_entries jsonb,p_source_actor uuid,p_viewer_actor uuid,p_viewer_username text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb;
begin
 if p_date is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch';end if;
 lock table public.payroll_run in share mode;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
   perform pg_advisory_xact_lock(hashtextextended((entry->>'worker_id')||':'||p_date::text||':extra_day',0));
   if entry->>'decision'='approved' and private.extra_day_owns_hourly_date((entry->>'worker_id')::uuid,p_date) then
     raise exception 'Approved Double Overtime replaces hourly overtime for this worker/date';
   end if;
 end loop;
 -- Original authorization/actor, eligibility, evidence/version, payroll lock,
 -- audit and atomicity protections are unchanged.
 return private.viewer_biometric_ot_before_extra_day(p_date,p_entries,p_source_actor,p_viewer_actor,p_viewer_username);
end $$;
revoke all on function private.extra_day_owns_hourly_date(uuid,date),private.viewer_payroll_reviews_before_extra_day(date,date),
 private.viewer_payroll_reviews_core(date,date),private.viewer_biometric_ot_before_extra_day(date,jsonb,uuid,uuid,text),
 private.viewer_biometric_ot_core(date,jsonb,uuid,uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';
