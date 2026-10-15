-- Explicit shift only: team membership, biometric ownership and payroll are unchanged.
alter table public.workers add column attendance_shift text not null default 'day'
  check (attendance_shift in ('day','night'));
comment on column public.workers.attendance_shift is 'Explicit attendance window; independent of team, identity and payroll.';
create function public.is_day_attendance_shift(p_shift text)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select coalesce(p_shift,'day')='day';
$$;
revoke all on function public.is_day_attendance_shift(text) from public;
grant execute on function public.is_day_attendance_shift(text) to authenticated,service_role;
CREATE OR REPLACE FUNCTION private.final_supervisor_review(p_date date, p_finalize boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'auth', 'pg_temp'
AS $function$
declare v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_snapshot private.supervisor_review_daily_snapshot%rowtype; v_workers jsonb; v_teams jsonb; v_attendance jsonb; v_locked boolean;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  if p_date is null or p_date>v_today or extract(isodow from p_date)=7 then
    raise exception 'Select a non-future operational workday' using errcode='22023';
  end if;
  if p_finalize then
    if p_date<>v_today or (now() at time zone 'Africa/Kinshasa')::time<time '11:00' then
      raise exception 'Finalization requires today after 11:00 Kinshasa' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||p_date::text,0));
    if not exists(select 1 from private.supervisor_review_daily_snapshot where attendance_date=p_date) then
      select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,
        'team_id',w.team_id,'team_name',t.name,'biometric_id',coalesce(ids.value,'—')) order by w.id),'[]'::jsonb)
        into v_workers from public.workers w join public.teams t on t.id=w.team_id
        left join public.worker_staff_classification c on c.worker_id=w.id
        left join lateral (select string_agg(device_employee_no,' · ' order by device_employee_no) as value
          from (select distinct device_employee_no from public.biometric_worker_mapping m where m.worker_id=w.id
            and m.is_active is true and m.mapping_review_state='confirmed') identities) ids on true
        where w.is_active is true and public.is_day_attendance_shift(w.attendance_shift) and coalesce(c.classification,'normal')='normal' and t.name<>'Adminstration'
          and (w.operational_start_date is null or w.operational_start_date<=p_date)
          and (not exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date and a.check_in is not null)
            or exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date and a.manual_override is true
              and a.biometric_sync_metadata->'supervisor_morning_review'->>'source'='supervisor_sheet'));
      insert into private.supervisor_review_daily_snapshot(attendance_date,cutoff_at,finalized_by,workers)
        values(p_date,(p_date+time '11:00') at time zone 'Africa/Kinshasa',auth.uid(),v_workers);
    end if;
  end if;
  select * into v_snapshot from private.supervisor_review_daily_snapshot where attendance_date=p_date;
  if not found then
    if p_date<v_today then
      return public.admin_get_historical_supervisor_review(p_date)||jsonb_build_object('exact_population',false,'reconstructed',true);
    end if;
    return jsonb_build_object('available',false,'read_only',true,'exact_population',false,'reconstructed',false,
      'workers','[]'::jsonb,'teams','[]'::jsonb,'attendance','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',team_id,'name',team_name)),'[]'::jsonb) into v_teams
    from (select distinct value->>'team_id' team_id,value->>'team_name' team_name from jsonb_array_elements(v_snapshot.workers)) teams;
  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into v_attendance from public.attendance a
    where a.attendance_date=p_date and exists(select 1 from jsonb_array_elements(v_snapshot.workers) w where w->>'id'=a.worker_id::text);
  select exists(select 1 from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
    where p_date between l.attendance_period_start and l.attendance_period_end and r.status in ('finalized','paid')) into v_locked;
  return jsonb_build_object('available',true,'read_only',v_locked,'exact_population',true,'reconstructed',false,
    'date',p_date,'cutoff_at',v_snapshot.cutoff_at,'finalized_at',v_snapshot.finalized_at,'version',v_snapshot.version,
    'workers',v_snapshot.workers,'teams',v_teams,'attendance',v_attendance);
end;
$function$;

CREATE OR REPLACE FUNCTION public.foreign_monitoring_live_missing_morning_payload(p_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with missing as materialized (
    select w.id, w.full_name, w.employee_code, t.id as team_id, t.name as team_name
    from public.workers w
    join public.teams t on t.id = w.team_id
    where w.is_active is true and public.is_day_attendance_shift(w.attendance_shift)
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
$function$;

do $$
declare wid uuid;
begin
  select id into strict wid from public.workers where employee_code='349' and full_name='ALIANO';
  if not exists(select 1 from public.biometric_worker_mapping where worker_id=wid and device_employee_no='025' and is_active and mapping_review_state='confirmed') then raise exception 'ALIANO mapping cross-check failed'; end if;
  update public.workers set attendance_shift='night' where id=wid;
end $$;
notify pgrst,'reload schema';
