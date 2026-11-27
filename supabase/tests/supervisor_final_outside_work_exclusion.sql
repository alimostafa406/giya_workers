-- All test writes roll back. Real report checks do not finalize production sheets.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date:='2000-01-04'; d2 date:='2000-01-05'; ids uuid[]; population jsonb; f uuid; movement uuid:=gen_random_uuid();
 ctx jsonb; saved jsonb; fresh jsonb; done jsonb; choices jsonb; original jsonb; snap jsonb; actual jsonb; before_final jsonb;
begin
 assert not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date in (d,d2));
 select array_agg(id order by id),jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'employee_code',employee_code,'team_id',team_id,'team_name','Regression') order by id)
 into ids,population from (select w.id,w.full_name,w.employee_code,w.team_id from public.workers w
 join public.teams t on t.id=w.team_id left join public.worker_staff_classification c on c.worker_id=w.id
 where coalesce(c.classification,'normal')='normal' and t.name<>'Adminstration' and w.operational_start_date is null order by w.id limit 3) w;
 select w.id into f from public.workers w join public.worker_staff_classification c on c.worker_id=w.id where w.is_active and c.classification='special_staff' limit 1;
 assert cardinality(ids)=3 and f is not null;
 insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
 values(d,(d+time '11:00') at time zone 'Africa/Kinshasa',auth.uid(),population);
 ctx:=public.admin_supervisor_review_draft(d);
 select jsonb_object_agg(id::text,'A') into choices from unnest(ids) id;
 saved:=public.admin_supervisor_review_draft(d,'save',ctx->>'snapshot_token',0,ctx->>'official_token',choices);
 -- A movement becomes FINAL after an A draft was saved.
 insert into public.outside_work_movements(id,work_date,status,foreman_worker_id,foreman_name,start_time,end_time,created_by)
 values(movement,d,'draft',f,'Supervisor exclusion test','08:00','18:00',auth.uid());
 insert into public.outside_work_movement_workers(movement_id,worker_id,worker_name,start_time,end_time)
 values(movement,ids[1],'Outside worker','08:00','18:00');
 update public.outside_work_movements set status='final' where id=movement;
 select to_jsonb(a) into original from public.attendance a where worker_id=ids[1] and attendance_date=d;
 assert original->>'attendance_source'='outside_work' and original->>'status'='present';
 actual:=public.admin_get_final_supervisor_review(d,false);
 assert jsonb_array_length(actual->'workers')=2;
 assert not exists(select 1 from jsonb_array_elements(actual->'workers') w where w->>'id'=ids[1]::text);
 fresh:=public.admin_supervisor_review_draft(d);
 assert fresh->>'snapshot_token'<>saved->>'snapshot_token' and not (fresh->'results' ? ids[1]::text);
 assert (select results=choices from private.supervisor_review_draft where attendance_date=d),'Load mutated draft history';
 begin
  perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  raise exception 'Stale pre-Outside Work draft submitted';
 exception when serialization_failure then null; end;
 -- Old direct clients cannot apply stale A over FINAL Outside Work either.
 perform public.admin_save_supervisor_morning_review(d,array[ids[1]],jsonb_build_object(ids[1]::text,'A'));
 assert original=(select to_jsonb(a) from public.attendance a where worker_id=ids[1] and attendance_date=d);
 choices:=choices-ids[1]::text;
 saved:=public.admin_supervisor_review_draft(d,'save',fresh->>'snapshot_token',1,fresh->>'official_token',choices);
 -- Real unrelated protected manual conflicts still roll back the whole submit.
 insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override,recorded_by,biometric_sync_metadata)
 values(ids[3],d,'absent','manual',true,auth.uid(),'{"protected_external_decision":"M"}');
 begin
  perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',2,saved->>'official_token');
  raise exception 'Real protected M conflict overwritten';
 exception when check_violation then null; end;
 assert not exists(select 1 from public.attendance where worker_id=ids[2] and attendance_date=d),'Partial writes';
 assert (select status='draft' and revision=2 from private.supervisor_review_draft where attendance_date=d);
 delete from public.attendance where worker_id=ids[3] and attendance_date=d;
 done:=public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',2,saved->>'official_token');
 assert done->>'status'='finalized' and (done->'applied'->>'applied')::integer=2;
 assert original=(select to_jsonb(a) from public.attendance a where worker_id=ids[1] and attendance_date=d),'Outside attendance rewritten';
 assert (select workers=population from private.supervisor_review_daily_snapshot where attendance_date=d),'Immutable snapshot changed';
 assert jsonb_array_length(public.admin_get_final_supervisor_review(d,false)->'workers')=2,'Excluded worker returned after finalization';
 before_final:=to_jsonb((select r from private.supervisor_review_draft r where attendance_date=d));
 begin
  perform public.admin_supervisor_review_draft(d,'save',done->>'snapshot_token',3,done->>'official_token',choices);
  raise exception 'Final sheet reopened';
 exception when check_violation then null; end;
 assert before_final=to_jsonb((select r from private.supervisor_review_draft r where attendance_date=d));
 -- All-outside population: no supervisor choices are required, even for an empty active roster.
 insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
 values(d2,(d2+time '11:00') at time zone 'Africa/Kinshasa',auth.uid(),jsonb_build_array(population->0));
 movement:=gen_random_uuid();
 insert into public.outside_work_movements(id,work_date,status,foreman_worker_id,foreman_name,start_time,end_time,created_by)
 values(movement,d2,'draft',f,'All outside','08:00','18:00',auth.uid());
 insert into public.outside_work_movement_workers(movement_id,worker_id,worker_name,start_time,end_time) values(movement,ids[1],'Outside','08:00','18:00');
 update public.outside_work_movements set status='final' where id=movement;
 ctx:=public.admin_supervisor_review_draft(d2);
 assert jsonb_array_length(public.admin_get_final_supervisor_review(d2,false)->'workers')=0;
 saved:=public.admin_supervisor_review_draft(d2,'save',ctx->>'snapshot_token',0,ctx->>'official_token','{}');
 done:=public.admin_supervisor_review_draft(d2,'submit',saved->>'snapshot_token',1,saved->>'official_token');
 assert done->>'status'='finalized' and (done->'applied'->>'applied')::integer=0;
 raise notice 'PASS: authoritative FINAL exclusion; stale A draft; atomic protection; no decision; all-outside sheet; immutable final roster';
end $$;
rollback;
