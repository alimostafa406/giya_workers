create table if not exists public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admins a
    where a.id = auth.uid()
      and a.is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists admins_select_own on public.admins;
create policy admins_select_own
on public.admins
for select
to authenticated
using (id = auth.uid());

drop policy if exists teams_admin_select on public.teams;
drop policy if exists teams_admin_insert on public.teams;
drop policy if exists teams_admin_update on public.teams;
drop policy if exists teams_admin_delete on public.teams;
create policy teams_admin_select
on public.teams
for select
to authenticated
using (public.is_admin());
create policy teams_admin_insert
on public.teams
for insert
to authenticated
with check (public.is_admin());
create policy teams_admin_update
on public.teams
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy teams_admin_delete
on public.teams
for delete
to authenticated
using (public.is_admin());

drop policy if exists supervisors_admin_select on public.supervisors;
drop policy if exists supervisors_admin_insert on public.supervisors;
drop policy if exists supervisors_admin_update on public.supervisors;
drop policy if exists supervisors_admin_delete on public.supervisors;
create policy supervisors_admin_select
on public.supervisors
for select
to authenticated
using (public.is_admin());
create policy supervisors_admin_insert
on public.supervisors
for insert
to authenticated
with check (public.is_admin());
create policy supervisors_admin_update
on public.supervisors
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy supervisors_admin_delete
on public.supervisors
for delete
to authenticated
using (public.is_admin());

drop policy if exists workers_admin_select on public.workers;
drop policy if exists workers_admin_insert on public.workers;
drop policy if exists workers_admin_update on public.workers;
drop policy if exists workers_admin_delete on public.workers;
create policy workers_admin_select
on public.workers
for select
to authenticated
using (public.is_admin());
create policy workers_admin_insert
on public.workers
for insert
to authenticated
with check (public.is_admin());
create policy workers_admin_update
on public.workers
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy workers_admin_delete
on public.workers
for delete
to authenticated
using (public.is_admin());

drop policy if exists attendance_admin_select on public.attendance;
drop policy if exists attendance_admin_insert on public.attendance;
drop policy if exists attendance_admin_update on public.attendance;
drop policy if exists attendance_admin_delete on public.attendance;
create policy attendance_admin_select
on public.attendance
for select
to authenticated
using (public.is_admin());
create policy attendance_admin_insert
on public.attendance
for insert
to authenticated
with check (public.is_admin());
create policy attendance_admin_update
on public.attendance
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
create policy attendance_admin_delete
on public.attendance
for delete
to authenticated
using (public.is_admin());
