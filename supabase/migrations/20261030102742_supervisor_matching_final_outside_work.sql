-- Matching supervisor O records agreement without replacing canonical FINAL
-- outside-work attendance. Existing auth, payroll locks, snapshot population,
-- transaction boundaries and stale draft/version checks remain unchanged.
CREATE OR REPLACE FUNCTION public.admin_save_supervisor_morning_review(p_date date, p_worker_ids uuid[], p_results jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
  v_matching_outside_work boolean;
begin
  if v_actor is null or not public.is_admin()
    or not exists (select 1 from public.admins where id = v_actor and is_active is true) then
    raise exception 'Active admin access is required' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today or extract(isodow from p_date) = 7
    or (p_date = v_today and (now() at time zone 'Africa/Kinshasa')::time < time '11:00') then
    raise exception 'Select an eligible non-future date; today requires the final 11:00 review' using errcode = '22023';
  end if;
  if p_worker_ids is null or cardinality(p_worker_ids) not between 1 and 500
    or p_results is null or jsonb_typeof(p_results) <> 'object' then
    raise exception 'Invalid supervisor morning review' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_each_text(p_results)) <> cardinality(p_worker_ids) then
    raise exception 'Every frozen-list worker must have one result' using errcode = '22023';
  end if;

  -- Serialize financial finalization against attendance edits.
  lock table public.payroll_run in share mode;
  foreach v_worker_id in array (select array_agg(id order by id) from unnest(p_worker_ids) id) loop
    perform pg_advisory_xact_lock(hashtextextended(v_worker_id::text || ':' || p_date::text, 0));
    if exists (select 1 from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
      where l.worker_id=v_worker_id and p_date between l.attendance_period_start and l.attendance_period_end
      and r.status in ('finalized','paid')) then
      raise exception 'Attendance is read-only for finalized/paid payroll' using errcode='23514';
    end if;
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
    if (private.final_supervisor_review(p_date,false)->>'exact_population')::boolean then
      if not exists(select 1 from jsonb_array_elements(private.final_supervisor_review(p_date,false)->'workers') w where w->>'id'=v_worker_id::text) then
        raise exception 'Worker is outside the finalized supervisor review population' using errcode='23514';
      end if;
    elsif p_date < v_today then
      if not exists(select 1 from jsonb_array_elements(private.supervisor_review_snapshot(p_date)->'workers') w
        where w->>'id'=v_worker_id::text) then
        raise exception 'No reliable historical eligibility for this worker/date' using errcode='23514';
      end if;
    elsif not found or v_active is not true or v_team is null
      or v_team = 'Adminstration' or v_classification <> 'normal'
      or (v_start is not null and v_start > p_date) then
      raise exception 'Worker % is not eligible for supervisor review', v_worker_id using errcode = '22023';
    end if;

    select a.* into v_old from public.attendance a
      where a.worker_id = v_worker_id and a.attendance_date = p_date for update;
    -- Only a matching O backed by a real FINAL movement may bypass the
    -- generic non-biometric protection. Do not turn it into manual attendance.
    v_matching_outside_work := coalesce(v_old.id is not null
      and v_old.attendance_source = 'outside_work' and v_old.status = 'present'
      and v_old.manual_override is false and v_old.emergency_overtime_mode is null
      and v_choice = 'O'
      and cardinality(private.outside_work_evidence_ids(v_worker_id,p_date)) > 0,false);
    if v_old.attendance_source = 'outside_work' and not v_matching_outside_work then
      raise exception 'Worker % has protected outside-work attendance; review it separately', v_worker_id
        using errcode = '23514';
    end if;
    if not v_matching_outside_work and v_old.id is not null and v_old.biometric_sync_metadata -> 'supervisor_morning_review' ->> 'source' is distinct from 'supervisor_sheet' and
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
      'updated_at', v_old.updated_at, 'supervisor_morning_review', v_old.biometric_sync_metadata -> 'supervisor_morning_review') end;
    v_metadata := coalesce(v_old.biometric_sync_metadata, '{}'::jsonb);
    if jsonb_typeof(v_metadata) <> 'object' then
      raise exception 'Worker % has unsupported attendance metadata', v_worker_id using errcode = '23514';
    end if;
    v_audit := jsonb_build_object(
      'source', 'supervisor_sheet', 'worker_id', v_worker_id, 'attendance_date', p_date,
      'choice', v_choice, 'status', v_status, 'reason', v_reason,
      'previous', v_previous, 'actor', v_actor, 'applied_at', v_applied_at);
    v_metadata := v_metadata || jsonb_build_object('supervisor_morning_review', v_audit,
      'supervisor_morning_review_history', coalesce(v_metadata->'supervisor_morning_review_history','[]'::jsonb) || jsonb_build_array(v_audit));

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
        attendance_source = case when v_matching_outside_work then a.attendance_source else 'manual' end,
        manual_override = case when v_matching_outside_work then false else true end,
        note = case when v_matching_outside_work then a.note else v_note end,
        recorded_by = v_actor, biometric_sync_metadata = v_metadata
      where a.id = v_old.id;
    end if;
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('date', p_date, 'worker_count', cardinality(p_worker_ids),
    'applied', v_applied, 'applied_at', v_applied_at);
end;
$function$;

CREATE OR REPLACE FUNCTION private.supervisor_official_decision_token(p_date date, p_ids uuid[])
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  select md5(coalesce(jsonb_agg(jsonb_build_array(worker_id,biometric_sync_metadata->'supervisor_morning_review') order by worker_id)::text,'[]'))
  from public.attendance where attendance_date=p_date and worker_id=any(p_ids)
    and (manual_override is true or (attendance_source='outside_work' and status='present'
      and manual_override is false and emergency_overtime_mode is null
      and biometric_sync_metadata->'supervisor_morning_review'->>'choice'='O'))
    and biometric_sync_metadata->'supervisor_morning_review'->>'source'='supervisor_sheet';
$function$;

notify pgrst,'reload schema';
