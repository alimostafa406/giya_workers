-- Run after 11:00 Kinshasa. No attendance/event writes; all snapshot fixtures roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date:=(now() at time zone 'Africa/Kinshasa')::date; first_result jsonb; repeated_result jsonb; viewer jsonb;
  ibrahim uuid; attendance_before text; snapshots_before text;
begin
  select md5(string_agg(to_jsonb(a)::text,',' order by a.id)) into attendance_before from public.attendance a;
  select md5(string_agg(to_jsonb(s)::text,',' order by s.attendance_date)) into snapshots_before from private.supervisor_review_daily_snapshot s where attendance_date<d;
  first_result:=public.admin_get_final_supervisor_review(d,true);
  repeated_result:=public.admin_get_final_supervisor_review(d,true);
  assert first_result->'workers'=repeated_result->'workers','Final population changed on repeated refresh';
  assert first_result->'finalized_at'=repeated_result->'finalized_at','Final snapshot overwritten';
  viewer:=public.foreign_monitoring_live_missing_morning_payload(d);
  assert viewer->>'source'='final_supervisor_review_snapshot','Viewer used live roster after cutoff';
  assert (select coalesce(array_agg(x->>'id' order by x->>'id'),'{}') from jsonb_array_elements(first_result->'workers') x)
    = (select coalesce(array_agg(w->>'id' order by w->>'id'),'{}') from jsonb_array_elements(viewer->'groups') g cross join lateral jsonb_array_elements(g->'workers') w),'Viewer/main worker sets differ';
  select id into ibrahim from public.workers where employee_code='153';
  if d='2026-10-19' then
    assert private.has_morning_evidence_at_cutoff(ibrahim,d),'10:58:25 evidence missed';
    assert not exists(select 1 from jsonb_array_elements(first_result->'workers') w where w->>'id'=ibrahim::text),'IBRAHIM2 incorrectly included';
  end if;
  assert attendance_before=(select md5(string_agg(to_jsonb(a)::text,',' order by a.id)) from public.attendance a),'Attendance changed';
  assert snapshots_before is not distinct from (select md5(string_agg(to_jsonb(s)::text,',' order by s.attendance_date)) from private.supervisor_review_daily_snapshot s where attendance_date<d),'Historical snapshots changed';
end $$;
rollback;
