-- Applied production version: 20261019164917.
-- Service handoff only; the existing atomic gate still proves completion.
create function public.agent_finalize_morning_report(p_date date) returns jsonb
language plpgsql volatile security definer set search_path=public,private,pg_temp as $$
begin
  if p_date is distinct from (now() at time zone 'Africa/Kinshasa')::date then
    raise exception 'Agent completion handoff requires today' using errcode='22023';
  end if;
  return private.complete_morning_report(p_date);
end $$;
revoke all on function public.agent_finalize_morning_report(date) from public,anon,authenticated;
grant execute on function public.agent_finalize_morning_report(date) to service_role;
notify pgrst,'reload schema';
