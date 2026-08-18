-- Base biometric-worker mapping migration.
-- This migration has already been executed in production. Do not run it again.
-- Use biometric_mapping_review_upgrade.sql for the additive review-state upgrade.

create table if not exists public.biometric_worker_mapping (
  id uuid primary key default extensions.gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  device_employee_no text not null,
  device_name text,
  device_picture_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint biometric_worker_mapping_device_employee_no_not_blank
    check (btrim(device_employee_no) <> ''),
  constraint biometric_worker_mapping_device_employee_no_unique
    unique (device_employee_no)
);

create unique index if not exists biometric_worker_mapping_one_active_worker
  on public.biometric_worker_mapping (worker_id)
  where is_active;

create index if not exists biometric_worker_mapping_active_worker_id_idx
  on public.biometric_worker_mapping (worker_id)
  where is_active;

create or replace function public.set_biometric_worker_mapping_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists biometric_worker_mapping_set_updated_at on public.biometric_worker_mapping;
create trigger biometric_worker_mapping_set_updated_at
before update on public.biometric_worker_mapping
for each row
execute function public.set_biometric_worker_mapping_updated_at();

alter table public.biometric_worker_mapping enable row level security;

drop policy if exists biometric_worker_mapping_admin_select on public.biometric_worker_mapping;
create policy biometric_worker_mapping_admin_select
on public.biometric_worker_mapping
for select
to authenticated
using (public.is_admin());

drop policy if exists biometric_worker_mapping_admin_insert on public.biometric_worker_mapping;
create policy biometric_worker_mapping_admin_insert
on public.biometric_worker_mapping
for insert
to authenticated
with check (public.is_admin());

drop policy if exists biometric_worker_mapping_admin_update on public.biometric_worker_mapping;
create policy biometric_worker_mapping_admin_update
on public.biometric_worker_mapping
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
