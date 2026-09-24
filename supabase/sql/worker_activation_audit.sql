-- REVIEW / EXECUTE MANUALLY. Append-only audit of explicit inactive -> active changes.
create table if not exists public.worker_activation_audit (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete restrict,
  activated_at timestamptz not null default now(),
  activated_by uuid references public.admins(id) on delete restrict,
  source text not null default 'admin_ui' check (btrim(source) <> ''),
  created_at timestamptz not null default now()
);
create index if not exists worker_activation_audit_worker_time_idx on public.worker_activation_audit (worker_id, activated_at desc);

create or replace function public.audit_worker_activation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_active is false and new.is_active is true then
    insert into public.worker_activation_audit (worker_id, activated_by)
    values (new.id, (select id from public.admins where id = auth.uid() and is_active is true limit 1));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_worker_activation() from public, anon, authenticated;
drop trigger if exists worker_activation_audit_change on public.workers;
create trigger worker_activation_audit_change after update of is_active on public.workers for each row execute function public.audit_worker_activation();

alter table public.worker_activation_audit enable row level security;
revoke all on table public.worker_activation_audit from public, anon, authenticated;
grant select on table public.worker_activation_audit to authenticated;
drop policy if exists worker_activation_audit_admin_select on public.worker_activation_audit;
create policy worker_activation_audit_admin_select on public.worker_activation_audit for select to authenticated using (public.is_admin());

create or replace function public.get_workers_activated_today()
returns table(worker_id uuid, full_name text, employee_code text, team_name text, activated_at timestamptz, biometric_ids text[])
language sql stable security definer set search_path = public, pg_temp as $$
  with latest as (
    select distinct on (worker_id) worker_id, activated_at
    from public.worker_activation_audit
    where activated_at >= date_trunc('day', now() at time zone 'Africa/Kinshasa') at time zone 'Africa/Kinshasa'
      and activated_at < (date_trunc('day', now() at time zone 'Africa/Kinshasa') + interval '1 day') at time zone 'Africa/Kinshasa'
    order by worker_id, activated_at desc
  )
  select a.worker_id, w.full_name::text, w.employee_code::text, t.name::text, a.activated_at,
    coalesce(array_agg(distinct m.device_employee_no) filter (where m.is_active is true and m.mapping_review_state = 'confirmed'), array[]::text[])
  from latest a join public.workers w on w.id = a.worker_id left join public.teams t on t.id = w.team_id
  left join public.biometric_worker_mapping m on m.worker_id = w.id
  where public.is_admin()
  group by a.worker_id, w.full_name, w.employee_code, t.name, a.activated_at
  order by a.activated_at desc;
$$;
revoke all on function public.get_workers_activated_today() from public, anon;
grant execute on function public.get_workers_activated_today() to authenticated;
