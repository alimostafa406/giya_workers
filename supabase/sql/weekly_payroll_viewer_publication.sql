-- ADDITIVE ONLY: current-week viewer visibility over immutable finalized payroll.
-- No payroll line, attendance, compensation, worker, team, mapping, or payroll
-- status is calculated, updated, or deleted by this migration.
-- Requires the existing foreign_monitoring session functions used by the viewer.

begin;

create table if not exists public.weekly_payroll_publication (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  status text not null default 'unpublished' check (status in ('published', 'unpublished')),
  published_at timestamptz,
  published_by uuid references public.admins(id) on delete restrict,
  unpublished_at timestamptz,
  unpublished_by uuid references public.admins(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_payroll_publication_period_unique unique (week_start, week_end),
  constraint weekly_payroll_publication_monday_saturday check (
    extract(isodow from week_start) = 1 and week_end = week_start + 5
  )
);

create table if not exists public.weekly_payroll_publication_run (
  publication_id uuid not null references public.weekly_payroll_publication(id) on delete restrict,
  payroll_run_id uuid not null references public.payroll_run(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (publication_id, payroll_run_id),
  constraint weekly_payroll_publication_run_once unique (payroll_run_id)
);

create table if not exists public.weekly_payroll_publication_audit (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.weekly_payroll_publication(id) on delete restrict,
  action text not null check (action in ('published', 'unpublished')),
  actor_id uuid not null references public.admins(id) on delete restrict,
  payroll_run_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

create index if not exists weekly_payroll_publication_status_week_idx
  on public.weekly_payroll_publication (status, week_start desc);
create index if not exists weekly_payroll_publication_audit_publication_idx
  on public.weekly_payroll_publication_audit (publication_id, created_at desc);

alter table public.weekly_payroll_publication enable row level security;
alter table public.weekly_payroll_publication_run enable row level security;
alter table public.weekly_payroll_publication_audit enable row level security;
revoke all on table public.weekly_payroll_publication from anon, authenticated;
revoke all on table public.weekly_payroll_publication_run from anon, authenticated;
revoke all on table public.weekly_payroll_publication_audit from anon, authenticated;

create or replace function public.guard_weekly_payroll_publication_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication public.weekly_payroll_publication%rowtype;
  v_run public.payroll_run%rowtype;
begin
  select * into v_publication from public.weekly_payroll_publication where id = new.publication_id;
  select * into v_run from public.payroll_run where id = new.payroll_run_id;
  if v_publication.id is null
    or v_run.id is null
    or v_run.payment_type <> 'weekly'
    or v_run.status not in ('finalized', 'paid')
    or v_run.weekly_period_start <> v_publication.week_start
    or v_run.weekly_period_end <> v_publication.week_end then
    raise exception 'Publication may reference only finalized weekly payroll runs for the same period' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_payroll_publication_run_guard on public.weekly_payroll_publication_run;
create trigger weekly_payroll_publication_run_guard
before insert or update on public.weekly_payroll_publication_run
for each row execute function public.guard_weekly_payroll_publication_run();
revoke all on function public.guard_weekly_payroll_publication_run() from public, anon, authenticated;

create or replace function public.get_current_weekly_payroll_publication_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_week_start date;
  v_week_end date;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Active admin access is required' using errcode = '42501';
  end if;
  v_week_start := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_end := v_week_start + 5;

  select jsonb_build_object(
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'workerCount', (
      select count(distinct l.worker_id)
      from public.payroll_run r join public.payroll_line l on l.payroll_run_id = r.id
      where r.payment_type = 'weekly' and r.weekly_period_start = v_week_start
        and r.weekly_period_end = v_week_end and r.status in ('finalized', 'paid')
        and l.payment_type_snapshot = 'weekly'
    ),
    'teamCount', (
      select count(distinct w.team_id)
      from public.payroll_run r
      join public.payroll_line l on l.payroll_run_id = r.id
      join public.workers w on w.id = l.worker_id
      where r.payment_type = 'weekly' and r.weekly_period_start = v_week_start
        and r.weekly_period_end = v_week_end and r.status in ('finalized', 'paid')
        and l.payment_type_snapshot = 'weekly' and w.team_id is not null
    ),
    'finalizedRunCount', (
      select count(*) from public.payroll_run r
      where r.payment_type = 'weekly' and r.weekly_period_start = v_week_start
        and r.weekly_period_end = v_week_end and r.status in ('finalized', 'paid')
    ),
    'unfinishedRunCount', (
      select count(*) from public.payroll_run r
      where r.payment_type = 'weekly' and r.weekly_period_start = v_week_start
        and r.weekly_period_end = v_week_end and r.status not in ('finalized', 'paid')
    ),
    'totals', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', totals.currency_code, 'amount', totals.amount) order by totals.currency_code), '[]'::jsonb)
      from (
        select l.currency_code_snapshot as currency_code, sum(l.final_amount) as amount
        from public.payroll_run r join public.payroll_line l on l.payroll_run_id = r.id
        where r.payment_type = 'weekly' and r.weekly_period_start = v_week_start
          and r.weekly_period_end = v_week_end and r.status in ('finalized', 'paid')
          and l.payment_type_snapshot = 'weekly'
        group by l.currency_code_snapshot
      ) totals
    ),
    'publicationStatus', coalesce(p.status, 'unpublished'),
    'viewerVisible', coalesce(p.status = 'published' and v_today between p.week_start and p.week_end + 1, false),
    'publishedAt', p.published_at,
    'unpublishedAt', p.unpublished_at
  ) into v_result
  from (select 1) seed
  left join public.weekly_payroll_publication p
    on p.week_start = v_week_start and p.week_end = v_week_end;
  return v_result;
end;
$$;

create or replace function public.set_current_weekly_payroll_viewer_publication(p_publish boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_week_start date;
  v_week_end date;
  v_publication_id uuid;
  v_run_ids uuid[];
  v_unfinished integer;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'Active admin access is required' using errcode = '42501';
  end if;
  v_week_start := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_end := v_week_start + 5;
  perform pg_advisory_xact_lock(hashtext('current-weekly-payroll-publication:' || v_week_start::text));

  select coalesce(array_agg(r.id order by r.id), '{}'::uuid[]),
    count(*) filter (where r.status not in ('finalized', 'paid'))
  into v_run_ids, v_unfinished
  from public.payroll_run r
  where r.payment_type = 'weekly'
    and r.weekly_period_start = v_week_start and r.weekly_period_end = v_week_end;

  if p_publish and (
    coalesce(array_length(v_run_ids, 1), 0) = 0
    or v_unfinished > 0
    or exists (
      select 1 from public.payroll_run r
      where r.id = any(v_run_ids) and r.status not in ('finalized', 'paid')
    )
  ) then
    raise exception 'Finalize every current-week weekly payroll run before sending it' using errcode = '22023';
  end if;

  -- The array must contain only immutable finalized/paid snapshots.
  select coalesce(array_agg(r.id order by r.id), '{}'::uuid[])
  into v_run_ids
  from public.payroll_run r
  where r.payment_type = 'weekly' and r.weekly_period_start = v_week_start
    and r.weekly_period_end = v_week_end and r.status in ('finalized', 'paid');

  insert into public.weekly_payroll_publication (
    week_start, week_end, status, published_at, published_by,
    unpublished_at, unpublished_by, updated_at
  ) values (
    v_week_start, v_week_end, case when p_publish then 'published' else 'unpublished' end,
    case when p_publish then now() else null end, case when p_publish then v_actor else null end,
    case when not p_publish then now() else null end, case when not p_publish then v_actor else null end, now()
  )
  on conflict (week_start, week_end) do update set
    status = excluded.status,
    published_at = case when p_publish then now() else public.weekly_payroll_publication.published_at end,
    published_by = case when p_publish then v_actor else public.weekly_payroll_publication.published_by end,
    unpublished_at = case when not p_publish then now() else public.weekly_payroll_publication.unpublished_at end,
    unpublished_by = case when not p_publish then v_actor else public.weekly_payroll_publication.unpublished_by end,
    updated_at = now()
  returning id into v_publication_id;

  if p_publish then
    insert into public.weekly_payroll_publication_run (publication_id, payroll_run_id)
    select v_publication_id, run_id from unnest(v_run_ids) as run_id
    on conflict do nothing;
  else
    select coalesce(array_agg(pr.payroll_run_id order by pr.payroll_run_id), '{}'::uuid[])
    into v_run_ids from public.weekly_payroll_publication_run pr
    where pr.publication_id = v_publication_id;
  end if;

  insert into public.weekly_payroll_publication_audit (publication_id, action, actor_id, payroll_run_ids)
  values (v_publication_id, case when p_publish then 'published' else 'unpublished' end, v_actor, v_run_ids);

  return jsonb_build_object(
    'publicationId', v_publication_id, 'weekStart', v_week_start, 'weekEnd', v_week_end,
    'status', case when p_publish then 'published' else 'unpublished' end,
    'viewerVisible', p_publish and v_today between v_week_start and v_week_end + 1,
    'payrollRunIds', to_jsonb(v_run_ids)
  );
end;
$$;

create or replace function public.get_published_weekly_payroll(p_session_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_publication public.weekly_payroll_publication%rowtype;
  v_lines jsonb;
  v_status text;
  v_payment_date date;
begin
  perform public.foreign_monitoring_require_session(p_session_token);
  select p.* into v_publication
  from public.weekly_payroll_publication p
  where p.status = 'published'
    and v_today between p.week_start and p.week_end + 1
  order by p.week_start desc limit 1;

  if v_publication.id is null then
    perform public.foreign_monitoring_touch_session(p_session_token);
    return jsonb_build_object('published', false, 'lines', '[]'::jsonb);
  end if;

  select case when bool_and(r.status = 'paid') then 'paid'
              when bool_and(r.status = 'finalized') then 'finalized'
              else 'mixed' end,
         min(r.scheduled_payment_date)
  into v_status, v_payment_date
  from public.weekly_payroll_publication_run pr
  join public.payroll_run r on r.id = pr.payroll_run_id
  where pr.publication_id = v_publication.id and r.status in ('finalized', 'paid');

  select coalesce(jsonb_agg(jsonb_build_object(
    'lineId', l.id, 'runId', r.id, 'workerId', l.worker_id,
    'workerName', l.worker_name_snapshot, 'employeeCode', w.employee_code,
    'teamId', w.team_id, 'teamName', coalesce(t.name, ''),
    'paymentType', l.payment_type_snapshot, 'currencyCode', l.currency_code_snapshot,
    'dailyRate', coalesce(l.compensation_snapshot->'daily_rate', '0'::jsonb),
    'presentDays', l.present_days, 'halfDays', l.half_days, 'absentDays', l.absent_days,
    'baseAmount', l.base_amount, 'transportAmount', l.transport_amount,
    'overtimeHours', l.overtime_hours, 'overtimeAmount', l.overtime_amount,
    'holidayAmount', l.holiday_amount, 'bonusAmount', l.bonus_amount,
    'deductionAmount', l.deduction_amount, 'advanceAmount', l.advance_amount,
    'manualAdjustmentAmount', l.manual_adjustment_amount, 'finalAmount', l.final_amount,
    'attendanceSummary', l.attendance_summary_snapshot,
    'calculationSnapshot', l.calculation_snapshot
  ) order by coalesce(t.name, ''), l.worker_name_snapshot, l.id), '[]'::jsonb)
  into v_lines
  from public.weekly_payroll_publication_run pr
  join public.payroll_run r on r.id = pr.payroll_run_id
  join public.payroll_line l on l.payroll_run_id = r.id
  join public.workers w on w.id = l.worker_id
  left join public.teams t on t.id = w.team_id
  where pr.publication_id = v_publication.id
    and r.payment_type = 'weekly' and r.status in ('finalized', 'paid')
    and l.payment_type_snapshot = 'weekly';

  perform public.foreign_monitoring_touch_session(p_session_token);
  return jsonb_build_object(
    'published', true, 'periodStart', v_publication.week_start,
    'periodEnd', v_publication.week_end, 'paymentDate', v_payment_date,
    'status', v_status, 'publishedAt', v_publication.published_at, 'lines', v_lines
  );
end;
$$;

revoke all on function public.get_current_weekly_payroll_publication_admin() from public, anon, authenticated;
revoke all on function public.set_current_weekly_payroll_viewer_publication(boolean) from public, anon, authenticated;
revoke all on function public.get_published_weekly_payroll(text) from public, anon, authenticated;
grant execute on function public.get_current_weekly_payroll_publication_admin() to authenticated;
grant execute on function public.set_current_weekly_payroll_viewer_publication(boolean) to authenticated;
grant execute on function public.get_published_weekly_payroll(text) to anon, authenticated;

comment on table public.weekly_payroll_publication is
  'Viewer visibility state for a Monday-Saturday payroll; visibility expires after Sunday.';
comment on table public.weekly_payroll_publication_run is
  'Exact immutable finalized/paid weekly payroll runs sent to the viewer.';
comment on table public.weekly_payroll_publication_audit is
  'Append-only history of send and stop-display actions.';

commit;
