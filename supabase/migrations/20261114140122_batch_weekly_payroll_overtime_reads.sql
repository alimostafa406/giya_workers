-- Batch week-scoped evidence reads. Do not change eligibility, fingerprints,
-- decision precedence, approved amounts, or immutable payroll snapshots.
create or replace function private.viewer_payroll_reviews_before_extra_day(p_start date,p_end date)
returns jsonb language sql security definer set search_path='' as $$
 with rows as materialized (
   select value item,ordinality ord
   from jsonb_array_elements(private.viewer_payroll_reviews_without_checkout(p_start,p_end)) with ordinality
 )
 select coalesce(jsonb_agg(jsonb_set(item,'{attendance,canonical_final_checkout_at}',
   coalesce(to_jsonb(private.canonical_overtime_checkout(
     jsonb_populate_record(null::public.attendance,item->'attendance'),
     jsonb_populate_record(null::public.workers,item->'worker'))),'null'::jsonb)) order by ord),'[]'::jsonb)
 from rows;
$$;

create function private.payroll_extra_day_reviews(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_start is null or p_end is null or p_end<p_start or p_end>p_start+31 then
   raise exception 'Invalid review range'; end if;
 return (
 with bounded as materialized (
   select r.*,private.extra_day_locked(r.worker_id,r.work_date) locked
   from public.extra_day_overtime_review r where r.work_date between p_start and p_end
 ), sources as materialized (
   select b.*,private.extra_day_source(b.rule_snapshot,b.worker_id,b.work_date) current_source from bounded b
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'rule_id',s.rule_id,'worker_id',s.worker_id,'work_date',s.work_date,
   'review',to_jsonb(s)-'locked'-'current_source',
   'source',case when s.locked then s.source_snapshot else s.current_source end,
   'payroll_source',case when s.decision='approved' and s.source_fingerprint=s.current_source->>'fingerprint'
     then jsonb_build_object('rule_id',s.rule_id,'worker_id',s.worker_id,'date',s.work_date,'version',s.version,
       'amount',s.approved_amount,'currency',s.currency_code,'source_fingerprint',s.source_fingerprint,'extra_days',1) end,
   'status',case when not s.locked and s.current_source->>'fingerprint'<>s.source_fingerprint then 'stale' else s.decision end,
   'locked',s.locked
 ) order by s.work_date,s.source_snapshot->'worker'->>'full_name'),'[]'::jsonb) from sources s);
end $$;
revoke all on function private.payroll_extra_day_reviews(date,date) from public,anon,authenticated;

create function private.payroll_biometric_reviews_with_extra_days(p_start date,p_end date,p_extra_days jsonb)
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
 ), rows as materialized (
   select value item,ordinality ord
   from jsonb_array_elements(private.viewer_payroll_reviews_before_extra_day(p_start,p_end)) with ordinality
 )
 select coalesce(jsonb_agg(item||jsonb_build_object('extra_day_payable',o.worker_id is not null) order by ord),'[]'::jsonb)
 from rows left join owned o on o.worker_id=(item->'worker'->>'id')::uuid
   and o.work_date=(item->'attendance'->>'attendance_date')::date;
$$;
revoke all on function private.payroll_biometric_reviews_with_extra_days(date,date,jsonb) from public,anon,authenticated;

create or replace function private.viewer_payroll_reviews_core(p_start date,p_end date)
returns jsonb language sql security definer set search_path='' as $$
 select private.payroll_biometric_reviews_with_extra_days(p_start,p_end,
   private.payroll_extra_day_reviews(p_start,p_end));
$$;

create function public.admin_get_payroll_overtime_context(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare extra_days jsonb;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then
   raise exception 'Active admin required' using errcode='42501'; end if;
 extra_days:=private.payroll_extra_day_reviews(p_start,p_end);
 return jsonb_build_object('extraDayReviews',extra_days,'biometricOvertimeReviews',
   private.payroll_biometric_reviews_with_extra_days(p_start,p_end,extra_days));
end $$;
revoke all on function public.admin_get_payroll_overtime_context(date,date) from public,anon,authenticated;
grant execute on function public.admin_get_payroll_overtime_context(date,date) to authenticated;
notify pgrst,'reload schema';
