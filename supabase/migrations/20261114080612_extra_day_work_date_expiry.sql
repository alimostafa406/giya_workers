create or replace function public.admin_get_extra_day_reviews(p_start date,p_end date) returns jsonb language plpgsql security definer set search_path='' as $$
declare rule public.extra_day_overtime_rule; target record; day date; src jsonb; today date:=(now() at time zone 'Africa/Kinshasa')::date;
begin
 perform private.extra_day_require_admin();
 if p_start is null or p_end is null or p_end<p_start or p_end>p_start+31 then raise exception 'Invalid review range'; end if;
 -- Expiry limits work dates, including the final overnight session. Late
 -- ingestion may materialize historical evidence within the valid range;
 -- no work date after end_date can ever generate a candidate.
 -- Persisted candidates/decisions
 -- use their original configuration after disable/expiry; no deletion/rebuild.
 for rule in select * from public.extra_day_overtime_rule where enabled and start_date<=least(p_end,today) and end_date>=p_start loop
   for target in select w.id from public.workers w where w.team_id=any(rule.team_ids) or w.id=any(rule.worker_ids) loop
     for day in select generate_series(greatest(p_start,rule.start_date)::timestamp,least(p_end,rule.end_date,today)::timestamp,interval '1 day')::date loop
       if private.extra_day_locked(target.id,day) then continue; end if;
       src:=private.extra_day_source(to_jsonb(rule)-'history',target.id,day);
       if (src->>'qualified')::boolean then
         insert into public.extra_day_overtime_review(rule_id,worker_id,work_date,rule_snapshot,source_snapshot,source_fingerprint,currency_code)
         values(rule.id,target.id,day,to_jsonb(rule)-'history',src,src->>'fingerprint',src->>'currency') on conflict do nothing;
       end if;
     end loop;
   end loop;
 end loop;
 return coalesce((select jsonb_agg(jsonb_build_object('rule_id',r.rule_id,'worker_id',r.worker_id,'work_date',r.work_date,'review',to_jsonb(r),
   'source',case when private.extra_day_locked(r.worker_id,r.work_date) then r.source_snapshot else s.value end,
   'payroll_source',(select value from jsonb_array_elements(private.extra_day_payroll_sources(r.worker_id,r.work_date,r.work_date)) where value->>'rule_id'=r.rule_id::text limit 1),
   'status',case when not private.extra_day_locked(r.worker_id,r.work_date) and s.value->>'fingerprint'<>r.source_fingerprint then 'stale' else r.decision end,
   'locked',private.extra_day_locked(r.worker_id,r.work_date)) order by r.work_date,r.source_snapshot->'worker'->>'full_name')
 from public.extra_day_overtime_review r cross join lateral(select private.extra_day_source(r.rule_snapshot,r.worker_id,r.work_date) value) s
 where r.work_date between p_start and p_end),'[]');
end $$;
