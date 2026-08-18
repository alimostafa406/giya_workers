-- REVIEW ONLY: additive company payroll rules and holiday calendar.
-- No existing operational table or data is modified.

create table if not exists public.payroll_rule_set (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null unique,
  name text not null,
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  weekly_period_start_iso_day smallint not null default 1 check (weekly_period_start_iso_day = 1),
  weekly_period_length_days smallint not null default 6 check (weekly_period_length_days = 6),
  weekly_payment_due_offset_days smallint not null default 5 check (weekly_payment_due_offset_days = 5),
  monthly_working_day_divisor numeric(6,2) not null default 26 check (monthly_working_day_divisor > 0),
  half_day_multiplier numeric(6,4) not null default 0.5 check (half_day_multiplier between 0 and 1),
  weekly_holiday_multiplier numeric(8,4) not null default 2.0 check (weekly_holiday_multiplier >= 0),
  monthly_holiday_policy text not null default 'manual' check (monthly_holiday_policy in ('normal_pay', 'additional_day_pay', 'multiplier', 'manual')),
  monthly_holiday_multiplier numeric(8,4) check (monthly_holiday_multiplier is null or monthly_holiday_multiplier >= 0),
  sunday_work_policy text not null default 'manual' check (sunday_work_policy in ('normal_additional_day', 'multiplied_day', 'overtime_special', 'manual')),
  sunday_work_multiplier numeric(8,4) check (sunday_work_multiplier is null or sunday_work_multiplier >= 0),
  transport_eligibility text not null default 'present_only' check (transport_eligibility in ('present_only', 'present_and_half_day', 'manual_only')),
  -- Null means no rounding: retain actual candidate overtime duration.
  overtime_rounding_minutes integer check (overtime_rounding_minutes between 1 and 60),
  overtime_rounding_mode text check (overtime_rounding_mode in ('down', 'up', 'nearest')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_rule_set_dates_valid check (effective_to is null or effective_to >= effective_from),
  constraint payroll_rule_set_overtime_rounding_valid check (
    (overtime_rounding_minutes is null and overtime_rounding_mode is null)
    or (overtime_rounding_minutes is not null and overtime_rounding_mode is not null)
  )
);

create table if not exists public.company_holiday (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_payroll_rule_updated_at()
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
  if not exists (select 1 from pg_trigger where tgname = 'payroll_rule_set_set_updated_at' and tgrelid = 'public.payroll_rule_set'::regclass) then
    create trigger payroll_rule_set_set_updated_at before update on public.payroll_rule_set for each row execute function public.set_payroll_rule_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'company_holiday_set_updated_at' and tgrelid = 'public.company_holiday'::regclass) then
    create trigger company_holiday_set_updated_at before update on public.company_holiday for each row execute function public.set_payroll_rule_updated_at();
  end if;
end;
$$;

-- The initial active policy preserves actual overtime duration because both
-- overtime-rounding fields are omitted and therefore null.
insert into public.payroll_rule_set (rule_code, name, effective_from)
values ('default-payroll-policy', 'Default payroll policy', current_date)
on conflict (rule_code) do nothing;

alter table public.payroll_rule_set enable row level security;
alter table public.company_holiday enable row level security;

do $$
declare target_table text;
begin
  foreach target_table in array array['payroll_rule_set', 'company_holiday'] loop
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
