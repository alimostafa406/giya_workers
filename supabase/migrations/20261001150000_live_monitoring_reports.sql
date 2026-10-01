-- Live read-only operational reports for existing monitoring sessions. This
-- does not alter either report or payroll publication and grants no table read.
begin;

create or replace function public.foreign_monitoring_live_day_payload(p_date date)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_result jsonb;
begin
  if p_date is null then raise exception 'Report date is required' using errcode = '22004'; end if;
  if p_date > v_today or extract(isodow from p_date) = 7
    or (p_date = v_today and not exists (
    select 1 from public.attendance_verification_run v
    where v.work_date = v_today and v.verification_type = 'morning'
      and v.status = 'complete'
    order by v.created_at desc limit 1
  )) then
    return jsonb_build_object('date', p_date, 'available', false,
      'attendance', '[]'::jsonb, 'exceptions', '[]'::jsonb,
      'overtime', '[]'::jsonb, 'monitoring_counts', null, 'counts', null);
  end if;

  with roster as materialized (
    select w.id, w.full_name, w.employee_code, w.team_id, t.name team_name
    from public.workers w join public.teams t on t.id = w.team_id
    where w.is_active is true and t.name <> 'Adminstration'
      and (w.operational_start_date is null or w.operational_start_date <= p_date)
      and not exists (select 1 from public.worker_staff_classification c
        where c.worker_id = w.id and c.classification = 'special_staff')
  ), ids as (
    select m.worker_id, string_agg(distinct btrim(m.device_employee_no), ' · '
      order by btrim(m.device_employee_no)) biometric_id
    from public.biometric_worker_mapping m join roster r on r.id = m.worker_id
    where m.is_active is true and m.mapping_review_state = 'confirmed'
      and nullif(btrim(m.device_employee_no), '') is not null
    group by m.worker_id
  ), safely_resolved as (
    select resolved.worker_id, e.attendance_date, e.event_timestamp
    from public.biometric_attendance_events e
    cross join lateral (
      select case
        when not scope.exact_ignored and scope.exact_owner_count = 1
          then scope.exact_worker_id
        when not scope.exact_ignored and scope.exact_owner_count = 0
          and not scope.legacy_ignored and scope.legacy_owner_count = 1
          then scope.legacy_worker_id
        else null end worker_id
      from (
        select
          exists (select 1 from public.biometric_device_identity_review review
            where review.device_id = e.device_id
              and btrim(review.device_employee_no) = btrim(e.device_employee_no)
              and review.review_state = 'ignored') exact_ignored,
          exists (select 1 from public.biometric_device_identity_review review
            where review.device_id is null
              and btrim(review.device_employee_no) = btrim(e.device_employee_no)
              and review.review_state = 'ignored') legacy_ignored,
          (select count(distinct m.worker_id) from public.biometric_worker_mapping m
            where m.device_id = e.device_id and btrim(m.device_employee_no) = btrim(e.device_employee_no)
              and m.is_active is true and m.mapping_review_state = 'confirmed') exact_owner_count,
          (select (array_agg(distinct m.worker_id))[1] from public.biometric_worker_mapping m
            where m.device_id = e.device_id and btrim(m.device_employee_no) = btrim(e.device_employee_no)
              and m.is_active is true and m.mapping_review_state = 'confirmed') exact_worker_id,
          (select count(distinct m.worker_id) from public.biometric_worker_mapping m
            where m.device_id is null and btrim(m.device_employee_no) = btrim(e.device_employee_no)
              and m.is_active is true and m.mapping_review_state = 'confirmed') legacy_owner_count,
          (select (array_agg(distinct m.worker_id))[1] from public.biometric_worker_mapping m
            where m.device_id is null and btrim(m.device_employee_no) = btrim(e.device_employee_no)
              and m.is_active is true and m.mapping_review_state = 'confirmed') legacy_worker_id
      ) scope
    ) resolved
    where e.device_employee_no is not null and e.attendance_date = p_date
      and resolved.worker_id is not null
  ), operational_evidence as (
    select worker_id, attendance_date, event_timestamp from safely_resolved
    union
    select review.worker_id, review.event_local_date, review.event_timestamp
    from public.biometric_early_morning_review review
    where review.worker_id is not null and review.review_status = 'needs_review'
      and review.event_local_date = p_date
  ), punches as (
    select e.worker_id, max((e.event_timestamp at time zone 'Africa/Kinshasa')::time) last_punch
    from operational_evidence e
    join roster r on r.id = e.worker_id
    where e.attendance_date = p_date
    group by e.worker_id
  ), rows as (
    select r.*, a.id attendance_id, a.status canonical_status, a.check_in,
      a.check_out, a.attendance_day_fraction, a.note,
      coalesce(i.biometric_id, '—') biometric_id, p.last_punch,
      case when a.id is null then case when p_date < v_today then 'absent' else 'not_recorded' end
        when a.status = 'late' then case when a.check_out is null then 'half_day' else 'present' end
        when a.status in ('present', 'half_day', 'absent') then a.status
        else 'not_recorded' end bucket,
      case when a.id is null then 'absent'
        when a.status = 'present' and a.check_in is not null and a.check_out is null
          and a.attendance_day_fraction is distinct from 1 then 'half_day'
        else coalesce(a.status, 'not_recorded') end exception_status,
      coalesce(
        case when a.biometric_sync_metadata->>'check_out_event_timestamp'
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          then (a.biometric_sync_metadata->>'check_out_event_timestamp')::timestamptz end,
        a.review_approved_check_out_at
      ) checkout_evidence
    from roster r
    left join lateral (select a.* from public.attendance a
      where a.worker_id = r.id and a.attendance_date = p_date
      order by a.updated_at desc nulls last, a.id desc limit 1) a on true
    left join ids i on i.worker_id = r.id
    left join punches p on p.worker_id = r.id
  ), checkout_clock as (
    select r.*,
      case when r.check_out is null then null
        else extract(epoch from r.check_out) / 60 +
          case when r.checkout_evidence is not null
            and (r.checkout_evidence at time zone 'Africa/Kinshasa')::date = p_date + 1
            and (r.checkout_evidence at time zone 'Africa/Kinshasa')::time <= time '02:00:00'
            and abs(extract(epoch from
              ((r.checkout_evidence at time zone 'Africa/Kinshasa')::time - r.check_out))) < 1
          then 1440 else 0 end end checkout_minutes
    from rows r
  ), amounts as (
    select c.*,
      case when extract(isodow from p_date) between 1 and 5
        and c.team_name <> 'Chauffeur'
        and c.team_id = any(coalesce((select s.team_ids from public.overtime_report_settings s
          where s.singleton is true), array[]::uuid[]))
        and c.checkout_minutes is not null
        and floor(greatest(c.checkout_minutes - 1020, 0)) >= 60
      then (60 + 30 * floor((floor(greatest(c.checkout_minutes - 1020, 0)) - 60) / 30))::integer
      else 0 end overtime_minutes
    from checkout_clock c
  ), output as (
    select a.*,
      jsonb_build_object('worker_id', a.id, 'worker_name', a.full_name,
        'employee_code', a.employee_code, 'team_id', a.team_id,
        'team_name', a.team_name, 'biometric_id', a.biometric_id,
        'status', a.bucket, 'canonical_status', a.canonical_status,
        'check_in', a.check_in, 'check_out', a.check_out,
        'last_punch', a.last_punch, 'note', a.note) attendance_value,
      jsonb_build_object('worker_id', a.id, 'worker_name', a.full_name,
        'employee_code', a.employee_code, 'team_id', a.team_id,
        'team_name', a.team_name, 'biometric_id', a.biometric_id,
        'status', a.exception_status, 'check_in', a.check_in,
        'check_out', a.check_out, 'last_punch',
          case when a.check_in is not null and a.last_punch > a.check_in
            then a.last_punch else null end,
        'note', a.note, 'derived_absent', a.attendance_id is null) exception_value,
      jsonb_build_object('worker_id', a.id, 'worker_name', a.full_name,
        'employee_code', a.employee_code, 'team_id', a.team_id,
        'team_name', a.team_name, 'biometric_id', a.biometric_id,
        'check_in', a.check_in, 'check_out', a.check_out,
        'overtime_minutes', a.overtime_minutes, 'note', a.note) overtime_value
    from amounts a
  )
  select jsonb_build_object('date', p_date, 'available', true,
    'attendance', coalesce(jsonb_agg(attendance_value order by team_name, full_name), '[]'::jsonb),
    'exceptions', coalesce(jsonb_agg(exception_value order by team_name, full_name)
      filter (where exception_status <> 'present'), '[]'::jsonb),
    'overtime', coalesce(jsonb_agg(overtime_value order by team_name, full_name)
      filter (where overtime_minutes >= 120), '[]'::jsonb),
    'monitoring_counts', jsonb_build_object(
      'total', count(*),
      'present', count(*) filter (where bucket = 'present'),
      'half_day', count(*) filter (where bucket = 'half_day'),
      'absent', count(*) filter (where bucket = 'absent'),
      'not_recorded', count(*) filter (where bucket = 'not_recorded')),
    'counts', jsonb_build_object(
      'exceptions', count(*) filter (where exception_status <> 'present'),
      'absent', count(*) filter (where exception_status = 'absent'),
      'half_day', count(*) filter (where exception_status = 'half_day'),
      'not_recorded', count(*) filter (where attendance_id is null),
      'overtime_workers', count(*) filter (where overtime_minutes >= 120),
      'overtime_minutes', coalesce(sum(overtime_minutes)
        filter (where overtime_minutes >= 120), 0)))
  into v_result from output;
  return v_result;
end $$;

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
    select coalesce(jsonb_agg(public.foreign_monitoring_live_day_payload(d::date)
      order by d), '[]'::jsonb) into v_days
    from generate_series(v_monday::timestamp, (v_monday + 5)::timestamp,
      interval '1 day') d;
  else
    v_days := jsonb_build_array(public.foreign_monitoring_live_day_payload(p_date));
  end if;
  perform public.foreign_monitoring_touch_session(p_session_token);
  return jsonb_build_object('schema_version', 1, 'publication_required', false,
    'source', 'live_canonical', 'period_start', v_monday,
    'period_end', v_monday + 5, 'days', v_days,
    'available_report_types', jsonb_build_array('daily_attendance',
      'attendance_exceptions', 'daily_overtime'));
end $$;

revoke all on function public.foreign_monitoring_live_day_payload(date) from public, anon, authenticated;
revoke all on function public.get_live_operational_reports(text,date) from public, anon, authenticated;
grant execute on function public.get_live_operational_reports(text,date) to anon, authenticated;

commit;
