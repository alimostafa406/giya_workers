-- REVIEW / EXECUTE MANUALLY: atomic biometric auto-reactivation with audit.
-- The attendance agent invokes this only after persisting a real device event.
-- No employee-code/name matching and no team changes are permitted here.

create table if not exists public.worker_biometric_reactivation_audit (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  previous_is_active boolean not null check (previous_is_active is false),
  new_is_active boolean not null check (new_is_active is true),
  reactivated_at timestamptz not null default now(),
  source text not null check (source = 'biometric_auto_reactivation'),
  device_id text not null check (btrim(device_id) <> ''),
  device_employee_no text not null check (btrim(device_employee_no) <> ''),
  biometric_event_id uuid not null references public.biometric_attendance_events(id) on delete restrict,
  team_id_snapshot uuid references public.teams(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint worker_biometric_reactivation_audit_event_unique unique (biometric_event_id)
);

create index if not exists worker_biometric_reactivation_audit_worker_time_idx
  on public.worker_biometric_reactivation_audit (worker_id, reactivated_at desc);

alter table public.worker_biometric_reactivation_audit enable row level security;
drop policy if exists worker_biometric_reactivation_audit_admin_select on public.worker_biometric_reactivation_audit;
create policy worker_biometric_reactivation_audit_admin_select
on public.worker_biometric_reactivation_audit
for select to authenticated using (public.is_admin());

revoke all on table public.worker_biometric_reactivation_audit from public, anon, authenticated;
grant select on table public.worker_biometric_reactivation_audit to authenticated;

create or replace function public.reactivate_worker_from_biometric_event(
  p_device_id text,
  p_event_identity text
)
returns table (
  event_id uuid,
  worker_id uuid,
  outcome text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.biometric_attendance_events%rowtype;
  v_worker public.workers%rowtype;
  v_worker_id uuid;
  v_owner_count integer;
  v_best_priority integer;
begin
  if btrim(coalesce(p_device_id, '')) = '' or coalesce(p_event_identity, '') = '' then
    return query select null::uuid, null::uuid, 'invalid_event_reference'::text;
    return;
  end if;

  select e.* into v_event
  from public.biometric_attendance_events as e
  where e.device_id = btrim(p_device_id)
    and e.event_identity = p_event_identity
  for update;

  if not found then
    return query select null::uuid, null::uuid, 'event_not_persisted'::text;
    return;
  end if;

  select min(case when m.device_id = v_event.device_id then 1 else 2 end)
  into v_best_priority
  from public.biometric_worker_mapping as m
  where m.is_active is true
    and m.mapping_review_state = 'confirmed'
    and btrim(m.device_employee_no) = btrim(v_event.device_employee_no)
    and (m.device_id = v_event.device_id or m.device_id is null);

  if v_best_priority is null then
    return query select v_event.id, null::uuid, 'no_confirmed_mapping'::text;
    return;
  end if;

  select
    count(distinct m.worker_id),
    (array_agg(m.worker_id order by m.updated_at desc, m.id))[1]
  into v_owner_count, v_worker_id
  from public.biometric_worker_mapping as m
  where m.is_active is true
    and m.mapping_review_state = 'confirmed'
    and btrim(m.device_employee_no) = btrim(v_event.device_employee_no)
    and (m.device_id = v_event.device_id or m.device_id is null)
    and case when m.device_id = v_event.device_id then 1 else 2 end = v_best_priority;

  if v_owner_count <> 1 or v_worker_id is null then
    return query select v_event.id, null::uuid, 'ambiguous_mapping'::text;
    return;
  end if;

  select w.* into v_worker
  from public.workers as w
  where w.id = v_worker_id
  for update;

  if not found then
    return query select v_event.id, v_worker_id, 'worker_not_found'::text;
    return;
  end if;

  if v_worker.is_active is true then
    update public.biometric_attendance_events as e
    set worker_id = v_worker.id
    where e.id = v_event.id
      and e.worker_id is distinct from v_worker.id;
    return query select v_event.id, v_worker.id, 'already_active'::text;
    return;
  end if;

  -- Preserve team_id and every other worker attribute. Only is_active changes.
  update public.workers as w
  set is_active = true
  where w.id = v_worker.id
    and w.is_active is false;

  update public.biometric_attendance_events as e
  set worker_id = v_worker.id
  where e.id = v_event.id;

  insert into public.worker_biometric_reactivation_audit (
    worker_id, previous_is_active, new_is_active, source,
    device_id, device_employee_no, biometric_event_id, team_id_snapshot
  ) values (
    v_worker.id, false, true, 'biometric_auto_reactivation',
    v_event.device_id, v_event.device_employee_no, v_event.id, v_worker.team_id
  )
  on conflict (biometric_event_id) do nothing;

  return query select v_event.id, v_worker.id, 'reactivated'::text;
end;
$$;

revoke all on function public.reactivate_worker_from_biometric_event(text, text) from public, anon, authenticated;
grant execute on function public.reactivate_worker_from_biometric_event(text, text) to service_role;
