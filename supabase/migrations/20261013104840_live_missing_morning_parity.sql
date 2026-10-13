-- The public missing-morning list is a live read of the same eligible roster
-- and canonical check-in evidence used by the main absence report. Other
-- normal-report pages keep their existing frozen publication payload.
begin;

create or replace function public.foreign_monitoring_live_missing_morning_payload(p_date date)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  with missing as materialized (
    select w.id, w.full_name, w.employee_code, t.id as team_id, t.name as team_name
    from public.workers w
    join public.teams t on t.id = w.team_id
    where w.is_active is true
      and t.name <> 'Adminstration'
      and (w.operational_start_date is null or w.operational_start_date <= p_date)
      and not exists (
        select 1 from public.worker_staff_classification c
        where c.worker_id = w.id and c.classification = 'special_staff'
      )
      and not exists (
        select 1 from public.attendance a
        where a.worker_id = w.id and a.attendance_date = p_date
          and nullif(btrim(a.check_in::text), '') is not null
      )
  ), grouped as (
    select team_id, team_name, count(*) as worker_count,
      jsonb_agg(jsonb_build_object(
        'id', id, 'fullName', full_name, 'employeeCode', employee_code
      ) order by full_name, id) as workers
    from missing group by team_id, team_name
  )
  select jsonb_build_object(
    'date', p_date, 'reportAvailable', true, 'withheldCurrentDay', false,
    'source', 'live_canonical_missing_morning',
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', team_id, 'name', team_name, 'workers', workers
      ) order by team_name, team_id) from grouped
    ), '[]'::jsonb),
    'missingWorkers', (select count(*) from missing),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'isActive', t.is_active
      ) order by t.name, t.id)
      from public.teams t
      where t.is_active is true and t.name <> 'Adminstration'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.foreign_monitoring_live_missing_morning_payload(date)
  from public, anon, authenticated;

create or replace function public.get_live_normal_missing_morning_report(
  p_date date, p_session_token text
)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_report jsonb;
begin
  if p_date is null or p_date > v_today then
    raise exception 'report date must be today or earlier' using errcode = '22023';
  end if;
  perform public.foreign_monitoring_require_session(p_session_token);
  if p_date = v_today and not exists (
    select 1 from public.foreign_monitoring_normal_report_snapshot
    where report_date = v_today
  ) then
    perform public.foreign_monitoring_touch_session(p_session_token);
    return jsonb_build_object(
      'date', p_date, 'reportAvailable', false, 'withheldCurrentDay', true,
      'source', 'withheld', 'groups', '[]'::jsonb,
      'missingWorkers', 0, 'teams', '[]'::jsonb
    );
  end if;
  v_report := public.foreign_monitoring_live_missing_morning_payload(p_date);
  perform public.foreign_monitoring_touch_session(p_session_token);
  return v_report;
end $$;

revoke all on function public.get_live_normal_missing_morning_report(date,text)
  from public, anon, authenticated;
grant execute on function public.get_live_normal_missing_morning_report(date,text)
  to anon, authenticated;

commit;
