-- Rollback-only test of production evidence and end-only approvals.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare context jsonb;example record;finish timestamptz;rows jsonb;r jsonb;entry jsonb;premium jsonb;
 team uuid;config jsonb;ordinary uuid;before_att text;before_pay text;before_events text;cnt integer;
begin
 context:=private.extra_day_end_threshold('2026-11-13','00:00',30);
 assert (context->>'special_end')::timestamptz='2026-11-14 00:00 Africa/Kinshasa'::timestamptz,'Wrong midnight';
 assert (context->>'qualifying_threshold')::timestamptz='2026-11-13 23:30 Africa/Kinshasa'::timestamptz,'Wrong tolerance';
 for example in select * from (values ('17:03'::time,false),('22:30',false),('23:29',false),('23:30',true),('23:45',true),('23:59',true),('00:00',true),('00:10',true)) x(clock,expected) loop
   finish:=('2026-11-13'::date+example.clock+case when example.clock<time '06:30' then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa';
   assert (finish>=(context->>'qualifying_threshold')::timestamptz)=example.expected,'End-only boundary failed';
 end loop;
 assert (private.extra_day_end_threshold('2026-11-13','23:00',15)->>'qualifying_threshold')::timestamptz='2026-11-13 22:45 Africa/Kinshasa'::timestamptz,'End not configurable';
 select id into strict team from public.teams where name='Peinture Raghibe';
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into before_att from public.attendance a where attendance_date='2026-11-13';
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into before_pay from public.payroll_line l;
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) into before_events from public.biometric_attendance_events e where event_timestamp>='2026-11-13' and event_timestamp<'2026-11-15';
 -- No start argument, no pre-created rule, default end/tolerance.
 rows:=public.admin_get_extra_day_end_reviews('2026-11-13',team);
 cnt:=jsonb_array_length(rows);assert cnt>0,'Real late candidates missing';
 assert not exists(select 1 from jsonb_array_elements(rows) x where x->'source'->>'qualified'<>'true'
   or (x->'source'->>'end')::timestamptz<'2026-11-13 23:30 Africa/Kinshasa'::timestamptz),'Early worker included';
 assert jsonb_array_length(public.admin_get_extra_day_end_reviews('2026-11-13',team))=cnt,'Duplicate rows';
 select value into strict r from jsonb_array_elements(rows) where value->'source'->>'configuration_error' is null
   and not exists(select 1 from public.worker_weekly_overtime_override o where o.worker_id=(value->>'worker_id')::uuid and o.minutes>0 and '2026-11-13'::date between o.week_start and o.week_start+5) limit 1;
 config:=r->'review'->'rule_snapshot';
 assert config->'session_settings'->>'mode'='end_only' and not (config->'session_settings' ? 'start'),'Start dependency remains';
 select w.id into ordinary from public.workers w join public.attendance a on a.worker_id=w.id and a.attendance_date='2026-11-13'
   where w.team_id=team and a.check_out between time '17:00' and time '17:10' limit 1;
 assert ordinary is not null,'Missing ordinary fixture';
 assert private.extra_day_source(config,ordinary,'2026-11-13')->>'qualified'='false','Normal duration qualified';
 assert private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13')='[]'::jsonb,'Pending paid';
 entry:=jsonb_build_object('rule_id',r->>'rule_id','worker_id',r->>'worker_id','work_date','2026-11-13','expected_version',r->'review'->'version','source_fingerprint',r->'source'->>'fingerprint','decision','approved');
 perform public.admin_decide_extra_day(jsonb_build_array(entry));
 premium:=private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13');
 assert jsonb_array_length(premium)=1 and premium->0->>'extra_days'='1' and (premium->0->>'amount')::numeric=(r->'source'->>'daily_wage')::numeric,'Wrong daily premium';
 assert exists(select 1 from public.extra_day_overtime_review where rule_id=(r->>'rule_id')::uuid and worker_id=(r->>'worker_id')::uuid
   and actor=auth.uid() and history->-1->'rule'->'session_settings'=config->'session_settings'),'Audit lost';
 assert exists(select 1 from jsonb_array_elements(public.admin_get_extra_day_end_reviews('2026-11-13',team)) x
   where x->>'worker_id'=r->>'worker_id' and x->>'status'='approved'),'Reload lost approval';
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.attendance a where attendance_date='2026-11-13'),'Attendance changed';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) from public.payroll_line l),'Payroll history changed';
 assert before_events=(select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) from public.biometric_attendance_events e where event_timestamp>='2026-11-13' and event_timestamp<'2026-11-15'),'Biometric events changed';
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.admin_get_extra_day_end_reviews('2026-11-13',team);raise exception 'Non-admin allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: end-only defaults, real late-night workers, threshold boundaries, no normal-duration qualification, approval/audit/premium and unchanged evidence/attendance/payroll' verification;
