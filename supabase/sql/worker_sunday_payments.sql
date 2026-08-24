-- REVIEW ONLY: additive, auditable Sunday-work entitlement and settlement.
-- Run manually through the approved Supabase migration process.
-- This migration does not create or alter attendance, worker classifications,
-- biometric data, or historical Monday-Saturday payroll lines.

create table if not exists public.worker_sunday_payment (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  work_date date not null,
  payment_type_snapshot text not null check (payment_type_snapshot in ('weekly', 'monthly')),
  compensation_term_id uuid not null references public.worker_payroll_compensation(id) on delete restrict,
  rule_set_id uuid not null references public.payroll_rule_set(id) on delete restrict,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  daily_value numeric(14,2) not null check (daily_value >= 0),
  multiplier numeric(8,4) not null default 2 check (multiplier = 2),
  amount numeric(14,2) not null check (amount >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'cancelled')),
  settlement_method text check (settlement_method in ('separate', 'payroll')),
  settled_payroll_run_id uuid references public.payroll_run(id) on delete restrict,
  settled_payroll_line_id uuid references public.payroll_line(id) on delete restrict,
  paid_at timestamptz,
  paid_by uuid references public.admins(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references public.admins(id) on delete restrict,
  cancellation_reason text,
  confirmed_by uuid not null references public.admins(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_sunday_payment_worker_date_unique unique (worker_id, work_date),
  constraint worker_sunday_payment_date_is_sunday check (extract(isodow from work_date) = 7),
  constraint worker_sunday_payment_amount_valid check (amount = round(daily_value * multiplier, 2)),
  constraint worker_sunday_payment_audit_valid check (
    (payment_status = 'unpaid' and paid_at is null and paid_by is null and cancelled_at is null and cancelled_by is null and settlement_method is distinct from 'separate')
    or
    (payment_status = 'paid' and paid_at is not null and paid_by is not null and cancelled_at is null and cancelled_by is null and settlement_method is not null)
    or
    (payment_status = 'cancelled' and paid_at is null and paid_by is null and cancelled_at is not null and cancelled_by is not null and settlement_method is null and settled_payroll_run_id is null and settled_payroll_line_id is null)
  ),
  constraint worker_sunday_payment_payroll_assignment_valid check (
    (settled_payroll_run_id is null and settled_payroll_line_id is null)
    or
    (settled_payroll_run_id is not null and settled_payroll_line_id is not null and settlement_method = 'payroll')
  )
);

-- Idempotent upgrade path when the first version of this reviewed migration was
-- already applied before audited Sunday reversal was added.
alter table public.worker_sunday_payment
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.admins(id) on delete restrict,
  add column if not exists cancellation_reason text;
alter table public.worker_sunday_payment drop constraint if exists worker_sunday_payment_payment_status_check;
alter table public.worker_sunday_payment
  add constraint worker_sunday_payment_payment_status_check check (payment_status in ('unpaid', 'paid', 'cancelled'));
alter table public.worker_sunday_payment drop constraint if exists worker_sunday_payment_audit_valid;
alter table public.worker_sunday_payment
  add constraint worker_sunday_payment_audit_valid check (
    (payment_status = 'unpaid' and paid_at is null and paid_by is null and cancelled_at is null and cancelled_by is null and settlement_method is distinct from 'separate')
    or
    (payment_status = 'paid' and paid_at is not null and paid_by is not null and cancelled_at is null and cancelled_by is null and settlement_method is not null)
    or
    (payment_status = 'cancelled' and paid_at is null and paid_by is null and cancelled_at is not null and cancelled_by is not null and settlement_method is null and settled_payroll_run_id is null and settled_payroll_line_id is null)
  );

create index if not exists worker_sunday_payment_worker_status_date_idx
  on public.worker_sunday_payment (worker_id, payment_status, work_date);
create index if not exists worker_sunday_payment_run_idx
  on public.worker_sunday_payment (settled_payroll_run_id)
  where settled_payroll_run_id is not null;

create or replace function public.set_worker_sunday_payment_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists worker_sunday_payment_set_updated_at on public.worker_sunday_payment;
create trigger worker_sunday_payment_set_updated_at
before update on public.worker_sunday_payment
for each row execute function public.set_worker_sunday_payment_updated_at();

alter table public.worker_sunday_payment enable row level security;
drop policy if exists worker_sunday_payment_admin_select on public.worker_sunday_payment;
create policy worker_sunday_payment_admin_select on public.worker_sunday_payment
for select to authenticated using (public.is_admin());

create or replace function public.confirm_worker_sunday_work(
  p_worker_id uuid,
  p_work_date date,
  p_note text default null
)
returns public.worker_sunday_payment
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile public.worker_payroll_profile%rowtype;
  v_term public.worker_payroll_compensation%rowtype;
  v_rule public.payroll_rule_set%rowtype;
  v_daily_value numeric(14,2);
  v_payment public.worker_sunday_payment%rowtype;
begin
  if not public.is_admin() then raise exception 'Active admin access is required'; end if;
  if extract(isodow from p_work_date) <> 7 then raise exception 'Work date must be Sunday'; end if;
  if p_work_date > (now() at time zone 'Africa/Lagos')::date then raise exception 'Future Sunday work cannot be confirmed'; end if;

  select * into v_profile from public.worker_payroll_profile where worker_id = p_worker_id;
  if not found then raise exception 'Worker payroll profile is required'; end if;

  select * into v_term
  from public.worker_payroll_compensation
  where worker_id = p_worker_id
    and payment_type = v_profile.payment_type
    and effective_from <= p_work_date
    and (effective_to is null or effective_to >= p_work_date)
  order by effective_from desc limit 1;
  if not found then raise exception 'Payroll compensation is not configured for this Sunday'; end if;

  select * into v_rule from public.payroll_rule_set
  where is_active and effective_from <= p_work_date
  order by effective_from desc limit 1;
  if not found then raise exception 'An active payroll rule set is required'; end if;

  if v_profile.payment_type = 'weekly' then
    if v_term.daily_rate is null then raise exception 'Weekly daily rate is required'; end if;
    v_daily_value := round(v_term.daily_rate, 2);
  else
    if v_term.monthly_salary is null then raise exception 'Monthly salary is required'; end if;
    v_daily_value := round(v_term.monthly_salary / v_rule.monthly_working_day_divisor, 2);
  end if;

  select * into v_payment from public.worker_sunday_payment
  where worker_id = p_worker_id and work_date = p_work_date for update;
  if found then
    if v_payment.payment_status <> 'cancelled' then return v_payment; end if;
    update public.worker_sunday_payment set
      payment_type_snapshot = v_profile.payment_type,
      compensation_term_id = v_term.id,
      rule_set_id = v_rule.id,
      currency_code = v_term.currency_code,
      daily_value = v_daily_value,
      multiplier = 2,
      amount = round(v_daily_value * 2, 2),
      payment_status = 'unpaid',
      cancelled_at = null,
      cancelled_by = null,
      cancellation_reason = null,
      confirmed_by = auth.uid(),
      note = nullif(btrim(p_note), '')
    where id = v_payment.id returning * into v_payment;
    return v_payment;
  end if;

  insert into public.worker_sunday_payment (
    worker_id, work_date, payment_type_snapshot, compensation_term_id, rule_set_id,
    currency_code, daily_value, multiplier, amount, confirmed_by, note
  ) values (
    p_worker_id, p_work_date, v_profile.payment_type, v_term.id, v_rule.id,
    v_term.currency_code, v_daily_value, 2, round(v_daily_value * 2, 2), auth.uid(), nullif(btrim(p_note), '')
  ) returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.cancel_sunday_work(
  p_sunday_payment_id uuid,
  p_reason text default 'Marked absent in payroll review'
)
returns public.worker_sunday_payment
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_payment public.worker_sunday_payment%rowtype;
begin
  if not public.is_admin() then raise exception 'Active admin access is required'; end if;
  update public.worker_sunday_payment set
    payment_status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = auth.uid(),
    cancellation_reason = coalesce(nullif(btrim(p_reason), ''), 'Marked absent in payroll review')
  where id = p_sunday_payment_id
    and payment_status = 'unpaid'
    and settled_payroll_run_id is null
    and settled_payroll_line_id is null
  returning * into v_payment;
  if v_payment.id is null then
    raise exception 'Sunday payment has already been financially processed and cannot be reversed';
  end if;
  return v_payment;
end;
$$;

create or replace function public.assign_sunday_payment_to_payroll_line(
  p_sunday_payment_id uuid,
  p_payroll_line_id uuid
)
returns public.worker_sunday_payment
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_payment public.worker_sunday_payment%rowtype;
  v_line public.payroll_line%rowtype;
  v_run public.payroll_run%rowtype;
begin
  if not public.is_admin() then raise exception 'Active admin access is required'; end if;
  select * into v_payment from public.worker_sunday_payment where id = p_sunday_payment_id for update;
  select * into v_line from public.payroll_line where id = p_payroll_line_id;
  select * into v_run from public.payroll_run where id = v_line.payroll_run_id;
  if v_payment.id is null or v_line.id is null or v_run.id is null then raise exception 'Sunday payment or payroll line not found'; end if;
  if v_run.status <> 'draft' then raise exception 'Sunday payment can only be assigned to a Draft payroll run'; end if;
  if v_payment.worker_id <> v_line.worker_id then raise exception 'Sunday payment worker does not match payroll line'; end if;
  if v_payment.currency_code <> v_line.currency_code_snapshot then raise exception 'Sunday payment currency does not match payroll line'; end if;
  if v_payment.work_date > v_line.payment_due_date then raise exception 'Sunday payment is later than this payroll settlement'; end if;
  if v_payment.payment_status <> 'unpaid' then raise exception 'Paid Sunday payment cannot be assigned'; end if;
  if v_payment.settled_payroll_run_id is not null and v_payment.settled_payroll_run_id <> v_run.id then
    raise exception 'Sunday payment is already assigned to another payroll run';
  end if;
  update public.worker_sunday_payment set
    settlement_method = 'payroll', settled_payroll_run_id = v_run.id, settled_payroll_line_id = v_line.id
  where id = v_payment.id returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.mark_sunday_payment_paid(p_sunday_payment_id uuid)
returns public.worker_sunday_payment
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_payment public.worker_sunday_payment%rowtype;
begin
  if not public.is_admin() then raise exception 'Active admin access is required'; end if;
  update public.worker_sunday_payment set
    payment_status = 'paid', settlement_method = 'separate', paid_at = now(), paid_by = auth.uid()
  where id = p_sunday_payment_id and payment_status = 'unpaid' and settled_payroll_run_id is null
  returning * into v_payment;
  if v_payment.id is null then raise exception 'Sunday payment is unavailable, already paid, or assigned to payroll'; end if;
  return v_payment;
end;
$$;

create or replace function public.mark_payroll_run_paid_with_sundays(p_payroll_run_id uuid)
returns public.payroll_run
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_run public.payroll_run%rowtype;
begin
  if not public.is_admin() then raise exception 'Active admin access is required'; end if;
  select * into v_run from public.payroll_run where id = p_payroll_run_id for update;
  if v_run.id is null or v_run.status <> 'finalized' then raise exception 'Only a finalized payroll run can be paid'; end if;
  update public.payroll_run set status = 'paid', paid_at = now(), paid_by = auth.uid()
  where id = p_payroll_run_id returning * into v_run;
  update public.worker_sunday_payment set payment_status = 'paid', paid_at = v_run.paid_at, paid_by = auth.uid()
  where settled_payroll_run_id = p_payroll_run_id and payment_status = 'unpaid';
  return v_run;
end;
$$;

revoke all on function public.confirm_worker_sunday_work(uuid, date, text) from public;
revoke all on function public.cancel_sunday_work(uuid, text) from public;
revoke all on function public.assign_sunday_payment_to_payroll_line(uuid, uuid) from public;
revoke all on function public.mark_sunday_payment_paid(uuid) from public;
revoke all on function public.mark_payroll_run_paid_with_sundays(uuid) from public;
grant execute on function public.confirm_worker_sunday_work(uuid, date, text) to authenticated;
grant execute on function public.cancel_sunday_work(uuid, text) to authenticated;
grant execute on function public.assign_sunday_payment_to_payroll_line(uuid, uuid) to authenticated;
grant execute on function public.mark_sunday_payment_paid(uuid) to authenticated;
grant execute on function public.mark_payroll_run_paid_with_sundays(uuid) to authenticated;
