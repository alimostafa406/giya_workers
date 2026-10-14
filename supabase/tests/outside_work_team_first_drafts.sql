-- Production-safe regression: every test movement is rolled back.
begin;
do $$
declare
  v_admin uuid;
  v_worker uuid;
  v_team uuid;
  v_foreman uuid;
  v_other_worker uuid;
  v_other_team uuid;
  v_individual_id uuid;
  v_id uuid;
  v_payload jsonb;
  v_rejected boolean;
  v_date date := (now() at time zone 'Africa/Kinshasa')::date;
begin
  select id into v_admin from public.admins where is_active is true limit 1;
  select w.id, w.team_id into v_worker, v_team from public.workers w
    join public.teams t on t.id = w.team_id
    left join public.worker_staff_classification c on c.worker_id = w.id
    where w.is_active is true and t.is_active is true and t.name <> 'Adminstration'
      and coalesce(c.classification, 'normal') = 'normal'
      and (w.operational_start_date is null or w.operational_start_date <= v_date) limit 1;
  select w.id into v_foreman from public.workers w
    join public.worker_staff_classification c on c.worker_id = w.id
    where w.is_active is true and c.classification = 'special_staff' limit 1;
  if v_admin is null or v_worker is null or v_foreman is null then
    raise exception 'Active admin/normal worker/foreign foreman fixtures are required';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_admin,'role','authenticated')::text, true);
  if has_function_privilege('anon', 'public.admin_save_outside_work_movement(jsonb)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.outside_work_movements', 'INSERT') then
    raise exception 'Outside-work privilege regression';
  end if;
  v_id := public.admin_save_outside_work_movement(jsonb_build_object(
    'status','draft','missing_worker_note','WhatsApp unresolved test','entry_state',jsonb_build_object('otherSearch','064')));
  if not exists (select 1 from public.outside_work_movements where id=v_id and status='draft'
    and work_date is null and start_time is null and missing_worker_note='WhatsApp unresolved test'
    and entry_state->>'otherSearch'='064') then
    raise exception 'Incomplete draft was not preserved';
  end if;
  v_payload := jsonb_build_object('id',v_id,'status','draft','work_date',v_date,'team_id',v_team,
    'foreman_worker_id',v_foreman,'start_time','08:00','end_time','17:00',
    'common_worker_start','08:00','common_worker_end','17:00','missing_worker_note','Unresolved worker',
    'workers',jsonb_build_array(jsonb_build_object('worker_id',v_worker,'start_time',null,'end_time',null)));
  perform public.admin_save_outside_work_movement(v_payload);
  if not exists (select 1 from public.outside_work_movement_workers where movement_id=v_id
    and worker_id=v_worker and start_time is null and end_time is null) then
    raise exception 'Explicitly missing draft worker times were not preserved';
  end if;
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(v_payload || jsonb_build_object('status','final'));
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Missing worker times allowed final save'; end if;
  if (select status from public.outside_work_movements where id=v_id) <> 'draft' then
    raise exception 'Failed promotion changed the draft';
  end if;
  v_payload := v_payload || jsonb_build_object('status','final','missing_worker_note',null,
    'workers',jsonb_build_array(jsonb_build_object('worker_id',v_worker,'start_time','08:00','end_time','17:00')));
  perform public.admin_save_outside_work_movement(v_payload);
  perform public.admin_save_outside_work_movement(v_payload);
  if not exists (select 1 from public.outside_work_movements where id=v_id and status='final')
    or (select count(*) from public.outside_work_movement_workers where movement_id=v_id) <> 1
    or (select team_id from public.workers where id=v_worker) is distinct from v_team then
    raise exception 'Final save, repeated save, or unchanged worker-team regression';
  end if;
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(jsonb_build_object('status','final',
      'work_date',v_date,'team_id',v_team,'foreman_worker_id',v_worker,'start_time','08:00','end_time','17:00',
      'workers',jsonb_build_array(jsonb_build_object('worker_id',v_worker,'start_time','08:00','end_time','17:00'))));
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Normal worker allowed as a new foreman'; end if;

  -- The new entry flow needs only a team and individually timed worker IDs.
  select w.id, w.team_id into v_other_worker, v_other_team from public.workers w
    join public.teams t on t.id = w.team_id
    left join public.worker_staff_classification c on c.worker_id = w.id
    where w.is_active is true and t.is_active is true and t.name <> 'Adminstration'
      and w.team_id <> v_team and coalesce(c.classification, 'normal') = 'normal'
      and (w.operational_start_date is null or w.operational_start_date <= v_date) limit 1;
  if v_other_worker is null then raise exception 'Cross-team fixture required'; end if;
  v_payload := jsonb_build_object('status','draft','work_date',v_date,'team_id',v_team,
    'workers',jsonb_build_array(
      jsonb_build_object('worker_id',v_worker,'start_time','09:00','end_time','17:00'),
      jsonb_build_object('worker_id',v_other_worker,'start_time','08:00','end_time',null)));
  v_individual_id := public.admin_save_outside_work_movement(v_payload);
  if not exists (select 1 from public.outside_work_movement_workers where movement_id=v_individual_id
    and worker_id=v_other_worker and end_time is null) then raise exception 'Individual draft times not preserved'; end if;
  v_payload := v_payload || jsonb_build_object('id',v_individual_id,'status','final',
    'workers',jsonb_build_array(
      jsonb_build_object('worker_id',v_worker,'start_time','09:00','end_time','17:00'),
      jsonb_build_object('worker_id',v_other_worker,'start_time','08:00','end_time','16:30')));
  perform public.admin_save_outside_work_movement(v_payload);
  perform public.admin_save_outside_work_movement(v_payload);
  if not exists (select 1 from public.outside_work_movements where id=v_individual_id and status='final'
      and foreman_worker_id is null and foreman_name is null and start_time is null and end_time is null)
    or (select count(*) from public.outside_work_movement_workers where movement_id=v_individual_id) <> 2
    or not exists (select 1 from public.outside_work_movement_workers where movement_id=v_individual_id
      and worker_id=v_other_worker and start_time=time '08:00' and end_time=time '16:30')
    or (select team_id from public.workers where id=v_other_worker) is distinct from v_other_team then
    raise exception 'Individual final save or cross-team ownership regression';
  end if;
  perform public.admin_save_outside_work_movement(jsonb_build_object('id',v_id,'status','final',
    'work_date',v_date,'team_id',v_team,'foreman_worker_id',v_foreman,'start_time','08:00','end_time','17:00',
    'note','Preserved historical note','missing_worker_note','Preserved historical reminder',
    'workers',jsonb_build_array(jsonb_build_object('worker_id',v_worker,'start_time','08:00','end_time','17:00'))));
  if not exists (select 1 from public.outside_work_movements where id=v_id
    and foreman_worker_id=v_foreman and note='Preserved historical note'
    and missing_worker_note='Preserved historical reminder') then
    raise exception 'Archived fields were lost or incorrectly blocked final save';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(jsonb_build_object('status','draft'));
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Non-admin could save outside work'; end if;
end;
$$;
rollback;
select 'Outside-work individual times/cross-team/draft/history/security checks passed; test data rolled back' as result;
