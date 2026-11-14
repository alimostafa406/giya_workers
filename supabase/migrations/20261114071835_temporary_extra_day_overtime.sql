create table public.extra_day_overtime_rule (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 150),
 enabled boolean not null default true, team_ids uuid[] not null default '{}',worker_ids uuid[] not null default '{}',
 start_date date not null,end_date date not null check(end_date>=start_date),
 start_time time not null,window_end time not null,minimum_end time,minimum_minutes integer check(minimum_minutes between 1 and 1440),
 payment_mode text not null default 'extra_full_day' check(payment_mode='extra_full_day'),notes text not null default '' check(length(notes)<=2000),
 version integer not null default 1,actor uuid not null references public.admins(id),updated_at timestamptz not null default now(),history jsonb not null default '[]',
 check(cardinality(team_ids)+cardinality(worker_ids)>0),check(minimum_end is not null or minimum_minutes is not null)
);
create table public.extra_day_overtime_review (
 rule_id uuid not null references public.extra_day_overtime_rule(id),worker_id uuid not null references public.workers(id),work_date date not null,
 rule_snapshot jsonb not null,source_snapshot jsonb not null,source_fingerprint text not null,
 decision text not null default 'pending' check(decision in ('pending','approved','rejected')),
 approved_amount numeric(14,2) not null default 0 check(approved_amount>=0),currency_code text,
 version integer not null default 0,actor uuid references public.admins(id),decided_at timestamptz,history jsonb not null default '[]',
 primary key(rule_id,worker_id,work_date)
);
create unique index extra_day_one_approval_per_date on public.extra_day_overtime_review(worker_id,work_date) where decision='approved';
create index extra_day_review_date on public.extra_day_overtime_review(work_date,worker_id);
alter table public.extra_day_overtime_rule enable row level security;
alter table public.extra_day_overtime_review enable row level security;
revoke all on public.extra_day_overtime_rule,public.extra_day_overtime_review from anon,authenticated;
grant select on public.extra_day_overtime_rule,public.extra_day_overtime_review to authenticated;
create policy extra_rule_admin on public.extra_day_overtime_rule for select to authenticated using((select public.is_admin()));
create policy extra_review_admin on public.extra_day_overtime_review for select to authenticated using((select public.is_admin()));

create function private.extra_day_require_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active)
 then raise exception 'Active admin required' using errcode='42501'; end if;
end $$;
create function private.extra_day_locked(p_worker uuid,p_date date) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.payroll_run where payment_type='weekly' and p_date between weekly_period_start and weekly_period_end and status in ('reviewed','finalized','paid'))
 or exists(select 1 from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id where l.worker_id=p_worker and p_date between l.attendance_period_start and l.attendance_period_end and r.status in ('reviewed','finalized','paid'));
$$;

