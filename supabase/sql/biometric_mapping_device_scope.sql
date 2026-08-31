-- REVIEW / EXECUTE MANUALLY ONLY.
-- Enables multiple device-scoped identities per worker without rewriting any
-- existing mapping. Existing rows remain legacy-global (device_id is null)
-- and continue to resolve as before until an admin explicitly scopes them.

alter table public.biometric_worker_mapping
  add column if not exists device_id text;

alter table public.biometric_worker_mapping
  drop constraint if exists biometric_worker_mapping_device_employee_no_unique;

drop index if exists public.biometric_worker_mapping_one_active_worker;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'biometric_worker_mapping_device_id_not_blank'
      and conrelid = 'public.biometric_worker_mapping'::regclass
  ) then
    alter table public.biometric_worker_mapping
      add constraint biometric_worker_mapping_device_id_not_blank
      check (device_id is null or btrim(device_id) <> '');
  end if;
end;
$$;

-- A scoped identity can have only one active worker. Null device_id is a
-- deliberate compatibility scope for old globally-keyed mappings.
create unique index if not exists biometric_worker_mapping_active_scoped_identity_unique
  on public.biometric_worker_mapping (device_id, device_employee_no)
  where is_active and device_id is not null;

create unique index if not exists biometric_worker_mapping_active_legacy_identity_unique
  on public.biometric_worker_mapping (device_employee_no)
  where is_active and device_id is null;

create index if not exists biometric_worker_mapping_active_device_employee_idx
  on public.biometric_worker_mapping (device_id, device_employee_no)
  where is_active;

-- The worker index is intentionally non-unique: one worker may resolve from
-- multiple legitimate device identities.
create index if not exists biometric_worker_mapping_active_worker_id_idx
  on public.biometric_worker_mapping (worker_id)
  where is_active;

-- Ignore decisions use the same scope. Existing rows remain legacy-global.
alter table public.biometric_device_identity_review
  add column if not exists device_id text;

alter table public.biometric_device_identity_review
  drop constraint if exists biometric_device_identity_review_pkey;

create unique index if not exists biometric_device_identity_review_scoped_unique
  on public.biometric_device_identity_review (device_id, device_employee_no)
  where device_id is not null;

create unique index if not exists biometric_device_identity_review_legacy_unique
  on public.biometric_device_identity_review (device_employee_no)
  where device_id is null;
