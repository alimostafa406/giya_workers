create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_create_supervisor(
  p_username text,
  p_password text,
  p_full_name text,
  p_team_id text default null,
  p_is_active boolean default true
)
returns public.supervisors
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_supervisor public.supervisors;
begin
  if coalesce(trim(p_password), '') = '' then
    raise exception 'Password is required';
  end if;

  insert into public.supervisors (
    username,
    password_hash,
    full_name,
    team_id,
    is_active
  )
  values (
    p_username,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    p_full_name,
    (
      select t.id
      from public.teams t
      where t.id::text = nullif(trim(p_team_id), '')
      limit 1
    ),
    coalesce(p_is_active, true)
  )
  returning * into v_supervisor;

  return v_supervisor;
end;
$$;

create or replace function public.admin_update_supervisor(
  p_id text,
  p_username text,
  p_full_name text,
  p_team_id text default null,
  p_is_active boolean default true,
  p_password text default null
)
returns public.supervisors
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_supervisor public.supervisors;
begin
  update public.supervisors s
  set
    username = p_username,
    full_name = p_full_name,
    team_id = case
      when p_team_id is null then s.team_id
      when trim(p_team_id) = '' then null
      else (
        select t.id
        from public.teams t
        where t.id::text = trim(p_team_id)
        limit 1
      )
    end,
    is_active = coalesce(p_is_active, s.is_active),
    password_hash = case
      when coalesce(trim(p_password), '') = '' then s.password_hash
      else extensions.crypt(p_password, extensions.gen_salt('bf'))
    end
  where s.id::text = p_id
  returning s.* into v_supervisor;

  if v_supervisor.id is null then
    raise exception 'Supervisor not found';
  end if;

  return v_supervisor;
end;
$$;

revoke all on function public.admin_create_supervisor(text, text, text, text, boolean) from public;
revoke all on function public.admin_update_supervisor(text, text, text, text, boolean, text) from public;

grant execute on function public.admin_create_supervisor(text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_update_supervisor(text, text, text, text, boolean, text) to authenticated;
