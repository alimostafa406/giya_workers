-- Integration tests against the deployed RPCs. All fixture/publication writes roll back.
begin;
do $$
declare
  admin_id uuid;
  viewer public.foreign_monitoring_users;
  token text := encode(extensions.gen_random_bytes(32),'hex');
  source jsonb;
  days jsonb;
  result jsonb;
  before_attendance text;
  before_payroll text;
  before_history text;
  monday date;
begin
  select id into admin_id from public.admins where is_active is true limit 1;
  select * into viewer from public.foreign_monitoring_users where is_active is true limit 1;
  if admin_id is null or viewer.id is null then raise exception 'Test requires existing active admin and monitoring user'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into before_attendance from public.attendance a;
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) into before_payroll from public.weekly_payroll_publication p;
  insert into public.foreign_monitoring_sessions(user_id,token_hash,pin_version,expires_at)
    values(viewer.id,extensions.digest(token,'sha256'),viewer.pin_version,now()+interval '1 hour');
  if has_table_privilege('anon','public.operational_report_publication','SELECT')
    or has_table_privilege('authenticated','public.operational_report_publication','UPDATE')
    or has_function_privilege('anon','public.publish_current_report_publication_admin(text,jsonb)','EXECUTE')
  then raise exception 'Unexpected public write/table permissions'; end if;
  result := public.stop_current_report_publication_admin();
  if (result->>'published')::boolean then raise exception 'Stop did not hide publication'; end if;
  result := public.get_published_operational_reports(token);
  if (result->>'published')::boolean or result->'days'<>'[]'::jsonb then raise exception 'Unpublished rows leaked'; end if;
  source := public.get_current_report_publication_source_admin();
  monday := (source->>'period_start')::date;
  insert into public.operational_report_publication(period_start,period_end,published,days)
    values(monday-7,monday-2,false,'[]') on conflict(period_start) do nothing;
  select md5(to_jsonb(p)::text) into before_history from public.operational_report_publication p where period_start=monday-7;
  if extract(isodow from monday)<>1 or (source->>'period_end')::date<>monday+5 then raise exception 'Invalid week boundary'; end if;
  select jsonb_agg(jsonb_build_object('date',day,'attendance',
    coalesce((select jsonb_agg(jsonb_build_object('worker_id',w->>'id','status','absent','biometric_id',null,
      'check_in',null,'check_out',null,'last_punch',null) order by w->>'id')
      from jsonb_array_elements(source->'workers') w
      where nullif(w->>'operational_start_date','') is null or (w->>'operational_start_date')::date<=day::date),'[]'::jsonb),
    'overtime','[]'::jsonb) order by day)
  into days from jsonb_array_elements_text(source->'available_dates') day;
  if days is null then raise exception 'Test requires at least one available day'; end if;
  begin
    perform public.publish_current_report_publication_admin('wrong-revision',days);
    raise exception 'Stale source accepted';
  exception when serialization_failure then null; end;
  result := public.publish_current_report_publication_admin(source->>'source_revision',days);
  if not (result->>'published')::boolean then raise exception 'Publish failed'; end if;
  result := public.get_published_operational_reports(token);
  if jsonb_array_length(result->'days')<>jsonb_array_length(days) then raise exception 'Published scope mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(result->'days') d cross join jsonb_array_elements(d->'attendance') w where w->>'team_name'='Adminstration') then raise exception 'Administration leaked'; end if;
  result := public.get_published_operational_reports(token,monday-1);
  if (result->>'published')::boolean or result->'days'<>'[]'::jsonb then raise exception 'Out-of-scope rows leaked'; end if;
  result := public.get_published_operational_reports(token,monday,'daily_overtime');
  if exists(select 1 from jsonb_array_elements(result->'days') d where d ? 'attendance') then raise exception 'Unexpected report type payload'; end if;
  perform public.publish_current_report_publication_admin(source->>'source_revision',days);
  if (select count(*) from public.operational_report_publication where period_start=monday)<>1 then raise exception 'Duplicate publication'; end if;
  perform public.stop_current_report_publication_admin();
  if public.get_published_operational_reports(token)->'days'<>'[]'::jsonb then raise exception 'Stop leaked saved payload'; end if;
  if before_history is distinct from (select md5(to_jsonb(p)::text) from public.operational_report_publication p where period_start=monday-7) then raise exception 'Historical snapshot changed'; end if;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  begin perform public.get_current_report_publication_source_admin(); raise exception 'Non-admin source allowed'; exception when insufficient_privilege then null; end;
  begin perform public.get_current_report_publication_admin(); raise exception 'Non-admin status allowed'; exception when insufficient_privilege then null; end;
  begin perform public.publish_current_report_publication_admin(source->>'source_revision',days); raise exception 'Non-admin publish allowed'; exception when insufficient_privilege then null; end;
  begin perform public.stop_current_report_publication_admin(); raise exception 'Non-admin stop allowed'; exception when insufficient_privilege then null; end;
  begin perform public.get_published_operational_reports(repeat('0',64)); raise exception 'Invalid viewer session allowed'; exception when insufficient_privilege then null; end;
  if before_attendance is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.attendance a)
    or before_payroll is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) from public.weekly_payroll_publication p)
  then raise exception 'Attendance or payroll publication changed'; end if;
end;
$$;
rollback;
