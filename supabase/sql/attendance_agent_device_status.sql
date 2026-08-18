-- REVIEW ONLY. Additive per-device status for the local Attendance Agent.
create table if not exists public.attendance_agent_device_status (
  agent_id text not null references public.attendance_agent_status(agent_id) on delete cascade,
  device_id text not null,
  last_seen_at timestamptz not null default now(),
  hikvision_reachable boolean not null default false,
  last_successful_read_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (agent_id, device_id)
);
alter table public.attendance_agent_device_status enable row level security;
drop policy if exists attendance_agent_device_status_admin_select on public.attendance_agent_device_status;
create policy attendance_agent_device_status_admin_select on public.attendance_agent_device_status for select to authenticated using (public.is_admin());
