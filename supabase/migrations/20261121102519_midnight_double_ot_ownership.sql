-- Midnight determines ownership; approval still determines the extra-day payment.
create function private.midnight_double_ot_date(p_worker uuid,p_date date) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.canonical_overtime_checkout(a,w)>=(p_date+1)::timestamp at time zone 'Africa/Kinshasa',false)
 from public.attendance a join public.workers w on w.id=a.worker_id
 where a.worker_id=p_worker and a.attendance_date=p_date;
$$;
revoke all on function private.midnight_double_ot_date(uuid,date) from public,anon,authenticated;
alter function private.extra_day_source(jsonb,uuid,date) rename to extra_day_before_midnight_policy;
create function private.extra_day_source(config jsonb,p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare body jsonb; canonical_config jsonb;
begin
 if config->'session_settings'->>'mode' is distinct from 'midnight_canonical' then
   return private.extra_day_before_midnight_policy(config,p_worker,p_date); end if;
 canonical_config:=jsonb_set(config,'{session_settings}',jsonb_build_object('mode','end_only_canonical','end','00:00:00','tolerance',0));
 body:=private.extra_day_before_midnight_policy(canonical_config,p_worker,p_date)-'fingerprint';
 body:=body||jsonb_build_object('rule',config,'qualified',coalesce((body->>'qualified')::boolean,false) and coalesce(private.midnight_double_ot_date(p_worker,p_date),false),
  'midnight_ownership',true,'qualifying_threshold',(p_date+1)::timestamp at time zone 'Africa/Kinshasa');
 return body||jsonb_build_object('fingerprint',md5(body::text));
end $$;
revoke all on function private.extra_day_before_midnight_policy(jsonb,uuid,date),private.extra_day_source(jsonb,uuid,date) from public,anon,authenticated;
-- Keep existing rule storage, authorization, frozen historical decisions and lookup.
do $patch$ declare definition text; begin
 definition:=pg_get_functiondef('public.admin_get_extra_day_end_reviews(date,uuid,time,integer)'::regprocedure);
 definition:=replace(definition,'''mode'',''end_only_canonical'',''end'',p_end,''tolerance'',p_tolerance','''mode'',''midnight_canonical'',''end'',''00:00:00'',''tolerance'',0');
 definition:=replace(definition,'if coalesce((src->>''qualified'')::boolean,false) then','if coalesce((src->>''qualified'')::boolean,false) and not exists(select 1 from public.extra_day_overtime_review d where d.worker_id=w.id and d.work_date=p_date) then');
 definition:=replace(definition,'(value->>''rule_id''=internal_rule.id::text and (value->''source''->>''qualified'')::boolean)',
   '((value->''source''->>''qualified'')::boolean and ((value->>''rule_id''=internal_rule.id::text) or ((value->>''work_date'')::date=p_date and value->''source''->''worker''->>''team_id''=p_team::text and private.midnight_double_ot_date((value->>''worker_id'')::uuid,p_date))))');
 execute definition;
 definition:=pg_get_functiondef('public.admin_decide_extra_day(jsonb)'::regprocedure);
 definition:=replace(definition,'if e->>''decision''=''approved'' then',
 'if e->>''decision''=''approved'' then
     if old.decision<>''approved'' and not coalesce(private.midnight_double_ot_date(old.worker_id,old.work_date),false) then raise exception ''Double OT requires canonical checkout at or after midnight on the following day''; end if;');
 execute definition;
end $patch$;
create or replace function private.payroll_biometric_reviews_with_extra_days(p_start date,p_end date,p_extra_days jsonb)
returns jsonb language sql security definer set search_path='' as $$
 with owned as materialized (
   select (e->>'worker_id')::uuid worker_id,(e->>'work_date')::date work_date
   from jsonb_array_elements(p_extra_days) e
   where e->'payroll_source' is not null and e->'payroll_source'<>'null'::jsonb
   union
   select l.worker_id,(s->>'date')::date
   from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
   cross join lateral jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]')) s
   where l.attendance_period_start<=p_end and l.attendance_period_end>=p_start
     and r.status in ('reviewed','finalized','paid')
     and s->>'date' between p_start::text and p_end::text and (s->>'extra_days')::numeric>0
 ), blocked as materialized (
   select distinct (e->>'worker_id')::uuid worker_id,(e->>'work_date')::date work_date
   from jsonb_array_elements(p_extra_days) e where e->>'status' in('pending','approved','stale')
 ), rows as materialized (
   select value item,ordinality ord
   from jsonb_array_elements(private.viewer_payroll_reviews_before_extra_day(p_start,p_end)) with ordinality
 )
 select coalesce(jsonb_agg(item||jsonb_build_object('extra_day_payable',o.worker_id is not null,
   'midnight_double_ot',coalesce((item->'attendance'->>'canonical_final_checkout_at')::timestamptz>=((item->'attendance'->>'attendance_date')::date+1)::timestamp at time zone 'Africa/Kinshasa',false),
   'extra_day_review_blocked',o.worker_id is not null or b.worker_id is not null or coalesce((item->'attendance'->>'canonical_final_checkout_at')::timestamptz>=((item->'attendance'->>'attendance_date')::date+1)::timestamp at time zone 'Africa/Kinshasa',false)) order by ord),'[]'::jsonb)
 from rows left join owned o on o.worker_id=(item->'worker'->>'id')::uuid
   and o.work_date=(item->'attendance'->>'attendance_date')::date
 left join blocked b on b.worker_id=(item->'worker'->>'id')::uuid
   and b.work_date=(item->'attendance'->>'attendance_date')::date;
$$;
create or replace function private.viewer_biometric_ot_core(p_date date,p_entries jsonb,p_source_actor uuid,p_viewer_actor uuid,p_viewer_username text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; extra_reviews jsonb;
begin
 if p_date is null or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch';end if;
 lock table public.payroll_run in share mode;
 -- Same locks/order as Double OT; read decisions only after obtaining locks.
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
   perform pg_advisory_xact_lock(hashtextextended((entry->>'worker_id')||':'||p_date::text||':extra_day',0));
 end loop;
 extra_reviews:=private.payroll_extra_day_reviews(p_date,p_date);
 for entry in select value from jsonb_array_elements(p_entries) loop
   if entry->>'decision'='approved' and (
     coalesce(private.midnight_double_ot_date((entry->>'worker_id')::uuid,p_date),false)
     or private.extra_day_owns_hourly_date((entry->>'worker_id')::uuid,p_date)
     or exists(select 1 from jsonb_array_elements(extra_reviews) e
       where e->>'worker_id'=entry->>'worker_id' and e->>'work_date'=p_date::text and e->>'status' in('pending','approved','stale'))
   ) then raise exception 'Double Overtime review has priority for this worker/date; resolve it before hourly approval'; end if;
 end loop;
 return private.viewer_biometric_ot_before_extra_day(p_date,p_entries,p_source_actor,p_viewer_actor,p_viewer_username);
end $$;
revoke all on function private.payroll_biometric_reviews_with_extra_days(date,date,jsonb),private.viewer_biometric_ot_core(date,jsonb,uuid,uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';

create or replace function private.guard_extra_day_weekly_override() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.minutes>0 and (jsonb_array_length(private.extra_day_payroll_sources(new.worker_id,new.week_start,new.week_start+5))>0
   or exists(select 1 from public.attendance a where a.worker_id=new.worker_id and a.attendance_date between new.week_start and new.week_start+5 and private.midnight_double_ot_date(a.worker_id,a.attendance_date))) then
   raise exception 'Midnight/approved extra day cannot be combined with an undated weekly OT override'; end if;
 return new;
end $$;
-- A stale payroll client must not persist hourly pay for an overnight date.
do $patch$ declare definition text; begin
 definition:=pg_get_functiondef('private.assert_extra_day_payroll(public.payroll_line)'::regprocedure);
 definition:=replace(definition,' if jsonb_array_length(sources)=0 then return; end if;',
 ' if exists(select 1 from public.attendance a where a.worker_id=l.worker_id and a.attendance_date between l.attendance_period_start and l.attendance_period_end and private.midnight_double_ot_date(a.worker_id,a.attendance_date) and (
     exists(select 1 from public.worker_weekly_overtime_override o where o.worker_id=l.worker_id and o.week_start=l.attendance_period_start and o.minutes>0)
     or exists(select 1 from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->''payable_overtime_days'',''[]'')) d where d->>''date''=a.attendance_date::text and (d->>''minutes'')::numeric>0))) then raise exception ''Hourly OT cannot pay a midnight Double OT date''; end if;
 if jsonb_array_length(sources)=0 then return; end if;');
 execute definition;
end $patch$;
notify pgrst,'reload schema';
