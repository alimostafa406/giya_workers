-- Keep existing rule-based history and payroll contracts. Daily review needs no admin-created rule.
alter table public.extra_day_overtime_rule add column review_mode text not null default 'configured' check(review_mode in ('configured','daily'));
create unique index extra_day_daily_scope on public.extra_day_overtime_rule((team_ids[1]),start_date) where review_mode='daily';
alter function private.extra_day_source(jsonb,uuid,date) rename to extra_day_rule_source;

create function private.extra_day_source(config jsonb,p_worker uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare body jsonb; evidence_config jsonb:=config; outside_rows jsonb; first_at timestamptz; last_at timestamptz;
begin
 if coalesce(config->>'review_mode','configured')<>'daily' then
   return private.extra_day_rule_source(config,p_worker,p_date);
 end if;
 -- No invented evening threshold. Expose real work evidence for admin review.
 -- Night workers retain their canonical 17:00 -> 06:30 operational date.
 if exists(select 1 from public.workers where id=p_worker and attendance_shift='night') then
   evidence_config:=config||'{"start_time":"17:00","window_end":"06:30"}'::jsonb;
 end if;
 body:=private.extra_day_rule_source(evidence_config,p_worker,p_date)-'fingerprint';
 select coalesce(jsonb_agg(jsonb_build_object('movement_id',m.id,'participant_id',mw.id,'start',mw.start_time,'end',mw.end_time,
   'shared_start',m.common_worker_start,'shared_end',m.common_worker_end,'team_id',m.team_id,'foreman_worker_id',m.foreman_worker_id) order by m.id,mw.id),'[]')
 into outside_rows from public.outside_work_movements m join public.outside_work_movement_workers mw on mw.movement_id=m.id
 where m.status='final' and m.work_date=p_date and mw.worker_id=p_worker
 and coalesce(mw.start_time,m.common_worker_start) is not null
 and coalesce(mw.end_time,m.common_worker_end) is not null
 and coalesce(mw.start_time,m.common_worker_start)<>coalesce(mw.end_time,m.common_worker_end);
 first_at:=nullif(body->>'start','')::timestamptz;last_at:=nullif(body->>'end','')::timestamptz;
 if first_at is null or last_at is null or first_at>=last_at then
   select min((p_date+coalesce(mw.start_time,m.common_worker_start)) at time zone 'Africa/Kinshasa'),
     max((p_date+coalesce(mw.end_time,m.common_worker_end)+case when coalesce(mw.end_time,m.common_worker_end)<coalesce(mw.start_time,m.common_worker_start) then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa')
   into first_at,last_at from public.outside_work_movements m join public.outside_work_movement_workers mw on mw.movement_id=m.id
   where m.status='final' and m.work_date=p_date and mw.worker_id=p_worker
     and coalesce(mw.start_time,m.common_worker_start)<>coalesce(mw.end_time,m.common_worker_end);
 end if;
 body:=body||jsonb_build_object('rule',config,'outside_work',outside_rows,'start',first_at,'end',last_at,
   'duration_minutes',floor(extract(epoch from last_at-first_at)/60),
   'qualified',coalesce((body->>'qualified')::boolean,false) or (
     jsonb_array_length(outside_rows)>0 and body->'worker'->>'payment_type' in ('weekly','monthly')
     and body->'attendance'->>'status' in ('present','late','half_day')
     and exists(select 1 from public.workers w where w.id=p_worker and (w.operational_start_date is null or w.operational_start_date<=p_date)
       and (config->'team_ids' ? w.team_id::text or config->'worker_ids' ? w.id::text))
     and not exists(select 1 from public.worker_staff_classification where worker_id=p_worker and classification<>'normal')
     and p_date between (config->>'start_date')::date and (config->>'end_date')::date));
 return body||jsonb_build_object('fingerprint',md5(body::text));
end $$;
revoke all on function private.extra_day_source(jsonb,uuid,date),private.extra_day_rule_source(jsonb,uuid,date) from public,anon,authenticated;

create function public.admin_get_daily_extra_day_reviews(p_date date,p_team uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare internal_rule public.extra_day_overtime_rule; w record; src jsonb; all_rows jsonb;
begin
 perform private.extra_day_require_admin();
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or not exists(select 1 from public.teams where id=p_team) then raise exception 'Valid date and team required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_team::text||':'||p_date::text||':daily_extra_review',0));
 -- Internal compatibility scope only; never shown as rule management.
 insert into public.extra_day_overtime_rule(name,enabled,team_ids,worker_ids,start_date,end_date,start_time,window_end,minimum_minutes,actor,review_mode)
 values('Daily review',false,array[p_team],'{}',p_date,p_date,'00:00','23:59:59.999999',1,auth.uid(),'daily')
 on conflict ((team_ids[1]),start_date) where review_mode='daily' do nothing;
 select * into strict internal_rule from public.extra_day_overtime_rule where review_mode='daily' and team_ids[1]=p_team and start_date=p_date;
 for w in select id from public.workers where team_id=p_team loop
   if private.extra_day_locked(w.id,p_date) or exists(select 1 from public.extra_day_overtime_review where worker_id=w.id and work_date=p_date) then continue; end if;
   src:=private.extra_day_source(to_jsonb(internal_rule)-'history',w.id,p_date);
   if coalesce((src->>'qualified')::boolean,false) then
     insert into public.extra_day_overtime_review(rule_id,worker_id,work_date,rule_snapshot,source_snapshot,source_fingerprint,currency_code)
     values(internal_rule.id,w.id,p_date,to_jsonb(internal_rule)-'history',src,src->>'fingerprint',src->>'currency') on conflict do nothing;
   end if;
 end loop;
 all_rows:=public.admin_get_extra_day_reviews(p_date,p_date);
 -- Preserve earlier decisions; one row per worker/date even if old rules overlap.
 return coalesce((select jsonb_agg(item order by item->'source'->'worker'->>'full_name') from (
   select distinct on (value->>'worker_id') value item from jsonb_array_elements(all_rows)
   where value->'source'->'worker'->>'team_id'=p_team::text or value->'review'->'source_snapshot'->'worker'->>'team_id'=p_team::text
   order by value->>'worker_id',case value->'review'->>'decision' when 'approved' then 0 when 'rejected' then 1 else 2 end,
     (value->'review'->>'decided_at')::timestamptz desc nulls last,value->>'rule_id'
 ) selected),'[]');
end $$;
revoke all on function public.admin_get_daily_extra_day_reviews(date,uuid) from public,anon;
grant execute on function public.admin_get_daily_extra_day_reviews(date,uuid) to authenticated;
notify pgrst,'reload schema';
