-- Sunday-specific read-only evidence gate. No attendance/history rewrites.
create or replace function private.sunday_work_evidence(p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.attendance; morning timestamp; checkout timestamp; eligible boolean:=false; reason text;
begin
 if extract(isodow from p_date)<>7 then return jsonb_build_object('eligible',false,'reason','ineligible'); end if;
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date;
 if a.manual_override then
   eligible:=a.status='present' and coalesce(a.attendance_day_fraction,0)>0
     and coalesce(a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}','') not in('A','M');
   return jsonb_build_object('eligible',eligible,'reason',case when eligible then 'manual' else 'protected' end,'manual',true,'morning',a.check_in,'checkout',a.check_out);
 end if;
 -- Reuse exact device/string ownership resolver; never infer by name or strip zeros.
 -- Existing normal work-date window is 06:30 D through 02:00 D+1.
 select min(local_time) filter(where local_time>=p_date+time '07:00' and local_time<=p_date+time '09:00'),
        max(local_time) filter(where local_time>=p_date+time '14:00') into morning,checkout
 from (select e.event_timestamp at time zone 'Africa/Kinshasa' local_time
       from public.biometric_attendance_events e
       where e.worker_id=p_worker and e.attendance_date between p_date and p_date+1
         and e.event_timestamp>=(p_date+time '06:30') at time zone 'Africa/Kinshasa'
         and e.event_timestamp<=((p_date+1)+time '02:00') at time zone 'Africa/Kinshasa'
         and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=p_worker) valid;
 eligible:=morning is not null and checkout is not null;
 reason:=case when eligible then 'eligible' when morning is null and checkout is null then 'ineligible' when morning is null then 'missing_in' else 'missing_out' end;
 return jsonb_build_object('eligible',eligible,'reason',reason,'manual',false,'morning',to_char(morning,'HH24:MI:SS'),'checkout',to_char(checkout,'HH24:MI:SS'));
end $$;
revoke all on function private.sunday_work_evidence(uuid,date) from public,anon,authenticated,service_role;
-- Separate Sunday work management; existing history is not rewritten.
create or replace function public.admin_get_sunday_payroll(p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date then raise exception 'Select a non-future Sunday' using errcode='22023'; end if;
 return jsonb_build_object(
 'date',p_date,
 'workers',coalesce((select jsonb_agg(to_jsonb(w)||jsonb_build_object('team_name',t.name,'payment_type',p.payment_type,
   'payroll_compensation_terms',(select coalesce(jsonb_agg(to_jsonb(c) order by effective_from desc),'[]') from public.worker_payroll_compensation c where c.worker_id=w.id)))
   from public.workers w left join public.teams t on t.id=w.team_id left join public.worker_payroll_profile p on p.worker_id=w.id
   where exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date)
      or exists(select 1 from public.worker_sunday_payment s where s.worker_id=w.id and s.work_date=p_date)
      or exists(select 1 from public.biometric_attendance_events e where e.worker_id=w.id and e.attendance_date=p_date)),'[]'),
 'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance a where attendance_date=p_date),'[]'),
 'sunday_evidence',coalesce((select jsonb_agg(jsonb_build_object('worker_id',w.id)||private.sunday_work_evidence(w.id,p_date)) from public.workers w where exists(select 1 from public.attendance a where a.worker_id=w.id and a.attendance_date=p_date) or exists(select 1 from public.worker_sunday_payment s where s.worker_id=w.id and s.work_date=p_date) or exists(select 1 from public.biometric_attendance_events e where e.worker_id=w.id and e.attendance_date=p_date)),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('payroll_eligible',coalesce((private.sunday_work_evidence(s.worker_id,p_date)->>'eligible')::boolean,false))) from public.worker_sunday_payment s where work_date=p_date),'[]'),
 'rules',(select to_jsonb(r) from public.payroll_rule_set r where is_active and effective_from<=p_date order by effective_from desc limit 1));
end $$;
revoke all on function public.admin_get_sunday_payroll(date) from public,anon,authenticated;
grant execute on function public.admin_get_sunday_payroll(date) to authenticated;

create or replace function public.admin_confirm_sunday_payroll(p_worker uuid,p_date date,p_expected_updated_at timestamptz) returns public.worker_sunday_payment
language plpgsql security definer set search_path='' as $$
declare a public.attendance; s public.worker_sunday_payment;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date then raise exception 'Select a non-future Sunday'; end if;
 lock table public.payroll_run in share mode;
 if exists(select 1 from public.payroll_run r where r.payment_type='weekly' and r.weekly_period_start=p_date+1 and r.status in('reviewed','finalized','paid')) then raise exception 'Payroll week locked'; end if;
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date for update;
 if not coalesce((private.sunday_work_evidence(p_worker,p_date)->>'eligible')::boolean,false) then raise exception 'Sunday requires morning check-in and final checkout at or after 14:00, or protected manual presence'; end if;
 if a.updated_at is distinct from p_expected_updated_at then raise exception 'Sunday evidence changed; reload'; end if;
 -- The existing canonical writer owns dated weekly/monthly wages, x2,
 -- actor identity and worker/date idempotency. It does not write attendance.
 return public.confirm_worker_sunday_work(p_worker,p_date,'Sunday payroll evidence review',null);
end $$;
revoke all on function public.admin_confirm_sunday_payroll(uuid,date,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_confirm_sunday_payroll(uuid,date,timestamptz) to authenticated;


create or replace function private.guard_sunday_presence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not coalesce((private.sunday_work_evidence(new.worker_id,new.work_date)->>'eligible')::boolean,false) then
   raise exception 'Sunday presence requires morning check-in and final checkout at or after 14:00, or protected manual presence';
 end if;
 return new;
end $$;
revoke all on function private.guard_sunday_presence() from public,anon,authenticated,service_role;
create trigger sunday_payment_presence_on_insert before insert on public.worker_sunday_payment for each row execute function private.guard_sunday_presence();
create trigger sunday_payment_presence_on_settlement before update on public.worker_sunday_payment for each row
 when ((new.payment_status='unpaid' and old.payment_status='cancelled') or (new.settled_payroll_line_id is not null and new.settled_payroll_line_id is distinct from old.settled_payroll_line_id)) execute function private.guard_sunday_presence();
notify pgrst,'reload schema';
