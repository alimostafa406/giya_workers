-- REVIEW / EXECUTE MANUALLY ONLY.
-- Narrow, auditable handling for valid biometric events observed from
-- 01:00:00 through 05:59:59 Africa/Kinshasa. No historical rows are backfilled.
-- This migration does not enable attendance_cross_midnight_session_shadow.sql.

alter table public.attendance
  add column if not exists review_approved_check_out_at timestamptz;

-- Preserve the existing same-day ordering rule. The only added exception is a
-- date-aware checkout explicitly approved through this review workflow.
alter table public.attendance
  drop constraint if exists attendance_checkout_after_checkin;
alter table public.attendance
  add constraint attendance_checkout_after_checkin check (
    check_in is null
    or check_out is null
    or check_out >= check_in
    or (
      review_approved_check_out_at is not null
      and (review_approved_check_out_at at time zone 'Africa/Kinshasa')::date = attendance_date + 1
      and (review_approved_check_out_at at time zone 'Africa/Kinshasa')::time = check_out
      and review_approved_check_out_at
        > ((attendance_date + check_in) at time zone 'Africa/Kinshasa')
    )
  );

create table if not exists public.biometric_early_morning_review (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.biometric_attendance_events(id) on delete restrict,
  worker_id uuid references public.workers(id) on delete restrict,
  event_timestamp timestamptz not null,
  device_id text not null check (btrim(device_id) <> ''),
  device_employee_no text not null check (btrim(device_employee_no) <> ''),
  device_name text,
  event_identity text not null,
  event_serial text,
  current_work_date date not null,
  previous_work_date date not null,
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'resolved')),
  review_decision text check (review_decision in (
    'current_day_check_in', 'previous_workday_check_out', 'ignored'
  )),
  reviewed_by uuid references public.admins(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint biometric_early_morning_review_event_unique unique (event_id),
  constraint biometric_early_morning_review_time_valid check (
    (event_timestamp at time zone 'Africa/Kinshasa')::time >= time '01:00:00'
    and (event_timestamp at time zone 'Africa/Kinshasa')::time < time '06:00:00'
  ),
  constraint biometric_early_morning_review_dates_valid check (
    current_work_date = (event_timestamp at time zone 'Africa/Kinshasa')::date
    and previous_work_date < current_work_date
  ),
  constraint biometric_early_morning_review_resolution_valid check (
    (review_status = 'needs_review' and review_decision is null and reviewed_by is null and reviewed_at is null)
    or
    (review_status = 'resolved' and review_decision is not null and reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists biometric_early_morning_review_pending_idx
  on public.biometric_early_morning_review (current_work_date, event_timestamp)
  where review_status = 'needs_review';
create index if not exists biometric_early_morning_review_worker_idx
  on public.biometric_early_morning_review (worker_id, current_work_date, review_status);

create or replace function public.previous_normal_work_date(p_date date)
returns date
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case extract(isodow from p_date)::integer
    when 1 then p_date - 2
    when 7 then p_date - 1
    else p_date - 1
  end;
$$;

create or replace function public.capture_early_morning_biometric_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_local_timestamp timestamp;
  v_serial text;
begin
  v_local_timestamp := new.event_timestamp at time zone 'Africa/Kinshasa';
  if v_local_timestamp::time < time '01:00:00'
     or v_local_timestamp::time >= time '06:00:00' then
    return new;
  end if;

  begin
    if jsonb_typeof(new.event_identity::jsonb) = 'array' then
      v_serial := new.event_identity::jsonb ->> 2;
    end if;
  exception when others then
    v_serial := null;
  end;

  insert into public.biometric_early_morning_review (
    event_id, worker_id, event_timestamp, device_id, device_employee_no,
    device_name, event_identity, event_serial, current_work_date,
    previous_work_date
  ) values (
    new.id, new.worker_id, new.event_timestamp, new.device_id,
    coalesce(nullif(btrim(new.device_employee_no), ''), new.event_identity),
    new.device_name, new.event_identity, v_serial, v_local_timestamp::date,
    public.previous_normal_work_date(v_local_timestamp::date)
  )
  on conflict (event_id) do update
    set worker_id = coalesce(public.biometric_early_morning_review.worker_id, excluded.worker_id)
  where public.biometric_early_morning_review.review_status = 'needs_review';

  return new;
end;
$$;

drop trigger if exists biometric_attendance_event_capture_early_review
  on public.biometric_attendance_events;
create trigger biometric_attendance_event_capture_early_review
after insert or update of worker_id on public.biometric_attendance_events
for each row execute function public.capture_early_morning_biometric_review();

create or replace function public.guard_pending_early_morning_absence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'absent' and exists (
    select 1
    from public.biometric_early_morning_review as r
    where r.worker_id = new.worker_id
      and r.current_work_date = new.attendance_date
      and r.review_status = 'needs_review'
  ) then
    raise exception 'Pending early-morning biometric review prevents absence';
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_guard_pending_early_morning_absence
  on public.attendance;
create trigger attendance_guard_pending_early_morning_absence
before insert or update of status on public.attendance
for each row execute function public.guard_pending_early_morning_absence();

create or replace function public.resolve_early_morning_biometric_review(
  p_review_id uuid,
  p_decision text
)
returns public.biometric_early_morning_review
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_review public.biometric_early_morning_review%rowtype;
  v_attendance public.attendance%rowtype;
  v_resolved_worker_id uuid;
  v_exact_count integer := 0;
  v_legacy_count integer := 0;
  v_local_timestamp timestamp;
  v_metadata jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Active admin access is required';
  end if;
  if p_decision not in ('current_day_check_in', 'previous_workday_check_out', 'ignored') then
    raise exception 'Unsupported early-morning review decision';
  end if;

  select r.* into v_review
  from public.biometric_early_morning_review as r
  where r.id = p_review_id
  for update;
  if v_review.id is null then
    raise exception 'Early-morning review item was not found';
  end if;
  if v_review.review_status = 'resolved' then
    if v_review.review_decision = p_decision then
      return v_review;
    end if;
    raise exception 'Early-morning review item is already resolved';
  end if;

  if p_decision = 'ignored' then
    update public.biometric_early_morning_review as r
    set review_status = 'resolved', review_decision = p_decision,
        reviewed_by = auth.uid(), reviewed_at = now()
    where r.id = v_review.id
    returning r.* into v_review;
    return v_review;
  end if;

  -- An exact device-scoped ignore governs its scope. A legacy/global ignore is
  -- consulted only when no exact confirmed mapping safely resolves the event.
  if exists (
    select 1 from public.biometric_device_identity_review as ir
    where ir.device_id = v_review.device_id
      and ir.device_employee_no = v_review.device_employee_no
      and ir.review_state = 'ignored'
  ) then
    raise exception 'This exact device identity is explicitly ignored';
  end if;

  select count(distinct m.worker_id), (array_agg(distinct m.worker_id))[1]
  into v_exact_count, v_resolved_worker_id
  from public.biometric_worker_mapping as m
  where m.device_id = v_review.device_id
    and m.device_employee_no = v_review.device_employee_no
    and m.is_active is true
    and m.mapping_review_state = 'confirmed';

  if v_exact_count = 0 then
    if exists (
      select 1 from public.biometric_device_identity_review as ir
      where ir.device_id is null
        and ir.device_employee_no = v_review.device_employee_no
        and ir.review_state = 'ignored'
    ) then
      raise exception 'This legacy identity is explicitly ignored';
    end if;
    select count(distinct m.worker_id), (array_agg(distinct m.worker_id))[1]
    into v_legacy_count, v_resolved_worker_id
    from public.biometric_worker_mapping as m
    where m.device_id is null
      and m.device_employee_no = v_review.device_employee_no
      and m.is_active is true
      and m.mapping_review_state = 'confirmed';
    if v_legacy_count <> 1 then
      raise exception 'No unique safe confirmed mapping exists for this event';
    end if;
  elsif v_exact_count <> 1 then
    raise exception 'The exact device identity has ambiguous ownership';
  end if;

  if v_review.worker_id is not null and v_review.worker_id <> v_resolved_worker_id then
    raise exception 'Current mapping does not match the captured worker';
  end if;
  if not exists (
    select 1 from public.workers as w
    where w.id = v_resolved_worker_id and w.is_active is true
  ) then
    raise exception 'The safely mapped worker is not active';
  end if;

  v_local_timestamp := v_review.event_timestamp at time zone 'Africa/Kinshasa';
  if p_decision = 'current_day_check_in' then
    select a.* into v_attendance
    from public.attendance as a
    where a.worker_id = v_resolved_worker_id
      and a.attendance_date = v_review.current_work_date
    for update;

    if v_attendance.id is null then
      insert into public.attendance (
        worker_id, attendance_date, status, check_in, check_out,
        attendance_source, manual_override, biometric_sync_key,
        biometric_sync_metadata, recorded_by
      ) values (
        v_resolved_worker_id, v_review.current_work_date, 'half_day',
        v_local_timestamp::time, null, 'biometric', true,
        'early-review:' || v_review.id::text,
        jsonb_build_object(
          'early_morning_review_id', v_review.id,
          'decision', p_decision,
          'event_timestamp', v_review.event_timestamp,
          'device_id', v_review.device_id,
          'device_employee_no', v_review.device_employee_no,
          'event_serial', v_review.event_serial
        ), auth.uid()
      );
    elsif v_attendance.attendance_source = 'biometric'
      and (
        v_attendance.manual_override is false
        or v_attendance.biometric_sync_metadata ->> 'early_morning_review_id' = v_review.id::text
      )
      and (v_attendance.check_in is null or v_attendance.check_in = v_local_timestamp::time)
      and v_attendance.check_out is null then
      update public.attendance as a
      set status = 'half_day', check_in = v_local_timestamp::time,
          check_out = null, attendance_source = 'biometric', manual_override = true,
          biometric_sync_key = coalesce(a.biometric_sync_key, 'early-review:' || v_review.id::text),
          biometric_sync_metadata = coalesce(a.biometric_sync_metadata, '{}'::jsonb) || jsonb_build_object(
            'early_morning_review_id', v_review.id,
            'decision', p_decision,
            'event_timestamp', v_review.event_timestamp,
            'device_id', v_review.device_id,
            'device_employee_no', v_review.device_employee_no,
            'event_serial', v_review.event_serial
          ), recorded_by = auth.uid()
      where a.id = v_attendance.id;
    else
      raise exception 'Current-day attendance is protected or incompatible with this decision';
    end if;
  else
    select a.* into v_attendance
    from public.attendance as a
    where a.worker_id = v_resolved_worker_id
      and a.attendance_date = v_review.previous_work_date
    for update;

    if v_attendance.id is null or v_attendance.check_in is null then
      raise exception 'Previous workday has no valid check-in to complete';
    end if;
    if v_attendance.attendance_source <> 'biometric'
      or (
        v_attendance.manual_override is true
        and v_attendance.biometric_sync_metadata ->> 'early_morning_review_id' <> v_review.id::text
      ) then
      raise exception 'Previous-workday attendance is manual or protected';
    end if;

    v_metadata := coalesce(v_attendance.biometric_sync_metadata, '{}'::jsonb) || jsonb_build_object(
      'early_morning_review_id', v_review.id,
      'decision', p_decision,
      'check_out_event_timestamp', v_review.event_timestamp,
      'check_out_calendar_date', v_review.current_work_date,
      'check_out_device_id', v_review.device_id,
      'check_out_employee_no', v_review.device_employee_no,
      'check_out_event_serial', v_review.event_serial
    );
    update public.attendance as a
    set status = 'present', check_out = v_local_timestamp::time,
        review_approved_check_out_at = v_review.event_timestamp,
        attendance_source = 'biometric', manual_override = true,
        biometric_sync_metadata = v_metadata, recorded_by = auth.uid()
    where a.id = v_attendance.id;
  end if;

  update public.biometric_early_morning_review as r
  set worker_id = v_resolved_worker_id, review_status = 'resolved',
      review_decision = p_decision, reviewed_by = auth.uid(), reviewed_at = now()
  where r.id = v_review.id
  returning r.* into v_review;
  return v_review;
end;
$$;

alter table public.biometric_early_morning_review enable row level security;
drop policy if exists biometric_early_morning_review_admin_select
  on public.biometric_early_morning_review;
create policy biometric_early_morning_review_admin_select
on public.biometric_early_morning_review
for select to authenticated using ((select public.is_admin()));

revoke all on table public.biometric_early_morning_review from public, anon, authenticated;
grant select on table public.biometric_early_morning_review to authenticated;
grant select, insert, update on table public.biometric_early_morning_review to service_role;
revoke all on function public.resolve_early_morning_biometric_review(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_early_morning_biometric_review(uuid, text) to authenticated;
revoke all on function public.capture_early_morning_biometric_review() from public, anon, authenticated;
revoke all on function public.guard_pending_early_morning_absence() from public, anon, authenticated;
revoke all on function public.previous_normal_work_date(date) from public, anon, authenticated;
grant execute on function public.previous_normal_work_date(date) to service_role;

comment on table public.biometric_early_morning_review is
  'One auditable manual-review decision per immutable 01:00-05:59 biometric event.';
comment on column public.attendance.review_approved_check_out_at is
  'Exact next-calendar-day biometric checkout approved through early-morning review.';
