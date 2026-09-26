-- Configuration changes below are rolled back; no attendance/payroll writes.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.admins where is_active is true limit 1), true);
set local role authenticated;
do $$
declare team uuid; result jsonb;
begin
  if has_table_privilege('authenticated', 'public.overtime_report_settings', 'UPDATE')
    or has_table_privilege('anon', 'public.overtime_report_settings', 'SELECT')
    or has_function_privilege('anon', 'public.save_overtime_report_settings(uuid[])', 'EXECUTE')
  then raise exception 'Direct/public access must be denied'; end if;
  select id into team from public.teams where is_active is true and name not in ('Chauffeur','Adminstration') limit 1;
  result := public.save_overtime_report_settings(array[team,team]);
  if jsonb_array_length(result->'team_ids') <> 1 then raise exception 'Duplicate selection'; end if;
  result := public.save_overtime_report_settings(array[]::uuid[]);
  if result->'team_ids' <> '[]'::jsonb then raise exception 'Empty selection failed'; end if;
  begin
    perform public.save_overtime_report_settings(array[(select id from public.teams where name='Chauffeur' limit 1)]);
    raise exception 'Chauffeur accepted';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
  begin
    perform public.save_overtime_report_settings(array[team]);
    raise exception 'Non-admin accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_overtime_report_settings();
    raise exception 'Non-admin read accepted';
  exception when insufficient_privilege then null; end;
end; $$;
rollback;
