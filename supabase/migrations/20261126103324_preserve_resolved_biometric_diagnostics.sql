-- Keep compatible existing/protected attendance resolved in diagnostics.
do $migration$
declare definition text;
begin
 definition := pg_get_functiondef('public.get_unresolved_biometric_attendance(date)'::regprocedure);
 definition := replace(definition, 'when w.attendance_shift = ''night''', 'when a.id is null and w.attendance_shift = ''night''');
 execute definition;
end;
$migration$;
