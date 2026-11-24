-- Keep the 08:35 cutoff; accept early arrivals from the existing 06:30
-- canonical Sunday evidence window. Custom worker schedules are untouched.
lock table public.worker_sunday_evidence_override in share row exclusive mode;
create temporary table sunday_early_override_baseline on commit drop as
 select worker_id,work_date,raw_work_fingerprint from public.worker_sunday_evidence_override o
 where o.raw_work_fingerprint=md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text);
do $$ declare d text;begin
 d:=pg_get_functiondef('private.worker_sunday_settings_for_date(uuid,date)'::regprocedure);
 if strpos(d,'''checkin_start'',''08:00:00''')=0 then raise exception 'Unexpected Sunday start default';end if;
 execute replace(d,'''checkin_start'',''08:00:00''','''checkin_start'',''06:30:00''');
end $$;
-- Policy metadata only: preserve valid explicit approved values and versions,
-- without reviving corrections that were already stale from changed evidence.
update public.worker_sunday_evidence_override o
 set raw_work_fingerprint=md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text),
 history=o.history||jsonb_build_array(jsonb_build_object('source','allow_early_sunday_arrival','at',now(),
  'reason','Restore canonical 06:30 lower bound; retain 08:35 cutoff and approved values',
  'previous_raw_work_fingerprint',o.raw_work_fingerprint,
  'new_raw_work_fingerprint',md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text)))
 from pg_temp.sunday_early_override_baseline b
 where o.worker_id=b.worker_id and o.work_date=b.work_date and o.raw_work_fingerprint=b.raw_work_fingerprint
 and o.raw_work_fingerprint<>md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text);
notify pgrst,'reload schema';
