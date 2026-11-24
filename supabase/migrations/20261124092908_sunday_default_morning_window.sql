-- Change the global Sunday morning default, not the physical evidence window.
-- Existing custom worker schedules retain their previous precedence/window.
lock table public.worker_sunday_evidence_override in share row exclusive mode;
create temporary table sunday_window_override_baseline on commit drop as
 select worker_id,work_date,raw_work_fingerprint
 from public.worker_sunday_evidence_override o
 where o.raw_work_fingerprint=md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text);

alter table public.worker_sunday_settings alter column checkin_cutoff set default '08:35';
do $$ declare d text;begin
 d:=pg_get_functiondef('private.worker_sunday_settings_for_date(uuid,date)'::regprocedure);
 if strpos(d,'''checkin_cutoff'',''08:20:00''')=0 then raise exception 'Unexpected Sunday defaults';end if;
 d:=replace(d,'''checkin_cutoff'',''08:20:00''','''checkin_start'',''08:00:00'',''checkin_cutoff'',''08:35:00''');
 execute d;
 d:=pg_get_functiondef('private.sunday_work_evidence_raw(uuid,date)'::regprocedure);
 d:=replace(d,'local_time>=p_date+time ''06:30'' and local_time<=','local_time>=p_date+coalesce((cfg->>''checkin_start'')::time,time ''06:30'') and local_time<=');
 d:=replace(d,'first_at between p_date+time ''06:30'' and','first_at between p_date+coalesce((cfg->>''checkin_start'')::time,time ''06:30'') and');
 execute d;
 d:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 d:=replace(d,'first_local between p_date+time ''06:30'' and','first_local between p_date+coalesce((cfg->>''checkin_start'')::time,time ''06:30'') and');
 execute d;
end $$;

-- A policy-only eligibility change must not discard a still-valid, explicit
-- admin evidence correction. Rebase only fingerprints verified BEFORE change;
-- never resurrect an override already stale from changed physical evidence.
update public.worker_sunday_evidence_override o
 set raw_work_fingerprint=md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text),
 history=o.history||jsonb_build_array(jsonb_build_object('source','sunday_default_morning_window',
  'at',now(),'reason','Global default morning window 08:00:00 through 08:35:00 inclusive; approved values preserved',
  'previous_raw_work_fingerprint',o.raw_work_fingerprint,
  'new_raw_work_fingerprint',md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text)))
 from pg_temp.sunday_window_override_baseline b
 where o.worker_id=b.worker_id and o.work_date=b.work_date and o.raw_work_fingerprint=b.raw_work_fingerprint
 and o.raw_work_fingerprint<>md5(private.sunday_work_evidence_raw(o.worker_id,o.work_date)::text);
notify pgrst,'reload schema';
