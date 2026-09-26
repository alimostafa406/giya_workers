-- Independent report publication. No attendance/payroll writes or legacy RPC changes.
create table public.operational_report_publication (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique check (extract(isodow from period_start) = 1),
  period_end date not null check (period_end = period_start + 5),
  published boolean not null default false,
  version integer not null default 0,
  published_at timestamptz,
  published_by uuid references public.admins(id),
  stopped_at timestamptz,
  source_revision text,
  days jsonb not null default '[]'::jsonb check (jsonb_typeof(days) = 'array')
);
alter table public.operational_report_publication enable row level security;
revoke all on table public.operational_report_publication from public, anon, authenticated;

-- One canonical source read for the main-app report builders. A revision guards
-- against concurrent attendance/mapping/settings changes while preparing reports.
create function public.get_current_report_publication_source_admin()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'Africa/Kinshasa')::date;
  monday date := today - (extract(isodow from today)::integer - 1);
  source jsonb;
begin
  if not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  with roster as materialized (
    select w.*, jsonb_build_object('id',t.id,'name',t.name) as team
    from public.workers w join public.teams t on t.id=w.team_id
    where w.is_active is true and t.name <> 'Adminstration'
      and (w.operational_start_date is null or w.operational_start_date <= least(today,monday+5))
      and not exists (select 1 from public.worker_staff_classification c where c.worker_id=w.id and c.classification='special_staff')
  ), worker_data as (
    select id,jsonb_build_object('id',id,'full_name',full_name,'employee_code',employee_code,
      'is_active',true,'operational_start_date',operational_start_date,'team_id',team_id,'team',team,'staff_classification','normal') value from roster
  ), eligible_dates as (
    select d::date as day from generate_series(monday::timestamp,(monday+5)::timestamp,interval '1 day') d
    where d::date < today or (d::date=today and
      (select v.status from public.attendance_verification_run v where v.work_date=today and v.verification_type='morning'
       order by v.created_at desc,v.id desc limit 1) = 'complete')
  )
  select jsonb_build_object(
    'business_date',today,'period_start',monday,'period_end',monday+5,
    'available_dates',coalesce((select jsonb_agg(day order by day) from eligible_dates),'[]'::jsonb),
    'workers',coalesce((select jsonb_agg(value order by id) from worker_data),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('worker',w.value,'team',w.value->'team') order by a.attendance_date,a.worker_id)
      from public.attendance a join worker_data w on w.id=a.worker_id join eligible_dates d on d.day=a.attendance_date),'[]'::jsonb),
    'mappings',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.biometric_worker_mapping m join roster w on w.id=m.worker_id
      where m.is_active is true and m.mapping_review_state='confirmed'),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.attendance_date,e.worker_id,e.event_timestamp)
      from public.get_company_mapped_biometric_events(monday,monday+5) e join roster w on w.id=e.worker_id join eligible_dates d on d.day=e.attendance_date),'[]'::jsonb),
    'overtime_team_ids',coalesce((select to_jsonb(team_ids) from public.overtime_report_settings where singleton is true),'[]'::jsonb)
  ) into source;
  return source || jsonb_build_object('source_revision',md5(source::text));
end;
$$;

create function public.get_current_report_publication_admin()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'Africa/Kinshasa')::date;
  monday date := today - (extract(isodow from today)::integer - 1);
  p public.operational_report_publication;
begin
  if not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  select * into p from public.operational_report_publication where period_start=monday;
  return jsonb_build_object('published',coalesce(p.published,false),'period_start',monday,'period_end',monday+5,
    'published_at',p.published_at,'publication_id',p.id,'version',coalesce(p.version,0),
    'available_dates',coalesce((select jsonb_agg(d->>'date' order by d->>'date') from jsonb_array_elements(p.days) d),'[]'::jsonb));
end;
$$;

