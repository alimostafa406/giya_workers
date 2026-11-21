-- Explicit admin exceptions, never attendance or biometric evidence.
create table public.worker_manual_overtime_exception(
 id uuid primary key default gen_random_uuid(),worker_id uuid not null references public.workers(id),work_date date not null,
 team_id uuid not null references public.teams(id),extra_days integer not null check(extra_days between 0 and 31),
 extra_minutes integer not null check(extra_minutes between 0 and 1440),daily_wage numeric not null check(daily_wage>=0),
 hourly_rate numeric not null check(hourly_rate>=0),currency_code text not null,full_day_amount numeric(18,2) not null,
 hourly_amount numeric(18,2) not null,total_amount numeric(18,2) not null,note text not null check(length(note) between 1 and 1000),
 active boolean not null default true,version integer not null default 1,rate_snapshot jsonb not null,
 created_by uuid not null references public.admins(id),updated_by uuid not null references public.admins(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),history jsonb not null default '[]',
 unique(worker_id,work_date),check(extra_days>0 or extra_minutes>0)
);
create index manual_overtime_exception_date on public.worker_manual_overtime_exception(work_date,worker_id) where active;
alter table public.worker_manual_overtime_exception enable row level security;
revoke all on public.worker_manual_overtime_exception from public,anon,authenticated;

create function private.manual_exception_rates(p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare body jsonb;term public.worker_payroll_compensation;answer jsonb;
begin
 -- Reuse the canonical dated daily wage, including monthly daily equivalent.
 body:=private.extra_day_rule_source(jsonb_build_object('start_time','00:00','window_end','00:00','start_date',p_date,'end_date',p_date,'team_ids','[]'::jsonb,'worker_ids',jsonb_build_array(p_worker)),p_worker,p_date);
 select * into term from public.worker_payroll_compensation c where c.worker_id=p_worker and c.payment_type=body->'worker'->>'payment_type'
 and c.effective_from<=p_date and(c.effective_to is null or c.effective_to>=p_date) order by effective_from desc,created_at desc limit 1;
 answer:=jsonb_build_object('daily_wage',body->'daily_wage','hourly_rate',term.overtime_rate_per_hour,'currency',body->'currency','term_id',term.id,'term_updated_at',term.updated_at);
 return answer||jsonb_build_object('fingerprint',md5(answer::text));
end $$;
create function private.manual_exception_snapshot(e public.worker_manual_overtime_exception) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',e.id,'version',e.version,'date',e.work_date,'extra_days',e.extra_days,'minutes',e.extra_minutes,
 'daily_wage',e.daily_wage,'hourly_rate',e.hourly_rate,'full_day_amount',e.full_day_amount,'hourly_amount',e.hourly_amount,'currency',e.currency_code);
$$;
create function public.admin_get_manual_overtime_exceptions(p_date date,p_team uuid,p_worker uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.extra_day_require_admin();
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or extract(isodow from p_date)=7 then raise exception 'Select a Monday-Saturday date';end if;
 if p_worker is not null and not exists(select 1 from public.workers where id=p_worker and team_id=p_team) then raise exception 'Worker is not a member of selected team';end if;
 return jsonb_build_object('workers',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,'is_active',w.is_active,'payment_type',p.payment_type) order by w.full_name)
 from public.workers w join public.worker_payroll_profile p on p.worker_id=w.id where w.team_id=p_team and p.payment_type in('weekly','monthly') and(w.operational_start_date is null or w.operational_start_date<=p_date)),'[]'),
 'entries',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('worker_name',w.full_name,'employee_code',w.employee_code) order by w.full_name) from public.worker_manual_overtime_exception e join public.workers w on w.id=e.worker_id where e.work_date=p_date and e.team_id=p_team),'[]'),
 'rates',case when p_worker is not null then private.manual_exception_rates(p_worker,p_date) end,
 'locked',case when p_worker is not null then private.extra_day_locked(p_worker,p_date) else false end);
end $$;

alter function private.extra_day_payroll_sources(uuid,date,date) rename to extra_day_sources_before_manual;
create function private.extra_day_payroll_sources(p_worker uuid,p_start date,p_end date) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(value order by value->>'date'),'[]') from jsonb_array_elements(private.extra_day_sources_before_manual(p_worker,p_start,p_end)||coalesce((select jsonb_agg(jsonb_build_object('manual_exception_id',e.id,'worker_id',e.worker_id,'date',e.work_date,'version',e.version,
 'amount',e.full_day_amount,'currency',e.currency_code,'extra_days',e.extra_days,'source_fingerprint',md5(private.manual_exception_snapshot(e)::text)) order by e.work_date)
 from public.worker_manual_overtime_exception e where e.worker_id=p_worker and e.work_date between p_start and p_end and e.active and e.extra_days>0),'[]'));
