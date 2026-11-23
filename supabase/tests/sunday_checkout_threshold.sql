-- Exercise the deployed canonical function with isolated temporary evidence.
-- No production attendance, events or payroll records are written.
begin;
create temporary table sunday_test_events as select * from public.biometric_attendance_events with no data;
create temporary table sunday_test_attendance as select * from public.attendance with no data;
do $$
declare definition text; sample public.biometric_attendance_events; clock text; answer jsonb;
begin
 select * into strict sample from public.biometric_attendance_events e
 where e.attendance_date='2026-11-22'
 and (e.event_timestamp at time zone 'Africa/Kinshasa')::time between '07:00' and '09:00'
 and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=e.worker_id
 limit 1;
 definition:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 definition:=replace(definition,'private.sunday_work_evidence','pg_temp.sunday_threshold_test');
 definition:=replace(definition,'public.biometric_attendance_events','pg_temp.sunday_test_events');
 definition:=replace(definition,'public.attendance','pg_temp.sunday_test_attendance');
 execute definition;
 insert into pg_temp.sunday_test_events select sample.*;
 answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-22');
 assert not (answer->>'eligible')::boolean,'One morning punch must remain unpaid';
 foreach clock in array array['13:29:00','13:29:59','13:30:00','13:50:00','14:00:00','14:15:00'] loop
  delete from pg_temp.sunday_test_events;
  insert into pg_temp.sunday_test_events select sample.*;
  insert into pg_temp.sunday_test_events select sample.*;
  update pg_temp.sunday_test_events set event_timestamp=(date '2026-11-22'+clock::time) at time zone 'Africa/Kinshasa'
   where ctid=(select ctid from pg_temp.sunday_test_events order by ctid desc limit 1);
  answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-22');
  assert (answer->>'eligible')::boolean=(clock::time>=time '13:30'),'Checkout boundary failed: '||clock;
 end loop;
 delete from pg_temp.sunday_test_events where (event_timestamp at time zone 'Africa/Kinshasa')::time<'13:30';
 answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-22');
 assert not (answer->>'eligible')::boolean,'Checkout-only must remain unpaid';
 answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-23');
 assert not (answer->>'eligible')::boolean,'Monday must not use Sunday rule';
end $$;
rollback;
