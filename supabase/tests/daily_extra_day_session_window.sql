-- All changes are rolled back; test decisions never enter production payroll.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare session jsonb;example record;finish timestamptz;rows jsonb;r jsonb;entry jsonb;premium jsonb;saved jsonb;
 team uuid;candidate_count integer;session_config jsonb;normal_worker uuid;src jsonb;before_att text;before_pay text;before_events text;
begin
 session:=private.extra_day_session('2026-11-13','17:00','00:00',30);
 assert (session->>'special_start')::timestamptz='2026-11-13 17:00 Africa/Kinshasa'::timestamptz,'Start shifted';
 assert (session->>'special_end')::timestamptz='2026-11-14 00:00 Africa/Kinshasa'::timestamptz,'Previous midnight used';
 assert (session->>'qualifying_threshold')::timestamptz='2026-11-13 23:30 Africa/Kinshasa'::timestamptz,'Tolerance wrong';
 for example in select * from (values ('17:03'::time,false),('22:30',false),('23:29',false),('23:30',true),('23:45',true),('23:59',true),('00:00',true),('00:10',true)) x(clock,expected) loop
   finish:=('2026-11-13'::date+example.clock+case when example.clock<'17:00'::time then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa';
   assert (finish>=(session->>'qualifying_threshold')::timestamptz)=example.expected,'Boundary failure';
 end loop;
 assert floor(extract(epoch from ('2026-11-13 23:48 Africa/Kinshasa'::timestamptz-(session->>'special_start')::timestamptz))/60)=408,'Session duration must be 6h48';
 session:=private.extra_day_session('2026-11-13','18:10','01:20',15);
 assert (session->>'qualifying_threshold')::timestamptz='2026-11-14 01:05 Africa/Kinshasa'::timestamptz,'Hardcoded window';
 begin perform private.extra_day_session('2026-11-13','17:00','00:00',-1);raise exception 'Negative tolerance accepted';
 exception when raise_exception then if sqlerrm<>'Valid session start, end and tolerance required' then raise;end if;end;
 select id into strict team from public.teams where name='Peinture Raghibe';
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into before_att from public.attendance a where attendance_date='2026-11-13';
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into before_pay from public.payroll_line l;
 select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) into before_events from public.biometric_attendance_events e where event_timestamp>='2026-11-13' and event_timestamp<'2026-11-15';
 rows:=public.admin_get_extra_day_session_reviews('2026-11-13',team,'17:00','00:00',30);
 candidate_count:=jsonb_array_length(rows);assert candidate_count>0,'No real window candidates';
 assert not exists(select 1 from jsonb_array_elements(rows) x where x->'source'->>'qualified'<>'true'
   or (x->'source'->>'end')::timestamptz<'2026-11-13 23:30 Africa/Kinshasa'::timestamptz
   or (x->'source'->>'end')::timestamptz>'2026-11-14 02:00 Africa/Kinshasa'::timestamptz),'Wrong operational date/threshold';
 assert jsonb_array_length(public.admin_get_extra_day_session_reviews('2026-11-13',team,'17:00','00:00',30))=candidate_count,'Duplicate candidates';
 select value into strict r from jsonb_array_elements(rows) where value->'source'->>'configuration_error' is null
   and not exists(select 1 from public.worker_weekly_overtime_override o where o.worker_id=(value->>'worker_id')::uuid and o.minutes>0 and '2026-11-13'::date between o.week_start and o.week_start+5) limit 1;
 session_config:=r->'review'->'rule_snapshot';
 -- Real ordinary day worker's safe evidence ends before the chosen threshold.
 select w.id into normal_worker from public.workers w join public.attendance a on a.worker_id=w.id and a.attendance_date='2026-11-13'
 where w.team_id=team and a.check_out between time '17:00' and time '17:10' limit 1;
 assert normal_worker is not null,'Need real normal checkout fixture';
 src:=private.extra_day_source(session_config,normal_worker,'2026-11-13');
 assert src->>'qualified'='false','Normal-day duration incorrectly qualified';
 assert private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13')='[]'::jsonb,'Pending paid';
 entry:=jsonb_build_object('rule_id',r->>'rule_id','worker_id',r->>'worker_id','work_date','2026-11-13','expected_version',r->'review'->'version','source_fingerprint',r->'source'->>'fingerprint','decision','approved');
 perform public.admin_decide_extra_day(jsonb_build_array(entry));
 premium:=private.extra_day_payroll_sources((r->>'worker_id')::uuid,'2026-11-13','2026-11-13');
 assert jsonb_array_length(premium)=1 and premium->0->>'extra_days'='1' and (premium->0->>'amount')::numeric=(r->'source'->>'daily_wage')::numeric,'Not exactly +1 daily wage';
 rows:=public.admin_get_extra_day_session_reviews('2026-11-13',team,'17:00','00:00',30);
 select value into strict saved from jsonb_array_elements(rows) where value->>'worker_id'=r->>'worker_id';
 assert saved->>'status'='approved' and saved->'review'->>'actor'=auth.uid()::text,'Decision did not persist';
 assert saved->'review'->'rule_snapshot'->'session_settings'=session_config->'session_settings','Settings audit lost';
 assert saved->'review'->'history'->-1->'rule'->'session_settings'=session_config->'session_settings','History lacks settings';
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.attendance a where attendance_date='2026-11-13'),'Attendance changed';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) from public.payroll_line l),'Payroll history changed';
 assert before_events=(select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id)::text,'')) from public.biometric_attendance_events e where event_timestamp>='2026-11-13' and event_timestamp<'2026-11-15'),'Biometric evidence changed';
end $$;
rollback;
select 'PASS: midnight and tolerance boundaries, real candidates, ordinary checkout excluded, explicit approval/full wage, settings audit, no evidence/attendance/payroll changes' verification;
