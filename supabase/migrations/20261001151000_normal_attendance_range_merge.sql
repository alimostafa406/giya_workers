-- A current-day frozen snapshot covers today only. Do not let it replace the
-- historical portion of a requested attendance week/range.
begin;

create or replace function public.get_normal_worker_attendance_report(
  p_date_from date, p_date_to date, p_session_token text
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_history jsonb;
  v_today_snapshot jsonb;
  v_workers jsonb;
  v_teams jsonb;
  v_requests_today boolean;
begin
  if p_date_from is null or p_date_to is null then
    raise exception 'date range is required' using errcode = '22004';
  end if;
  if p_date_to < p_date_from or p_date_to - p_date_from > 31 then
    raise exception 'date range must be between 1 and 32 calendar days' using errcode = '22023';
  end if;
  perform public.foreign_monitoring_require_session(p_session_token);

  v_requests_today := p_date_from <= v_today and p_date_to >= v_today;
  if p_date_from <= least(p_date_to, v_today - 1) then
    v_history := public.foreign_monitoring_normal_report_payload(
      p_date_from, least(p_date_to, v_today - 1));
  end if;
  if v_requests_today then
    select s.payload into v_today_snapshot
    from public.foreign_monitoring_normal_report_snapshot s
    where s.report_date = v_today;
  end if;

  select coalesce(jsonb_agg(worker order by worker->>'fullName'), '[]'::jsonb)
  into v_workers from (
    select distinct on (item->>'id') item worker
    from jsonb_array_elements(coalesce(v_today_snapshot->'workers', '[]'::jsonb)
      || coalesce(v_history->'workers', '[]'::jsonb)) with ordinality as x(item, ordinal)
    order by item->>'id', ordinal
  ) distinct_workers;
  select coalesce(jsonb_agg(team order by team->>'name'), '[]'::jsonb)
  into v_teams from (
    select distinct on (item->>'id') item team
    from jsonb_array_elements(coalesce(v_today_snapshot->'teams', '[]'::jsonb)
      || coalesce(v_history->'teams', '[]'::jsonb)) with ordinality as x(item, ordinal)
    order by item->>'id', ordinal
  ) distinct_teams;

  perform public.foreign_monitoring_touch_session(p_session_token);
  return jsonb_build_object(
    'dateFrom', p_date_from, 'dateTo', p_date_to,
    'reportAvailable', v_history is not null or v_today_snapshot is not null,
    'withheldCurrentDay', v_requests_today and v_today_snapshot is null,
    'finalizedSnapshot', v_today_snapshot is not null,
    'workers', v_workers, 'teams', v_teams,
    'attendance', coalesce(v_history->'attendance', '[]'::jsonb)
      || coalesce(v_today_snapshot->'attendance', '[]'::jsonb),
    'mappedBiometricEvents', coalesce(v_history->'mappedBiometricEvents', '[]'::jsonb)
      || coalesce(v_today_snapshot->'mappedBiometricEvents', '[]'::jsonb));
end $$;

revoke all on function public.get_normal_worker_attendance_report(date,date,text)
  from public, anon, authenticated;
grant execute on function public.get_normal_worker_attendance_report(date,date,text)
  to anon, authenticated;

commit;