$$;
alter function private.payroll_extra_day_reviews(date,date) rename to extra_day_reviews_before_manual;
create function private.payroll_extra_day_reviews(p_start date,p_end date) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.extra_day_reviews_before_manual(p_start,p_end)||coalesce((select jsonb_agg(jsonb_build_object('worker_id',e.worker_id,'work_date',e.work_date,'status','approved','manual_exception',private.manual_exception_snapshot(e),
 'source',jsonb_build_object('qualified',true,'fingerprint',md5(private.manual_exception_snapshot(e)::text)),
 'review',jsonb_build_object('source_fingerprint',md5(private.manual_exception_snapshot(e)::text)),
 'payroll_source',case when e.extra_days>0 then jsonb_build_object('manual_exception_id',e.id,'worker_id',e.worker_id,'date',e.work_date,'version',e.version,'amount',e.full_day_amount,'currency',e.currency_code,'extra_days',e.extra_days,'source_fingerprint',md5(private.manual_exception_snapshot(e)::text)) end) order by e.work_date,e.id)
 from public.worker_manual_overtime_exception e where e.work_date between p_start and p_end and e.active),'[]');
$$;

create function public.admin_save_manual_overtime_exception(p_worker uuid,p_date date,p_team uuid,p_days integer,p_minutes integer,p_note text,p_version integer,p_rate_fingerprint text,p_clear boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.worker_manual_overtime_exception;result public.worker_manual_overtime_exception;rates jsonb;week date;w public.workers;overlap boolean;
begin
 perform private.extra_day_require_admin();
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or extract(isodow from p_date)=7 then raise exception 'Select a Monday-Saturday date';end if;
 if p_note is null or length(btrim(p_note)) not between 1 and 1000 then raise exception 'Reason required';end if;
 select * into strict w from public.workers where id=p_worker;
 if w.team_id is distinct from p_team or(w.operational_start_date is not null and w.operational_start_date>p_date) then raise exception 'Worker/team/date is not eligible';end if;
 lock table public.payroll_run in share mode;
 perform pg_advisory_xact_lock(hashtextextended(p_worker::text||':'||p_date::text||':extra_day',0));
 if private.extra_day_locked(p_worker,p_date) then raise exception 'Payroll locked; exception cannot be changed';end if;
 select * into old from public.worker_manual_overtime_exception where worker_id=p_worker and work_date=p_date for update;
 if p_version is null or p_version<>coalesce(old.version,0) then raise exception 'Exception changed; reload';end if;
 if p_clear then
   if old.id is null then raise exception 'No exception to clear';end if;
   update public.worker_manual_overtime_exception set active=false,version=old.version+1,note=btrim(p_note),updated_by=auth.uid(),updated_at=now(),
     history=old.history||jsonb_build_array(jsonb_build_object('action','clear','previous',to_jsonb(old)-'history','actor',auth.uid(),'at',now(),'reason',btrim(p_note))) where id=old.id returning * into result;
   return to_jsonb(result);
 end if;
 if p_days is null or p_minutes is null or p_days not between 0 and 31 or p_minutes not between 0 and 1440 or p_days+p_minutes=0 then raise exception 'Invalid days/minutes';end if;
 rates:=private.manual_exception_rates(p_worker,p_date);
 if rates->>'fingerprint' is distinct from p_rate_fingerprint then raise exception 'Canonical rates changed; reload';end if;
 if nullif(rates->>'currency','') is null or(p_days>0 and (rates->>'daily_wage' is null or(rates->>'daily_wage')::numeric<0)) or(p_minutes>0 and(rates->>'hourly_rate' is null or(rates->>'hourly_rate')::numeric<0)) then raise exception 'Canonical wage/hourly rate/currency required';end if;
 week:=p_date-(extract(isodow from p_date)::integer-1);
 if exists(select 1 from public.worker_weekly_overtime_override where worker_id=p_worker and week_start=week and minutes>0) then raise exception 'Overlap: clear positive weekly OT override first';end if;
 if p_days>0 and jsonb_array_length(private.extra_day_sources_before_manual(p_worker,p_date,p_date))>0 then raise exception 'Overlap: approved Double OT already pays the full-day component; enter zero extra days';end if;
 -- Existing suppressed hourly history is preserved. Only currently payable overlap blocks a save.
 if not coalesce(private.extra_day_owns_hourly_date(p_worker,p_date),false) and not coalesce(private.midnight_double_ot_date(p_worker,p_date),false) then
   if exists(select 1 from public.attendance a where a.worker_id=p_worker and a.attendance_date=p_date and a.manual_override and a.emergency_overtime_mode='manual_overtime_duration' and a.emergency_overtime_minutes>0) then raise exception 'Overlap: daily manual overtime already payable';end if;
   if exists(select 1 from jsonb_array_elements(private.viewer_payroll_reviews_core(p_date,p_date)) s where s->'worker'->>'id'=p_worker::text and s->'review'->>'decision'='approved' and s->'review'->>'source_fingerprint'=s->>'source_fingerprint' and(s->'review'->>'minutes')::integer>0) then raise exception 'Overlap: approved biometric overtime already payable';end if;
   if exists(select 1 from public.outside_work_movements m left join public.outside_work_movement_workers mw on mw.movement_id=m.id and mw.worker_id=p_worker where m.work_date=p_date and m.status='final' and
     ((m.foreman_worker_id=p_worker and m.end_time>case when extract(isodow from p_date)=6 then time '14:00' else time '17:00' end)
     or(mw.worker_id=p_worker and coalesce(mw.end_time,m.common_worker_end)>case when extract(isodow from p_date)=6 then time '14:00' else time '17:00' end))) then raise exception 'Overlap: FINAL outside-work overtime already payable';end if;
 end if;
 insert into public.worker_manual_overtime_exception(worker_id,work_date,team_id,extra_days,extra_minutes,daily_wage,hourly_rate,currency_code,full_day_amount,hourly_amount,total_amount,note,active,version,rate_snapshot,created_by,updated_by,history)
 values(p_worker,p_date,p_team,p_days,p_minutes,coalesce((rates->>'daily_wage')::numeric,0),coalesce((rates->>'hourly_rate')::numeric,0),rates->>'currency',round(p_days*coalesce((rates->>'daily_wage')::numeric,0),2),round(p_minutes*coalesce((rates->>'hourly_rate')::numeric,0)/60,2),round(p_days*coalesce((rates->>'daily_wage')::numeric,0),2)+round(p_minutes*coalesce((rates->>'hourly_rate')::numeric,0)/60,2),btrim(p_note),true,coalesce(old.version,0)+1,rates,auth.uid(),auth.uid(),coalesce(old.history,'[]')||jsonb_build_array(jsonb_build_object('action',case when old.id is null then 'create' else 'edit' end,'previous',case when old.id is not null then to_jsonb(old)-'history' end,'days',p_days,'minutes',p_minutes,'rates',rates,'reason',btrim(p_note),'actor',auth.uid(),'at',now())))
 on conflict(worker_id,work_date) do update set extra_days=excluded.extra_days,extra_minutes=excluded.extra_minutes,daily_wage=excluded.daily_wage,hourly_rate=excluded.hourly_rate,currency_code=excluded.currency_code,full_day_amount=excluded.full_day_amount,hourly_amount=excluded.hourly_amount,total_amount=excluded.total_amount,note=excluded.note,active=true,version=excluded.version,rate_snapshot=excluded.rate_snapshot,updated_by=auth.uid(),updated_at=now(),history=excluded.history returning * into result;
 return to_jsonb(result);
end $$;

create function private.assert_manual_exception_payroll(l public.payroll_line) returns void language plpgsql security definer set search_path='' as $$
declare e public.worker_manual_overtime_exception;d jsonb;
begin
 for e in select * from public.worker_manual_overtime_exception where worker_id=l.worker_id and work_date between l.attendance_period_start and l.attendance_period_end and active loop
   select value into d from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]')) where value->>'date'=e.work_date::text;
   if d is null or d->>'source'<>'manual_exception' or d->'manual_exception' is distinct from private.manual_exception_snapshot(e) or(d->>'minutes')::integer<>e.extra_minutes or e.currency_code<>l.currency_code_snapshot then raise exception 'Manual exception changed; refresh payroll Draft';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(l.attendance_summary_snapshot->'payable_overtime_days','[]')) d where d ? 'manual_exception' and not exists(select 1 from public.worker_manual_overtime_exception e where e.worker_id=l.worker_id and e.work_date=(d->>'date')::date and e.active and private.manual_exception_snapshot(e)=d->'manual_exception')) then raise exception 'Manual exception removed; refresh payroll Draft';end if;
