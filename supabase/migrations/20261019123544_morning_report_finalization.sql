-- Reuse the authoritative supervisor population. Never rewrite old snapshots.
-- Persisted events carry the resolver's worker_id; no name or numeric-ID matching.
create function private.has_morning_evidence_at_cutoff(p_worker uuid,p_date date)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.attendance a where a.worker_id=p_worker
    and a.attendance_date=p_date and a.check_in<=time '11:00')
    or exists(select 1 from public.biometric_attendance_events e
      where e.worker_id=p_worker and e.attendance_date=p_date
        and e.event_timestamp >= (p_date+time '06:30') at time zone 'Africa/Kinshasa'
        and e.event_timestamp <= (p_date+time '11:00') at time zone 'Africa/Kinshasa');
$$;
revoke all on function private.has_morning_evidence_at_cutoff(uuid,date) from public,anon,authenticated;

-- Patch only the evidence predicate in the existing finalizer; retain its
-- authorization, advisory lock, roster/night exclusions, A/P/O/M and fallback.
do $$
declare definition text; old_predicate text := 'not exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date and a.check_in is not null)';
begin
  select pg_get_functiondef('private.final_supervisor_review(date,boolean)'::regprocedure) into definition;
  if strpos(definition,old_predicate)=0 then raise exception 'Unexpected finalizer definition; review before changing'; end if;
  execute replace(definition,old_predicate,'not private.has_morning_evidence_at_cutoff(w.id,p_date)');
end $$;

-- Preserve the existing viewer session/publication gate in its wrapper. After
-- cutoff the payload reads the same immutable population as the admin page.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.foreign_monitoring_live_missing_morning_payload(date)'::regprocedure) into definition;
  execute replace(definition,'public.foreign_monitoring_live_missing_morning_payload','private.legacy_missing_morning_payload');
end $$;
revoke all on function private.legacy_missing_morning_payload(date) from public,anon,authenticated;

create or replace function public.foreign_monitoring_live_missing_morning_payload(p_date date)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare population jsonb; groups jsonb; teams jsonb; final_window boolean;
begin
  final_window := now() >= ((p_date+time '11:00') at time zone 'Africa/Kinshasa');
  if final_window then
    select workers into population from private.supervisor_review_daily_snapshot where attendance_date=p_date;
    if population is null then
      if p_date < (now() at time zone 'Africa/Kinshasa')::date then
        return private.legacy_missing_morning_payload(p_date)||jsonb_build_object('finalized',false,'reconstructed',true);
      end if;
      return jsonb_build_object('date',p_date,'reportAvailable',false,'withheldCurrentDay',false,
        'source','final_snapshot_pending','groups','[]'::jsonb,'teams','[]'::jsonb,'missingWorkers',0,'finalized',false);
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,
      'team_id',t.id,'team_name',t.name)),'[]'::jsonb) into population
      from public.workers w join public.teams t on t.id=w.team_id
      where w.is_active is true and public.is_day_attendance_shift(w.attendance_shift)
        and t.name<>'Adminstration' and (w.operational_start_date is null or w.operational_start_date<=p_date)
        and not exists(select 1 from public.worker_staff_classification c where c.worker_id=w.id and c.classification='special_staff')
        and not exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date and a.check_in is not null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',team_id,'name',team_name,'workers',workers) order by team_name,team_id),'[]'::jsonb)
    into groups from (select x->>'team_id' team_id,x->>'team_name' team_name,
      jsonb_agg(jsonb_build_object('id',x->>'id','fullName',x->>'full_name','employeeCode',x->>'employee_code') order by x->>'full_name',x->>'id') workers
      from jsonb_array_elements(population) x group by x->>'team_id',x->>'team_name') g;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'isActive',is_active) order by name,id),'[]'::jsonb)
    into teams from public.teams where is_active is true and name<>'Adminstration';
  return jsonb_build_object('date',p_date,'reportAvailable',true,'withheldCurrentDay',false,
    'source',case when final_window then 'final_supervisor_review_snapshot' else 'live_canonical_missing_morning' end,
    'groups',groups,'missingWorkers',jsonb_array_length(population),'teams',teams,'finalized',final_window);
end;
$$;
revoke all on function public.foreign_monitoring_live_missing_morning_payload(date) from public,anon,authenticated;
notify pgrst,'reload schema';
