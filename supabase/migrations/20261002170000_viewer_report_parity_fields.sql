-- Read-only display fields required by the main dashboard's attendance views.
-- Keep the existing monitoring-session gate and all canonical calculations.
begin;

create or replace function public.get_live_operational_reports(
  p_session_token text, p_date date default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_monday date := v_today - (extract(isodow from v_today)::integer - 1);
  v_days jsonb;
begin
  perform public.foreign_monitoring_require_session(p_session_token);
  if p_date is null then
    v_days := public.foreign_monitoring_live_range_payload(v_monday, v_monday + 5);
  else
    v_days := public.foreign_monitoring_live_range_payload(p_date, p_date);
  end if;

  -- The shared report payload already contains canonical status and counts.
  -- Add only the metadata used by DailyAttendanceSummary's visible row list.
  select coalesce(jsonb_agg(jsonb_set(d.day, '{attendance}',
    coalesce((select jsonb_agg(e.row || jsonb_build_object(
      'roster_state', case when a.id is not null then null
        when (d.day->>'date')::date = v_today then
          case when e.row->>'last_punch' is not null then 'biometric_pending' else 'not_recorded' end
        else 'confirmed_absent' end,
      'lateness_seconds', a.biometric_sync_metadata->'lateness_seconds'
    ) order by e.ordinal)
    from jsonb_array_elements(d.day->'attendance') with ordinality e(row, ordinal)
    left join public.attendance a on a.worker_id = (e.row->>'worker_id')::uuid
      and a.attendance_date = (d.day->>'date')::date), '[]'::jsonb),
    true) order by d.ordinal), '[]'::jsonb)
  into v_days
  from jsonb_array_elements(v_days) with ordinality d(day, ordinal);

  perform public.foreign_monitoring_touch_session(p_session_token);
  return jsonb_build_object('schema_version', 1, 'publication_required', false,
    'source', 'live_canonical', 'period_start', v_monday,
    'period_end', v_monday + 5, 'days', v_days,
    'available_report_types', jsonb_build_array('daily_attendance',
      'attendance_exceptions', 'daily_overtime'));
end $$;
revoke all on function public.get_live_operational_reports(text,date) from public, anon, authenticated;
grant execute on function public.get_live_operational_reports(text,date) to anon, authenticated;

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
    select distinct on (item->>'id')
      item || jsonb_build_object('operationalStartDate', w.operational_start_date) worker
    from jsonb_array_elements(coalesce(v_today_snapshot->'workers', '[]'::jsonb)
      || coalesce(v_history->'workers', '[]'::jsonb)) with ordinality as x(item, ordinal)
    left join public.workers w on w.id = (item->>'id')::uuid
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
