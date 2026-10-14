-- Team responsibility only; never changes workers.team_id or roster membership.
alter table public.teams add column foreman_worker_id uuid null
  references public.workers(id) on delete restrict;
create index teams_foreman_worker_id_idx on public.teams(foreman_worker_id)
  where foreman_worker_id is not null;
comment on column public.teams.foreman_worker_id is
  'Optional active special-staff foreman; responsibility metadata, not team membership.';

create function public.validate_team_foreman()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.foreman_worker_id is not distinct from old.foreman_worker_id then return new; end if;
  end if;
  if new.foreman_worker_id is null then return new; end if;
  if not public.is_admin() then
    raise exception 'Admin access required to assign a team foreman' using errcode = '42501';
  end if;
  perform 1 from public.workers w
    join public.worker_staff_classification c on c.worker_id = w.id
    where w.id = new.foreman_worker_id and w.is_active is true
      and c.classification = 'special_staff'
    for share of w, c;
  if not found then
    raise exception 'Team foreman must be an active special-staff worker' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_team_foreman() from public, anon, authenticated;
create trigger teams_validate_foreman before insert or update of foreman_worker_id
  on public.teams for each row execute function public.validate_team_foreman();
notify pgrst, 'reload schema';
