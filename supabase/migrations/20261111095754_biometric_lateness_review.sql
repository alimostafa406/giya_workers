-- Separate financial reviews: never update attendance or biometric evidence.
create table public.worker_biometric_lateness_review (
  worker_id uuid not null references public.workers(id),
  attendance_date date not null,
  source_attendance_id uuid not null references public.attendance(id),
  source_fingerprint text not null,
  scheduled_start timestamp not null,
  raw_check_in timestamp not null,
  raw_minutes integer not null check (raw_minutes > 0),
  approved_minutes integer not null check (approved_minutes between 0 and 1440),
  deduction_amount numeric(14,2) not null check (deduction_amount >= 0),
  currency_code text not null default 'CDF' check (currency_code = 'CDF'),
  decision text not null check (decision in ('approved','rejected')),
  actor uuid not null references public.admins(id),
  decided_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  history jsonb not null default '[]',
  primary key (attendance_date,worker_id)
);
alter table public.worker_biometric_lateness_review enable row level security;
revoke all on public.worker_biometric_lateness_review from anon,authenticated;
grant select on public.worker_biometric_lateness_review to authenticated;
create policy lateness_admin_read on public.worker_biometric_lateness_review for select to authenticated
  using ((select public.is_admin()));

-- Mirrors attendance_business_rules.workday_schedule: day start 08:00 on
-- Mon-Sat (Maison changes checkout only); Sunday has no scheduled day shift.
-- Explicit night workers use attendance_shift.NIGHT_START = 17:00, including
-- their real next-calendar-day check-in. Day Chauffeurs have a calendar window,
-- not a canonical required arrival time: do not invent one for deductions.
create function private.biometric_lateness_evidence(a public.attendance,w public.workers,team_name text)
returns jsonb language plpgsql stable set search_path='' as $$
declare scheduled timestamp; actual timestamp; minutes integer;
begin
 if a.check_in is null or a.attendance_source is distinct from 'biometric'
   or a.status not in ('present','late','half_day')
   or (coalesce(a.manual_override,false) and a.emergency_overtime_mode is distinct from 'manual_overtime_duration') then return null; end if;
 if w.attendance_shift='night' then scheduled:=a.attendance_date+time '17:00';
 elsif team_name='Chauffeur' or extract(isodow from a.attendance_date)=7 then return null;
 else scheduled:=a.attendance_date+time '08:00'; end if;
 actual:=a.attendance_date+a.check_in;
 if w.attendance_shift='night' and a.check_in<=time '06:30' then actual:=actual+interval '1 day'; end if;
 -- A real timestamp, when supplied by the canonical agent, is authoritative.
 if nullif(a.biometric_sync_metadata->>'check_in_event_timestamp','') is not null then
   actual:=(a.biometric_sync_metadata->>'check_in_event_timestamp')::timestamptz at time zone 'Africa/Kinshasa';
   if actual::time<>a.check_in then return null; end if;
 end if;
 if (w.attendance_shift='night' and (actual<scheduled or actual>a.attendance_date+1+time '06:30'))
   or (w.attendance_shift<>'night' and actual::date<>a.attendance_date) then return null; end if;
 minutes:=greatest(0,floor(extract(epoch from actual-scheduled)/60)::integer);
 return jsonb_build_object('scheduled_start',scheduled,'raw_check_in',actual,'raw_minutes',minutes,
   'source_fingerprint',md5(jsonb_build_array(a.id,a.worker_id,a.attendance_date,a.check_in,
     actual,scheduled,a.attendance_source,a.status,a.manual_override,a.emergency_overtime_mode,w.attendance_shift)::text));
end $$;

create function private.lateness_payroll_sources(p_worker uuid,p_start date,p_end date,p_currency text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('date',r.attendance_date,'version',r.version,
   'source_fingerprint',r.source_fingerprint,'approved_minutes',r.approved_minutes,
   'deduction_amount',r.deduction_amount,'actor',r.actor,'decided_at',r.decided_at) order by r.attendance_date),'[]')
 from public.worker_biometric_lateness_review r join public.attendance a on a.id=r.source_attendance_id
 join public.workers w on w.id=r.worker_id left join public.teams t on t.id=w.team_id
 where r.worker_id=p_worker and r.attendance_date between p_start and p_end and r.decision='approved'
 and p_currency=r.currency_code
 and r.source_fingerprint=private.biometric_lateness_evidence(a,w,t.name)->>'source_fingerprint';
$$;

