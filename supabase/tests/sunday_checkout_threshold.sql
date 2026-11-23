-- Exercise the deployed canonical function with isolated temporary evidence.
-- No production attendance, events or payroll records are written.
begin;
create temporary table sunday_test_events as select * from public.biometric_attendance_events with no data;
create temporary table sunday_test_attendance as select * from public.attendance with no data;
do $$
declare definition text; sample public.biometric_attendance_events; clock text; answer jsonb; punches integer;
begin
 select * into strict sample from public.biometric_attendance_events e
 where e.attendance_date='2026-11-22'
 and (e.event_timestamp at time zone 'Africa/Kinshasa')::time between '07:00' and '09:00'
 and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=e.worker_id
 limit 1;
 -- A real morning arrival may be inside 08:00–08:20.
 sample.event_timestamp:=timestamp '2026-11-22 08:05:04' at time zone 'Africa/Kinshasa';
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
 foreach punches in array array[2,4,6] loop
  delete from pg_temp.sunday_test_events;
  insert into pg_temp.sunday_test_events select sample.*;
  insert into pg_temp.sunday_test_events select sample.*;
  update pg_temp.sunday_test_events set event_timestamp=timestamp '2026-11-22 19:01:16' at time zone 'Africa/Kinshasa'
   where ctid=(select ctid from pg_temp.sunday_test_events order by ctid desc limit 1);
  for i in 1..(punches-2) loop
   insert into pg_temp.sunday_test_events select sample.*;
   update pg_temp.sunday_test_events set event_timestamp=(timestamp '2026-11-22 10:00:00'+i*interval '1 hour') at time zone 'Africa/Kinshasa'
    where ctid=(select ctid from pg_temp.sunday_test_events order by ctid desc limit 1);
  end loop;
  answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-22');
  assert (answer->>'eligible')::boolean and (answer->>'punch_count')::integer=punches,'First/final evidence must support multiple punches';
  assert answer->>'morning'='08:05:04' and answer->>'checkout'='19:01:16','Intermediate punches must not replace first/final';
 end loop;
 foreach clock in array array['06:29:59','06:30:00','07:45:00','07:59:59','08:00:00','08:20:00','08:20:01','08:21:00','08:30:00','09:05:04'] loop
  delete from pg_temp.sunday_test_events;
  sample.event_timestamp:=(date '2026-11-22'+clock::time) at time zone 'Africa/Kinshasa';
  insert into pg_temp.sunday_test_events select sample.*;
  insert into pg_temp.sunday_test_events select sample.*;
  update pg_temp.sunday_test_events set event_timestamp=timestamp '2026-11-22 19:01:16' at time zone 'Africa/Kinshasa'
   where ctid=(select ctid from pg_temp.sunday_test_events order by ctid desc limit 1);
  answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-22');
  assert (answer->>'eligible')::boolean=(clock::time between time '06:30' and time '08:20'),'First check-in boundary failed: '||clock;
 end loop;
 answer:=pg_temp.sunday_threshold_test(sample.worker_id,'2026-11-23');
 assert not (answer->>'eligible')::boolean,'Monday must not use Sunday rule';
end $$;
rollback;
