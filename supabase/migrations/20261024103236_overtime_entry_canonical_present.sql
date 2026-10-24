-- Duration-only eligibility follows canonical full-day attendance, not punch
-- completeness. Keep punch-editing mode, absence/medical and payroll guards.
do $migration$
declare definition text; old_guard text := $old$
            if v_attendance.id is null or v_attendance.check_in is null
              or v_attendance.status in ('absent', 'pending') then
              v_outcome := 'skipped'; v_message := 'valid_check_in_required';
            elsif v_attendance.manual_override is true
              and v_attendance.emergency_overtime_mode is null then
$old$;
new_guard text := $new$
            if p_mode = 'manual_overtime_duration'
              and v_attendance.biometric_sync_metadata #>> '{supervisor_morning_review,choice}' in ('A','M') then
              v_outcome := 'skipped'; v_message := 'protected_manual_attendance';
            elsif v_attendance.id is null or (
              not (p_mode = 'manual_overtime_duration' and v_attendance.status = 'present'
                and coalesce(v_attendance.attendance_day_fraction,0) = 1)
              and (v_attendance.check_in is null or v_attendance.status in ('absent', 'pending'))) then
              v_outcome := 'skipped'; v_message := 'valid_check_in_required';
            elsif v_attendance.manual_override is true
              and v_attendance.emergency_overtime_mode is null
              and not (p_mode = 'manual_overtime_duration' and v_attendance.status = 'present'
                and coalesce(v_attendance.attendance_day_fraction,0) = 1) then
$new$;
begin
  definition:=pg_get_functiondef('public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)'::regprocedure);
  if position(old_guard in definition)=0 then raise exception 'Eligibility guard changed; inspect before migration'; end if;
  execute replace(definition,old_guard,new_guard);
end $migration$;
