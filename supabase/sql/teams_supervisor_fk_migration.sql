-- Preflight check: run this first to find orphaned team supervisor references.
-- It returns any teams.supervisor_id values that do not exist in public.supervisors.id.
select
  t.id as team_id,
  t.supervisor_id
from public.teams t
left join public.supervisors s
  on s.id = t.supervisor_id
where t.supervisor_id is not null
  and s.id is null;

begin;

do $$
begin
  if exists (
    select 1
    from public.teams t
    left join public.supervisors s
      on s.id = t.supervisor_id
    where t.supervisor_id is not null
      and s.id is null
  ) then
    raise exception
      'Cannot migrate teams.supervisor_id: one or more values do not match public.supervisors.id';
  end if;
end
$$;

alter table public.teams
  drop constraint if exists teams_supervisor_id_fkey;

alter table public.teams
  add constraint teams_supervisor_id_fkey
  foreign key (supervisor_id)
  references public.supervisors(id)
  on update cascade
  on delete restrict;

commit;