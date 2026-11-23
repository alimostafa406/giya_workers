do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 definition:=replace(definition,'and e.punches>=2', $guard$and not exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date
   and ((a.manual_override and a.status='absent') or coalesce(a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}','') in('A','M')))
   and e.punches>=2$guard$);
 execute definition;
 definition:=pg_get_functiondef('private.decide_sunday_hourly(date,jsonb,uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,$old$if entry->>'decision' is null$old$,$guard$if entry->>'decision'='approved' and private.extra_day_owns_hourly_date((entry->>'worker_id')::uuid,p_date) then raise exception 'Approved extra day already owns this worker/date';end if;
  if entry ? 'original_biometric_minutes' and entry->>'original_biometric_minutes' is distinct from source->>'raw_minutes' then raise exception 'Biometric duration changed; reload';end if;
  if entry->>'decision' is null$guard$);
 execute definition;
end $$;