create function public.admin_get_biometric_lateness_review(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end>p_start+31 then raise exception 'Invalid review range'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
   'worker',jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,'team_id',w.team_id,'team_name',t.name,'payment_type',p.payment_type),
   'attendance',jsonb_build_object('id',a.id,'worker_id',w.id,'attendance_date',a.attendance_date,'check_in',a.check_in),
   'evidence',e.value,'review',to_jsonb(r),
   'payroll_source',private.lateness_payroll_sources(w.id,a.attendance_date,a.attendance_date,c.currency_code)->0,
   'locked',exists(select 1 from public.payroll_run pr where pr.payment_type='weekly'
     and a.attendance_date between pr.weekly_period_start and pr.weekly_period_end and pr.status in ('reviewed','finalized','paid'))
     or exists(select 1 from public.payroll_line pl join public.payroll_run pr on pr.id=pl.payroll_run_id
       where pl.worker_id=w.id and a.attendance_date between pl.attendance_period_start and pl.attendance_period_end and pr.status in ('reviewed','finalized','paid'))
 ) order by a.attendance_date,w.full_name)
 from public.attendance a join public.workers w on w.id=a.worker_id
 join public.teams t on t.id=w.team_id join public.worker_payroll_profile p on p.worker_id=w.id
 left join lateral (select currency_code from public.worker_payroll_compensation c
   where c.worker_id=w.id and c.effective_from<=a.attendance_date and (c.effective_to is null or c.effective_to>=a.attendance_date)
   order by c.effective_from desc,c.created_at desc limit 1) c on true
 left join public.worker_staff_classification sc on sc.worker_id=w.id
 left join public.worker_biometric_lateness_review r on r.worker_id=w.id and r.attendance_date=a.attendance_date
 cross join lateral (select private.biometric_lateness_evidence(a,w,t.name) value) e
 where a.attendance_date between p_start and p_end and a.attendance_date<=(now() at time zone 'Africa/Kinshasa')::date
 and coalesce(sc.classification,'normal')='normal' and t.name<>'Adminstration'
 and p.payment_type in ('weekly','monthly') and (w.operational_start_date is null or w.operational_start_date<=a.attendance_date)
 and ((e.value->>'raw_minutes')::integer>0 or r.worker_id is not null)),'[]');
end $$;

