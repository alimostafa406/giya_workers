-- REVIEW / EXECUTE MANUALLY: persistent Hikvision identity discovery tracking.
-- Additive only. It does not alter attendance, mappings, workers, or payroll.

create table if not exists public.biometric_device_identity_presence (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  device_employee_no text not null,
  device_name text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint biometric_device_identity_presence_device_employee_unique unique (device_id, device_employee_no),
  constraint biometric_device_identity_presence_employee_not_blank check (btrim(device_employee_no) <> '')
);

create index if not exists biometric_device_identity_presence_current_first_seen_idx
  on public.biometric_device_identity_presence (is_current, first_seen_at);

create or replace function public.sync_biometric_device_identity_presence(
  p_present jsonb,
  p_successful_device_ids text[],
  p_seen_at timestamptz default now()
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.biometric_device_identity_presence (device_id, device_employee_no, device_name, first_seen_at, last_seen_at, is_current)
  select btrim(item->>'device_id'), btrim(item->>'device_employee_no'), nullif(btrim(item->>'device_name'), ''), p_seen_at, p_seen_at, true
  from jsonb_array_elements(coalesce(p_present, '[]'::jsonb)) item
  where btrim(coalesce(item->>'device_id', '')) <> '' and btrim(coalesce(item->>'device_employee_no', '')) <> ''
  on conflict (device_id, device_employee_no) do update set
    device_name = excluded.device_name,
    last_seen_at = excluded.last_seen_at,
    is_current = true,
    updated_at = now();

  update public.biometric_device_identity_presence presence
  set is_current = false, updated_at = now()
  where presence.device_id = any(coalesce(p_successful_device_ids, array[]::text[]))
    and presence.is_current
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_present, '[]'::jsonb)) item
      where item->>'device_id' = presence.device_id and item->>'device_employee_no' = presence.device_employee_no
    );
end;
$$;

-- Manual bootstrap only: inserts conservative old discovery timestamps and never overwrites existing rows.
create or replace function public.bootstrap_biometric_device_identity_presence(
  p_rows jsonb,
  p_baseline_seen_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.biometric_device_identity_presence (device_id, device_employee_no, device_name, first_seen_at, last_seen_at, is_current)
  select btrim(item->>'device_id'), btrim(item->>'device_employee_no'), nullif(btrim(item->>'device_name'), ''), p_baseline_seen_at, p_baseline_seen_at,
    coalesce((item->>'is_current')::boolean, false)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) item
  where btrim(coalesce(item->>'device_id', '')) <> '' and btrim(coalesce(item->>'device_employee_no', '')) <> ''
  on conflict (device_id, device_employee_no) do nothing;
end;
$$;

alter table public.biometric_device_identity_presence enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biometric_device_identity_presence' and policyname = 'biometric_device_identity_presence_admin_select') then
    create policy biometric_device_identity_presence_admin_select on public.biometric_device_identity_presence for select to authenticated using (public.is_admin());
  end if;
end $$;

grant execute on function public.sync_biometric_device_identity_presence(jsonb, text[], timestamptz) to service_role;
grant execute on function public.bootstrap_biometric_device_identity_presence(jsonb, timestamptz) to service_role;
