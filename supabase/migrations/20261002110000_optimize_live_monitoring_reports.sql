-- Keep the live report contract, but resolve roster, mappings, and biometric
-- evidence once for a bounded range instead of rebuilding them per day.
begin;

create or replace function public.foreign_monitoring_live_range_payload(p_start date, p_end date)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_today_complete boolean;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 6 then
    raise exception 'Report range must contain 1 to 7 days' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.attendance_verification_run v
    where v.work_date = v_today and v.verification_type = 'morning'
      and v.status = 'complete'
  ) into v_today_complete;

  with days as materialized (
    select d::date report_date,
      (d::date <= v_today and extract(isodow from d::date) <> 7
        and (d::date <> v_today or v_today_complete)) available
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') d
  ), roster as materialized (
    select w.id, w.full_name, w.employee_code, w.team_id, t.name team_name,
      w.operational_start_date
    from public.workers w join public.teams t on t.id = w.team_id
    where w.is_active is true and t.name <> 'Adminstration'
      and (w.operational_start_date is null or w.operational_start_date <= p_end)
      and not exists (select 1 from public.worker_staff_classification c
        where c.worker_id = w.id and c.classification = 'special_staff')
  ), ids as materialized (
    -- Preserve the byte-for-byte production display payload during this
    -- performance-only migration; correcting legacy text is separate work.
    select m.worker_id, string_agg(distinct btrim(m.device_employee_no), ' Â· '
      order by btrim(m.device_employee_no)) biometric_id
    from public.biometric_worker_mapping m join roster r on r.id = m.worker_id
    where m.is_active is true and m.mapping_review_state = 'confirmed'
      and nullif(btrim(m.device_employee_no), '') is not null
    group by m.worker_id
  ), mapping_scope as materialized (
    select m.device_id, btrim(m.device_employee_no) device_employee_no,
      count(distinct m.worker_id) owner_count,
      (array_agg(distinct m.worker_id))[1] worker_id
    from public.biometric_worker_mapping m
    where m.is_active is true and m.mapping_review_state = 'confirmed'
    group by m.device_id, btrim(m.device_employee_no)
  ), ignored_scope as materialized (
    select review.device_id, btrim(review.device_employee_no) device_employee_no
    from public.biometric_device_identity_review review
    where review.review_state = 'ignored'
    group by review.device_id, btrim(review.device_employee_no)
  ), events_in_range as materialized (
    select e.device_id, e.device_employee_no, e.attendance_date, e.event_timestamp
    from public.biometric_attendance_events e
    where e.device_employee_no is not null
      and e.attendance_date between p_start and least(p_end, v_today)
  ), safely_resolved as (
    select case
      when exact_ignored.device_employee_no is null and exact_map.owner_count = 1
        then exact_map.worker_id
      when exact_ignored.device_employee_no is null and exact_map.owner_count is null
        and legacy_ignored.device_employee_no is null and legacy_map.owner_count = 1
        then legacy_map.worker_id
      else null end worker_id,
      e.attendance_date, e.event_timestamp
    from events_in_range e
    left join mapping_scope exact_map on exact_map.device_id = e.device_id
      and exact_map.device_employee_no = btrim(e.device_employee_no)
    left join mapping_scope legacy_map on legacy_map.device_id is null
      and legacy_map.device_employee_no = btrim(e.device_employee_no)
    left join ignored_scope exact_ignored on exact_ignored.device_id = e.device_id
      and exact_ignored.device_employee_no = btrim(e.device_employee_no)
    left join ignored_scope legacy_ignored on legacy_ignored.device_id is null
      and legacy_ignored.device_employee_no = btrim(e.device_employee_no)
  ), operational_evidence as (
    select worker_id, attendance_date, event_timestamp from safely_resolved
    where worker_id is not null
    union
    select review.worker_id, review.event_local_date, review.event_timestamp
    from public.biometric_early_morning_review review
    where review.worker_id is not null and review.review_status = 'needs_review'
      and review.event_local_date between p_start and least(p_end, v_today)
  ), punches as materialized (
    select e.worker_id, e.attendance_date,
      max((e.event_timestamp at time zone 'Africa/Kinshasa')::time) last_punch
    from operational_evidence e join roster r on r.id = e.worker_id
    group by e.worker_id, e.attendance_date
  ), attendance_range as materialized (
    select a.* from public.attendance a
    where a.attendance_date between p_start and least(p_end, v_today)
  ), rows as (
    select d.report_date, r.id, r.full_name, r.employee_code, r.team_id,
      r.team_name, a.id attendance_id, a.status canonical_status,
      a.check_in, a.check_out, a.attendance_day_fraction, a.note,
      coalesce(i.biometric_id, 'â€”') biometric_id, p.last_punch,
      case when a.id is null then case when d.report_date < v_today then 'absent' else 'not_recorded' end
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
    from days d join roster r on d.available
      and (r.operational_start_date is null or r.operational_start_date <= d.report_date)
    left join attendance_range a on a.worker_id = r.id and a.attendance_date = d.report_date
    left join ids i on i.worker_id = r.id
    left join punches p on p.worker_id = r.id and p.attendance_date = d.report_date
  ), checkout_clock as (
    select r.*,
      case when r.check_out is null then null
        else extract(epoch from r.check_out) / 60 +
          case when r.checkout_evidence is not null
            and (r.checkout_evidence at time zone 'Africa/Kinshasa')::date = r.report_date + 1
            and (r.checkout_evidence at time zone 'Africa/Kinshasa')::time <= time '02:00:00'
            and abs(extract(epoch from
              ((r.checkout_evidence at time zone 'Africa/Kinshasa')::time - r.check_out))) < 1
          then 1440 else 0 end end checkout_minutes
    from rows r
  ), amounts as (
    select c.*,
      case when extract(isodow from c.report_date) between 1 and 5
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
  ), day_payload as (
    select d.report_date,
      case when not d.available then
        jsonb_build_object('date', d.report_date, 'available', false,
          'attendance', '[]'::jsonb, 'exceptions', '[]'::jsonb,
          'overtime', '[]'::jsonb, 'monitoring_counts', null, 'counts', null)
      else jsonb_build_object('date', d.report_date, 'available', true,
        'attendance', coalesce(jsonb_agg(o.attendance_value order by o.team_name, o.full_name)
          filter (where o.id is not null), '[]'::jsonb),
        'exceptions', coalesce(jsonb_agg(o.exception_value order by o.team_name, o.full_name)
          filter (where o.id is not null and o.exception_status <> 'present'), '[]'::jsonb),
        'overtime', coalesce(jsonb_agg(o.overtime_value order by o.team_name, o.full_name)
          filter (where o.id is not null and o.overtime_minutes >= 120), '[]'::jsonb),
        'monitoring_counts', jsonb_build_object(
          'total', count(o.id),
          'present', count(*) filter (where o.bucket = 'present'),
          'half_day', count(*) filter (where o.bucket = 'half_day'),
          'absent', count(*) filter (where o.bucket = 'absent'),
          'not_recorded', count(*) filter (where o.bucket = 'not_recorded')),
        'counts', jsonb_build_object(
          'exceptions', count(*) filter (where o.exception_status <> 'present'),
          'absent', count(*) filter (where o.exception_status = 'absent'),
          'half_day', count(*) filter (where o.exception_status = 'half_day'),
          'not_recorded', count(*) filter (where o.attendance_id is null and o.id is not null),
          'overtime_workers', count(*) filter (where o.overtime_minutes >= 120),
          'overtime_minutes', coalesce(sum(o.overtime_minutes)
            filter (where o.overtime_minutes >= 120), 0))) end payload
    from days d left join output o on o.report_date = d.report_date
    group by d.report_date, d.available
  )
  select coalesce(jsonb_agg(payload order by report_date), '[]'::jsonb)
  into v_result from day_payload;
  return v_result;
end $$;

revoke all on function public.foreign_monitoring_live_range_payload(date,date)
  from public, anon, authenticated;

create or replace function public.foreign_monitoring_live_day_payload(p_date date)
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp as $$
begin
  if p_date is null then raise exception 'Report date is required' using errcode = '22004'; end if;
  return public.foreign_monitoring_live_range_payload(p_date, p_date)->0;
end $$;
revoke all on function public.foreign_monitoring_live_day_payload(date)
  from public, anon, authenticated;

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
  perform public.foreign_monitoring_touch_session(p_session_token);
  return jsonb_build_object('schema_version', 1, 'publication_required', false,
    'source', 'live_canonical', 'period_start', v_monday,
    'period_end', v_monday + 5, 'days', v_days,
    'available_report_types', jsonb_build_array('daily_attendance',
      'attendance_exceptions', 'daily_overtime'));
end $$;
revoke all on function public.get_live_operational_reports(text,date)
  from public, anon, authenticated;
grant execute on function public.get_live_operational_reports(text,date)
  to anon, authenticated;

commit;
