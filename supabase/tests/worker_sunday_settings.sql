-- Requires a real source-admin JWT subject. Every settings/evidence fixture
-- below is rolled back; no attendance/biometric/payroll history is rewritten.
begin;
create temporary table sunday_settings_test_events as select * from public.biometric_attendance_events with no data;
create temporary table sunday_settings_test_attendance as select * from public.attendance with no data;
do $$
declare wid uuid;cfg jsonb;saved jsonb;settings jsonb;first_day date;second_day date;definition text;sample public.biometric_attendance_events;answer jsonb;failed boolean:=false;
begin
 select id into strict wid from public.workers where employee_code='179';
 cfg:=private.worker_sunday_settings_for_date(wid,'2026-11-22');
 assert cfg->>'checkin_cutoff'='08:20:00' and (cfg->>'pay_multiplier')::numeric=2,'Historical defaults changed';
 settings:=jsonb_build_object('enabled',true,'checkin_cutoff','09:00','shift_end','14:30','checkout_threshold','13:45','pay_multiplier',3,'overtime_start','15:00','overtime_requires_approval',false,'note','rollback fixture');
 cfg:=public.admin_get_worker_sunday_settings(wid);
 saved:=public.admin_save_worker_sunday_settings(wid,settings,(cfg->>'version')::integer);
 first_day:=(saved->>'effective_from')::date;second_day:=first_day+7;
 assert first_day>(now() at time zone 'Africa/Kinshasa')::date,'Settings must be prospective';
 assert private.worker_sunday_settings_for_date(wid,first_day)->>'checkin_cutoff'='09:00:00','First Sunday did not reuse settings';
 assert private.worker_sunday_settings_for_date(wid,second_day)->>'checkin_cutoff'='09:00:00','Second Sunday did not reuse settings';
 assert (private.worker_sunday_settings_for_date(wid,second_day)->>'pay_multiplier')::numeric=3,'Custom multiplier missing';
 assert private.worker_sunday_settings_for_date(wid,'2026-11-22')->>'checkin_cutoff'='08:20:00','History changed';
 select * into strict sample from public.biometric_attendance_events where worker_id=wid and attendance_date='2026-11-22' limit 1;
 sample.attendance_date:=first_day;sample.event_timestamp:=(first_day+time '08:45') at time zone 'Africa/Kinshasa';
 insert into pg_temp.sunday_settings_test_events select sample.*;
 sample.event_timestamp:=(first_day+time '17:00') at time zone 'Africa/Kinshasa';insert into pg_temp.sunday_settings_test_events select sample.*;
 definition:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 definition:=replace(replace(replace(definition,'private.sunday_work_evidence','pg_temp.settings_evidence_test'),'public.attendance','pg_temp.sunday_settings_test_attendance'),'public.biometric_attendance_events','pg_temp.sunday_settings_test_events');execute definition;
 answer:=pg_temp.settings_evidence_test(wid,first_day);assert (answer->>'eligible')::boolean,'Custom check-in/checkout rejected';
 definition:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 definition:=replace(replace(replace(definition,'private.sunday_hourly_sources','pg_temp.settings_ot_test'),'public.attendance','pg_temp.sunday_settings_test_attendance'),'public.biometric_attendance_events','pg_temp.sunday_settings_test_events');execute definition;
 answer:=pg_temp.settings_ot_test(first_day)->0;assert (answer->>'raw_minutes')::integer=120,'OT must start at custom 15:00';
 assert (answer->'sunday_settings'->>'overtime_requires_approval')::boolean=false,'Approval preference not persisted';
 settings:=settings||jsonb_build_object('enabled',false);
 saved:=public.admin_save_worker_sunday_settings(wid,settings,(saved->>'version')::integer);
 answer:=pg_temp.settings_evidence_test(wid,first_day);assert not (answer->>'eligible')::boolean,'Disabled Sunday must not accrue automatic base';
 assert (select jsonb_array_length(history)>0 from public.worker_sunday_settings where worker_id=wid),'Audit history missing';
 begin perform public.admin_save_worker_sunday_settings(wid,settings,0);exception when others then failed:=true;end;
 assert failed,'Stale settings version must fail';
 assert (select updated_by=auth.uid() from public.worker_sunday_settings where worker_id=wid),'Actual admin identity missing';
end $$;
rollback;