create function public.admin_save_extra_day_rule(p_rule jsonb,p_id uuid default null,p_version integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.extra_day_overtime_rule; saved public.extra_day_overtime_rule; teams uuid[]; workers uuid[]; entry jsonb;
begin
 perform private.extra_day_require_admin();
 teams:=array(select value::uuid from jsonb_array_elements_text(coalesce(p_rule->'team_ids','[]')));
 workers:=array(select value::uuid from jsonb_array_elements_text(coalesce(p_rule->'worker_ids','[]')));
 if exists(select 1 from unnest(teams) id where not exists(select 1 from public.teams t where t.id=id))
   or exists(select 1 from unnest(workers) id where not exists(select 1 from public.workers w where w.id=id)) then raise exception 'Invalid target'; end if;
 if p_id is not null then select * into strict old from public.extra_day_overtime_rule where id=p_id for update;
   if old.version<>p_version then raise exception 'Rule changed; reload'; end if;
 elsif p_version<>0 then raise exception 'Invalid rule version'; end if;
 entry:=jsonb_build_object('actor',auth.uid(),'at',now(),'previous',case when old.id is not null then to_jsonb(old)-'history' end,'configuration',p_rule);
 insert into public.extra_day_overtime_rule(id,name,enabled,team_ids,worker_ids,start_date,end_date,start_time,window_end,minimum_end,minimum_minutes,notes,version,actor,history)
 values(coalesce(p_id,gen_random_uuid()),btrim(p_rule->>'name'),coalesce((p_rule->>'enabled')::boolean,true),teams,workers,
 (p_rule->>'start_date')::date,(p_rule->>'end_date')::date,(p_rule->>'start_time')::time,(p_rule->>'window_end')::time,
 nullif(p_rule->>'minimum_end','')::time,nullif(p_rule->>'minimum_minutes','')::integer,coalesce(p_rule->>'notes',''),coalesce(old.version,0)+1,auth.uid(),coalesce(old.history,'[]')||jsonb_build_array(entry))
 on conflict(id) do update set name=excluded.name,enabled=excluded.enabled,team_ids=excluded.team_ids,worker_ids=excluded.worker_ids,
 start_date=excluded.start_date,end_date=excluded.end_date,start_time=excluded.start_time,window_end=excluded.window_end,minimum_end=excluded.minimum_end,
 minimum_minutes=excluded.minimum_minutes,notes=excluded.notes,version=excluded.version,actor=excluded.actor,updated_at=now(),history=excluded.history returning * into saved;
 if saved.minimum_minutes is not null and saved.minimum_minutes>extract(epoch from(case when saved.window_end<=saved.start_time then saved.window_end-saved.start_time+interval '1 day' else saved.window_end-saved.start_time end))/60 then raise exception 'Duration exceeds evidence window'; end if;
 if saved.minimum_end is not null and
   (case when saved.minimum_end<=saved.start_time then saved.minimum_end-saved.start_time+interval '1 day' else saved.minimum_end-saved.start_time end)>
   (case when saved.window_end<=saved.start_time then saved.window_end-saved.start_time+interval '1 day' else saved.window_end-saved.start_time end) then raise exception 'Minimum end exceeds evidence window'; end if;
 return to_jsonb(saved);
end $$;

create function private.extra_day_source(config jsonb,p_worker uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.workers; a public.attendance; term public.worker_payroll_compensation; payment text; salary numeric; divisor numeric;
 start_at timestamp; end_at timestamp; min_end timestamp; first_at timestamptz; last_at timestamptz; evidence jsonb; wage numeric; body jsonb; qualifies boolean; reason text;
begin
 select * into w from public.workers where id=p_worker;
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date;
 select payment_type,monthly_salary into payment,salary from public.worker_payroll_profile where worker_id=p_worker;
 select * into term from public.worker_payroll_compensation where worker_id=p_worker and payment_type=payment and effective_from<=p_date and (effective_to is null or effective_to>=p_date) order by effective_from desc,created_at desc limit 1;
 if payment='weekly' then wage:=term.daily_rate;
 elsif payment='monthly' then
   select coalesce(nullif(monthly_working_day_divisor,0),26) into divisor from public.payroll_rule_set where is_active and effective_from<=p_date and (effective_to is null or effective_to>=p_date) order by effective_from desc limit 1;
   wage:=round(coalesce(term.monthly_salary,salary)/coalesce(divisor,26),2);
 end if;
 if wage is null or wage<0 or term.currency_code is null then reason:='Canonical daily wage/currency missing'; end if;
 start_at:=p_date+(config->>'start_time')::time;
 end_at:=p_date+(config->>'window_end')::time;
 if end_at<=start_at then end_at:=end_at+interval '1 day'; end if;
 if nullif(config->>'minimum_end','') is not null then min_end:=p_date+(config->>'minimum_end')::time;
   if min_end<=start_at then min_end:=min_end+interval '1 day'; end if; end if;
 select min(e.event_timestamp),max(e.event_timestamp),coalesce(jsonb_agg(jsonb_build_object('id',e.id,'device',e.device_id,'employee_no',e.device_employee_no,'timestamp',e.event_timestamp) order by e.event_timestamp,e.id),'[]')
 into first_at,last_at,evidence from public.biometric_attendance_events e
 where e.worker_id=p_worker and e.event_timestamp>=start_at at time zone 'Africa/Kinshasa' and e.event_timestamp<=end_at at time zone 'Africa/Kinshasa'
 and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=p_worker;
 qualifies:=w.id is not null and payment in ('weekly','monthly')
   and not exists(select 1 from public.worker_staff_classification where worker_id=p_worker and classification<>'normal')
   and (w.operational_start_date is null or w.operational_start_date<=p_date)
   and p_date between (config->>'start_date')::date and (config->>'end_date')::date
   and (config->'team_ids' ? w.team_id::text or config->'worker_ids' ? w.id::text)
   and a.status in ('present','late','half_day') and first_at<last_at
   and (min_end is null or last_at at time zone 'Africa/Kinshasa'>=min_end)
   and (nullif(config->>'minimum_minutes','') is null or extract(epoch from last_at-first_at)/60>=(config->>'minimum_minutes')::integer);
 body:=jsonb_build_object('qualified',coalesce(qualifies,false),'worker',jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,'team_id',w.team_id,'team_name',(select name from public.teams where id=w.team_id),'payment_type',payment),
   'date',p_date,'attendance',jsonb_build_object('id',a.id,'status',a.status,'fraction',a.attendance_day_fraction),
   'start',first_at,'end',last_at,'duration_minutes',floor(extract(epoch from last_at-first_at)/60),
   'events',evidence,'daily_wage',wage,'proposed_premium',wage,'currency',term.currency_code,'configuration_error',reason,'rule',config);
 return body||jsonb_build_object('fingerprint',md5(body::text));
end $$;

create function public.admin_get_extra_day_reviews(p_start date,p_end date) returns jsonb language plpgsql security definer set search_path='' as $$
declare rule public.extra_day_overtime_rule; target record; day date; src jsonb; today date:=(now() at time zone 'Africa/Kinshasa')::date;
begin
 perform private.extra_day_require_admin();
 if p_start is null or p_end is null or p_end<p_start or p_end>p_start+31 then raise exception 'Invalid review range'; end if;
 -- Generation only while enabled and unexpired. Persisted candidates/decisions
 -- use their original configuration after disable/expiry; no deletion/rebuild.
 for rule in select * from public.extra_day_overtime_rule where enabled and end_date>=today and start_date<=least(p_end,today) and end_date>=p_start loop
   for target in select w.id from public.workers w where w.team_id=any(rule.team_ids) or w.id=any(rule.worker_ids) loop
     for day in select generate_series(greatest(p_start,rule.start_date)::timestamp,least(p_end,rule.end_date,today)::timestamp,interval '1 day')::date loop
       if private.extra_day_locked(target.id,day) then continue; end if;
       src:=private.extra_day_source(to_jsonb(rule)-'history',target.id,day);
       if (src->>'qualified')::boolean then
         insert into public.extra_day_overtime_review(rule_id,worker_id,work_date,rule_snapshot,source_snapshot,source_fingerprint,currency_code)
         values(rule.id,target.id,day,to_jsonb(rule)-'history',src,src->>'fingerprint',src->>'currency') on conflict do nothing;
       end if;
     end loop;
   end loop;
 end loop;
 return coalesce((select jsonb_agg(jsonb_build_object('rule_id',r.rule_id,'worker_id',r.worker_id,'work_date',r.work_date,'review',to_jsonb(r),
   'source',case when private.extra_day_locked(r.worker_id,r.work_date) then r.source_snapshot else s.value end,
   'payroll_source',(select value from jsonb_array_elements(private.extra_day_payroll_sources(r.worker_id,r.work_date,r.work_date)) where value->>'rule_id'=r.rule_id::text limit 1),
   'status',case when not private.extra_day_locked(r.worker_id,r.work_date) and s.value->>'fingerprint'<>r.source_fingerprint then 'stale' else r.decision end,
   'locked',private.extra_day_locked(r.worker_id,r.work_date)) order by r.work_date,r.source_snapshot->'worker'->>'full_name')
 from public.extra_day_overtime_review r cross join lateral(select private.extra_day_source(r.rule_snapshot,r.worker_id,r.work_date) value) s
 where r.work_date between p_start and p_end),'[]');
end $$;

create function public.admin_decide_extra_day(p_entries jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e jsonb; old public.extra_day_overtime_review; src jsonb; answer jsonb:='[]';
begin
 perform private.extra_day_require_admin();
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid batch'; end if;
 if (select count(distinct (value->>'worker_id')||':'||(value->>'work_date')) from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Duplicate worker/date'; end if;
 lock table public.payroll_run in share mode;
 for e in select value from jsonb_array_elements(p_entries) order by value->>'worker_id',value->>'work_date' loop
   if coalesce(e->>'decision','') not in ('approved','rejected') then raise exception 'Invalid decision'; end if;
   perform pg_advisory_xact_lock(hashtextextended((e->>'worker_id')||':'||(e->>'work_date')||':extra_day',0));
   select * into strict old from public.extra_day_overtime_review where rule_id=(e->>'rule_id')::uuid and worker_id=(e->>'worker_id')::uuid and work_date=(e->>'work_date')::date for update;
   if private.extra_day_locked(old.worker_id,old.work_date) then raise exception 'Payroll locked'; end if;
   if old.version is distinct from (e->>'expected_version')::integer then raise exception 'Review changed; reload'; end if;
   src:=private.extra_day_source(old.rule_snapshot,old.worker_id,old.work_date);
   if e->>'source_fingerprint' is distinct from src->>'fingerprint' then raise exception 'Evidence/wage changed; reload'; end if;
   if e->>'decision'='approved' then
     if not (src->>'qualified')::boolean or src->>'configuration_error' is not null then raise exception 'Qualifying evidence and canonical daily wage required'; end if;
     if exists(select 1 from public.worker_weekly_overtime_override where worker_id=old.worker_id and minutes>0 and old.work_date between week_start and week_start+5) then raise exception 'Clear undated weekly OT override before approving an extra day'; end if;
   end if;
   update public.extra_day_overtime_review set decision=e->>'decision',source_snapshot=src,source_fingerprint=src->>'fingerprint',currency_code=src->>'currency',
     approved_amount=case when e->>'decision'='approved' then (src->>'daily_wage')::numeric else 0 end,
     actor=auth.uid(),decided_at=now(),version=old.version+1,
     history=old.history||jsonb_build_array(jsonb_build_object('previous',to_jsonb(old)-'history','rule',old.rule_snapshot,'source',src,
       'decision',e->>'decision','actor',auth.uid(),'at',now(),'extra_days',case when e->>'decision'='approved' then 1 else 0 end))
     where rule_id=old.rule_id and worker_id=old.worker_id and work_date=old.work_date;
   answer:=answer||jsonb_build_array(jsonb_build_object('worker_id',old.worker_id,'version',old.version+1));
 end loop;
 return answer;
end $$;

create function private.extra_day_payroll_sources(p_worker uuid,p_start date,p_end date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('rule_id',r.rule_id,'worker_id',r.worker_id,'date',r.work_date,'version',r.version,
   'amount',r.approved_amount,'currency',r.currency_code,'source_fingerprint',r.source_fingerprint,'extra_days',1) order by r.work_date),'[]')
 from public.extra_day_overtime_review r where worker_id=p_worker and work_date between p_start and p_end and decision='approved'
 and source_fingerprint=private.extra_day_source(rule_snapshot,worker_id,work_date)->>'fingerprint';
$$;
create function private.guard_extra_day_payroll() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.payroll_line; run public.payroll_run; sources jsonb; amount numeric; d jsonb;
begin
 if tg_table_name='payroll_line' then select * into run from public.payroll_run where id=new.payroll_run_id for update;
   if run.payment_type<>'weekly' or run.status<>'draft' then return new; end if;
   l:=new;
 elsif new.payment_type='weekly' and old.status='draft' and new.status='reviewed' then
   for l in select * from public.payroll_line where payroll_run_id=new.id loop
     sources:=private.extra_day_payroll_sources(l.worker_id,l.attendance_period_start,l.attendance_period_end);
     if sources<>coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]') then raise exception 'Extra-day decisions changed; refresh Draft'; end if;
     if jsonb_array_length(sources)>0 and exists(select 1 from public.worker_weekly_overtime_override where worker_id=l.worker_id and minutes>0 and week_start=l.attendance_period_start) then raise exception 'Extra day conflicts with undated weekly OT'; end if;
   end loop;
   return new;
 else return new; end if;
 sources:=private.extra_day_payroll_sources(l.worker_id,l.attendance_period_start,l.attendance_period_end);
 select coalesce(sum((value->>'amount')::numeric),0) into amount from jsonb_array_elements(sources);
 if sources<>coalesce(l.attendance_summary_snapshot->'extra_day_premiums','[]') or amount<>coalesce((l.calculation_snapshot->>'extra_day_amount')::numeric,0)
   or coalesce(l.bonus_amount,0)<amount then raise exception 'Extra-day premium changed; refresh Draft'; end if;
 if jsonb_array_length(sources)>0 then
   if exists(select 1 from public.worker_weekly_overtime_override where worker_id=l.worker_id and minutes>0 and week_start=l.attendance_period_start)
     or exists(select 1 from jsonb_array_elements(sources) s where s->>'currency'<>l.currency_code_snapshot) then raise exception 'Extra day conflicts with currency/undated weekly OT'; end if;
   for d in select value from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]')) loop
     if exists(select 1 from jsonb_array_elements(sources) s where s->>'date'=d->>'date') and (d->>'minutes')::numeric<>0 then raise exception 'Hourly OT overlaps approved extra day'; end if;
   end loop;
 end if;
 return new;
