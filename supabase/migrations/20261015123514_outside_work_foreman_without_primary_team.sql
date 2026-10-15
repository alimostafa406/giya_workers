-- Permit a final movement with a primary team OR an existing validated foreman.
-- Does not reassign workers, change eligibility, or alter historical movements.
alter table public.outside_work_movements drop constraint outside_work_final_fields;
alter table public.outside_work_movements add constraint outside_work_final_fields
  check (status = 'draft' or (work_date is not null and (team_id is not null or foreman_worker_id is not null))) not valid;

create or replace function public.admin_save_outside_work_movement(p_movement jsonb) returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid := nullif(p_movement ->> 'id', '')::uuid;
  v_date date := nullif(p_movement ->> 'work_date', '')::date;
  v_team uuid := nullif(p_movement ->> 'team_id', '')::uuid;
  v_status text := coalesce(p_movement ->> 'status', 'final');
  v_foreman uuid := nullif(p_movement ->> 'foreman_worker_id', '')::uuid;
  v_foreman_name text := nullif(btrim(p_movement ->> 'foreman_name'), '');
  v_start time := nullif(p_movement ->> 'start_time', '')::time;
  v_end time := nullif(p_movement ->> 'end_time', '')::time;
  v_common_start time := nullif(p_movement ->> 'common_worker_start', '')::time;
  v_common_end time := nullif(p_movement ->> 'common_worker_end', '')::time;
  v_missing text := nullif(btrim(p_movement ->> 'missing_worker_note'), '');
  v_workers jsonb := coalesce(p_movement -> 'workers', '[]'::jsonb);
  v_entry jsonb := coalesce(p_movement -> 'entry_state', '{}'::jsonb);
  v_old public.outside_work_movements%rowtype;
  v_item jsonb;
  v_worker uuid;
  v_name text;
  v_worker_start time;
  v_worker_end time;
  v_seen uuid[] := array[]::uuid[];
  v_legacy boolean := false;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Active admin access required' using errcode = '42501';
  end if;
  if p_movement is null or jsonb_typeof(p_movement) <> 'object'
    or v_status not in ('draft', 'final') or jsonb_typeof(v_workers) <> 'array'
    or jsonb_array_length(v_workers) > 500 or jsonb_typeof(v_entry) <> 'object' then
    raise exception 'Invalid outside-work entry' using errcode = '22023';
  end if;
  if v_id is not null then
    select * into v_old from public.outside_work_movements where id = v_id for update;
    if not found then raise exception 'Outside-work movement not found' using errcode = 'P0002'; end if;
    v_legacy := v_old.status = 'final' and v_date is not distinct from v_old.work_date;
  end if;
  if v_team is not null and not exists (select 1 from public.teams t
    where t.id = v_team and (t.is_active is true or (v_legacy and v_team = v_old.team_id))) then
    raise exception 'Select an active team' using errcode = '22023';
  end if;
  if v_foreman is not null then
    select w.full_name into v_foreman_name from public.workers w
      left join public.worker_staff_classification c on c.worker_id = w.id
      where w.id = v_foreman and ((w.is_active is true and c.classification = 'special_staff')
        or (v_legacy and v_foreman = v_old.foreman_worker_id)
        or (v_old.id is not null and v_foreman = v_old.foreman_worker_id));
    if v_foreman_name is null then
      raise exception 'Select an active foreign/special-staff foreman' using errcode = '22023';
    end if;
  end if;
  if v_status = 'final' and (v_date is null or (v_team is null and v_foreman is null) or jsonb_array_length(v_workers) = 0) then
    raise exception 'Final movement requires date, a team or foreman, and real workers'
      using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.outside_work_movements(work_date, team_id, status, foreman_worker_id,
      foreman_name, start_time, end_time, common_worker_start, common_worker_end,
      missing_worker_note, entry_state, note, created_by)
    values (v_date, v_team, v_status, v_foreman, v_foreman_name, v_start, v_end,
      v_common_start, v_common_end, v_missing, v_entry,
      nullif(btrim(p_movement ->> 'note'), ''), v_actor) returning id into v_id;
  else
    update public.outside_work_movements set work_date = v_date, team_id = v_team,
      status = v_status, foreman_worker_id = v_foreman, foreman_name = v_foreman_name,
      start_time = v_start, end_time = v_end, common_worker_start = v_common_start,
      common_worker_end = v_common_end, missing_worker_note = v_missing,
      entry_state = v_entry, note = nullif(btrim(p_movement ->> 'note'), ''), updated_at = now()
    where id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(v_workers) loop
    v_worker := nullif(v_item ->> 'worker_id', '')::uuid;
    v_worker_start := case when v_item ? 'start_time' then nullif(v_item ->> 'start_time', '')::time else v_common_start end;
    v_worker_end := case when v_item ? 'end_time' then nullif(v_item ->> 'end_time', '')::time else v_common_end end;
    if jsonb_typeof(v_item) <> 'object' or v_worker is null or v_worker = any(v_seen) then
      raise exception 'Invalid or repeated real worker' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_worker);
    select w.full_name into v_name from public.workers w
      left join public.teams t on t.id = w.team_id
      left join public.worker_staff_classification c on c.worker_id = w.id
      where w.id = v_worker and (
        (w.is_active is true and coalesce(c.classification, 'normal') = 'normal'
          and t.name is not null and t.name <> 'Adminstration'
          and (v_date is null or w.operational_start_date is null or w.operational_start_date <= v_date))
        or ((v_legacy or v_status = 'draft') and exists (
          select 1 from public.outside_work_movement_workers x where x.movement_id = v_old.id and x.worker_id = v_worker)));
    if v_name is null then raise exception 'Worker is not eligible for this date' using errcode = '22023'; end if;
    if v_status = 'final' and (v_worker_start is null or v_worker_end is null or v_worker_end <= v_worker_start) then
      raise exception 'Every final worker needs valid start/end times' using errcode = '22023';
    end if;
    insert into public.outside_work_movement_workers(movement_id, worker_id, worker_name, start_time, end_time)
    values(v_id, v_worker, v_name, v_worker_start, v_worker_end)
    on conflict (movement_id, worker_id) do update set start_time = excluded.start_time, end_time = excluded.end_time;
  end loop;
  delete from public.outside_work_movement_workers where movement_id = v_id and not (worker_id = any(v_seen));
  return v_id;
end;
$$;
revoke all on function public.admin_save_outside_work_movement(jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_outside_work_movement(jsonb) to authenticated;
