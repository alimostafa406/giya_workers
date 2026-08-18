-- REVIEW ONLY: additive, persistent review outcome for current device identities.
-- Do not execute automatically. No existing mappings, workers, or attendance are changed.
create table if not exists public.biometric_device_identity_review (
  device_employee_no text primary key,
  review_state text not null default 'ignored',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint biometric_device_identity_review_state_valid check (review_state = 'ignored'),
  constraint biometric_device_identity_review_employee_no_not_blank check (btrim(device_employee_no) <> '')
);

create or replace function public.set_biometric_device_identity_review_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists biometric_device_identity_review_set_updated_at on public.biometric_device_identity_review;
create trigger biometric_device_identity_review_set_updated_at before update on public.biometric_device_identity_review
for each row execute function public.set_biometric_device_identity_review_updated_at();

alter table public.biometric_device_identity_review enable row level security;
drop policy if exists biometric_device_identity_review_admin_select on public.biometric_device_identity_review;
create policy biometric_device_identity_review_admin_select on public.biometric_device_identity_review for select to authenticated using (public.is_admin());
drop policy if exists biometric_device_identity_review_admin_insert on public.biometric_device_identity_review;
create policy biometric_device_identity_review_admin_insert on public.biometric_device_identity_review for insert to authenticated with check (public.is_admin());
drop policy if exists biometric_device_identity_review_admin_update on public.biometric_device_identity_review;
create policy biometric_device_identity_review_admin_update on public.biometric_device_identity_review for update to authenticated using (public.is_admin()) with check (public.is_admin());