end $$;
create trigger extra_day_payroll_line before insert or update on public.payroll_line for each row execute function private.guard_extra_day_payroll();
create trigger extra_day_payroll_run before update of status on public.payroll_run for each row execute function private.guard_extra_day_payroll();
create function private.guard_extra_day_weekly_override() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.minutes>0 and jsonb_array_length(private.extra_day_payroll_sources(new.worker_id,new.week_start,new.week_start+5))>0 then
   raise exception 'Approved extra day cannot be combined with an undated weekly OT override'; end if;
 return new;
end $$;
create trigger extra_day_weekly_override before insert or update on public.worker_weekly_overtime_override for each row execute function private.guard_extra_day_weekly_override();
revoke all on function private.extra_day_require_admin(),private.extra_day_locked(uuid,date),private.extra_day_source(jsonb,uuid,date),private.extra_day_payroll_sources(uuid,date,date),private.guard_extra_day_payroll(),private.guard_extra_day_weekly_override() from public,anon,authenticated;
revoke all on function public.admin_save_extra_day_rule(jsonb,uuid,integer),public.admin_get_extra_day_reviews(date,date),public.admin_decide_extra_day(jsonb) from public,anon;
grant execute on function public.admin_save_extra_day_rule(jsonb,uuid,integer),public.admin_get_extra_day_reviews(date,date),public.admin_decide_extra_day(jsonb) to authenticated;
notify pgrst,'reload schema';
