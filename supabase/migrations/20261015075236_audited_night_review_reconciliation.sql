-- Operator-only, explicitly authorized and audited historical corrections. Normal snapshot
-- writes remain immutable; no public/admin API receives mutation privileges.
create table private.night_supervisor_review_correction (
  id uuid primary key default gen_random_uuid(),
  attendance_date date not null references private.supervisor_review_daily_snapshot(attendance_date),
  corrected_at timestamptz not null default now(),
  transaction_id bigint not null default txid_current(),
  actor text not null default session_user,
  reason text not null check (btrim(reason) <> ''),
  snapshot_before jsonb not null,
  snapshot_after jsonb not null,
  evidence jsonb not null check (jsonb_typeof(evidence)='array')
);
alter table private.night_supervisor_review_correction enable row level security;
revoke all on private.night_supervisor_review_correction from public,anon,authenticated,service_role;

create or replace function private.protect_supervisor_review_snapshot()
returns trigger language plpgsql set search_path=public,private,pg_temp as $$
begin
  if tg_table_name='supervisor_review_daily_snapshot' and tg_op='UPDATE' and current_user='postgres' then
    if exists(select 1 from private.night_supervisor_review_correction c
      where c.attendance_date=old.attendance_date and c.transaction_id=txid_current()
        and c.snapshot_before=to_jsonb(old) and c.snapshot_after=to_jsonb(new)) then
      return new;
    end if;
  end if;
  raise exception 'Final supervisor review populations are immutable' using errcode='23514';
end;
$$;
create trigger night_review_correction_append_only before update or delete
  on private.night_supervisor_review_correction for each row
  execute function private.protect_supervisor_review_snapshot();

create function private.correct_night_supervisor_review(p_date date,p_evidence jsonb,p_reason text)
returns jsonb language plpgsql set search_path=public,private,pg_temp as $$
declare
  s private.supervisor_review_daily_snapshot%rowtype;
  a public.attendance%rowtype;
  proof jsonb; first_at timestamptz; last_at timestamptz; event_count integer;
  worker_ids text[] := array[]::text[]; remaining jsonb; audit_id uuid;
begin
  if current_user <> 'postgres' then raise exception 'Operator access required' using errcode='42501'; end if;
  if p_date is null or p_date < date '2026-10-12' or p_date > (now() at time zone 'Africa/Kinshasa')::date
    or jsonb_typeof(p_evidence) is distinct from 'array' or nullif(btrim(p_reason),'') is null then
    raise exception 'Invalid night correction scope' using errcode='22023';
  end if;
  for proof in select value from jsonb_array_elements(p_evidence) loop
    select at.* into a from public.attendance at join public.workers w on w.id=at.worker_id
      where w.id=(proof->>'worker_id')::uuid and w.attendance_shift='night'
        and at.attendance_date=p_date and at.status='present' and at.attendance_day_fraction=1
        and at.attendance_source='biometric' and at.manual_override is false
        and not (coalesce(at.biometric_sync_metadata,'{}'::jsonb) ? 'supervisor_morning_review');
    if not found then raise exception 'Missing unprotected canonical night attendance'; end if;
    -- Validate the persisted evidence selected by the shared Python resolver.
    -- Exact-device confirmed ownership takes precedence over legacy null-device
    -- mappings. Conflicts and ignored identities fail closed, never name-match.
    select min(e.event_timestamp),max(e.event_timestamp),count(*) into first_at,last_at,event_count
      from public.biometric_attendance_events e
      where e.id::text in (select value from jsonb_array_elements_text(proof->'event_ids'))
        and e.worker_id=a.worker_id
        and e.event_timestamp >= (p_date+time '17:00') at time zone 'Africa/Kinshasa'
        and e.event_timestamp <= (p_date+1+time '06:30') at time zone 'Africa/Kinshasa'
        and not exists(select 1 from public.biometric_device_identity_review r
          where r.device_employee_no=e.device_employee_no and r.review_state='ignored'
            and (r.device_id=e.device_id or (r.device_id is null and not exists(
              select 1 from public.biometric_worker_mapping m where m.device_id=e.device_id
                and m.device_employee_no=e.device_employee_no and m.is_active and m.mapping_review_state='confirmed'))))
        and (select count(distinct m.worker_id)=1 and bool_and(m.worker_id=a.worker_id)
          from public.biometric_worker_mapping m
          where m.device_employee_no=e.device_employee_no and m.is_active and m.mapping_review_state='confirmed'
            and (m.device_id=e.device_id or (m.device_id is null and not exists(
              select 1 from public.biometric_worker_mapping exact where exact.device_id=e.device_id
                and exact.device_employee_no=e.device_employee_no and exact.is_active and exact.mapping_review_state='confirmed'))));
    if event_count=0 or event_count<>jsonb_array_length(proof->'event_ids')
      or a.check_in is distinct from (first_at at time zone 'Africa/Kinshasa')::time
      or a.check_out is distinct from (case when last_at>first_at then (last_at at time zone 'Africa/Kinshasa')::time else null end) then
      raise exception 'Night attendance does not match safe real evidence';
    end if;
    worker_ids := array_append(worker_ids,a.worker_id::text);
  end loop;
  select * into s from private.supervisor_review_daily_snapshot where attendance_date=p_date for update;
  if not found then return jsonb_build_object('date',p_date,'snapshot_exists',false,'removed',0); end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into remaining
    from jsonb_array_elements(s.workers) with ordinality where not coalesce(value->>'id'=any(worker_ids),false);
  if remaining=s.workers then return jsonb_build_object('date',p_date,'snapshot_exists',true,'removed',0,'count',jsonb_array_length(remaining)); end if;
  insert into private.night_supervisor_review_correction(attendance_date,reason,snapshot_before,snapshot_after,evidence)
    values(p_date,p_reason,to_jsonb(s),to_jsonb(s)||jsonb_build_object('workers',remaining,'version',s.version+1),p_evidence)
    returning id into audit_id;
  update private.supervisor_review_daily_snapshot set workers=remaining,version=s.version+1 where attendance_date=p_date;
  return jsonb_build_object('date',p_date,'snapshot_exists',true,'removed',jsonb_array_length(s.workers)-jsonb_array_length(remaining),
    'count',jsonb_array_length(remaining),'audit_id',audit_id);
end;
$$;
revoke all on function private.correct_night_supervisor_review(date,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function private.protect_supervisor_review_snapshot() from public,anon,authenticated,service_role;

-- Explicit shift classification also applies to night workers in Chauffeur.
-- Day Chauffeurs and all existing historical issue rows remain unchanged.
create or replace function public.capture_early_morning_biometric_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_local_time time; v_local_date date;
begin
  v_local_time := (new.event_timestamp at time zone 'Africa/Kinshasa')::time;
  v_local_date := (new.event_timestamp at time zone 'Africa/Kinshasa')::date;
  if exists(select 1 from public.workers w where w.id=new.worker_id and w.attendance_shift='night') then return new; end if;
  if v_local_time >= time '01:00' and v_local_time < time '06:00' then
    insert into public.biometric_early_morning_review(event_id,worker_id,event_timestamp,device_id,device_employee_no,event_identity,event_local_date)
      values(new.id,new.worker_id,new.event_timestamp,new.device_id,new.device_employee_no,new.event_identity,v_local_date)
      on conflict(event_id) do nothing;
  end if;
  return new;
end;
$$;
