-- REVIEW ONLY: local-agent heartbeat table. Do not execute automatically.
-- This adds a new table only; it does not alter attendance, workers, mappings, or RLS elsewhere.

create table if not exists public.attendance_agent_status (
  agent_id text primary key,
  machine_name text not null,
  last_seen_at timestamptz not null default now(),
  hikvision_reachable boolean not null default false,
  supabase_reachable boolean not null default false,
  last_user_sync_at timestamptz,
  last_attendance_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.attendance_agent_status
  add column if not exists machine_name text,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists hikvision_reachable boolean not null default false,
  add column if not exists supabase_reachable boolean not null default false,
  add column if not exists last_user_sync_at timestamptz,
  add column if not exists last_attendance_sync_at timestamptz,
  add column if not exists last_error text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_attendance_agent_status_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists attendance_agent_status_set_updated_at on public.attendance_agent_status;
create trigger attendance_agent_status_set_updated_at
before update on public.attendance_agent_status
for each row
execute function public.set_attendance_agent_status_updated_at();

alter table public.attendance_agent_status enable row level security;

drop policy if exists attendance_agent_status_admin_select on public.attendance_agent_status;
create policy attendance_agent_status_admin_select
on public.attendance_agent_status
for select
to authenticated
using (public.is_admin());
