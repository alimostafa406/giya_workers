-- REVIEW ONLY: additive worker-specific payroll terms.
-- Do not execute automatically. This migration does not alter existing
-- worker_payroll_profile rows, attendance, Hikvision data, teams, or mappings.

create table if not exists public.worker_payroll_compensation (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  payment_type text not null check (payment_type in ('weekly', 'monthly')),
  effective_from date not null,
  effective_to date,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  daily_rate numeric(12,2),
  daily_transport_allowance numeric(12,2) not null default 0,
  overtime_rate_per_hour numeric(12,2),
  overtime_start_time time without time zone,
  monthly_salary numeric(12,2),
  monthly_payroll_cycle_start_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_payroll_compensation_dates_valid
    check (effective_to is null or effective_to >= effective_from),
  constraint worker_payroll_compensation_amounts_valid
    check (
      (daily_rate is null or daily_rate >= 0)
      and daily_transport_allowance >= 0
      and (overtime_rate_per_hour is null or overtime_rate_per_hour >= 0)
      and (monthly_salary is null or monthly_salary >= 0)
    ),
  constraint worker_payroll_compensation_worker_effective_unique
    unique (worker_id, effective_from)
);

create index if not exists worker_payroll_compensation_worker_effective_idx
  on public.worker_payroll_compensation (worker_id, effective_from desc);

create or replace function public.set_worker_payroll_compensation_updated_at()
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
  if not exists (
    select 1 from pg_trigger
    where tgname = 'worker_payroll_compensation_set_updated_at'
      and tgrelid = 'public.worker_payroll_compensation'::regclass
  ) then
    create trigger worker_payroll_compensation_set_updated_at
    before update on public.worker_payroll_compensation
    for each row
    execute function public.set_worker_payroll_compensation_updated_at();
  end if;
end;
$$;

-- One legacy baseline per existing payroll profile. This preserves the profile
-- payment type as the source of the initial value and never overwrites a term.
-- Monthly cycle dates deliberately remain null until an admin enters the real
-- payroll-cycle start date.
insert into public.worker_payroll_compensation (
  worker_id,
  payment_type,
  effective_from,
  currency_code,
  monthly_salary,
  monthly_payroll_cycle_start_date
)
select
  profile.worker_id,
  profile.payment_type,
  date '1900-01-01',
  case when profile.payment_type = 'monthly' then 'USD' else 'CDF' end,
  profile.monthly_salary,
  null
from public.worker_payroll_profile as profile
on conflict (worker_id, effective_from) do nothing;

alter table public.worker_payroll_compensation enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'worker_payroll_compensation' and policyname = 'worker_payroll_compensation_admin_select') then
    create policy worker_payroll_compensation_admin_select on public.worker_payroll_compensation for select to authenticated using (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'worker_payroll_compensation' and policyname = 'worker_payroll_compensation_admin_insert') then
    create policy worker_payroll_compensation_admin_insert on public.worker_payroll_compensation for insert to authenticated with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'worker_payroll_compensation' and policyname = 'worker_payroll_compensation_admin_update') then
    create policy worker_payroll_compensation_admin_update on public.worker_payroll_compensation for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end;
$$;
