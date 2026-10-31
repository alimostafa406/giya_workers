-- Applied production migration version: 20261031115748.
-- Manual admin duration entry only. Keep biometric review, automatic OT,
-- manual-checkout restrictions, authorization, locks, versions and audit intact.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.admin_set_weekly_overtime(date,jsonb)'::regprocedure);
  if strpos(definition, 'and t.name not in (''Adminstration'',''Chauffeur'')') = 0 then
    raise exception 'Unexpected weekly overtime eligibility definition';
  end if;
  execute replace(definition,
    'and t.name not in (''Adminstration'',''Chauffeur'')',
    'and t.name <> ''Adminstration''');

  definition := pg_get_functiondef('public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb)'::regprocedure);
  if strpos(definition, 'or v_team_name in (''Adminstration'', ''Chauffeur'')') = 0 then
    raise exception 'Unexpected daily overtime eligibility definition';
  end if;
  execute replace(definition,
    'or v_team_name in (''Adminstration'', ''Chauffeur'')',
    'or v_team_name = ''Adminstration'' or (v_team_name = ''Chauffeur'' and p_mode <> ''manual_overtime_duration'')');
end $$;
revoke all on function public.admin_set_weekly_overtime(date,jsonb) from public,anon;
grant execute on function public.admin_set_weekly_overtime(date,jsonb) to authenticated;
revoke all on function public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb) from public,anon;
grant execute on function public.admin_apply_bulk_emergency_overtime(uuid,date,text,text,text,jsonb) to authenticated;
