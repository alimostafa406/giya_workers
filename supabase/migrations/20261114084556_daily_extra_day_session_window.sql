alter table public.extra_day_overtime_rule add column session_settings jsonb not null default '{}';
alter table public.extra_day_overtime_rule drop constraint extra_day_overtime_rule_review_mode_check;
alter table public.extra_day_overtime_rule add constraint extra_day_overtime_rule_review_mode_check check(review_mode in ('configured','daily','daily_window'));
create unique index extra_day_session_scope on public.extra_day_overtime_rule((team_ids[1]),start_date,session_settings) where review_mode='daily_window';

create function private.extra_day_session(p_date date,p_start time,p_end time,p_tolerance integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare first_at timestamp;end_at timestamp;threshold_at timestamp;
begin
 if p_date is null or p_start is null or p_end is null or p_tolerance is null or p_tolerance<0 or p_tolerance>1440 then raise exception 'Valid session start, end and tolerance required';end if;
 first_at:=p_date+p_start;end_at:=p_date+p_end;
 if end_at<=first_at then end_at:=end_at+interval '1 day';end if;
 threshold_at:=end_at-make_interval(mins=>p_tolerance);
 if threshold_at<=first_at then raise exception 'Tolerance must be shorter than the special session';end if;
 return jsonb_build_object('special_start',first_at at time zone 'Africa/Kinshasa','special_end',end_at at time zone 'Africa/Kinshasa',
   'qualifying_threshold',threshold_at at time zone 'Africa/Kinshasa','tolerance_minutes',p_tolerance);
end $$;

alter function private.extra_day_source(jsonb,uuid,date) rename to extra_day_compat_source;
create function private.extra_day_source(config jsonb,p_worker uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare body jsonb; session jsonb;operational_start timestamp;operational_end timestamp;evidence_config jsonb; night boolean;
 first_at timestamptz;last_at timestamptz;events jsonb;outside_rows jsonb;out_start timestamptz;out_end timestamptz;
 special_start timestamptz;threshold_at timestamptz;session_start timestamptz;qualified boolean;
begin
 if coalesce(config->>'review_mode','configured')<>'daily_window' then return private.extra_day_compat_source(config,p_worker,p_date);end if;
 session:=private.extra_day_session(p_date,(config->'session_settings'->>'start')::time,(config->'session_settings'->>'end')::time,(config->'session_settings'->>'tolerance')::integer);
 special_start:=(session->>'special_start')::timestamptz;threshold_at:=(session->>'qualifying_threshold')::timestamptz;
 select attendance_shift='night' into night from public.workers where id=p_worker;
 -- Same bounds as attendance_business_rules / night_event_date. In particular
 -- use next day's 00:00-02:00 tail, never the previous midnight.
 operational_start:=p_date+case when night then time '17:00' else time '06:30' end;
 operational_end:=p_date+1+case when night then time '06:30' else time '02:00' end;
 evidence_config:=config||jsonb_build_object('start_time',operational_start::time,'window_end',operational_end::time,'minimum_end',null,'minimum_minutes',1);
 body:=private.extra_day_rule_source(evidence_config,p_worker,p_date)-'fingerprint';
 events:=body->'events';first_at:=(body->>'start')::timestamptz;last_at:=(body->>'end')::timestamptz;
 select coalesce(jsonb_agg(jsonb_build_object('movement_id',m.id,'participant_id',mw.id,'start',mw.start_time,'end',mw.end_time,
   'shared_start',m.common_worker_start,'shared_end',m.common_worker_end,'team_id',m.team_id,'foreman_worker_id',m.foreman_worker_id) order by m.id,mw.id),'[]'),
   min(s.start_at),max(s.end_at)
 into outside_rows,out_start,out_end
 from public.outside_work_movements m join public.outside_work_movement_workers mw on mw.movement_id=m.id
 cross join lateral(select (p_date+coalesce(mw.start_time,m.common_worker_start)) at time zone 'Africa/Kinshasa' start_at,
   (p_date+coalesce(mw.end_time,m.common_worker_end)+case when coalesce(mw.end_time,m.common_worker_end)<=coalesce(mw.start_time,m.common_worker_start) then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa' end_at) s
 where m.status='final' and m.work_date=p_date and mw.worker_id=p_worker
   and s.start_at>=operational_start at time zone 'Africa/Kinshasa' and s.end_at<=operational_end at time zone 'Africa/Kinshasa'
   and s.start_at<s.end_at;
 first_at:=least(first_at,out_start);last_at:=greatest(last_at,out_end);
 session_start:=greatest(special_start,first_at);
 qualified:=first_at<last_at and last_at>=threshold_at and last_at>session_start
   and body->'worker'->>'payment_type' in ('weekly','monthly') and body->'attendance'->>'status' in ('present','late','half_day')
   and exists(select 1 from public.workers w where w.id=p_worker and (w.operational_start_date is null or w.operational_start_date<=p_date)
     and config->'team_ids' ? w.team_id::text)
   and not exists(select 1 from public.worker_staff_classification where worker_id=p_worker and classification<>'normal')
   and p_date between (config->>'start_date')::date and (config->>'end_date')::date;
 body:=body||session||jsonb_build_object('rule',config,'outside_work',outside_rows,'events',events,'start',first_at,'end',last_at,
   'qualified',coalesce(qualified,false),'session_start',session_start,
   'duration_minutes',case when first_at is not null and last_at>session_start then floor(extract(epoch from last_at-session_start)/60) else 0 end);
 return body||jsonb_build_object('fingerprint',md5(body::text));
end $$;

create function public.admin_get_extra_day_session_reviews(p_date date,p_team uuid,p_start time,p_end time,p_tolerance integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare internal_rule public.extra_day_overtime_rule;w record;src jsonb;settings jsonb;config jsonb;all_rows jsonb;
begin
 perform private.extra_day_require_admin();
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or not exists(select 1 from public.teams where id=p_team) then raise exception 'Valid date and team required';end if;
 perform private.extra_day_session(p_date,p_start,p_end,p_tolerance);
 settings:=jsonb_build_object('start',p_start,'end',p_end,'tolerance',p_tolerance);
 perform pg_advisory_xact_lock(hashtextextended(p_team::text||':'||p_date::text||':daily_extra_review',0));
 insert into public.extra_day_overtime_rule(name,enabled,team_ids,worker_ids,start_date,end_date,start_time,window_end,minimum_minutes,actor,review_mode,session_settings)
 values('Daily session review',false,array[p_team],'{}',p_date,p_date,p_start,p_end,1,auth.uid(),'daily_window',settings)
 on conflict ((team_ids[1]),start_date,session_settings) where review_mode='daily_window' do nothing;
 select * into strict internal_rule from public.extra_day_overtime_rule where review_mode='daily_window' and team_ids[1]=p_team and start_date=p_date and session_settings=settings;
 config:=to_jsonb(internal_rule)-'history';
 for w in select id from public.workers where team_id=p_team loop
   if private.extra_day_locked(w.id,p_date) then continue;end if;
   src:=private.extra_day_source(config,w.id,p_date);
   if coalesce((src->>'qualified')::boolean,false) then
     insert into public.extra_day_overtime_review(rule_id,worker_id,work_date,rule_snapshot,source_snapshot,source_fingerprint,currency_code)
     values(internal_rule.id,w.id,p_date,config,src,src->>'fingerprint',src->>'currency') on conflict do nothing;
   end if;
 end loop;
 all_rows:=public.admin_get_extra_day_reviews(p_date,p_date);
 -- Current-window candidates plus historical decisions, never silently replace
 -- a prior approval or its frozen qualification settings.
 return coalesce((select jsonb_agg(item order by item->'source'->'worker'->>'full_name') from (
   select distinct on(value->>'worker_id') value item from jsonb_array_elements(all_rows)
   where ((value->>'rule_id'=internal_rule.id::text and (value->'source'->>'qualified')::boolean)
     or (value->'review'->>'decision' in ('approved','rejected') and (value->'review'->'source_snapshot'->'worker'->>'team_id'=p_team::text)))
   order by value->>'worker_id',case value->'review'->>'decision' when 'approved' then 0 else 1 end,
     case when value->>'rule_id'=internal_rule.id::text then 0 else 1 end,(value->'review'->>'decided_at')::timestamptz desc nulls last,value->>'rule_id'
 ) chosen),'[]');
end $$;
revoke all on function private.extra_day_session(date,time,time,integer),private.extra_day_compat_source(jsonb,uuid,date),private.extra_day_source(jsonb,uuid,date) from public,anon,authenticated;
revoke all on function public.admin_get_extra_day_session_reviews(date,uuid,time,time,integer) from public,anon;
grant execute on function public.admin_get_extra_day_session_reviews(date,uuid,time,time,integer) to authenticated;
notify pgrst,'reload schema';
