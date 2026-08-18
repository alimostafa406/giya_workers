-- REVIEW ONLY: additive payroll review, finalization, and adjustment records.
-- No attendance rows, workers, teams, mappings, or existing profile rows change.

create table if not exists public.payroll_run (
  id uuid primary key default gen_random_uuid(),
  payment_type text not null check (payment_type in ('weekly', 'monthly')),
  weekly_period_start date,
  weekly_period_end date,
  scheduled_payment_date date not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  rule_set_id uuid not null references public.payroll_rule_set(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'finalized', 'paid')),
  notes text,
  created_by uuid references public.admins(id) on delete restrict,
  reviewed_by uuid references public.admins(id) on delete restrict,
  finalized_by uuid references public.admins(id) on delete restrict,
  paid_by uuid references public.admins(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  finalized_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint payroll_run_weekly_range_valid check (
    (payment_type = 'weekly'
      and weekly_period_start is not null
      and weekly_period_end = weekly_period_start + 5
      and extract(isodow from weekly_period_start) = 1
      and scheduled_payment_date = weekly_period_end)
    or (payment_type = 'monthly'
      and weekly_period_start is null
      and weekly_period_end is null)
  )
);

create table if not exists public.payroll_line (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_run(id) on delete restrict,
  worker_id uuid not null references public.workers(id) on delete restrict,
  attendance_period_start date not null,
  attendance_period_end date not null,
  payment_due_date date not null,
  worker_name_snapshot text not null,
  payment_type_snapshot text not null check (payment_type_snapshot in ('weekly', 'monthly')),
  currency_code_snapshot text not null check (currency_code_snapshot ~ '^[A-Z]{3}$'),
  monthly_payroll_cycle_start_date_snapshot date,
  compensation_snapshot jsonb not null default '{}'::jsonb,
  rule_snapshot jsonb not null default '{}'::jsonb,
  attendance_summary_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  present_days numeric(8,2) not null default 0,
  half_days numeric(8,2) not null default 0,
  absent_days numeric(8,2) not null default 0,
  base_amount numeric(14,2) not null default 0,
  transport_amount numeric(14,2) not null default 0,
  overtime_hours numeric(10,2) not null default 0,
  overtime_amount numeric(14,2) not null default 0,
  holiday_amount numeric(14,2) not null default 0,
  bonus_amount numeric(14,2) not null default 0,
  deduction_amount numeric(14,2) not null default 0,
  advance_amount numeric(14,2) not null default 0,
  manual_adjustment_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_line_period_dates_valid check (attendance_period_end >= attendance_period_start),
  constraint payroll_line_worker_per_run_unique unique (payroll_run_id, worker_id),
  constraint payroll_line_worker_period_unique unique (worker_id, attendance_period_start, attendance_period_end)
);

create index if not exists payroll_line_due_date_idx on public.payroll_line (payment_due_date);
create index if not exists payroll_line_worker_period_idx on public.payroll_line (worker_id, attendance_period_start, attendance_period_end);

create table if not exists public.payroll_adjustment (
  id uuid primary key default gen_random_uuid(),
  payroll_line_id uuid not null references public.payroll_line(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in ('bonus', 'deduction', 'advance', 'transport_correction', 'overtime_correction', 'holiday_correction', 'other')),
  amount numeric(14,2) not null,
  reason text not null,
  created_by uuid not null references public.admins(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.admins(id) on delete restrict,
  void_reason text
);

create or replace function public.set_payroll_run_or_line_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payroll_run_set_updated_at' and tgrelid = 'public.payroll_run'::regclass) then
    create trigger payroll_run_set_updated_at before update on public.payroll_run for each row execute function public.set_payroll_run_or_line_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payroll_line_set_updated_at' and tgrelid = 'public.payroll_line'::regclass) then
    create trigger payroll_line_set_updated_at before update on public.payroll_line for each row execute function public.set_payroll_run_or_line_updated_at();
  end if;
end;
$$;

-- Finalized and paid runs are immutable. A finalized run may transition once
-- to paid; neither its lines nor adjustments may then be changed.
create or replace function public.guard_payroll_run_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'paid' then
    raise exception 'Paid payroll runs are immutable';
  end if;
  if old.status = 'finalized' and new.status <> 'paid' then
    raise exception 'Finalized payroll runs may only transition to paid';
  end if;
  return new;
end;
$$;

create or replace function public.guard_payroll_run_content_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_status text;
  target_run_id uuid;
begin
  if tg_op = 'DELETE' then
    target_run_id := old.payroll_run_id;
  else
    target_run_id := new.payroll_run_id;
  end if;

  select status into run_status
  from public.payroll_run
  where id = target_run_id;

  if run_status in ('finalized', 'paid') then
    raise exception 'Payroll content is immutable after finalization';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.guard_payroll_adjustment_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_status text;
  target_line_id uuid;
begin
  if tg_op = 'DELETE' then
    target_line_id := old.payroll_line_id;
  else
    target_line_id := new.payroll_line_id;
  end if;

  select run.status into run_status
  from public.payroll_line as line
  join public.payroll_run as run on run.id = line.payroll_run_id
  where line.id = target_line_id;

  if run_status in ('finalized', 'paid') then
    raise exception 'Payroll adjustments are immutable after finalization';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payroll_run_guard_status' and tgrelid = 'public.payroll_run'::regclass) then
    create trigger payroll_run_guard_status before update on public.payroll_run for each row execute function public.guard_payroll_run_status();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payroll_line_guard_mutation' and tgrelid = 'public.payroll_line'::regclass) then
    create trigger payroll_line_guard_mutation before insert or update or delete on public.payroll_line for each row execute function public.guard_payroll_run_content_mutation();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payroll_adjustment_guard_mutation' and tgrelid = 'public.payroll_adjustment'::regclass) then
    create trigger payroll_adjustment_guard_mutation before insert or update or delete on public.payroll_adjustment for each row execute function public.guard_payroll_adjustment_mutation();
  end if;
end;
$$;

alter table public.payroll_run enable row level security;
alter table public.payroll_line enable row level security;
alter table public.payroll_adjustment enable row level security;

do $$
declare target_table text;
begin
  foreach target_table in array array['payroll_run', 'payroll_line', 'payroll_adjustment'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = target_table and policyname = target_table || '_admin_select') then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', target_table || '_admin_select', target_table);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = target_table and policyname = target_table || '_admin_insert') then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', target_table || '_admin_insert', target_table);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = target_table and policyname = target_table || '_admin_update') then
      execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', target_table || '_admin_update', target_table);
    end if;
  end loop;
end;
$$;
