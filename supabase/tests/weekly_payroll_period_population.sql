-- Read-only integration: historical population includes inactive snapshot
-- members without updating workers, snapshots, attendance, or payroll.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date; result jsonb; snapshot_before text; worker_before text;
begin
  select max(attendance_date) into d from private.supervisor_review_daily_snapshot;
  assert d is not null,'No snapshot available to audit';
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by attendance_date)::text,'[]')) into snapshot_before
    from private.supervisor_review_daily_snapshot s;
  select md5(coalesce(jsonb_agg(to_jsonb(w) order by id)::text,'[]')) into worker_before from public.workers w;
  result:=public.admin_get_weekly_payroll_population(d,d);
  assert jsonb_typeof(result)='array';
  assert not exists(select 1 from private.supervisor_review_daily_snapshot s cross join lateral jsonb_array_elements(s.workers) w
    where s.attendance_date=d and not exists(select 1 from jsonb_array_elements(result) r where r->>'worker_id'=w->>'id')),
    'Historical snapshot member removed by current status';
  assert not exists(select 1 from jsonb_array_elements(result) r where (r->>'date')::date<>d),'Out-of-period population leaked';
  assert (select count(*)=count(distinct r->>'worker_id') from jsonb_array_elements(result) r),'Duplicate workers';
  assert snapshot_before=(select md5(coalesce(jsonb_agg(to_jsonb(s) order by attendance_date)::text,'[]')) from private.supervisor_review_daily_snapshot s);
  assert worker_before=(select md5(coalesce(jsonb_agg(to_jsonb(w) order by id)::text,'[]')) from public.workers w);
  begin
    perform public.admin_get_weekly_payroll_population(d,d+32);
    raise exception 'Invalid range accepted';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
