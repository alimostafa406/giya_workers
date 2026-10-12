-- One admin-only transaction for the frozen supervisor morning review.
-- Existing attendance rows and biometric metadata are retained; no punches are synthesized.
create or replace function public.admin_save_supervisor_morning_review(
  p_date date, p_worker_ids uuid[], p_results jsonb
) returns jsonb
language plpgsql security invoker
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_worker_id uuid;
  v_seen uuid[] := array[]::uuid[];
  v_choice text;
  v_status text;
  v_reason text;
  v_note text;
  v_active boolean;
  v_start date;
  v_team text;
  v_classification text;
  v_old public.attendance%rowtype;
  v_previous jsonb;
  v_metadata jsonb;
  v_audit jsonb;
  v_applied_at timestamptz := now();
  v_applied integer := 0;
begin
  if v_actor is null or not public.is_admin()
    or not exists (select 1 from public.admins where id = v_actor and is_active is true) then
    raise exception 'Active admin access is required' using errcode = '42501';
  end if;
  if p_date is distinct from v_today
    or (now() at time zone 'Africa/Kinshasa')::time < time '11:00' then
    raise exception 'Supervisor morning review is available after 11:00 for today only' using errcode = '22023';
  end if;
  if p_worker_ids is null or cardinality(p_worker_ids) not between 1 and 500
    or p_results is null or jsonb_typeof(p_results) <> 'object' then
    raise exception 'Invalid supervisor morning review' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_each_text(p_results)) <> cardinality(p_worker_ids) then
    raise exception 'Every frozen-list worker must have one result' using errcode = '22023';
  end if;

  foreach v_worker_id in array p_worker_ids loop
    if v_worker_id is null or v_worker_id = any(v_seen) then
      raise exception 'Duplicate or missing worker in supervisor review' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_worker_id);
    v_choice := p_results ->> v_worker_id::text;
    if v_choice is null or v_choice not in ('A', 'P', 'O', 'M') then
      raise exception 'Invalid or missing supervisor result for worker %', v_worker_id using errcode = '22023';
    end if;
    select w.is_active, w.operational_start_date, t.name,
      coalesce(c.classification, 'normal')
      into v_active, v_start, v_team, v_classification
    from public.workers w
    left join public.teams t on t.id = w.team_id
    left join public.worker_staff_classification c on c.worker_id = w.id
    where w.id = v_worker_id;
    if not found or v_active is not true or v_team is null
      or v_team = 'Adminstration' or v_classification <> 'normal'
      or (v_start is not null and v_start > p_date) then
      raise exception 'Worker % is not eligible for supervisor review', v_worker_id using errcode = '22023';
    end if;

    select a.* into v_old from public.attendance a
      where a.worker_id = v_worker_id and a.attendance_date = p_date for update;
    if v_old.id is not null and
      (v_old.manual_override is true or v_old.attendance_source <> 'biometric'
        or v_old.emergency_overtime_mode is not null) then
      if v_old.biometric_sync_metadata -> 'supervisor_morning_review' ->> 'choice' = v_choice
        and v_old.status = (case when v_choice in ('P', 'O') then 'present' else 'absent' end) then
        continue;
      end if;
      raise exception 'Worker % has protected manual attendance; review it separately', v_worker_id
        using errcode = '23514';
    end if;

    v_status := case when v_choice in ('P', 'O') then 'present' else 'absent' end;
    v_reason := case v_choice when 'O' then 'working_outside' when 'M' then 'medical' else null end;
    v_note := case v_choice
      when 'O' then 'Working outside (supervisor morning review)'
      when 'M' then 'Medical (supervisor morning review)'
      when 'P' then 'Present (supervisor morning review)'
      else 'Absent (supervisor morning review)' end;
    v_previous := case when v_old.id is null then null else jsonb_build_object(
      'status', v_old.status, 'check_in', v_old.check_in, 'check_out', v_old.check_out,
      'attendance_day_fraction', v_old.attendance_day_fraction,
      'attendance_source', v_old.attendance_source, 'manual_override', v_old.manual_override,
      'note', v_old.note, 'recorded_by', v_old.recorded_by,
      'updated_at', v_old.updated_at) end;
    v_metadata := coalesce(v_old.biometric_sync_metadata, '{}'::jsonb);
    if jsonb_typeof(v_metadata) <> 'object' then
      raise exception 'Worker % has unsupported attendance metadata', v_worker_id using errcode = '23514';
    end if;
    v_audit := jsonb_build_object(
      'source', 'supervisor_sheet', 'worker_id', v_worker_id, 'attendance_date', p_date,
      'choice', v_choice, 'status', v_status, 'reason', v_reason,
      'previous', v_previous, 'actor', v_actor, 'applied_at', v_applied_at);
    v_metadata := v_metadata || jsonb_build_object('supervisor_morning_review', v_audit);

    if v_old.id is null then
      insert into public.attendance (
        worker_id, attendance_date, status, check_in, check_out, note, recorded_by,
        attendance_source, manual_override, biometric_sync_metadata
      ) values (
        v_worker_id, p_date, v_status, null, null, v_note, v_actor,
        'manual', true, v_metadata
      );
    else
      update public.attendance a set
        status = v_status,
        check_in = case when v_status = 'absent' then null else a.check_in end,
        check_out = case when v_status = 'absent' then null else a.check_out end,
        review_approved_check_out_at = case when v_status = 'absent' then null else a.review_approved_check_out_at end,
        attendance_source = 'manual', manual_override = true,
        note = v_note, recorded_by = v_actor, biometric_sync_metadata = v_metadata
      where a.id = v_old.id;
    end if;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('date', p_date, 'worker_count', cardinality(p_worker_ids),
    'applied', v_applied, 'applied_at', v_applied_at);
end;
$$;

revoke all on function public.admin_save_supervisor_morning_review(date, uuid[], jsonb) from public, anon;
grant execute on function public.admin_save_supervisor_morning_review(date, uuid[], jsonb) to authenticated;
comment on function public.admin_save_supervisor_morning_review(date, uuid[], jsonb) is
  'Atomic admin-only supervisor morning decisions; previous state and actor are recorded in existing attendance metadata.';
