create table public.worker_biometric_overtime_review (
  worker_id uuid not null references public.workers(id), attendance_date date not null,
  source_attendance_id uuid not null references public.attendance(id), source_updated_at timestamptz not null,
  source_fingerprint text not null, minutes integer not null check(minutes between 1 and 1440),
  decision text not null check(decision in ('approved','rejected')), actor uuid not null references auth.users(id),
  decided_at timestamptz not null default now(), version integer not null default 1 check(version>0),
  history jsonb not null default '[]' check(jsonb_typeof(history)='array'), primary key(attendance_date,worker_id)
);
alter table public.worker_biometric_overtime_review enable row level security;
revoke all on public.worker_biometric_overtime_review from public,anon,authenticated;
grant select on public.worker_biometric_overtime_review to authenticated;
create policy biometric_ot_admin_read on public.worker_biometric_overtime_review for select to authenticated
using ((select public.is_admin()) and exists(select 1 from public.admins where id=(select auth.uid()) and is_active));

create function private.biometric_ot_fingerprint(a public.attendance,w public.workers,team_name text,payment_type text,classification text)
returns text language sql stable set search_path=public,pg_temp as $$
 select md5(jsonb_build_object('attendance',jsonb_build_object('id',a.id,'date',a.attendance_date,'worker_id',a.worker_id,'status',a.status,'check_in',a.check_in,'check_out',a.check_out,'source',a.attendance_source,'checkout_event',a.biometric_sync_metadata->>'check_out_event_timestamp','review_checkout',to_jsonb(a)->>'review_approved_check_out_at'),'shift',w.attendance_shift,'team_id',w.team_id,'team',team_name,'payment_type',payment_type,'classification',classification)::text)
$$;
revoke all on function private.biometric_ot_fingerprint(public.attendance,public.workers,text,text,text) from public,anon,authenticated;

create function public.admin_get_biometric_overtime_review(p_start date,p_end date) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end>p_start+31 then raise exception 'Invalid review range'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'worker',jsonb_build_object('id',w.id,'full_name',w.full_name,'employee_code',w.employee_code,'team_id',w.team_id,'team_name',t.name,'payment_type',p.payment_type,'is_active',w.is_active,'staff_classification',coalesce(c.classification,'normal'),'operational_start_date',w.operational_start_date,'attendance_shift',w.attendance_shift),
  'attendance',to_jsonb(a),'review',to_jsonb(r),'source_fingerprint',private.biometric_ot_fingerprint(a,w,t.name,p.payment_type,coalesce(c.classification,'normal')),
  'locked',exists(select 1 from payroll_run pr where pr.payment_type='weekly' and a.attendance_date between pr.weekly_period_start and pr.weekly_period_end and pr.status in ('reviewed','finalized','paid'))
    or exists(select 1 from payroll_line pl join payroll_run pr on pr.id=pl.payroll_run_id where pl.worker_id=w.id and a.attendance_date between pl.attendance_period_start and pl.attendance_period_end and pr.status in ('finalized','paid'))
 ) order by a.attendance_date,w.full_name) from attendance a join workers w on w.id=a.worker_id join teams t on t.id=w.team_id
 join worker_payroll_profile p on p.worker_id=w.id left join worker_staff_classification c on c.worker_id=w.id
 left join worker_biometric_overtime_review r on r.worker_id=w.id and r.attendance_date=a.attendance_date
 where a.attendance_date between p_start and p_end and w.is_active and coalesce(c.classification,'normal')='normal'
  and p.payment_type in ('weekly','monthly') and t.name not in ('Adminstration','Chauffeur')
  and (w.operational_start_date is null or w.operational_start_date<=a.attendance_date)
  and a.attendance_source='biometric' and a.check_out is not null and a.status in ('present','late','half_day')
  and (not coalesce(a.manual_override,false) or a.emergency_overtime_mode='manual_overtime_duration')), '[]'::jsonb);
end $$;

