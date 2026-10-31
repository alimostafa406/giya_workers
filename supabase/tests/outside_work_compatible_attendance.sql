-- Transactional integration tests; no fixture or production data survives.
begin;
do $test$
declare
 w uuid; f uuid; actor uuid; m uuid:=gen_random_uuid();
 d date:='2020-01-06'; a public.attendance%rowtype; before_row jsonb;
 choice text;
begin
 select x.id into w from public.workers x join public.teams t on t.id=x.team_id
 left join public.worker_staff_classification c on c.worker_id=x.id
 where not x.is_active and coalesce(c.classification,'normal')='normal'
 and t.name<>'Adminstration' and (x.operational_start_date is null or x.operational_start_date<=d)
 and not exists(select 1 from public.attendance existing where existing.worker_id=x.id and existing.attendance_date=d)
 limit 1;
 select x.id into f from public.workers x join public.worker_staff_classification c on c.worker_id=x.id
 where x.is_active and c.classification='special_staff' limit 1;
 select id into actor from public.admins where is_active limit 1;
 assert w is not null and f is not null and actor is not null, 'Fixture prerequisites missing';
 insert into public.outside_work_movements(id,work_date,team_id,status,foreman_worker_id,foreman_name,start_time,end_time,created_by)
 values(m,d,null,'final',f,'Regression fixture','08:00','17:00',actor);
 insert into public.outside_work_movement_workers(movement_id,worker_id,worker_name,start_time,end_time)
 values(m,w,'Inactive historical fixture','08:00','17:00');
 select * into a from public.attendance where worker_id=w and attendance_date=d;
 assert a.status='present' and a.attendance_day_fraction=1 and a.attendance_source='outside_work',
 'Historical inactive participant without supervisor decision must count';
 assert not a.manual_override and a.check_in is null and a.check_out is null,'No fabricated manual attendance or punches';
 assert not (select conflict from private.outside_work_attendance_evidence where worker_id=w and attendance_date=d),'Missing supervisor row is not a conflict';
 -- Both overlay (normal writes) and reconciliation use the same protection predicate.
 foreach choice in array array['O','P'] loop
  update public.attendance set attendance_source='manual',manual_override=true,status='present',
   biometric_sync_metadata=jsonb_build_object('supervisor_morning_review',jsonb_build_object('choice',choice))
  where id=a.id;
  perform private.reconcile_outside_work_attendance(w,d);
  select * into a from public.attendance where worker_id=w and attendance_date=d;
  assert a.status='present' and a.attendance_source='outside_work' and a.attendance_day_fraction=1,'Compatible O/P rejected';
  assert a.biometric_sync_metadata #>> '{supervisor_morning_review,choice}'=choice,'Supervisor audit lost';
  assert not (select conflict from private.outside_work_attendance_evidence where worker_id=w and attendance_date=d),'Compatible O/P falsely conflicts';
 end loop;
 foreach choice in array array['A','M'] loop
  update public.attendance set attendance_source='manual',manual_override=true,
   status=case when choice='A' then 'absent' else 'half_day' end,
   check_in=case when choice='M' then time '08:12:34' end,
   biometric_sync_metadata=jsonb_build_object('supervisor_morning_review',jsonb_build_object('choice',choice))
  where id=a.id;
  select to_jsonb(x) into before_row from public.attendance x where id=a.id;
  perform private.reconcile_outside_work_attendance(w,d);
  assert (select to_jsonb(x)=before_row from public.attendance x where id=a.id),'Protected A/M overwritten';
  assert (select conflict from private.outside_work_attendance_evidence where worker_id=w and attendance_date=d),'Protected A/M not flagged';
 end loop;
 -- An old manual absence without supervisor audit cannot safely be presumed automatic.
 update public.attendance set status='absent',check_in=null,biometric_sync_metadata='{}' where id=a.id;
 assert (select private.outside_work_attendance_conflicts(x) from public.attendance x where id=a.id),'Unaudited protected absence weakened';
 assert (select count(*)=1 from private.outside_work_attendance_evidence where worker_id=w and attendance_date=d),'Duplicate ledger rows';
 assert not (select is_active from public.workers where id=w),'Historical worker reactivated';
 raise notice 'PASS: historical/inactive, no supervisor, compatible O/P, protected A/M and unaudited absence, idempotence';
end;
$test$;
rollback;
