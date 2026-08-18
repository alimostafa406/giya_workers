-- Additive payroll-frequency profile. Review and execute through the approved
-- Supabase migration process; do not run automatically from the application.
-- Payroll frequency is independent from worker_staff_classification after this
-- one-time default initialization.

create table if not exists public.worker_payroll_profile (
  worker_id uuid primary key references public.workers(id) on delete restrict,
  payment_type text not null,
  monthly_salary numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_payroll_profile_payment_type_valid
    check (payment_type in ('weekly', 'monthly')),
  constraint worker_payroll_profile_monthly_salary_valid
    check (monthly_salary is null or monthly_salary >= 0)
);

create or replace function public.set_worker_payroll_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists worker_payroll_profile_set_updated_at on public.worker_payroll_profile;
create trigger worker_payroll_profile_set_updated_at
before update on public.worker_payroll_profile
for each row
execute function public.set_worker_payroll_profile_updated_at();

-- Initialize only workers without a profile. Future edits to classification do
-- not change these values, and re-running this migration cannot overwrite them.
insert into public.worker_payroll_profile (worker_id, payment_type)
select
  worker.id,
  case
    when classification.classification = 'special_staff' then 'monthly'
    else 'weekly'
  end
from public.workers as worker
left join public.worker_staff_classification as classification
  on classification.worker_id = worker.id
on conflict (worker_id) do nothing;

alter table public.worker_payroll_profile enable row level security;

drop policy if exists worker_payroll_profile_admin_select on public.worker_payroll_profile;
create policy worker_payroll_profile_admin_select
on public.worker_payroll_profile
for select
to authenticated
using (public.is_admin());

drop policy if exists worker_payroll_profile_admin_insert on public.worker_payroll_profile;
create policy worker_payroll_profile_admin_insert
on public.worker_payroll_profile
for insert
to authenticated
with check (public.is_admin());

drop policy if exists worker_payroll_profile_admin_update on public.worker_payroll_profile;
create policy worker_payroll_profile_admin_update
on public.worker_payroll_profile
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
