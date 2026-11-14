-- End-only review. Existing approvals keep their original frozen source/settings.
alter function private.extra_day_source(jsonb,uuid,date) rename to extra_day_session_source;
create function private.extra_day_end_threshold(p_date date,p_end time,p_tolerance integer)
returns jsonb language plpgsql immutable set search_path='' as $$
declare end_at timestamp;
begin
 if p_date is null or p_end is null or p_tolerance is null or p_tolerance<0 or p_tolerance>1440 then raise exception 'Valid end time and tolerance required';end if;
 end_at:=p_date+p_end;
 -- Early clocks belong to the bounded following-day tail, not yesterday's midnight.
 if p_end<=time '06:30' then end_at:=end_at+interval '1 day';end if;
 return jsonb_build_object('special_end',end_at at time zone 'Africa/Kinshasa',
   'qualifying_threshold',(end_at-make_interval(mins=>p_tolerance)) at time zone 'Africa/Kinshasa','tolerance_minutes',p_tolerance);
end $$;

create function private.extra_day_source(config jsonb,p_worker uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare body jsonb;context jsonb;op_start timestamp;op_end timestamp;night boolean;outside_rows jsonb;
 first_at timestamptz;last_at timestamptz;out_start timestamptz;out_end timestamptz;qualified boolean;
begin
 if config->'session_settings'->>'mode' is distinct from 'end_only' then return private.extra_day_session_source(config,p_worker,p_date);end if;
 context:=private.extra_day_end_threshold(p_date,(config->'session_settings'->>'end')::time,(config->'session_settings'->>'tolerance')::integer);
 select attendance_shift='night' into night from public.workers where id=p_worker;
 -- Existing canonical operational bounds; no special-work start is required.
 op_start:=p_date+case when night then time '17:00' else time '06:30' end;
 op_end:=p_date+1+case when night then time '06:30' else time '02:00' end;
 -- Reuse canonical wage/worker context and exact-device safe biometric identity resolution.
 -- Its duration qualification is deliberately NOT used by this end-only workflow.
 body:=private.extra_day_rule_source(config||jsonb_build_object('start_time',op_start::time,'window_end',op_end::time,'minimum_end',null,'minimum_minutes',1),p_worker,p_date)-'fingerprint';
 first_at:=(body->>'start')::timestamptz;last_at:=(body->>'end')::timestamptz;
 select coalesce(jsonb_agg(jsonb_build_object('movement_id',m.id,'participant_id',mw.id,'start',mw.start_time,'end',mw.end_time,
   'shared_start',m.common_worker_start,'shared_end',m.common_worker_end,'team_id',m.team_id,'foreman_worker_id',m.foreman_worker_id) order by m.id,mw.id),'[]'),
   min(s.start_at),max(s.end_at) into outside_rows,out_start,out_end
 from public.outside_work_movements m join public.outside_work_movement_workers mw on mw.movement_id=m.id
 cross join lateral(select (p_date+coalesce(mw.start_time,m.common_worker_start)) at time zone 'Africa/Kinshasa' start_at,
   (p_date+coalesce(mw.end_time,m.common_worker_end)+case when coalesce(mw.end_time,m.common_worker_end)<=coalesce(mw.start_time,m.common_worker_start) then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa' end_at) s
 where m.status='final' and m.work_date=p_date and mw.worker_id=p_worker
   and s.start_at>=op_start at time zone 'Africa/Kinshasa' and s.end_at<=op_end at time zone 'Africa/Kinshasa' and s.start_at<s.end_at;
 first_at:=least(first_at,out_start);last_at:=greatest(last_at,out_end);
 qualified:=last_at>=(context->>'qualifying_threshold')::timestamptz
   and body->'worker'->>'payment_type' in ('weekly','monthly') and body->'attendance'->>'status' in ('present','late','half_day')
   and exists(select 1 from public.workers w where w.id=p_worker and (w.operational_start_date is null or w.operational_start_date<=p_date)
     and config->'team_ids' ? w.team_id::text)
   and not exists(select 1 from public.worker_staff_classification where worker_id=p_worker and classification<>'normal')
   and p_date between (config->>'start_date')::date and (config->>'end_date')::date;
 body:=body||context||jsonb_build_object('rule',config,'outside_work',outside_rows,'start',first_at,'end',last_at,
   'qualified',coalesce(qualified,false),'duration_minutes',case when first_at is not null then floor(extract(epoch from last_at-first_at)/60) else 0 end);
 return body||jsonb_build_object('fingerprint',md5(body::text));
end $$;

create function public.admin_get_extra_day_end_reviews(p_date date,p_team uuid,p_end time default '00:00',p_tolerance integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare internal_rule public.extra_day_overtime_rule;w record;src jsonb;settings jsonb;config jsonb;all_rows jsonb;
begin
 perform private.extra_day_require_admin();
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or not exists(select 1 from public.teams where id=p_team) then raise exception 'Valid date and team required';end if;
 perform private.extra_day_end_threshold(p_date,p_end,p_tolerance);
 settings:=jsonb_build_object('mode','end_only','end',p_end,'tolerance',p_tolerance);
 perform pg_advisory_xact_lock(hashtextextended(p_team::text||':'||p_date::text||':daily_extra_review',0));
 -- Compatibility storage only: no rule creation or start parameter in the workflow.
 insert into public.extra_day_overtime_rule(name,enabled,team_ids,worker_ids,start_date,end_date,start_time,window_end,minimum_minutes,actor,review_mode,session_settings)
 values('Daily end review',false,array[p_team],'{}',p_date,p_date,'00:00','23:59:59.999999',1,auth.uid(),'daily_window',settings)
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
 return coalesce((select jsonb_agg(item order by item->'source'->'worker'->>'full_name') from (
   select distinct on(value->>'worker_id') value item from jsonb_array_elements(all_rows)
   where ((value->>'rule_id'=internal_rule.id::text and (value->'source'->>'qualified')::boolean)
     or (value->'review'->>'decision' in ('approved','rejected') and value->'review'->'source_snapshot'->'worker'->>'team_id'=p_team::text))
   order by value->>'worker_id',case value->'review'->>'decision' when 'approved' then 0 else 1 end,
     case when value->>'rule_id'=internal_rule.id::text then 0 else 1 end,(value->'review'->>'decided_at')::timestamptz desc nulls last,value->>'rule_id'
 ) chosen),'[]');
end $$;
revoke all on function private.extra_day_end_threshold(date,time,integer),private.extra_day_session_source(jsonb,uuid,date),private.extra_day_source(jsonb,uuid,date) from public,anon,authenticated;
revoke all on function public.admin_get_extra_day_end_reviews(date,uuid,time,integer) from public,anon;
grant execute on function public.admin_get_extra_day_end_reviews(date,uuid,time,integer) to authenticated;
notify pgrst,'reload schema';
