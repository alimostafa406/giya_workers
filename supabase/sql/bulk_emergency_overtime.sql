-- REVIEW / APPLY ONCE. Admin-only, per-worker emergency corrections.
-- No biometric events or payroll snapshots are written by this migration.

alter table public.attendance
  add column if not exists emergency_overtime_mode text,
  add column if not exists emergency_overtime_minutes integer;

alter table public.attendance
  drop constraint if exists attendance_emergency_overtime_valid;
alter table public.attendance
  add constraint attendance_emergency_overtime_valid check (
    (emergency_overtime_mode is null and emergency_overtime_minutes is null)
    or (emergency_overtime_mode = 'manual_checkout' and emergency_overtime_minutes is null)
    or (emergency_overtime_mode = 'manual_overtime_duration'
      and emergency_overtime_minutes between 1 and 1440)
  );

create table if not exists public.attendance_emergency_overtime_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  worker_id uuid not null references public.workers(id) on delete restrict,
  attendance_date date not null,
  applied_by uuid not null references public.admins(id) on delete restrict,
  applied_at timestamptz not null default now(),
  source text not null default 'manual_emergency'
    check (source = 'manual_emergency'),
  mode text not null check (mode in ('manual_checkout', 'manual_overtime_duration')),
  reason text not null check (btrim(reason) <> ''),
  note text,
  previous_value jsonb not null,
  new_value jsonb not null,
  unique (request_id, worker_id)
);
create index if not exists attendance_emergency_overtime_audit_worker_date_idx
  on public.attendance_emergency_overtime_audit (worker_id, attendance_date, applied_at desc);
alter table public.attendance_emergency_overtime_audit enable row level security;
revoke all on public.attendance_emergency_overtime_audit from public, anon, authenticated;
grant select on public.attendance_emergency_overtime_audit to authenticated;
drop policy if exists attendance_emergency_overtime_audit_admin_select
  on public.attendance_emergency_overtime_audit;
create policy attendance_emergency_overtime_audit_admin_select
  on public.attendance_emergency_overtime_audit
  for select to authenticated using ((select public.is_admin()));

