-- Canonical checkout timestamps are shared by the daily review payload and Double OT.
create function private.canonical_overtime_checkout(a public.attendance,w public.workers)
returns timestamptz language plpgsql stable set search_path='' as $$
declare proof_text text;proof timestamptz;first_at timestamp;last_at timestamp;clock_at timestamp;
begin
 if a.check_out is null or a.attendance_source<>'biometric' or a.status not in ('present','late','half_day')
   or (coalesce(a.manual_override,false) and a.emergency_overtime_mode is distinct from 'manual_overtime_duration') then return null;end if;
 first_at:=a.attendance_date+case when w.attendance_shift='night' then time '17:00' else time '06:30' end;
 last_at:=a.attendance_date+1+case when w.attendance_shift='night' then time '06:30' else time '02:00' end;
 proof_text:=coalesce(a.biometric_sync_metadata->>'check_out_event_timestamp',a.review_approved_check_out_at::text);
 if proof_text is not null then
   begin proof:=proof_text::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then proof:=null;end;
   if proof is not null and abs(extract(epoch from ((proof at time zone 'Africa/Kinshasa')::time-a.check_out)))<1
     and proof>=first_at at time zone 'Africa/Kinshasa' and proof<=last_at at time zone 'Africa/Kinshasa' then return proof;end if;
 end if;
 -- Same-day clocks are unambiguous. Post-midnight day-worker clocks require
 -- the persisted timestamp proving next-day assignment, as in Daily OT.
 clock_at:=a.attendance_date+a.check_out;
 if w.attendance_shift='night' and a.check_out<=time '06:30' then clock_at:=clock_at+interval '1 day';end if;
 if clock_at between first_at and last_at then return clock_at at time zone 'Africa/Kinshasa';end if;
 return null;
end $$;

alter function private.viewer_payroll_reviews_core(date,date) rename to viewer_payroll_reviews_without_checkout;
create function private.viewer_payroll_reviews_core(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;item jsonb;a public.attendance;w public.workers;answer jsonb:='[]';
begin
 rows:=private.viewer_payroll_reviews_without_checkout(p_start,p_end);
 for item in select value from jsonb_array_elements(rows) loop
   a:=jsonb_populate_record(null::public.attendance,item->'attendance');
   w:=jsonb_populate_record(null::public.workers,item->'worker');
   answer:=answer||jsonb_build_array(jsonb_set(item,'{attendance,canonical_final_checkout_at}',coalesce(to_jsonb(private.canonical_overtime_checkout(a,w)),'null'::jsonb)));
 end loop;
 return answer;
end $$;

alter function private.extra_day_source(jsonb,uuid,date) rename to extra_day_before_canonical_checkout;
create function private.extra_day_source(config jsonb,p_worker uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare body jsonb;a public.attendance;w public.workers;final_at timestamptz;outside_at timestamptz;item jsonb;threshold_at timestamptz;qualified boolean;
begin
 if config->'session_settings'->>'mode' is distinct from 'end_only_canonical' then return private.extra_day_before_canonical_checkout(config,p_worker,p_date);end if;
 -- Keep wage/FINAL outside-work context and raw evidence visible; raw MAX(event)
 -- no longer overrides the canonical biometric attendance checkout.
 body:=private.extra_day_before_canonical_checkout(jsonb_set(config,'{session_settings,mode}','"end_only"'),p_worker,p_date)-'fingerprint';
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date;
 select * into w from public.workers where id=p_worker;
 final_at:=private.canonical_overtime_checkout(a,w);
 for item in select value from jsonb_array_elements(coalesce(body->'outside_work','[]')) loop
   outside_at:=(p_date+coalesce(item->>'end',item->>'shared_end')::time
     +case when coalesce(item->>'end',item->>'shared_end')::time<=coalesce(item->>'start',item->>'shared_start')::time then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa';
   final_at:=greatest(final_at,outside_at);
 end loop;
 threshold_at:=(body->>'qualifying_threshold')::timestamptz;
 qualified:=final_at>=threshold_at and body->'worker'->>'payment_type' in ('weekly','monthly')
   and a.status in ('present','late','half_day') and (w.operational_start_date is null or w.operational_start_date<=p_date)
   and config->'team_ids' ? w.team_id::text
   and not exists(select 1 from public.worker_staff_classification where worker_id=p_worker and classification<>'normal')
   and p_date between (config->>'start_date')::date and (config->>'end_date')::date;
 body:=body||jsonb_build_object('rule',config,'end',final_at,'qualified',coalesce(qualified,false),
   'canonical_attendance_checkout',jsonb_build_object('attendance_id',a.id,'clock',a.check_out,'timestamp',private.canonical_overtime_checkout(a,w)),
   'duration_minutes',case when final_at>(body->>'start')::timestamptz then floor(extract(epoch from final_at-(body->>'start')::timestamptz)/60) else 0 end);
 return body||jsonb_build_object('fingerprint',md5(body::text));
end $$;
create or replace function public.admin_get_extra_day_end_reviews(p_date date,p_team uuid,p_end time default '00:00',p_tolerance integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare internal_rule public.extra_day_overtime_rule;w record;src jsonb;settings jsonb;config jsonb;all_rows jsonb;
begin
 perform private.extra_day_require_admin();
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or not exists(select 1 from public.teams where id=p_team) then raise exception 'Valid date and team required';end if;
 perform private.extra_day_end_threshold(p_date,p_end,p_tolerance);
 settings:=jsonb_build_object('mode','end_only_canonical','end',p_end,'tolerance',p_tolerance);
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

revoke all on function private.canonical_overtime_checkout(public.attendance,public.workers),private.viewer_payroll_reviews_without_checkout(date,date),private.viewer_payroll_reviews_core(date,date),private.extra_day_before_canonical_checkout(jsonb,uuid,date),private.extra_day_source(jsonb,uuid,date) from public,anon,authenticated;
notify pgrst,'reload schema';
