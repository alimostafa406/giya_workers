alter table public.worker_biometric_lateness_review
 add column automatic_deduction numeric(14,2),
 add column adjusted_deduction numeric(14,2) check(adjusted_deduction>=0),
 add column adjustment_source text check(adjustment_source in ('single','bulk'));
alter table public.worker_biometric_lateness_review drop constraint worker_biometric_lateness_review_decision_check;
alter table public.worker_biometric_lateness_review add constraint worker_biometric_lateness_review_decision_check check(decision in ('pending','approved','rejected'));

create or replace function public.admin_decide_biometric_lateness(p_date date,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; context jsonb; prepared jsonb:='[]'; amount numeric; automatic numeric; adjusted numeric;
 minutes integer; target_worker_id uuid; previous public.worker_biometric_lateness_review;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch'; end if;
 lock table public.payroll_run in share mode;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
   if coalesce(entry->>'decision','') not in ('pending','approved','rejected')
     or coalesce(entry->>'approved_minutes','')!~'^[0-9]{1,4}$'
     or coalesce(entry->>'adjustment_source','single') not in ('single','bulk') then raise exception 'Invalid review values'; end if;
   minutes:=(entry->>'approved_minutes')::integer;
   if minutes>1440 then raise exception 'Invalid approved minutes'; end if;
   target_worker_id:=(entry->>'worker_id')::uuid;
   perform pg_advisory_xact_lock(hashtextextended(target_worker_id::text||':'||p_date::text||':lateness',0));
   perform 1 from public.workers where workers.id=target_worker_id for share;
   perform 1 from public.worker_payroll_profile where worker_id=target_worker_id for share;
   perform 1 from public.worker_payroll_compensation where worker_id=target_worker_id for share;
   perform 1 from public.payroll_rule_set where is_active for share;
   perform 1 from public.attendance where worker_id=target_worker_id and attendance_date=p_date for update;
   select * into previous from public.worker_biometric_lateness_review where worker_id=target_worker_id and attendance_date=p_date for update;
   if entry ? 'adjusted_deduction' then
     if entry->>'adjusted_deduction' is not null and entry->>'adjusted_deduction'!~'^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'Invalid adjusted deduction'; end if;
     adjusted:=(entry->>'adjusted_deduction')::numeric;
   else adjusted:=previous.adjusted_deduction; end if;
   context:=private.lateness_calculation_context(target_worker_id,p_date);
   if entry->>'decision'='approved' and context->>'unavailable_reason' is not null then raise exception '%',context->>'unavailable_reason'; end if;
   if entry->>'calculation_fingerprint' is distinct from context->>'fingerprint' then raise exception 'Wage or schedule changed; reload and review again'; end if;
   automatic:=case when context->>'unavailable_reason' is null then round((context->>'daily_wage')::numeric/(context->>'scheduled_paid_minutes')::numeric*minutes,2) end;
   amount:=case when entry->>'decision'='approved' then coalesce(adjusted,automatic) else 0 end;
   prepared:=prepared||jsonb_build_array(entry||jsonb_build_object('deduction_amount',amount,'calculation_snapshot',context,
     'automatic_deduction',automatic,'adjusted_deduction',adjusted,'requested_decision',entry->>'decision',
     'decision',case when entry->>'decision'='pending' then 'rejected' else entry->>'decision' end));
 end loop;
 -- Reuse the existing atomic authorization, worker eligibility, evidence/version
 -- and payroll-lock validation. Pending edits are non-payable throughout.
 perform private.lateness_decision_core(p_date,prepared);
 for entry in select value from jsonb_array_elements(prepared) loop
   update public.worker_biometric_lateness_review r set decision=entry->>'requested_decision',
     calculation_snapshot=entry->'calculation_snapshot',automatic_deduction=(entry->>'automatic_deduction')::numeric,
     adjusted_deduction=(entry->>'adjusted_deduction')::numeric,adjustment_source=coalesce(entry->>'adjustment_source','single'),
     history=jsonb_set(r.history,array[(jsonb_array_length(r.history)-1)::text],(r.history->-1)||jsonb_build_object(
       'mode','automatic_with_optional_override','decision',entry->>'requested_decision','calculation',entry->'calculation_snapshot',
       'automatic_deduction',entry->'automatic_deduction','adjusted_deduction',entry->'adjusted_deduction',
       'adjustment_source',coalesce(entry->>'adjustment_source','single'),'worker_id',r.worker_id,'attendance_date',p_date))
     where worker_id=(entry->>'worker_id')::uuid and attendance_date=p_date;
 end loop;
 return (select jsonb_agg(to_jsonb(r) order by r.worker_id) from public.worker_biometric_lateness_review r
   where r.attendance_date=p_date and r.worker_id in (select (value->>'worker_id')::uuid from jsonb_array_elements(prepared)));
end $$;
revoke all on function public.admin_decide_biometric_lateness(date,jsonb) from public,anon;
grant execute on function public.admin_decide_biometric_lateness(date,jsonb) to authenticated;
notify pgrst,'reload schema';
