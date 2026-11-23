-- Real configured compensation plus isolated future-Sunday evidence/ledger
-- fixtures. No production biometric, attendance or payroll data is written.
begin;
create temporary table sunday_money_events as select * from public.biometric_attendance_events with no data;
create temporary table sunday_money_attendance as select * from public.attendance with no data;
create temporary table sunday_money_ledger(like public.worker_sunday_payment including all);
do $$
declare wid uuid;weekly uuid;pay jsonb;definition text;sample public.biometric_attendance_events;workday date:=date '2026-11-29';
begin
 select id into strict wid from public.workers where employee_code='300';
 pay:=private.sunday_pay_components(wid,workday);
 assert (pay->>'base_amount')::numeric=20000 and (pay->>'transport_amount')::numeric=3000,'Fixed Sunday/transport missing';
 assert (pay->>'normal_hourly_rate')::numeric=2500 and (pay->>'overtime_rate')::numeric=10000,'Sunday OT must be normal rate times four';
 assert (pay->>'base_amount')::numeric+(pay->>'transport_amount')::numeric=23000,'Base net before OT incorrect';
 assert pay=private.sunday_pay_components(wid,workday+7),'Recurring Sunday pay changed across weeks';
 assert private.worker_sunday_settings_for_date(wid,'2026-11-22')->>'pay_model' is null,'Historical model changed';
 assert (private.sunday_pay_components((select id from public.workers where employee_code='81'),workday)->>'base_amount') is null,'Monthly salary must not replace missing fixed Sunday pay';
 select w.id into strict weekly from public.workers w join public.worker_payroll_profile p on p.worker_id=w.id and p.payment_type='weekly'
  cross join lateral(select * from public.worker_payroll_compensation c where c.worker_id=w.id and c.payment_type='weekly' and c.effective_from<=workday and(c.effective_to is null or c.effective_to>=workday) order by effective_from desc limit 1)c
  where w.is_active and c.daily_rate=20000 limit 1;
 assert (private.sunday_pay_components(weekly,workday)->>'base_amount')::numeric=40000,'Weekly Sunday must remain daily wage times two';
 select * into strict sample from public.biometric_attendance_events where worker_id=wid and attendance_date='2026-11-22' limit 1;
 sample.attendance_date:=workday;sample.event_timestamp:=(workday+time '08:00') at time zone 'Africa/Kinshasa';insert into pg_temp.sunday_money_events select sample.*;
 sample.event_timestamp:=(workday+time '14:00') at time zone 'Africa/Kinshasa';insert into pg_temp.sunday_money_events select sample.*;
 definition:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 definition:=replace(replace(replace(definition,'private.sunday_work_evidence','pg_temp.money_evidence'),'public.attendance','pg_temp.sunday_money_attendance'),'public.biometric_attendance_events','pg_temp.sunday_money_events');execute definition;
 definition:=pg_get_functiondef('private.accrue_automatic_sunday_base(date)'::regprocedure);
 definition:=replace(definition,'private.accrue_automatic_sunday_base','pg_temp.money_accrue');
 definition:=replace(definition,$old$or p_date>(now() at time zone 'Africa/Kinshasa')::date$old$,''); -- Fixture clock only; production guard stays intact.
 definition:=replace(replace(replace(replace(definition,'public.worker_sunday_payment','pg_temp.sunday_money_ledger'),'private.sunday_work_evidence','pg_temp.money_evidence'),'public.biometric_attendance_events','pg_temp.sunday_money_events'),'public.attendance','pg_temp.sunday_money_attendance');execute definition;
 perform pg_temp.money_accrue(workday);perform pg_temp.money_accrue(workday);
 assert (select count(*)=1 from pg_temp.sunday_money_ledger where worker_id=wid),'Duplicate Sunday accrual';
 assert exists(select 1 from pg_temp.sunday_money_ledger where worker_id=wid and base_amount=20000 and transport_amount=3000 and amount=23000),'Ledger must carry base plus transport once';
 update pg_temp.sunday_money_events set event_timestamp=(workday+time '16:00') at time zone 'Africa/Kinshasa'
  where event_timestamp=(workday+time '14:00') at time zone 'Africa/Kinshasa';
 definition:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 definition:=replace(replace(replace(definition,'private.sunday_hourly_sources','pg_temp.money_ot_sources'),'public.biometric_attendance_events','pg_temp.sunday_money_events'),'public.attendance','pg_temp.sunday_money_attendance');execute definition;
 pay:=pg_temp.money_ot_sources(workday)->0;
 assert (pay->>'raw_minutes')::integer=120 and (pay->>'hourly_rate')::numeric=10000,'Review source must use x4 only for Sunday hourly rate';
 update pg_temp.sunday_money_events set event_timestamp=(workday+time '14:00') at time zone 'Africa/Kinshasa'
  where event_timestamp=(workday+time '16:00') at time zone 'Africa/Kinshasa';
 delete from pg_temp.sunday_money_ledger;
 delete from pg_temp.sunday_money_events where event_timestamp=(workday+time '14:00') at time zone 'Africa/Kinshasa';
 perform pg_temp.money_accrue(workday);
 assert not exists(select 1 from pg_temp.sunday_money_ledger where worker_id=wid),'Incomplete Sunday must not pay transport';
end $$;
rollback;
