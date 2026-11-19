-- Separate Sunday work management; existing history is not rewritten.
create function public.admin_get_sunday_payroll(p_date date) returns jsonb
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
      or exists(select 1 from public.worker_sunday_payment s where s.worker_id=w.id and s.work_date=p_date)),'[]'),
 'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance a where attendance_date=p_date),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('payroll_eligible',not exists(
    select 1 from public.attendance a where a.worker_id=s.worker_id and a.attendance_date=p_date
    and (a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}' in ('A','M')
      or (a.manual_override and a.status='absent')))))
    from public.worker_sunday_payment s where work_date=p_date),'[]'),
 'rules',(select to_jsonb(r) from public.payroll_rule_set r where is_active and effective_from<=p_date order by effective_from desc limit 1));
end $$;
revoke all on function public.admin_get_sunday_payroll(date) from public,anon,authenticated;
grant execute on function public.admin_get_sunday_payroll(date) to authenticated;

create function public.admin_confirm_sunday_payroll(p_worker uuid,p_date date,p_expected_updated_at timestamptz) returns public.worker_sunday_payment
language plpgsql security definer set search_path='' as $$
declare a public.attendance; s public.worker_sunday_payment;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501'; end if;
 if p_date is null or extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date then raise exception 'Select a non-future Sunday'; end if;
 lock table public.payroll_run in share mode;
 if exists(select 1 from public.payroll_run r where r.payment_type='weekly' and r.weekly_period_start=p_date+1 and r.status in('reviewed','finalized','paid')) then raise exception 'Payroll week locked'; end if;
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date for update;
 if a.id is null or a.status<>'present' or coalesce(a.attendance_day_fraction,0)<=0
   or a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}' in ('A','M') then raise exception 'Canonical Sunday presence required'; end if;
 if a.updated_at is distinct from p_expected_updated_at or p_expected_updated_at is null then raise exception 'Sunday evidence changed; reload'; end if;
 -- The existing canonical writer owns dated weekly/monthly wages, x2,
 -- actor identity and worker/date idempotency. It does not write attendance.
 return public.confirm_worker_sunday_work(p_worker,p_date,'Sunday payroll evidence review',null);
end $$;
revoke all on function public.admin_confirm_sunday_payroll(uuid,date,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_confirm_sunday_payroll(uuid,date,timestamptz) to authenticated;

create function private.sync_weekly_sunday_settlement() returns trigger language plpgsql security definer set search_path='' as $$
declare l public.payroll_line; r public.payroll_run; ids uuid[]; p public.worker_sunday_payment; total numeric:=0;
begin
 if tg_op='DELETE' then l:=old; else l:=new; end if;
 if coalesce(l.attendance_summary_snapshot->>'sunday_snapshot_version','')<>'1'
   and (tg_op<>'UPDATE' or coalesce(old.attendance_summary_snapshot->>'sunday_snapshot_version','')<>'1') then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;
 select * into r from public.payroll_run where id=l.payroll_run_id for update;
 if r.payment_type<>'weekly' or r.status<>'draft' then raise exception 'Sunday settlement requires Draft weekly payroll'; end if;
 if tg_op='DELETE' then ids:='{}'; else
   select coalesce(array_agg((v->>'id')::uuid),'{}'::uuid[]) into ids
   from jsonb_array_elements(coalesce(new.attendance_summary_snapshot->'sunday_payments','[]'))v;
 end if;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception 'Duplicate Sunday payment'; end if;
 -- Lock the canonical entitlement, so concurrent Drafts / separate payments
 -- cannot spend the same Sunday twice. Removed Draft items are released.
 for p in select * from public.worker_sunday_payment where id=any(ids) or settled_payroll_line_id=l.id order by id for update loop
   if p.id=any(ids) then
     if p.worker_id<>l.worker_id or p.work_date<>r.weekly_period_start-1 or p.currency_code<>l.currency_code_snapshot
       or p.payment_status<>'unpaid' or (p.settled_payroll_line_id is not null and p.settled_payroll_line_id<>l.id) then raise exception 'Sunday payment unavailable for this payroll'; end if;
     if exists(select 1 from public.attendance a where a.worker_id=p.worker_id and a.attendance_date=p.work_date
       and ((a.manual_override and a.status='absent') or a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}' in('A','M'))) then raise exception 'Protected Sunday absence conflicts with payment'; end if;
     total:=total+p.amount;
     update public.worker_sunday_payment set settlement_method='payroll',settled_payroll_run_id=r.id,settled_payroll_line_id=l.id where id=p.id;
   else
     if p.payment_status='paid' then raise exception 'Paid Sunday cannot be removed'; end if;
     update public.worker_sunday_payment set settlement_method=null,settled_payroll_run_id=null,settled_payroll_line_id=null where id=p.id;
   end if;
 end loop;
 if tg_op<>'DELETE' and (cardinality(ids)<>(select count(*) from public.worker_sunday_payment where id=any(ids))
   or total<>coalesce((new.calculation_snapshot->>'sunday_carry_amount')::numeric,0)
   or round(new.base_amount+new.transport_amount+new.overtime_amount+new.holiday_amount+new.bonus_amount-new.deduction_amount-new.advance_amount+new.manual_adjustment_amount,2)<>new.final_amount)
   then raise exception 'Sunday payroll snapshot amount mismatch'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.sync_weekly_sunday_settlement() from public,anon,authenticated;
create trigger payroll_line_sunday_settlement after insert or update on public.payroll_line for each row execute function private.sync_weekly_sunday_settlement();
create trigger payroll_line_release_sundays before delete on public.payroll_line for each row execute function private.sync_weekly_sunday_settlement();

create function private.pay_weekly_sundays() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.payment_type='weekly' and new.status='paid' and old.status is distinct from 'paid' then
   update public.worker_sunday_payment s set payment_status='paid',paid_at=coalesce(new.paid_at,now()),paid_by=new.paid_by,updated_at=now()
   where s.settled_payroll_run_id=new.id and s.payment_status='unpaid' and exists(select 1 from public.payroll_line l
    where l.id=s.settled_payroll_line_id and l.attendance_summary_snapshot->>'sunday_snapshot_version'='1');
 end if;
 return new;
end $$;
revoke all on function private.pay_weekly_sundays() from public,anon,authenticated;
create trigger payroll_run_pay_sundays after update of status on public.payroll_run for each row execute function private.pay_weekly_sundays();
notify pgrst,'reload schema';
