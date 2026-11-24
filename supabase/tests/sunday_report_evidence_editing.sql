-- Execute as the authorized admin; genuine IFASO/EMMANUEL evidence, rollback.
begin;
do $test$
declare s jsonb;w uuid;code text;version integer;raw_hash text;changed_hash text;
begin
 foreach code in array array['19','20'] loop
  select value into s from jsonb_array_elements(private.sunday_evidence_edit_sources('2026-11-22')) where value->'worker'->>'employee_code'=code;
  w:=(s->'worker'->>'id')::uuid;
  if w is null then raise exception 'Real Sunday worker % missing',code;end if;
  select md5(jsonb_agg(to_jsonb(b) order by b.event_timestamp,b.event_identity)::text) into raw_hash from public.biometric_attendance_events b where worker_id=w and attendance_date between '2026-11-22' and '2026-11-23';
  perform public.admin_save_sunday_evidence(w,'2026-11-22','2026-11-22 08:05:00+01',case when code='19' then '2026-11-22 14:02:01+01'::timestamptz else '2026-11-22 14:00:00+01'::timestamptz end,0,false,'Rollback report inline regression',coalesce((s->'approved_evidence'->>'version')::integer,0),s->>'source_fingerprint');
  if not(private.sunday_work_evidence(w,'2026-11-22')->>'eligible')::boolean then raise exception 'Approved Sunday evidence not eligible';end if;
  if exists(select 1 from jsonb_array_elements(private.sunday_hourly_sources('2026-11-22'))x where x->'worker'->>'id'=w::text) then raise exception 'Evidence edit auto-created payable OT';end if;
  if code='20' then
   select value into s from jsonb_array_elements(private.sunday_evidence_edit_sources('2026-11-22')) where value->'worker'->>'id'=w::text;
   perform public.admin_save_sunday_evidence(w,'2026-11-22','2026-11-22 08:05:00+01','2026-11-22 18:30:00+01',270,false,'Approved last punch suggests OT', (s->'approved_evidence'->>'version')::integer,s->>'source_fingerprint');
   select value into s from jsonb_array_elements(private.sunday_hourly_sources('2026-11-22')) where value->'worker'->>'id'=w::text;
   if s is null or s->>'suggested_approved_minutes'<>'270' or s->'review' is distinct from 'null'::jsonb then raise exception 'Shared pending Sunday OT not visible';end if;
   perform public.admin_decide_biometric_overtime('2026-11-22',jsonb_build_array(jsonb_build_object('worker_id',w,'minutes',255,'decision','approved','original_biometric_minutes',(s->>'raw_minutes')::integer,'note','Explicit approval only','source_fingerprint',s->>'source_fingerprint','expected_version',0)));
   if (select minutes from public.worker_biometric_overtime_review where worker_id=w and attendance_date='2026-11-22')<>255 then raise exception 'Shared adjusted approval failed';end if;
  end if;
  select md5(jsonb_agg(to_jsonb(b) order by b.event_timestamp,b.event_identity)::text) into changed_hash from public.biometric_attendance_events b where worker_id=w and attendance_date between '2026-11-22' and '2026-11-23';
  if raw_hash<>changed_hash then raise exception 'Raw biometric evidence changed';end if;
 end loop;
end $test$;
rollback;