end $$;
-- Reuse existing premium/math guard; admit only the exact audited exception hours.
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('private.assert_extra_day_payroll(public.payroll_line)'::regprocedure);
 definition:=replace(definition,'day jsonb;','day jsonb;manual_minutes numeric:=0;manual_amount numeric:=0;');
 definition:=replace(definition,' sources:=private.extra_day_payroll_sources',
 ' perform private.assert_manual_exception_payroll(l);
 select coalesce(sum(extra_minutes),0),coalesce(sum(hourly_amount),0) into manual_minutes,manual_amount from public.worker_manual_overtime_exception where worker_id=l.worker_id and work_date between l.attendance_period_start and l.attendance_period_end and active;
 sources:=private.extra_day_payroll_sources');
 definition:=replace(definition,'jsonb_array_length(sources)<>coalesce((l.calculation_snapshot->>''extra_days'')::integer,0)','(select coalesce(sum((value->>''extra_days'')::numeric),0) from jsonb_array_elements(sources))<>coalesce((l.calculation_snapshot->>''extra_days'')::integer,0)');
 definition:=replace(definition,'(d->>''minutes'')::numeric>0','(d->>''minutes'')::numeric>0 and d->>''source''<>''manual_exception''');
 definition:=replace(definition,'(d->>''minutes'')::numeric=0','((d->>''minutes'')::numeric=0 or d->>''source''=''manual_exception'')');
 definition:=replace(definition,' if jsonb_array_length(sources)=0 then return; end if;',' if jsonb_array_length(sources)=0 and manual_minutes=0 then return; end if;');
 definition:=replace(definition,'(total_minutes>0 and nullif','(total_minutes>manual_minutes and nullif');
 definition:=replace(definition,'round(total_minutes/60*(l.compensation_snapshot->>''overtime_rate_per_hour'')::numeric,2)','round((total_minutes-manual_minutes)/60*coalesce((l.compensation_snapshot->>''overtime_rate_per_hour'')::numeric,0)+manual_amount,2)');
 execute definition;
 definition:=pg_get_functiondef('public.admin_decide_extra_day(jsonb)'::regprocedure);
 definition:=replace(definition,'if e->>''decision''=''approved'' then','if e->>''decision''=''approved'' then
 if exists(select 1 from public.worker_manual_overtime_exception where worker_id=old.worker_id and work_date=old.work_date and active and extra_days>0) then raise exception ''Overlap: manual exception already pays extra days'';end if;');execute definition;
 definition:=pg_get_functiondef('private.guard_extra_day_weekly_override()'::regprocedure);
 definition:=replace(definition,'if new.minutes>0 and (','if new.minutes>0 and (exists(select 1 from public.worker_manual_overtime_exception where worker_id=new.worker_id and work_date between new.week_start and new.week_start+5 and active) or ');execute definition;
end $patch$;
create function private.guard_manual_exception_daily_ot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.manual_override and new.emergency_overtime_mode='manual_overtime_duration' and new.emergency_overtime_minutes>0 and(tg_op='INSERT' or new.emergency_overtime_minutes is distinct from old.emergency_overtime_minutes or new.emergency_overtime_mode is distinct from old.emergency_overtime_mode)
 and exists(select 1 from public.worker_manual_overtime_exception where worker_id=new.worker_id and work_date=new.attendance_date and active) then raise exception 'Overlap: clear manual overtime exception first';end if;return new;
end $$;
create trigger attendance_manual_exception_overlap before insert or update on public.attendance for each row execute function private.guard_manual_exception_daily_ot();
revoke all on function private.manual_exception_rates(uuid,date),private.manual_exception_snapshot(public.worker_manual_overtime_exception),private.extra_day_sources_before_manual(uuid,date,date),private.extra_day_reviews_before_manual(date,date),private.extra_day_payroll_sources(uuid,date,date),private.payroll_extra_day_reviews(date,date),private.assert_manual_exception_payroll(public.payroll_line),private.guard_manual_exception_daily_ot() from public,anon,authenticated;
revoke all on function public.admin_get_manual_overtime_exceptions(date,uuid,uuid),public.admin_save_manual_overtime_exception(uuid,date,uuid,integer,integer,text,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.admin_get_manual_overtime_exceptions(date,uuid,uuid),public.admin_save_manual_overtime_exception(uuid,date,uuid,integer,integer,text,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