create function public.admin_decide_biometric_lateness(p_date date,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; a public.attendance; w public.workers; old public.worker_biometric_lateness_review;
 evidence jsonb; team_name text; approved integer; amount numeric; answer jsonb:='[]'; saved public.worker_biometric_lateness_review;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or jsonb_typeof(p_entries) is distinct from 'array'
   or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch'; end if;
 if (select count(distinct value->>'worker_id') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Duplicate worker'; end if;
 lock table public.payroll_run in share mode;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
   if entry->>'decision' is null or entry->>'decision' not in ('approved','rejected')
     or coalesce(entry->>'approved_minutes','')!~'^[0-9]{1,4}$'
     or coalesce(entry->>'deduction_amount','')!~'^[0-9]{1,12}(\.[0-9]{1,2})?$'
     or length(coalesce(entry->>'note',''))>1000 then raise exception 'Invalid review values'; end if;
   approved:=(entry->>'approved_minutes')::integer; amount:=(entry->>'deduction_amount')::numeric;
   if approved>1440 then raise exception 'Invalid approved minutes'; end if;
   perform pg_advisory_xact_lock(hashtextextended((entry->>'worker_id')||':'||p_date::text||':lateness',0));
   select * into w from public.workers where id=(entry->>'worker_id')::uuid;
   select name into team_name from public.teams where id=w.team_id;
   if w.id is null or team_name is null or team_name='Adminstration' or w.operational_start_date>p_date
     or not exists(select 1 from public.worker_payroll_profile where worker_id=w.id and payment_type in ('weekly','monthly'))
     or exists(select 1 from public.worker_staff_classification where worker_id=w.id and classification<>'normal') then raise exception 'Worker not eligible'; end if;
   if amount>0 and (select currency_code from public.worker_payroll_compensation where worker_id=w.id
     and effective_from<=p_date and (effective_to is null or effective_to>=p_date) order by effective_from desc,created_at desc limit 1) is distinct from 'CDF'
     then raise exception 'CDF compensation required for a CDF deduction'; end if;
   if exists(select 1 from public.payroll_run pr where pr.payment_type='weekly' and p_date between pr.weekly_period_start and pr.weekly_period_end and pr.status in ('reviewed','finalized','paid'))
     or exists(select 1 from public.payroll_line pl join public.payroll_run pr on pr.id=pl.payroll_run_id where pl.worker_id=w.id and p_date between pl.attendance_period_start and pl.attendance_period_end and pr.status in ('reviewed','finalized','paid')) then raise exception 'Payroll locked'; end if;
   select * into a from public.attendance where worker_id=w.id and attendance_date=p_date for update;
   evidence:=private.biometric_lateness_evidence(a,w,team_name);
   if coalesce((evidence->>'raw_minutes')::integer,0)<=0 or entry->>'source_fingerprint' is distinct from evidence->>'source_fingerprint' then raise exception 'Biometric evidence changed; reload and review again'; end if;
   select * into old from public.worker_biometric_lateness_review where worker_id=w.id and attendance_date=p_date for update;
   if coalesce(entry->>'expected_version','')!~'^[0-9]+$' or (entry->>'expected_version')::integer<>coalesce(old.version,0) then raise exception 'Review changed; reload'; end if;
   insert into public.worker_biometric_lateness_review(worker_id,attendance_date,source_attendance_id,source_fingerprint,scheduled_start,raw_check_in,raw_minutes,approved_minutes,deduction_amount,decision,actor,version,history)
   values(w.id,p_date,a.id,evidence->>'source_fingerprint',(evidence->>'scheduled_start')::timestamp,(evidence->>'raw_check_in')::timestamp,(evidence->>'raw_minutes')::integer,approved,amount,entry->>'decision',auth.uid(),coalesce(old.version,0)+1,
     coalesce(old.history,'[]')||jsonb_build_array(jsonb_build_object('previous',case when old.worker_id is not null then to_jsonb(old)-'history' end,'evidence',evidence,'approved_minutes',approved,'deduction_amount',amount,'decision',entry->>'decision','actor',auth.uid(),'at',now(),'note',coalesce(entry->>'note',''),'mode','manual','source','workers_react_deploy')))
   on conflict(attendance_date,worker_id) do update set source_attendance_id=excluded.source_attendance_id,source_fingerprint=excluded.source_fingerprint,
     scheduled_start=excluded.scheduled_start,raw_check_in=excluded.raw_check_in,raw_minutes=excluded.raw_minutes,approved_minutes=excluded.approved_minutes,
     deduction_amount=excluded.deduction_amount,decision=excluded.decision,actor=excluded.actor,decided_at=now(),version=excluded.version,history=excluded.history
   returning * into saved;
   answer:=answer||jsonb_build_array(to_jsonb(saved));
 end loop;
 return answer;
end $$;

-- New Drafts must retain exactly the currently payable review versions. The
-- same check runs under the payroll-run lock on Draft -> Reviewed. Already
-- reviewed/finalized/paid snapshots are deliberately never recalculated.
create function private.assert_lateness_payroll_line(line public.payroll_line) returns void
language plpgsql security definer set search_path='' as $$
declare sources jsonb; amount numeric;
begin
 perform 1 from public.attendance a where a.worker_id=line.worker_id
   and a.attendance_date between line.attendance_period_start and line.attendance_period_end for update;
 sources:=private.lateness_payroll_sources(line.worker_id,line.attendance_period_start,line.attendance_period_end,line.currency_code_snapshot);
 select coalesce(sum((v->>'deduction_amount')::numeric),0) into amount from jsonb_array_elements(sources) v;
 if sources is distinct from coalesce(line.attendance_summary_snapshot->'lateness_deductions','[]')
   or amount<>coalesce((line.calculation_snapshot->>'late_deduction')::numeric,0)
   or line.deduction_amount<amount
   or (line.calculation_snapshot ? 'late_before_amount' and line.final_amount<>round((line.calculation_snapshot->>'late_before_amount')::numeric-amount,2)) then
   raise exception 'Lateness review changed; refresh weekly payroll Draft';
 end if;
end $$;
create function private.guard_lateness_payroll() returns trigger language plpgsql security definer set search_path='' as $$
declare line public.payroll_line; run public.payroll_run;
begin
 if tg_table_name='payroll_line' then
   select * into run from public.payroll_run where id=new.payroll_run_id for update;
   if run.payment_type='weekly' and run.status='draft' then perform private.assert_lateness_payroll_line(new); end if;
 elsif new.payment_type='weekly' and new.status='reviewed' and old.status='draft' then
   for line in select * from public.payroll_line where payroll_run_id=new.id loop
     perform private.assert_lateness_payroll_line(line);
   end loop;
 end if;
 return new;
end $$;
create trigger payroll_line_lateness_guard before insert or update on public.payroll_line for each row execute function private.guard_lateness_payroll();
create trigger payroll_run_lateness_guard before update of status on public.payroll_run for each row execute function private.guard_lateness_payroll();
revoke all on function private.biometric_lateness_evidence(public.attendance,public.workers,text),
 private.lateness_payroll_sources(uuid,date,date,text),private.assert_lateness_payroll_line(public.payroll_line),private.guard_lateness_payroll() from public,anon,authenticated;
revoke all on function public.admin_get_biometric_lateness_review(date,date),public.admin_decide_biometric_lateness(date,jsonb) from public,anon;
grant execute on function public.admin_get_biometric_lateness_review(date,date),public.admin_decide_biometric_lateness(date,jsonb) to authenticated;
notify pgrst,'reload schema';
