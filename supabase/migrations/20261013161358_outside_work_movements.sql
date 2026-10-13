-- Manual outside-work records. These tables deliberately have no attendance or payroll hooks.
create table public.outside_work_movements (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  foreman_worker_id uuid references public.workers(id) on delete restrict,
  foreman_name text not null check (btrim(foreman_name) <> ''),
  start_time time without time zone not null,
  end_time time without time zone not null,
  note text,
  created_by uuid not null references public.admins(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outside_work_movement_time_order check (end_time > start_time)
);
create index outside_work_movements_date_idx on public.outside_work_movements (work_date, start_time);

create table public.outside_work_movement_workers (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.outside_work_movements(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete restrict,
  worker_name text not null check (btrim(worker_name) <> ''),
  start_time time without time zone not null,
  end_time time without time zone not null,
  unique (movement_id, worker_id),
  constraint outside_work_worker_time_order check (end_time > start_time)
);

alter table public.outside_work_movements enable row level security;
alter table public.outside_work_movement_workers enable row level security;
revoke all on public.outside_work_movements, public.outside_work_movement_workers from public, anon, authenticated;
grant select on public.outside_work_movements, public.outside_work_movement_workers to authenticated;
create policy outside_work_movements_admin_select on public.outside_work_movements
  for select to authenticated using ((select public.is_admin()));
create policy outside_work_movement_workers_admin_select on public.outside_work_movement_workers
  for select to authenticated using ((select public.is_admin()));

-- One transaction saves the movement and its selected workers together.
create function public.admin_save_outside_work_movement(
  p_id uuid, p_date date, p_foreman_worker_id uuid, p_foreman_name text,
  p_start_time time without time zone, p_end_time time without time zone,
  p_note text, p_workers jsonb
) returns uuid
language plpgsql security definer set search_path = public, auth, pg_temp as $$
declare
  v_id uuid;
  v_actor uuid := auth.uid();
  v_item jsonb;
  v_worker_id uuid;
  v_name text;
  v_start time without time zone;
  v_end time without time zone;
  v_seen uuid[] := array[]::uuid[];
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Active admin access required' using errcode = '42501';
  end if;
  if p_date is null or nullif(btrim(p_foreman_name), '') is null
    or p_start_time is null or p_end_time is null or p_end_time <= p_start_time
    or p_workers is null or jsonb_typeof(p_workers) <> 'array'
    or jsonb_array_length(p_workers) > 500 then
    raise exception 'Invalid outside-work movement' using errcode = '22023';
  end if;
  if p_foreman_worker_id is not null and not exists (
    select 1 from public.workers w where w.id = p_foreman_worker_id
      and (w.is_active is true or (p_id is not null and exists (
        select 1 from public.outside_work_movements m
        where m.id = p_id and m.foreman_worker_id = p_foreman_worker_id)))
  ) then
    raise exception 'Foreman worker is not available' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.outside_work_movements
      (work_date, foreman_worker_id, foreman_name, start_time, end_time, note, created_by)
    values (p_date, p_foreman_worker_id, btrim(p_foreman_name), p_start_time, p_end_time,
      nullif(btrim(p_note), ''), v_actor)
    returning id into v_id;
  else
    update public.outside_work_movements
      set work_date = p_date, foreman_worker_id = p_foreman_worker_id,
        foreman_name = btrim(p_foreman_name), start_time = p_start_time,
        end_time = p_end_time, note = nullif(btrim(p_note), ''), updated_at = now()
      where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'Outside-work movement not found' using errcode = 'P0002';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_workers) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Invalid worker entry' using errcode = '22023';
    end if;
    v_worker_id := (v_item ->> 'worker_id')::uuid;
    v_start := (v_item ->> 'start_time')::time;
    v_end := (v_item ->> 'end_time')::time;
    if v_worker_id is null or v_worker_id = any(v_seen)
      or v_start is null or v_end is null or v_end <= v_start then
      raise exception 'Invalid or repeated worker entry' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_worker_id);
    select w.full_name into v_name from public.workers w
      where w.id = v_worker_id and (w.is_active is true or
        (p_id is not null and exists (select 1 from public.outside_work_movement_workers x
          where x.movement_id = p_id and x.worker_id = v_worker_id)));
    if v_name is null then
      raise exception 'Worker is not available for outside work' using errcode = '22023';
    end if;
  end loop;

  delete from public.outside_work_movement_workers where movement_id = v_id;
  for v_item in select value from jsonb_array_elements(p_workers) loop
    v_worker_id := (v_item ->> 'worker_id')::uuid;
    select full_name into v_name from public.workers where id = v_worker_id;
    insert into public.outside_work_movement_workers
      (movement_id, worker_id, worker_name, start_time, end_time)
    values (v_id, v_worker_id, v_name,
      (v_item ->> 'start_time')::time, (v_item ->> 'end_time')::time);
  end loop;
  return v_id;
end;
$$;

create function public.admin_delete_outside_work_movement(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Active admin access required' using errcode = '42501';
  end if;
  delete from public.outside_work_movements where id = p_id;
  if not found then
    raise exception 'Outside-work movement not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.admin_save_outside_work_movement(uuid,date,uuid,text,time without time zone,time without time zone,text,jsonb) from public, anon;
revoke all on function public.admin_delete_outside_work_movement(uuid) from public, anon;
grant execute on function public.admin_save_outside_work_movement(uuid,date,uuid,text,time without time zone,time without time zone,text,jsonb) to authenticated;
grant execute on function public.admin_delete_outside_work_movement(uuid) to authenticated;