create function public.publish_current_report_publication_admin(p_source_revision text,p_days jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  source jsonb;
  day jsonb;
  item jsonb;
  worker jsonb;
  day_date date;
  normalized_days jsonb := '[]'::jsonb;
  clean_attendance jsonb;
  clean_overtime jsonb;
  monday date := (now() at time zone 'Africa/Kinshasa')::date - (extract(isodow from now() at time zone 'Africa/Kinshasa')::integer-1);
begin
  if not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('operational_report_publication'));
  source := public.get_current_report_publication_source_admin();
  if p_source_revision is distinct from source->>'source_revision' then
    raise exception 'Report source changed. Refresh and publish again.' using errcode='40001';
  end if;
  if jsonb_typeof(p_days) is distinct from 'array' then raise exception 'Report days must be an array'; end if;
  if (select coalesce(jsonb_agg(d->>'date' order by d->>'date'),'[]') from jsonb_array_elements(p_days) d)
     is distinct from source->'available_dates' then raise exception 'Only the available current-week dates may be published'; end if;
  if jsonb_array_length(p_days)=0 then raise exception 'No verified report dates are available'; end if;
  for day in select value from jsonb_array_elements(p_days) loop
    day_date := (day->>'date')::date;
    if jsonb_typeof(day->'attendance') is distinct from 'array' or jsonb_typeof(day->'overtime') is distinct from 'array' then raise exception 'Invalid report rows'; end if;
    -- Exact roster, no omitted/duplicate/out-of-scope worker rows.
    if (select coalesce(jsonb_agg(r->>'worker_id' order by r->>'worker_id'),'[]') from jsonb_array_elements(day->'attendance') r)
      is distinct from (select coalesce(jsonb_agg(w->>'id' order by w->>'id'),'[]') from jsonb_array_elements(source->'workers') w
        where nullif(w->>'operational_start_date','') is null or (w->>'operational_start_date')::date <= day_date)
    then raise exception 'Report roster does not match current operational eligibility'; end if;
    clean_attendance := '[]'; clean_overtime := '[]';
    for item in select value from jsonb_array_elements(day->'attendance') loop
      select value into worker from jsonb_array_elements(source->'workers') w where w->>'id'=item->>'worker_id';
      if item->>'status' not in ('present','half_day','absent','not_recorded') or item->>'status' is null then raise exception 'Invalid attendance bucket'; end if;
      clean_attendance := clean_attendance || jsonb_build_array(jsonb_build_object(
        'worker_id',worker->'id','worker_name',worker->'full_name','employee_code',worker->'employee_code',
        'team_id',worker->'team_id','team_name',worker->'team'->'name','biometric_id',item->'biometric_id',
        'status',item->'status','check_in',item->'check_in','check_out',item->'check_out','last_punch',item->'last_punch'));
    end loop;
    if (select count(*)<>count(distinct r->>'worker_id') from jsonb_array_elements(day->'overtime') r) then raise exception 'Duplicate overtime worker'; end if;
    for item in select value from jsonb_array_elements(day->'overtime') loop
      select value into worker from jsonb_array_elements(source->'workers') w where w->>'id'=item->>'worker_id'
        and (nullif(w->>'operational_start_date','') is null or (w->>'operational_start_date')::date<=day_date);
      if worker is null or worker->'team'->>'name' in ('Chauffeur','Adminstration')
        or not (source->'overtime_team_ids' @> jsonb_build_array(worker->>'team_id'))
        or coalesce((item->>'overtime_minutes')::integer,0)<120 then raise exception 'Ineligible overtime report row'; end if;
      clean_overtime := clean_overtime || jsonb_build_array(jsonb_build_object(
        'worker_id',worker->'id','worker_name',worker->'full_name','employee_code',worker->'employee_code',
        'team_id',worker->'team_id','team_name',worker->'team'->'name','biometric_id',item->'biometric_id',
        'check_in',item->'check_in','check_out',item->'check_out','overtime_minutes',item->'overtime_minutes'));
    end loop;
    normalized_days := normalized_days || jsonb_build_array(jsonb_build_object('date',day_date,
      'attendance',clean_attendance,'overtime',clean_overtime,
      'counts',jsonb_build_object('total_workers',jsonb_array_length(clean_attendance),
        'present',(select count(*) from jsonb_array_elements(clean_attendance) r where r->>'status'='present'),
        'half_day',(select count(*) from jsonb_array_elements(clean_attendance) r where r->>'status'='half_day'),
        'absent',(select count(*) from jsonb_array_elements(clean_attendance) r where r->>'status'='absent'),
        'not_recorded',(select count(*) from jsonb_array_elements(clean_attendance) r where r->>'status'='not_recorded'),
        'overtime_workers',jsonb_array_length(clean_overtime),
        'overtime_minutes',(select coalesce(sum((r->>'overtime_minutes')::integer),0) from jsonb_array_elements(clean_overtime) r))));
  end loop;
  insert into public.operational_report_publication(period_start,period_end,published,version,published_at,published_by,source_revision,days)
  values(monday,monday+5,true,1,now(),auth.uid(),p_source_revision,normalized_days)
  on conflict(period_start) do update set published=true,version=operational_report_publication.version+1,
    published_at=now(),published_by=auth.uid(),stopped_at=null,source_revision=excluded.source_revision,days=excluded.days;
  return public.get_current_report_publication_admin();
