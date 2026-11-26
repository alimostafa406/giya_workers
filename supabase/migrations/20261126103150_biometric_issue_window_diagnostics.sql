-- Diagnostics only. Do not change mappings, punches, attendance or shift settings.
-- Mirror attendance_shift.py: night work runs 17:00 through 06:30 next day.
do $migration$
declare definition text;
begin
  definition := replace(pg_get_functiondef('public.get_unresolved_biometric_attendance(date)'::regprocedure), E'\r\n', E'\n');
  if position('outside_attendance_window' in definition) = 0 then
    if position('when a.id is null then' in definition) = 0 then raise exception 'Unexpected unresolved biometric RPC definition'; end if;
    definition := replace(definition,
      'when a.id is null then',
      $replacement$when w.attendance_shift = 'night'
          and (c.event_timestamp at time zone 'Africa/Kinshasa')::time > time '06:30'
          and (c.event_timestamp at time zone 'Africa/Kinshasa')::time < time '17:00'
          then 'outside_attendance_window'
        when a.id is null then$replacement$);
    definition := replace(definition,
      'and a.attendance_date = c.attendance_date',
      $replacement$and a.attendance_date = case
       when w.attendance_shift = 'night'
        and (c.event_timestamp at time zone 'Africa/Kinshasa')::time <= time '06:30'
       then c.attendance_date - 1 else c.attendance_date end$replacement$);
    execute definition;
  end if;
end;
$migration$;
