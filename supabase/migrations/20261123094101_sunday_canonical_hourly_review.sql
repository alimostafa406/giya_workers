-- Same canonical worker/date hourly decision, backed by real Sunday observations
-- rather than fabricating an attendance row just to satisfy a foreign key.
alter table public.worker_biometric_overtime_review alter column source_attendance_id drop not null;
alter table public.worker_biometric_overtime_review add column source_evidence jsonb;
alter table public.worker_biometric_overtime_review add constraint biometric_ot_real_source
 check(source_attendance_id is not null or coalesce((extract(isodow from attendance_date)=7
   and source_evidence is not null and source_evidence->>'kind'='sunday_device_evidence'),false));

create function private.sunday_hourly_sources(p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 with observations as materialized(
  select e.worker_id,e.event_timestamp,e.device_id,e.device_employee_no,e.event_identity
  from public.biometric_attendance_events e
  where extract(isodow from p_date)=7 and e.attendance_date between p_date and p_date+1
   and e.event_timestamp>=(p_date+time '06:30') at time zone 'Africa/Kinshasa'
   and e.event_timestamp<=((p_date+1)+time '02:00') at time zone 'Africa/Kinshasa'
   and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=e.worker_id
 ), evidence as(
  select worker_id,min(event_timestamp) first_at,max(event_timestamp) last_at,count(distinct event_timestamp) punches,
    jsonb_agg(jsonb_build_array(device_id,device_employee_no,event_identity,event_timestamp) order by event_timestamp,device_id,event_identity) events
  from observations group by worker_id
 ), candidates as(
  select w.*,p.payment_type,t.name team_name,e.*,
   floor(extract(epoch from(e.last_at-((p_date+time '14:00') at time zone 'Africa/Kinshasa')))/60)::integer minutes,
   jsonb_build_object('kind','sunday_device_evidence','date',p_date,'first_at',e.first_at,'last_at',e.last_at,'events',e.events,'team_id',w.team_id,'shift',w.attendance_shift,'payment_type',p.payment_type) source
  from evidence e join public.workers w on w.id=e.worker_id join public.teams t on t.id=w.team_id
   join public.worker_payroll_profile p on p.worker_id=w.id
   left join public.worker_staff_classification sc on sc.worker_id=w.id
  where p.payment_type in('weekly','monthly') and coalesce(sc.classification,'normal')='normal'
   and (w.operational_start_date is null or w.operational_start_date<=p_date)
   and e.punches>=2 and e.first_at<(p_date+time '14:00') at time zone 'Africa/Kinshasa'
   and extract(epoch from(e.last_at-((p_date+time '14:00') at time zone 'Africa/Kinshasa')))>1800
 )
 select coalesce(jsonb_agg(jsonb_build_object('sunday_evidence',true,'work_date',p_date,
  'worker',jsonb_build_object('id',c.id,'full_name',c.full_name,'employee_code',c.employee_code,'team_id',c.team_id,'team_name',c.team_name,'payment_type',c.payment_type,'is_active',c.is_active),
  'attendance',jsonb_build_object('id',null,'worker_id',c.id,'attendance_date',p_date),
  'evidence',c.source,'raw_minutes',c.minutes,'source_fingerprint',md5(c.source::text),'review',to_jsonb(r),
  'hourly_rate',term.overtime_rate_per_hour,'currency',term.currency_code,
  'locked',exists(select 1 from public.payroll_run pr where pr.status in('reviewed','finalized','paid') and
    ((pr.payment_type='weekly' and p_date+1 between pr.weekly_period_start and pr.weekly_period_end)
     or exists(select 1 from public.payroll_line pl where pl.payroll_run_id=pr.id and pl.worker_id=c.id and p_date between pl.attendance_period_start and pl.attendance_period_end)))) order by c.full_name),'[]')
 from candidates c left join public.worker_biometric_overtime_review r on r.worker_id=c.id and r.attendance_date=p_date
 left join lateral(select * from public.worker_payroll_compensation co where co.worker_id=c.id and co.payment_type=c.payment_type
   and co.effective_from<=p_date and(co.effective_to is null or co.effective_to>=p_date) order by co.effective_from desc limit 1)term on true;
$$;
revoke all on function private.sunday_hourly_sources(date) from public,anon,authenticated,service_role;

create function private.decide_sunday_hourly(p_date date,p_entries jsonb,p_source_actor uuid,p_viewer_actor uuid,p_viewer_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb;source jsonb;old public.worker_biometric_overtime_review;answer jsonb:='[]';sources jsonb;minutes integer;audit jsonb;
begin
 if num_nonnulls(p_source_actor,p_viewer_actor)<>1 then raise exception 'Actor required' using errcode='42501';end if;
 if p_date is null or extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date
   or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch';end if;
 if (select count(distinct value->>'worker_id') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Duplicate worker';end if;
 lock table public.payroll_run in share mode;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
  perform pg_advisory_xact_lock(hashtextextended((entry->>'worker_id')||':'||p_date::text||':biometric_ot',0));
 end loop;
 sources:=private.sunday_hourly_sources(p_date);
 for entry in select value from jsonb_array_elements(p_entries) loop
  select value into source from jsonb_array_elements(sources) where value->'worker'->>'id'=entry->>'worker_id';
  if source is null or not coalesce((source->'worker'->>'is_active')::boolean,false) then raise exception 'Worker not eligible';end if;
  if (source->>'locked')::boolean then raise exception 'Payroll locked';end if;
  if entry->>'decision' is null or entry->>'decision' not in('approved','rejected') or coalesce(entry->>'minutes','')!~'^[0-9]+$' then raise exception 'Invalid decision';end if;
  minutes:=(entry->>'minutes')::integer;
  if minutes not between 1 and 1440 then raise exception 'Invalid reviewed minutes';end if;
  if entry->>'source_fingerprint' is distinct from source->>'source_fingerprint' then raise exception 'Biometric evidence changed; reload and review again';end if;
  select * into old from public.worker_biometric_overtime_review where worker_id=(entry->>'worker_id')::uuid and attendance_date=p_date for update;
  if entry->>'expected_version' is null or (entry->>'expected_version')::integer<>coalesce(old.version,0) then raise exception 'Review changed; reload';end if;
  audit:=jsonb_build_object('previous',case when old.worker_id is null then null else to_jsonb(old)-'history' end,'decision',entry->>'decision','minutes',minutes,
   'original_biometric_minutes',(source->>'raw_minutes')::integer,'actor',p_source_actor,'viewer_user_id',p_viewer_actor,'viewer_username',p_viewer_username,
   'source',case when p_viewer_actor is null then 'workers_react_deploy' else 'foreign_attendance_viewer' end,'at',now(),'source_fingerprint',source->>'source_fingerprint','evidence',source->'evidence');
  insert into public.worker_biometric_overtime_review(worker_id,attendance_date,source_attendance_id,source_updated_at,source_fingerprint,source_evidence,minutes,decision,actor,actor_viewer_id,version,history)
   values((entry->>'worker_id')::uuid,p_date,null,(source->'evidence'->>'last_at')::timestamptz,source->>'source_fingerprint',source->'evidence',minutes,entry->>'decision',p_source_actor,p_viewer_actor,1,jsonb_build_array(audit))
   on conflict(attendance_date,worker_id) do update set source_attendance_id=null,source_updated_at=excluded.source_updated_at,source_fingerprint=excluded.source_fingerprint,
    source_evidence=excluded.source_evidence,minutes=excluded.minutes,decision=excluded.decision,actor=excluded.actor,actor_viewer_id=excluded.actor_viewer_id,
    version=old.version+1,decided_at=now(),history=old.history||jsonb_build_array(audit);
  answer:=answer||jsonb_build_array(jsonb_build_object('worker_id',entry->>'worker_id','decision',entry->>'decision','version',coalesce(old.version,0)+1));
 end loop;
 return answer;
end $$;
revoke all on function private.decide_sunday_hourly(date,jsonb,uuid,uuid,text) from public,anon,authenticated,service_role;

-- Existing authenticated/allowlisted entry points keep their authorization.
-- Sunday is hourly OT, never a new Double OT full-day decision.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.viewer_biometric_ot_core(date,jsonb,uuid,uuid,text)'::regprocedure);
 definition:=replace(definition,'lock table public.payroll_run in share mode;',
  'if extract(isodow from p_date)=7 then return private.decide_sunday_hourly(p_date,p_entries,p_source_actor,p_viewer_actor,p_viewer_username);end if;'||chr(10)||' lock table public.payroll_run in share mode;');
 execute definition;
end $$;
create or replace function private.viewer_payroll_reviews_core(p_start date,p_end date) returns jsonb
language sql security definer set search_path='' as $$
 select coalesce((select jsonb_agg(e) from jsonb_array_elements(private.payroll_biometric_reviews_with_extra_days(p_start,p_end,private.payroll_extra_day_reviews(p_start,p_end)))e
   where extract(isodow from (e->'attendance'->>'attendance_date')::date)<>7),'[]')
 ||coalesce((select jsonb_agg(e) from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day')d
   cross join lateral jsonb_array_elements(private.sunday_hourly_sources(d::date))e where extract(isodow from d)=7),'[]');
$$;
notify pgrst,'reload schema';