create function public.admin_decide_biometric_overtime(p_date date,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare e jsonb; a public.attendance%rowtype; w public.workers%rowtype; old public.worker_biometric_overtime_review%rowtype;
 actor_id uuid:=auth.uid(); team_name text; payment_type text; classification text; fingerprint text; answer jsonb:='[]'; entry_minutes integer;
begin
 if actor_id is null or not public.is_admin() or not exists(select 1 from admins where id=actor_id and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or p_date>(now() at time zone 'Africa/Kinshasa')::date or jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch'; end if;
 if (select count(distinct value->>'worker_id') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Duplicate worker'; end if;
 lock table payroll_run in share mode;
 for e in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
  if e->>'decision' is null or e->>'decision' not in ('approved','rejected') or e->>'minutes' is null or (e->>'minutes')!~'^[0-9]+$' then raise exception 'Invalid decision'; end if;
  entry_minutes:=(e->>'minutes')::integer;
  if entry_minutes not between 1 and 1440 then raise exception 'Invalid reviewed minutes'; end if;
  perform pg_advisory_xact_lock(hashtextextended((e->>'worker_id')||':'||p_date::text||':biometric_ot',0));
  select * into w from workers where id=(e->>'worker_id')::uuid;
  select t.name into team_name from teams t where t.id=w.team_id;
  select p.payment_type into payment_type from worker_payroll_profile p where p.worker_id=w.id;
  select c.classification into classification from worker_staff_classification c where c.worker_id=w.id;
  if w.id is null or not w.is_active or team_name is null or team_name in ('Adminstration','Chauffeur') or payment_type is null or payment_type not in ('weekly','monthly') or coalesce(classification,'normal')<>'normal' or w.operational_start_date>p_date then raise exception 'Worker not eligible'; end if;
  if exists(select 1 from payroll_run pr where pr.payment_type='weekly' and p_date between pr.weekly_period_start and pr.weekly_period_end and pr.status in ('reviewed','finalized','paid'))
   or exists(select 1 from payroll_line pl join payroll_run pr on pr.id=pl.payroll_run_id where pl.worker_id=w.id and p_date between pl.attendance_period_start and pl.attendance_period_end and pr.status in ('finalized','paid')) then raise exception 'Payroll locked'; end if;
  select * into a from attendance where worker_id=w.id and attendance_date=p_date for update;
  if a.id is null or a.attendance_source is distinct from 'biometric' or a.check_out is null or a.status not in ('present','late','half_day') or (coalesce(a.manual_override,false) and a.emergency_overtime_mode is distinct from 'manual_overtime_duration') then raise exception 'Real biometric attendance required'; end if;
  fingerprint:=private.biometric_ot_fingerprint(a,w,team_name,payment_type,coalesce(classification,'normal'));
  if e->>'source_fingerprint' is distinct from fingerprint then raise exception 'Biometric evidence changed; reload and review again'; end if;
  select * into old from worker_biometric_overtime_review where worker_id=w.id and attendance_date=p_date for update;
  if e->>'expected_version' is null or (e->>'expected_version')::integer<>coalesce(old.version,0) then raise exception 'Review changed; reload'; end if;
  insert into worker_biometric_overtime_review(worker_id,attendance_date,source_attendance_id,source_updated_at,source_fingerprint,minutes,decision,actor,version,history)
   values(w.id,p_date,a.id,a.updated_at,fingerprint,entry_minutes,e->>'decision',actor_id,1,jsonb_build_array(jsonb_build_object('previous',null,'decision',e->>'decision','minutes',entry_minutes,'actor',actor_id,'at',now(),'source_fingerprint',fingerprint)))
   on conflict(attendance_date,worker_id) do update set source_attendance_id=a.id,source_updated_at=a.updated_at,source_fingerprint=fingerprint,minutes=entry_minutes,decision=e->>'decision',actor=actor_id,decided_at=now(),version=old.version+1,
    history=old.history||jsonb_build_array(jsonb_build_object('previous',to_jsonb(old)-'history','decision',e->>'decision','minutes',entry_minutes,'actor',actor_id,'at',now(),'source_fingerprint',fingerprint));
  answer:=answer||jsonb_build_array(jsonb_build_object('worker_id',w.id,'decision',e->>'decision','version',coalesce(old.version,0)+1));
 end loop;
 return answer;
end $$;
revoke all on function public.admin_get_biometric_overtime_review(date,date) from public,anon;
revoke all on function public.admin_decide_biometric_overtime(date,jsonb) from public,anon;
grant execute on function public.admin_get_biometric_overtime_review(date,date) to authenticated;
grant execute on function public.admin_decide_biometric_overtime(date,jsonb) to authenticated;
