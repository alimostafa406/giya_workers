begin;
create table public.overtime_report_settings (
  singleton boolean primary key default true check (singleton),
  team_ids uuid[] not null default array[]::uuid[],
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.overtime_report_settings enable row level security;
revoke all on public.overtime_report_settings from public, anon, authenticated;
insert into public.overtime_report_settings (singleton) values (true);

create function public.get_overtime_report_settings()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'team_ids', (select to_jsonb(team_ids) from public.overtime_report_settings where singleton),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from public.teams where is_active is true and name not in ('Adminstration', 'Chauffeur')), '[]'::jsonb)
  );
end; $$;

create function public.save_overtime_report_settings(p_team_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare selected_ids uuid[];
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_team_ids is null or exists (
    select 1 from unnest(p_team_ids) selected(id)
    left join public.teams t on t.id = selected.id
    where t.id is null or t.is_active is not true or t.name in ('Adminstration', 'Chauffeur')
  ) then raise exception 'Select active operational overtime teams only' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct id order by id), array[]::uuid[]) into selected_ids from unnest(p_team_ids) selected(id);
  update public.overtime_report_settings set team_ids = selected_ids, updated_at = now(), updated_by = auth.uid() where singleton;
  return public.get_overtime_report_settings();
end; $$;
revoke all on function public.get_overtime_report_settings() from public, anon, authenticated;
revoke all on function public.save_overtime_report_settings(uuid[]) from public, anon, authenticated;
grant execute on function public.get_overtime_report_settings() to authenticated;
grant execute on function public.save_overtime_report_settings(uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
