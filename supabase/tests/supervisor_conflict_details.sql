begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare actual jsonb; actor uuid:=auth.uid(); wid uuid; population jsonb; ctx jsonb; saved jsonb; detail text; original jsonb;
 d date:='2000-01-06'; semantic text; other text; row public.attendance;
begin
 select item into actual from jsonb_array_elements(private.supervisor_review_conflicts('2026-11-26')) item
 where item->>'worker_id'='d5a3617f-0b81-448c-82af-2e0925380698';
 assert actual->>'protected_choice'='A' and actual->>'supervisor_choice'='A';
 assert actual->>'conflict_type'='outside_work' and (actual->>'outside_work_final')::boolean;
 assert actual->>'attendance_source'='manual';
 assert not has_function_privilege('authenticated','private.supervisor_review_conflicts(date)','execute');
 foreach semantic in array array['A','M','P','O'] loop
  row:=jsonb_populate_record(null::public.attendance,jsonb_build_object('attendance_source','manual','manual_override',true,
   'status',case when semantic in ('A','M') then 'absent' else 'present' end,
   'attendance_day_fraction',case when semantic in ('A','M') then 0 else 1 end,
   'biometric_sync_metadata',jsonb_build_object('protected_external_decision',semantic)));
  assert private.supervisor_manual_attendance_matches(row,semantic),'Matching semantics changed';
  foreach other in array array['A','M','P','O'] loop
   if other<>semantic then assert not private.supervisor_manual_attendance_matches(row,other),'Conflict became compatible'; end if;
  end loop;
 end loop;
 assert not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=d);
 select id into wid from public.workers order by id limit 1;
 select jsonb_build_array(jsonb_build_object('id',id,'full_name',full_name,'employee_code',employee_code,'team_id',team_id,'team_name','Regression')) into population from public.workers where id=wid;
 insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
 values(d,(d+time '11:00') at time zone 'Africa/Kinshasa',actor,population);
 insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override,recorded_by,biometric_sync_metadata)
 values(wid,d,'absent','manual',true,actor,'{}');
 select to_jsonb(a) into original from public.attendance a where worker_id=wid and attendance_date=d;
 ctx:=public.admin_supervisor_review_draft(d);
 saved:=public.admin_supervisor_review_draft(d,'save',ctx->>'snapshot_token',0,ctx->>'official_token',jsonb_build_object(wid::text,'P'));
 begin
  perform public.admin_supervisor_review_draft(d,'submit',saved->>'snapshot_token',1,saved->>'official_token');
  raise exception 'Conflicting P overwrote protected A';
 exception when check_violation then
  get stacked diagnostics detail=pg_exception_detail;
  assert detail::jsonb->>'protected_choice'='A' and detail::jsonb->>'supervisor_choice'='P','Exact error detail missing';
 end;
 assert original=(select to_jsonb(a) from public.attendance a where worker_id=wid and attendance_date=d);
 assert (select status='draft' and revision=1 from private.supervisor_review_draft where attendance_date=d);
end $$;
rollback;
