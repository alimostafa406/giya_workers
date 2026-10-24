-- Duration entry is separate from punch editing. Preserve all attendance
-- provenance; keep canonical manual_override for existing payroll precedence.
do $migration$
declare definition text; old_duration text := $old$
                if v_attendance.check_out is not null then
                  v_outcome := 'skipped'; v_message := 'existing_real_checkout';
                else
                  update public.attendance a set
                    attendance_source = 'manual', manual_override = true,
                    emergency_overtime_mode = 'manual_overtime_duration',
                    emergency_overtime_minutes = v_minutes,
                    recorded_by = v_actor, note = coalesce(nullif(btrim(p_note), ''), a.note), updated_at = now()
                  where a.id = v_attendance.id returning a.* into v_after;
                  v_outcome := 'updated';
                end if;
$old$;
new_duration text := $new$
                update public.attendance a set
                  manual_override = true,
                  emergency_overtime_mode = 'manual_overtime_duration',
                  emergency_overtime_minutes = v_minutes,
                  updated_at = now()
                where a.id = v_attendance.id returning a.* into v_after;
                v_outcome := 'updated';
$new$;
begin
  definition:=pg_get_functiondef('public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)'::regprocedure);
  if position(old_duration in definition)=0 then raise exception 'Duration writer changed; inspect before migration'; end if;
  definition:=replace(definition,old_duration,new_duration);
  -- A duration override must not grant permission to edit a real punch via
  -- the separate manual_checkout action. Only its own manual checkout is editable.
  if position(E'if v_attendance.check_out is not null\n                  and v_attendance.emergency_overtime_mode is null then' in definition)=0 then
    raise exception 'Checkout guard changed; inspect before migration';
  end if;
  definition:=replace(definition,
    E'if v_attendance.check_out is not null\n                  and v_attendance.emergency_overtime_mode is null then',
    E'if v_attendance.check_out is not null\n                  and v_attendance.emergency_overtime_mode is distinct from ''manual_checkout'' then');
  if position('  for v_entry in select value from jsonb_array_elements(p_entries) loop' in definition)=0 then
    raise exception 'Batch loop changed; inspect before migration';
  end if;
  -- Serialize against concurrent payroll finalization for the entire short RPC.
  definition:=replace(definition,'  for v_entry in select value from jsonb_array_elements(p_entries) loop',
    E'  lock table public.payroll_run in share mode;\n\n  for v_entry in select value from jsonb_array_elements(p_entries) loop');
  execute definition;
end $migration$;
