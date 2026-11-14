-- Overtime is a compensation workflow, not the morning attendance roster.
-- Preserve every authorization, version, audit, payroll and evidence guard.
do $$
declare definition text; target regprocedure; before_text text; after_text text;
begin
 for target,before_text,after_text in
 select * from (values
 ('private.viewer_weekly_ot_core(date,jsonb,uuid,uuid,text)'::regprocedure,
  'and t.name <> ''Adminstration''', 'and nullif(btrim(t.name),'''') is not null'),
 ('private.viewer_daily_ot_core(uuid,date,text,text,text,jsonb,uuid,uuid)'::regprocedure,
  'or v_team_name = ''Adminstration'' or (v_team_name = ''Chauffeur'' and p_mode <> ''manual_overtime_duration'')',
  'or (v_team_name in (''Adminstration'',''Chauffeur'') and p_mode <> ''manual_overtime_duration'')'),
 ('private.viewer_payroll_reviews_without_checkout(date,date)'::regprocedure,
  't.name not in (''Adminstration'',''Chauffeur'')', 't.name <> ''Chauffeur'''),
 ('private.viewer_biometric_ot_before_extra_day(date,jsonb,uuid,uuid,text)'::regprocedure,
  'team_name in (''Adminstration'',''Chauffeur'')', 'team_name = ''Chauffeur''')
 ) changes(target,before_text,after_text)
 loop
  definition:=pg_get_functiondef(target);
  if strpos(definition,before_text)=0 then
   raise exception 'Unexpected overtime function definition: %',target;
  end if;
  execute replace(definition,before_text,after_text);
 end loop;
end $$;
notify pgrst,'reload schema';