end;
$$;

create function public.stop_current_report_publication_admin()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare monday date := (now() at time zone 'Africa/Kinshasa')::date - (extract(isodow from now() at time zone 'Africa/Kinshasa')::integer-1);
begin
  if not public.is_admin() then raise exception 'Active admin access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('operational_report_publication'));
  update public.operational_report_publication set published=false,stopped_at=now() where period_start=monday;
  return public.get_current_report_publication_admin();
end;
$$;

create function public.get_published_operational_reports(p_session_token text,p_date date default null,p_report_type text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'Africa/Kinshasa')::date;
  monday date := today - (extract(isodow from today)::integer-1);
  p public.operational_report_publication;
  result_days jsonb;
begin
  perform public.foreign_monitoring_require_session(p_session_token);
  if p_report_type is not null and p_report_type not in ('daily_attendance','daily_overtime') then raise exception 'Unsupported report type' using errcode='22023'; end if;
  select * into p from public.operational_report_publication where period_start=monday and published is true;
  if p.id is null or (p_date is not null and (p_date<monday or p_date>monday+5)) then
    return jsonb_build_object('schema_version',1,'published',false,'period_start',monday,'period_end',monday+5,
      'published_at',null,'publication_id',null,'version',0,'available_report_types','[]'::jsonb,'available_dates','[]'::jsonb,'days','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(case p_report_type
    when 'daily_attendance' then d-'overtime'
    when 'daily_overtime' then d-'attendance' else d end order by d->>'date'),'[]'::jsonb)
  into result_days from jsonb_array_elements(p.days) d where (p_date is null or (d->>'date')::date=p_date)
    and (d->>'date')::date<=today
    and ((d->>'date')::date<>today or (select v.status from public.attendance_verification_run v
      where v.work_date=today and v.verification_type='morning' order by v.created_at desc,v.id desc limit 1)='complete');
  return jsonb_build_object('schema_version',1,'published',true,'period_start',p.period_start,'period_end',p.period_end,
    'published_at',p.published_at,'publication_id',p.id,'version',p.version,
    'available_report_types',jsonb_build_array('daily_attendance','daily_overtime'),
    'available_dates',coalesce((select jsonb_agg(d->>'date' order by d->>'date') from jsonb_array_elements(p.days) d
      where (d->>'date')::date<=today and ((d->>'date')::date<>today or (select v.status from public.attendance_verification_run v
        where v.work_date=today and v.verification_type='morning' order by v.created_at desc,v.id desc limit 1)='complete')),'[]'::jsonb),
    'days',result_days);
end;
$$;

revoke all on function public.get_current_report_publication_source_admin(), public.get_current_report_publication_admin(),
  public.publish_current_report_publication_admin(text,jsonb),public.stop_current_report_publication_admin(),
  public.get_published_operational_reports(text,date,text) from public, anon, authenticated;
grant execute on function public.get_current_report_publication_source_admin(),public.get_current_report_publication_admin(),
  public.publish_current_report_publication_admin(text,jsonb),public.stop_current_report_publication_admin() to authenticated;
grant execute on function public.get_published_operational_reports(text,date,text) to anon,authenticated;
