-- Isolated historical fixture. ALL draft/snapshot/attendance writes roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date:='2000-01-03'; population jsonb; ids uuid[]; choices jsonb; context jsonb; saved jsonb; finalized jsonb;
  protected uuid; count_before integer; payroll_before text;
begin
  assert not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=d),'Fixture date already used';
  select jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'employee_code',employee_code,'team_id',team_id,'team_name','Draft test') order by id),
    array_agg(id order by id) into population,ids from (select id,full_name,employee_code,team_id from public.workers order by id limit 45) w;
  assert cardinality(ids)=45;
  insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
    values(d,(d+time '11:00') at time zone 'Africa/Kinshasa',auth.uid(),population);
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) into payroll_before from public.payroll_line p;
  context:=public.admin_supervisor_review_draft(d);
  assert context->>'revision'='0' and context->>'status'='unsaved';
  assert not exists(select 1 from public.attendance where attendance_date=d),'Load wrote attendance';
  select jsonb_object_agg(id::text,(array['A','P','O','M'])[(ordinality::integer-1)%4+1]) into choices from unnest(ids) with ordinality x(id,ordinality);
  saved:=public.admin_supervisor_review_draft(d,'save',context->>'snapshot_token',0,context->>'official_token',choices);
  assert saved->>'revision'='1' and saved->'results'=choices and saved->>'status'='draft';
  assert not exists(select 1 from public.attendance where attendance_date=d),'Draft wrote attendance/manual override';
  assert public.admin_supervisor_review_draft(d)->'results'=choices,'Reload lost draft';
  begin
    perform public.admin_supervisor_review_draft(d,'save',context->>'snapshot_token',0,context->>'official_token',choices);
    raise exception 'Stale session overwrote draft';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_supervisor_review_draft(d,'save','wrong-snapshot',1,saved->>'official_token',choices);
    raise exception 'Snapshot mismatch accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_supervisor_review_draft(d,'save',saved->>'snapshot_token',1,'changed-official-decisions',choices);
    raise exception 'Newer official decisions overwritten';
  exception when serialization_failure then null; end;
  -- The final worker fails AFTER earlier workers would have been written.
  protected:=ids[cardinality(ids)];
  insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override,recorded_by,biometric_sync_metadata)
    values(protected,d,'absent','manual',true,auth.uid(),'{}');
  begin
    perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
    raise exception 'Protected manual conflict was overwritten';
  exception when check_violation then null; end;
  select count(*) into count_before from public.attendance where attendance_date=d;
  assert count_before=1,'Failed final save left partial attendance writes';
  context:=public.admin_supervisor_review_draft(d);
  assert context->'results'=choices and context->>'revision'='1' and context->>'status'='draft','Failed final save lost draft';
  delete from public.attendance where attendance_date=d and worker_id=protected;
  finalized:=public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  assert finalized->>'status'='finalized' and finalized->>'revision'='2';
  assert (select count(*) from public.attendance where attendance_date=d)=45;
  assert not exists(select 1 from public.attendance where attendance_date=d and (
    manual_override is not true or attendance_source<>'manual' or check_in is not null or check_out is not null
    or status is distinct from case when choices->>worker_id::text in ('P','O') then 'present' else 'absent' end));
  assert public.admin_supervisor_review_draft(d)->>'status'='finalized';
  perform public.admin_supervisor_review_draft(d,'submit',finalized->>'snapshot_token',2,finalized->>'official_token');
  assert (select count(*) from public.attendance where attendance_date=d)=45,'Retry duplicated workers';
  assert payroll_before=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payroll_line p),'Draft/final flow changed payroll';
end $$;
rollback;
