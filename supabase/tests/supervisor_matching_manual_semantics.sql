-- Transactional RPC regressions: fixtures and all changes roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $test$
declare
 d date:='2000-01-05'; ids uuid[]; population jsonb; actor uuid:=auth.uid();
 a public.attendance%rowtype; original jsonb; first_original jsonb;
 semantic text; choice text; choices jsonb; context jsonb; saved jsonb; done jsonb;
begin
 assert not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=d),'Fixture date occupied';
 select array_agg(id order by id),jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,
  'employee_code',employee_code,'team_id',team_id,'team_name','Regression') order by id)
 into ids,population from (select w.id,w.full_name,w.employee_code,w.team_id from public.workers w
 join public.teams t on t.id=w.team_id left join public.worker_staff_classification c on c.worker_id=w.id
 where coalesce(c.classification,'normal')='normal' and t.name<>'Adminstration'
 and w.operational_start_date is null order by w.id limit 2) w;
 assert cardinality(ids)=2,'Fixture prerequisites missing';
 insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
 values(d,(d+time '11:00') at time zone 'Africa/Kinshasa',actor,population);
 -- The matrix goes through the real protected writer, not just the helper.
 foreach semantic in array array['A','M','P','O'] loop
  insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override,note)
  values(ids[2],d,case when semantic in ('A','M') then 'absent' else 'present' end,'manual',true,
   case semantic when 'M' then 'medical' when 'O' then 'working_outside' end);
  select to_jsonb(x) into original from public.attendance x where worker_id=ids[2] and attendance_date=d;
  foreach choice in array array['A','M','P','O'] loop
   if choice=semantic then
    done:=public.admin_save_supervisor_morning_review(d,array[ids[2]],jsonb_build_object(ids[2]::text,choice));
    assert (done->>'applied')::int=1,'Matching manual acceptance not counted';
   else
    begin
     perform public.admin_save_supervisor_morning_review(d,array[ids[2]],jsonb_build_object(ids[2]::text,choice));
     raise exception 'Semantic conflict accepted: % + %',semantic,choice;
    exception when check_violation then
     assert sqlerrm like '%protected manual attendance%';
    end;
   end if;
   assert original=(select to_jsonb(x) from public.attendance x where worker_id=ids[2] and attendance_date=d),
    'Protected row/provenance/metadata changed';
  end loop;
  delete from public.attendance where worker_id=ids[2] and attendance_date=d;
 end loop;
 -- A last-worker conflict must roll back the first worker and preserve the draft.
 insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override)
 values(ids[1],d,'absent','biometric',false),(ids[2],d,'absent','manual',true);
 select to_jsonb(x) into first_original from public.attendance x where worker_id=ids[1] and attendance_date=d;
 select to_jsonb(x) into original from public.attendance x where worker_id=ids[2] and attendance_date=d;
 context:=public.admin_supervisor_review_draft(d);
 choices:=jsonb_build_object(ids[1]::text,'P',ids[2]::text,'P');
 saved:=public.admin_supervisor_review_draft(d,'save',context->>'snapshot_token',0,context->>'official_token',choices);
 begin
  perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  raise exception 'Conflicting draft accepted';
 exception when check_violation then
  assert sqlerrm like '%protected manual attendance%';
 end;
 assert first_original=(select to_jsonb(x) from public.attendance x where worker_id=ids[1] and attendance_date=d),'Partial write survived';
 assert (select status='draft' and revision=1 and results=choices from private.supervisor_review_draft where attendance_date=d),'Draft changed on rollback';
 choices:=choices||jsonb_build_object(ids[2]::text,'A');
 saved:=public.admin_supervisor_review_draft(d,'save',saved->>'snapshot_token',1,saved->>'official_token',choices);
 begin
  perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  raise exception 'Stale revision accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.admin_supervisor_review_draft(d,'submit','stale',2,saved->>'official_token');
  raise exception 'Stale snapshot accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',2,'stale');
  raise exception 'Stale official context accepted';
 exception when serialization_failure then null; end;
 done:=public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',2,saved->>'official_token');
 assert done->>'status'='finalized' and (done->'applied'->>'applied')::int=2,'Normal draft submit failed';
 assert original=(select to_jsonb(x) from public.attendance x where worker_id=ids[2] and attendance_date=d),'Manual A provenance rewritten';
 assert (select workers=population from private.supervisor_review_daily_snapshot where attendance_date=d),'Snapshot changed';
 raise notice 'PASS: all 16 manual semantic pairs, unchanged provenance, atomic rollback, draft/version guards and snapshot population';
end;
$test$;
rollback;
