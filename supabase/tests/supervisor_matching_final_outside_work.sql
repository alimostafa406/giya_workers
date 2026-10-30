-- Isolated historical fixtures. All rows and changes are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare
  d date:='2000-01-04'; ids uuid[]; population jsonb; actor uuid:=auth.uid();
  f uuid; movement uuid:=gen_random_uuid(); context jsonb; saved jsonb; done jsonb;
  choices jsonb; original jsonb; before_metadata jsonb; choice text; n integer;
begin
  assert not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=d),'Fixture date occupied';
  select array_agg(id order by id),jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,
    'employee_code',employee_code,'team_id',team_id,'team_name','Regression') order by id)
  into ids,population from (select w.id,w.full_name,w.employee_code,w.team_id from public.workers w
    join public.teams t on t.id=w.team_id left join public.worker_staff_classification c on c.worker_id=w.id
    where coalesce(c.classification,'normal')='normal' and t.name<>'Adminstration'
      and w.operational_start_date is null order by w.id limit 2) w;
  select w.id into f from public.workers w join public.worker_staff_classification c on c.worker_id=w.id
    where w.is_active and c.classification='special_staff' limit 1;
  assert cardinality(ids)=2 and f is not null,'Missing fixture prerequisites';
  assert not exists(select 1 from public.attendance where attendance_date=d and worker_id=any(ids));
  insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
    values(d,(d+time '11:00') at time zone 'Africa/Kinshasa',actor,population);
  insert into public.attendance(worker_id,attendance_date,status,check_in,check_out,attendance_source,manual_override)
    values(ids[1],d,'present','08:13:14','18:23:24','biometric',false);
  insert into public.outside_work_movements(id,work_date,team_id,status,foreman_worker_id,foreman_name,start_time,end_time,created_by)
    values(movement,d,null,'draft',f,'Supervisor regression','08:00','18:00',actor);
  insert into public.outside_work_movement_workers(movement_id,worker_id,worker_name,start_time,end_time)
    values(movement,ids[1],'Supervisor regression','08:00','18:00');
  update public.outside_work_movements set status='final' where id=movement;
  select to_jsonb(a),a.biometric_sync_metadata->'outside_work' into original,before_metadata
    from public.attendance a where worker_id=ids[1] and attendance_date=d;
  assert original->>'attendance_source'='outside_work' and original->>'manual_override'='false';
  context:=public.admin_supervisor_review_draft(d);
  choices:=jsonb_build_object(ids[1]::text,'O',ids[2]::text,'O');
  saved:=public.admin_supervisor_review_draft(d,'save',context->>'snapshot_token',0,context->>'official_token',choices);
  begin
    perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',0,saved->>'official_token');
    raise exception 'Stale revision accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_supervisor_review_draft(d,'submit','stale-snapshot',1,saved->>'official_token');
    raise exception 'Stale snapshot accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,'stale-official-token');
    raise exception 'Stale official token accepted';
  exception when serialization_failure then null; end;
  foreach choice in array array['A','M'] loop
    begin
      perform public.admin_save_supervisor_morning_review(d,ids,choices||jsonb_build_object(ids[1]::text,choice));
      raise exception 'Outside-work conflict accepted';
    exception when check_violation then
      assert sqlerrm like '%protected outside-work attendance%';
    end;
    assert original=(select to_jsonb(a) from public.attendance a where worker_id=ids[1] and attendance_date=d);
  end loop;
  -- Last worker blocks after the matching outside-work O would be written.
  foreach choice in array array['A','M'] loop
    insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override,biometric_sync_metadata)
      values(ids[2],d,'absent','manual',true,jsonb_build_object('protected_external_decision',choice));
    begin
      perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
      raise exception 'Protected manual A/M overwritten';
    exception when check_violation then
      assert sqlerrm like '%protected manual attendance%';
    end;
    assert original=(select to_jsonb(a) from public.attendance a where worker_id=ids[1] and attendance_date=d),'Partial outside-work update';
    assert (select status='draft' and revision=1 and results=choices from private.supervisor_review_draft where attendance_date=d),'Draft changed on failure';
    assert (select count(*)=2 from public.attendance where attendance_date=d),'Partial attendance writes';
    delete from public.attendance where worker_id=ids[2] and attendance_date=d;
  end loop;
  insert into public.attendance(worker_id,attendance_date,status,check_in,check_out,attendance_source,manual_override)
    values(ids[2],d,'present','11:12:13','17:20:21','biometric',false);
  done:=public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  assert done->>'status'='finalized' and done->>'revision'='2';
  assert (done->'applied'->>'applied')::integer=2;
  assert (select status='present' and attendance_day_fraction=1 and attendance_source='outside_work' and not manual_override
    and check_in='08:13:14' and check_out='18:23:24' and note='working_outside'
    and biometric_sync_metadata->'outside_work'=before_metadata
    and biometric_sync_metadata->'supervisor_morning_review'->>'choice'='O'
    and jsonb_array_length(biometric_sync_metadata->'supervisor_morning_review_history')=1
    from public.attendance where worker_id=ids[1] and attendance_date=d),'Outside-work provenance/times lost';
  assert (select attendance_source='manual' and manual_override and status='present'
    and check_in='11:12:13' and check_out='17:20:21' from public.attendance where worker_id=ids[2] and attendance_date=d),'Biometric + O behavior changed';
  assert done->>'official_token'=private.supervisor_official_decision_token(d,ids);
  assert done->>'official_token'<>saved->>'official_token';
  assert (select workers=population and jsonb_array_length(workers)=2 from private.supervisor_review_daily_snapshot where attendance_date=d),'Snapshot changed';
  perform public.admin_supervisor_review_draft(d,'submit',done->>'snapshot_token',2,done->>'official_token');
  assert (select jsonb_array_length(biometric_sync_metadata->'supervisor_morning_review_history')=1 from public.attendance where worker_id=ids[1] and attendance_date=d),'Retry duplicated history';
  raise notice 'PASS: matching FINAL outside O; conflicts; manual protection; real times; rollback; version guards; snapshot; idempotency';
end $$;
rollback;
