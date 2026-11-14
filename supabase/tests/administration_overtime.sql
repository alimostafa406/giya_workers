-- Real IFASO paths; every test decision is rolled back.
begin;
select set_config('request.jwt.claim.sub','fbf1dedc-2c5f-49f9-981f-65250179520c',true);
do $$
declare wid uuid:='056e2cb7-1930-44aa-927b-691764bccd21'; d date:='2026-11-13'; wk date:='2026-11-09';
 a public.attendance%rowtype; r jsonb; source jsonb; v integer; req uuid:=gen_random_uuid(); rejected boolean;
 att_before text; ot_before text; review_before text; payroll_before text;
begin
 assert exists(select 1 from public.workers w join public.worker_payroll_profile p on p.worker_id=w.id
  where w.id=wid and w.employee_code='19' and p.payment_type='monthly' and w.team_id='907b67ff-a6f7-4633-9fa1-8856d86a4a3b'),'Real worker fixture missing';
 select * into a from public.attendance where worker_id=wid and attendance_date=d;
 assert a.check_out=time '20:08:07' and a.attendance_source='biometric','Real checkout fixture changed';
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into att_before from public.attendance x where worker_id=wid;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by week_start)::text,'')) into ot_before from public.worker_weekly_overtime_override x where worker_id=wid;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by attendance_date)::text,'')) into review_before from public.worker_biometric_overtime_review x where worker_id=wid;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into payroll_before from public.payroll_line x;
 begin
  select coalesce((select version from public.worker_weekly_overtime_override where worker_id=wid and week_start=wk),0) into v;
  r:=public.admin_set_weekly_overtime(wk,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',188,'expected_version',v)));
  assert (select minutes=188 and version=v+1 from public.worker_weekly_overtime_override where worker_id=wid and week_start=wk),'Weekly read-back failed';
  rejected:=false;
  begin perform public.admin_set_weekly_overtime(wk,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',60,'expected_version',v)));
   exception when others then rejected:=sqlerrm='Weekly overtime changed; reload'; end;
  assert rejected,'Stale version guard lost';
  assert (select count(*)=1 from public.worker_weekly_overtime_override where worker_id=wid and week_start=wk),'Duplicate weekly row';
  raise exception sqlstate 'ZX001' using message='ROLLBACK_WEEKLY_TEST';
 exception when sqlstate 'ZX001' then null; end;
 begin
  r:=public.admin_apply_bulk_emergency_overtime(req,d,'manual_overtime_duration','Rollback-only Administration verification',null,
   jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',188,'expected_updated_at',a.updated_at)));
  assert (r->>'updated')::integer=1,'Daily save failed';
  assert (select emergency_overtime_minutes=188 and check_in is not distinct from a.check_in and check_out is not distinct from a.check_out and status=a.status and attendance_source=a.attendance_source from public.attendance where id=a.id),'Daily modified biometric evidence';
  r:=public.admin_apply_bulk_emergency_overtime(req,d,'manual_overtime_duration','Rollback-only Administration verification',null,
   jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',188,'expected_updated_at',a.updated_at)));
  assert r->'results'->0->>'reason'='already_applied','Idempotency lost';
  raise exception sqlstate 'ZX001' using message='ROLLBACK_DAILY_TEST';
 exception when sqlstate 'ZX001' then null; end;
 begin
  select x into source from jsonb_array_elements(public.admin_get_biometric_overtime_review(d,d)) x where x->'worker'->>'id'=wid::text;
  assert source is not null,'Biometric review candidate missing';
  v:=coalesce((source->'review'->>'version')::integer,0);
  r:=public.admin_decide_biometric_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',188,'original_biometric_minutes',188,
   'decision','approved','source_fingerprint',source->>'source_fingerprint','expected_version',v,'note','Rollback-only Administration verification')));
  assert (select minutes=188 and decision='approved' and actor='fbf1dedc-2c5f-49f9-981f-65250179520c' from public.worker_biometric_overtime_review where worker_id=wid and attendance_date=d),'Biometric approval read-back failed';
  assert (select count(*)=1 from public.worker_biometric_overtime_review where worker_id=wid and attendance_date=d),'Duplicate biometric review';
  rejected:=false;
  begin perform public.admin_decide_biometric_overtime(d,jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',188,'decision','approved','source_fingerprint','stale','expected_version',v+1)));
   exception when others then rejected:=sqlerrm='Biometric evidence changed; reload and review again'; end;
  assert rejected,'Biometric stale evidence guard lost';
  assert (select to_jsonb(x)=to_jsonb(a) from public.attendance x where id=a.id),'Approval mutated attendance';
  raise exception sqlstate 'ZX001' using message='ROLLBACK_BIOMETRIC_TEST';
 exception when sqlstate 'ZX001' then null; end;
 assert att_before=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.attendance x where worker_id=wid),'Attendance changed';
 assert ot_before=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by week_start)::text,'')) from public.worker_weekly_overtime_override x where worker_id=wid),'Overrides changed';
 assert review_before=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by attendance_date)::text,'')) from public.worker_biometric_overtime_review x where worker_id=wid),'Reviews changed';
 assert payroll_before=(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) from public.payroll_line x),'Payroll changed';
 assert not has_function_privilege('anon','public.admin_set_weekly_overtime(date,jsonb)','execute'),'Anonymous weekly write exposed';
 assert not has_function_privilege('anon','private.viewer_weekly_ot_core(date,jsonb,uuid,uuid,text)','execute'),'Private core exposed';
end $$;
rollback;
select 'PASS: IFASO #19 2026-11-13 weekly save/read-back, daily save/read-back/idempotency, biometric approval/read-back, stale/version protections, no duplicate rows, all test writes rolled back, attendance/payroll unchanged' as verification;
