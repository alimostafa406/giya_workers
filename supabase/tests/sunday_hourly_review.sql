-- Actual Sunday evidence, normal canonical RPC; all review writes roll back.
begin;
do $$
declare sources jsonb;entries jsonb;one jsonb;before_hash text;after_hash text;failed boolean:=false;version_before integer;double_before bigint;
begin
 if auth.uid() is null then raise exception 'Run with a real authenticated source admin subject';end if;
 sources:=public.admin_get_biometric_overtime_review('2026-11-22','2026-11-22');
 assert exists(select 1 from jsonb_array_elements(sources)s where s->'worker'->>'employee_code'='71' and (s->>'raw_minutes')::integer=301),'Juresse missing';
 assert exists(select 1 from jsonb_array_elements(sources)s where s->'worker'->>'employee_code'='300' and (s->>'raw_minutes')::integer=477),'Khonde missing';
 assert not exists(select 1 from jsonb_array_elements(sources)s where s->'worker'->>'employee_code'='179'),'NIOKA must not be an hourly candidate';
 select md5(jsonb_build_object('attendance',(select jsonb_agg(a order by id) from public.attendance a where attendance_date='2026-11-22'),
   'events',(select jsonb_agg(e order by id) from public.biometric_attendance_events e where attendance_date='2026-11-22'))::text) into before_hash;
 select jsonb_agg(jsonb_build_object('worker_id',s->'worker'->>'id','minutes',(s->>'raw_minutes')::integer,'decision','approved',
  'source_fingerprint',s->>'source_fingerprint','expected_version',coalesce((s->'review'->>'version')::integer,0),'original_biometric_minutes',(s->>'raw_minutes')::integer,'note','rollback test'))
  into entries from jsonb_array_elements(sources)s;
 perform public.admin_decide_biometric_overtime('2026-11-22',entries);
 select count(*) into double_before from public.worker_biometric_overtime_review where attendance_date='2026-11-22';
 assert double_before=jsonb_array_length(entries),'One canonical row per worker/date';
 sources:=public.admin_get_biometric_overtime_review('2026-11-22','2026-11-22');
 one:=sources->0;
 select version into version_before from public.worker_biometric_overtime_review where worker_id=(one->'worker'->>'id')::uuid and attendance_date='2026-11-22';
 entries:=jsonb_build_array(jsonb_build_object('worker_id',one->'worker'->>'id','minutes',60,'decision','rejected','source_fingerprint',one->>'source_fingerprint','expected_version',version_before));
 perform public.admin_decide_biometric_overtime('2026-11-22',entries);
 assert exists(select 1 from public.worker_biometric_overtime_review where worker_id=(one->'worker'->>'id')::uuid and attendance_date='2026-11-22' and decision='rejected' and version=version_before+1),'Reject did not persist';
 begin
  perform public.admin_decide_biometric_overtime('2026-11-22',jsonb_set(entries,'{0,source_fingerprint}','"stale"'));
 exception when others then failed:=true;end;
 assert failed,'Stale source must be rejected';
 assert exists(select 1 from public.worker_biometric_overtime_review where worker_id=(one->'worker'->>'id')::uuid and attendance_date='2026-11-22' and version=version_before+1),'Failed write must be atomic';
 select md5(jsonb_build_object('attendance',(select jsonb_agg(a order by id) from public.attendance a where attendance_date='2026-11-22'),
   'events',(select jsonb_agg(e order by id) from public.biometric_attendance_events e where attendance_date='2026-11-22'))::text) into after_hash;
 assert before_hash=after_hash,'Attendance/evidence changed';
end $$;
rollback;
