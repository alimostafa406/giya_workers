-- Uses existing active people; all test movements and updates are rolled back.
begin;
do $$
declare
  v_admin uuid;
  v_foreman uuid;
  v_worker_a uuid;
  v_worker_b uuid;
  v_team_a uuid;
  v_team_b uuid;
  v_id uuid;
  v_payload jsonb;
  v_rejected boolean;
  v_date date := (now() at time zone 'Africa/Kinshasa')::date;
begin
  select id into strict v_admin from public.admins where is_active is true limit 1;
  select w.id into strict v_foreman from public.workers w
    join public.worker_staff_classification c on c.worker_id=w.id
    where w.is_active is true and c.classification='special_staff' and w.team_id is null limit 1;
  select w.id,w.team_id into strict v_worker_a,v_team_a from public.workers w
    join public.teams t on t.id=w.team_id
    left join public.worker_staff_classification c on c.worker_id=w.id
    where w.is_active is true and t.is_active is true and t.name<>'Adminstration'
      and coalesce(c.classification,'normal')='normal'
      and (w.operational_start_date is null or w.operational_start_date<=v_date) limit 1;
  select w.id,w.team_id into strict v_worker_b,v_team_b from public.workers w
    join public.teams t on t.id=w.team_id
    left join public.worker_staff_classification c on c.worker_id=w.id
    where w.is_active is true and t.is_active is true and t.name<>'Adminstration'
      and w.team_id<>v_team_a and coalesce(c.classification,'normal')='normal'
      and (w.operational_start_date is null or w.operational_start_date<=v_date) limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  v_payload := jsonb_build_object('work_date',v_date,'status','final','team_id',null,
    'foreman_worker_id',v_foreman,'start_time','08:00','end_time','17:00',
    'common_worker_start','08:00','common_worker_end','17:00',
    'workers',jsonb_build_array(
      jsonb_build_object('worker_id',v_worker_a,'start_time','08:00','end_time','17:00'),
      jsonb_build_object('worker_id',v_worker_b,'start_time','08:00','end_time','17:00')));
  v_id := public.admin_save_outside_work_movement(v_payload);
  v_payload := v_payload || jsonb_build_object('id',v_id);
  -- Reload and re-save the exact canonical child-worker set, not a team roster.
  select v_payload || jsonb_build_object('workers',jsonb_agg(jsonb_build_object(
    'worker_id',worker_id,'start_time',start_time,'end_time',end_time))) into v_payload
    from public.outside_work_movement_workers where movement_id=v_id;
  perform public.admin_save_outside_work_movement(v_payload);
  if not exists (select 1 from public.outside_work_movements
      where id=v_id and team_id is null and foreman_worker_id=v_foreman and status='final')
    or (select count(*) from public.outside_work_movement_workers where movement_id=v_id)<>2
    or (select count(distinct worker_id) from public.outside_work_movement_workers where movement_id=v_id)<>2
    or not exists (select 1 from public.outside_work_movement_workers where movement_id=v_id and worker_id=v_worker_a)
    or not exists (select 1 from public.outside_work_movement_workers where movement_id=v_id and worker_id=v_worker_b)
    or (select team_id from public.workers where id=v_worker_a) is distinct from v_team_a
    or (select team_id from public.workers where id=v_worker_b) is distinct from v_team_b
    or (select team_id from public.workers where id=v_foreman) is not null then
    raise exception 'No-team persistence/reload/resave or original-team regression';
  end if;
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(v_payload || jsonb_build_object('foreman_worker_id',null));
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Final movement without team or foreman was accepted'; end if;
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(v_payload || jsonb_build_object('workers','[]'::jsonb));
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Final movement without workers was accepted'; end if;
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(v_payload || jsonb_build_object('foreman_worker_id',v_worker_a));
  exception when sqlstate '22023' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Normal worker accepted as foreign foreman'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  v_rejected := false;
  begin
    perform public.admin_save_outside_work_movement(v_payload);
  exception when sqlstate '42501' then v_rejected := true;
  end;
  if not v_rejected then raise exception 'Non-admin accepted'; end if;
end;
$$;
rollback;
select 'No-team foreman/multi-team worker persistence, reload/resave, unchanged ownership and validation passed; all test data rolled back' as result;