create or replace function public.admin_apply_bulk_emergency_overtime(
  p_request_id uuid,
  p_date date,
  p_mode text,
  p_reason text,
  p_note text,
  p_entries jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_entry jsonb;
  v_worker_id uuid;
  v_worker public.workers%rowtype;
  v_team_name text;
  v_classification text;
  v_attendance public.attendance%rowtype;
  v_after public.attendance%rowtype;
  v_checkout_text text;
  v_checkout time;
  v_checkout_threshold time;
  v_minutes integer;
  v_previous jsonb;
  v_result jsonb := '[]'::jsonb;
  v_outcome text;
  v_message text;
  v_seen uuid[] := array[]::uuid[];
  v_updated_count integer := 0;
  v_skipped_count integer := 0;
  v_failed_count integer := 0;
begin
  if v_actor is null or not public.is_admin()
    or not exists (select 1 from public.admins where id = v_actor and is_active is true) then
    raise exception 'Active admin access is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_date is null or p_date > (now() at time zone 'Africa/Kinshasa')::date
    or p_mode is null or p_mode not in ('manual_checkout', 'manual_overtime_duration')
    or p_reason is null or nullif(btrim(p_reason), '') is null
    or p_entries is null or jsonb_typeof(p_entries) <> 'array'
    or jsonb_array_length(p_entries) < 1 or jsonb_array_length(p_entries) > 200 then
    raise exception 'Invalid emergency overtime request' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    v_outcome := 'failed';
    v_message := null;
    v_worker_id := null;
    begin
      v_worker_id := (v_entry ->> 'worker_id')::uuid;
      if v_worker_id = any(v_seen) then
        v_outcome := 'skipped'; v_message := 'duplicate_worker';
      else
        v_seen := array_append(v_seen, v_worker_id);
        if exists (
          select 1 from public.attendance_emergency_overtime_audit
          where request_id = p_request_id and worker_id = v_worker_id
        ) then
          v_outcome := 'skipped'; v_message := 'already_applied';
        else
          select w.* into v_worker from public.workers w where w.id = v_worker_id;
          select t.name into v_team_name from public.teams t where t.id = v_worker.team_id;
          select c.classification into v_classification
            from public.worker_staff_classification c where c.worker_id = v_worker_id;

          if v_worker.id is null or v_worker.is_active is not true
            or v_worker.team_id is null or v_team_name is null
            or v_team_name in ('Adminstration', 'Chauffeur')
            or coalesce(v_classification, 'normal') <> 'normal'
            or (v_worker.operational_start_date is not null
              and v_worker.operational_start_date > p_date) then
            v_outcome := 'skipped'; v_message := 'worker_not_eligible';
          elsif extract(isodow from p_date) = 7 then
            v_outcome := 'skipped'; v_message := 'sunday_not_eligible';
          elsif exists (
            select 1 from public.payroll_line l
            join public.payroll_run r on r.id = l.payroll_run_id
            where l.worker_id = v_worker_id
              and p_date between l.attendance_period_start and l.attendance_period_end
              and r.status in ('finalized', 'paid')
          ) then
            v_outcome := 'skipped'; v_message := 'payroll_finalized_or_paid';
          else
            select a.* into v_attendance from public.attendance a
              where a.worker_id = v_worker_id and a.attendance_date = p_date for update;
            if v_attendance.id is null or v_attendance.check_in is null
              or v_attendance.status in ('absent', 'pending') then
              v_outcome := 'skipped'; v_message := 'valid_check_in_required';
            elsif v_attendance.manual_override is true
              and v_attendance.emergency_overtime_mode is null then
              v_outcome := 'skipped'; v_message := 'protected_manual_attendance';
            elsif (v_entry ->> 'expected_updated_at') is null
              or v_attendance.updated_at is distinct from
                (v_entry ->> 'expected_updated_at')::timestamptz then
              v_outcome := 'skipped'; v_message := 'attendance_changed_since_preview';
            else
              v_previous := to_jsonb(v_attendance);
              if p_mode = 'manual_checkout' then
                v_checkout_text := v_entry ->> 'checkout';
                if v_checkout_text is null
                  or v_checkout_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
                  raise exception 'Invalid same-day checkout time';
                end if;
                v_checkout := v_checkout_text::time;
                v_checkout_threshold := case
                  when extract(isodow from p_date) = 6 then time '14:00'
                  when v_team_name = 'Maison' then time '16:00'
                  else time '16:30' end;
                if v_attendance.check_out is not null
                  and v_attendance.emergency_overtime_mode is null then
                  v_outcome := 'skipped'; v_message := 'existing_real_checkout';
                elsif v_checkout <= v_attendance.check_in
                  or v_checkout < v_checkout_threshold then
                  v_outcome := 'skipped'; v_message := 'checkout_not_qualified';
                else
                  update public.attendance a set
                    status = case when a.status = 'late' then 'late' else 'present' end,
                    check_out = v_checkout,
                    attendance_source = 'manual', manual_override = true,
                    emergency_overtime_mode = 'manual_checkout',
                    emergency_overtime_minutes = null,
                    recorded_by = v_actor, note = coalesce(nullif(btrim(p_note), ''), a.note), updated_at = now()
                  where a.id = v_attendance.id returning a.* into v_after;
                  v_outcome := 'updated';
                end if;
              else
                v_minutes := (v_entry ->> 'minutes')::integer;
                if v_minutes is null or v_minutes < 1 or v_minutes > 1440 then
                  raise exception 'Invalid overtime duration';
                end if;
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
              end if;
              if v_outcome = 'updated' then
                insert into public.attendance_emergency_overtime_audit
                  (request_id, worker_id, attendance_date, applied_by, mode, reason, note,
                   previous_value, new_value)
                values (p_request_id, v_worker_id, p_date, v_actor, p_mode,
                  btrim(p_reason), nullif(btrim(p_note), ''), v_previous, to_jsonb(v_after));
              end if;
            end if;
          end if;
        end if;
      end if;
    exception when others then
      v_outcome := 'failed'; v_message := sqlerrm;
    end;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'worker_id', v_worker_id, 'outcome', v_outcome, 'reason', v_message));
    if v_outcome = 'updated' then
      v_updated_count := v_updated_count + 1;
    elsif v_outcome = 'skipped' then
      v_skipped_count := v_skipped_count + 1;
    else
      v_failed_count := v_failed_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'updated', v_updated_count,
    'skipped', v_skipped_count,
    'failed', v_failed_count,
    'results', v_result);
end;
$$;
revoke all on function public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)
  to authenticated;
