-- Rollback-only integration test against real evidence. No approvals persist.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare t record; rows jsonb; r jsonb; entry jsonb; premium jsonb; previous_count int; exercised int:=0; saved jsonb;
 before_att text; before_events text; before_pay text;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into before_att from public.attendance a where attendance_date='2026-11-13';
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) into before_events from public.biometric_attendance_events e where event_timestamp>='2026-11-12' and event_timestamp<'2026-11-15';
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into before_pay from public.payroll_line l;
 for t in select id,name from public.teams order by case when name='Peinture Raghibe' then 0 else 1 end,name loop
   rows:=public.admin_get_daily_extra_day_reviews('2026-11-13',t.id);
   if jsonb_array_length(rows)=0 then continue; end if;
   assert jsonb_array_length(rows)=(select count(distinct value->>'worker_id') from jsonb_array_elements(rows)),'Duplicate workers';
   previous_count:=jsonb_array_length(rows);
   assert jsonb_array_length(public.admin_get_daily_extra_day_reviews('2026-11-13',t.id))=previous_count,'Repeated read duplicated review';
   select value into r from jsonb_array_elements(rows) where not (value->>'locked')::boolean
     and value->'source'->>'configuration_error' is null
     and not exists(select 1 from public.worker_weekly_overtime_override o where o.worker_id=(value->>'worker_id')::uuid and o.minutes>0 and '2026-11-13'::date between o.week_start and o.week_start+5)
   limit 1;
   if r is null then continue; end if;
   assert private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13')='[]'::jsonb,'Pending payable';
   entry:=jsonb_build_object('rule_id',r->>'rule_id','worker_id',r->>'worker_id','work_date','2026-11-13','expected_version',r->'review'->'version','source_fingerprint',r->'source'->>'fingerprint','decision','approved');
   perform public.admin_decide_extra_day(jsonb_build_array(entry));
   premium:=private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13');
   assert jsonb_array_length(premium)=1 and premium->0->>'extra_days'='1' and (premium->0->>'amount')::numeric=(r->'source'->>'daily_wage')::numeric,'Not one daily wage';
   rows:=public.admin_get_daily_extra_day_reviews('2026-11-13',t.id);
   select value into saved from jsonb_array_elements(rows) where value->>'worker_id'=r->>'worker_id';
   assert saved->>'status'='approved' and saved->'review'->>'actor'=auth.uid()::text,'Approval/audit not preserved';
   assert not exists(select 1 from jsonb_array_elements(rows) x where x->>'worker_id'<>r->>'worker_id' and x->>'status'='approved'),'Unselected worker approved';
   begin
     perform public.admin_decide_extra_day(jsonb_build_array(entry||jsonb_build_object('expected_version',1,'source_fingerprint','changed')));
     raise exception 'Stale accepted';
   exception when raise_exception then if sqlerrm<>'Evidence/wage changed; reload' then raise; end if; end;
   perform public.admin_decide_extra_day(jsonb_build_array(entry||'{"expected_version":1,"decision":"rejected"}'));
   assert private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13')='[]'::jsonb,'Rejected payable';
   exercised:=exercised+1;
   if exercised=2 then exit; end if;
 end loop;
 assert exercised=2,'Need two generic teams';
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.attendance a where attendance_date='2026-11-13'),'Attendance mutated';
 assert before_events=(select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) from public.biometric_attendance_events e where event_timestamp>='2026-11-12' and event_timestamp<'2026-11-15'),'Events mutated';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) from public.payroll_line l),'Payroll history mutated';
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.admin_get_daily_extra_day_reviews('2026-11-13',t.id);raise exception 'Non-admin allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: two teams incl Peinture Raghibe, daily evidence, selected approval, one daily wage, persistence, no duplicates, stale/auth protections, no attendance/events/payroll mutation' verification;
