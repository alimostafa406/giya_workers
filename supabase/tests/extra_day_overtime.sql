-- Real evidence, rollback-only rules/decisions; no attendance/event updates.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare target record; config jsonb; rule jsonb; row jsonb; rows jsonb; entry jsonb; snapshot jsonb;
 d date; today date:=(now() at time zone 'Africa/Kinshasa')::date; before_att text; before_pay text; count_before integer; source jsonb;
 bulk jsonb:='[]'; lock_id uuid; monday date; state text; line public.payroll_line; amount numeric;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into before_att from public.attendance a where attendance_date between today-7 and today;
 select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into before_pay from public.payroll_line l;
 for target in
   select distinct on(p.payment_type) w.id,w.team_id,p.payment_type,a.attendance_date
   from public.workers w join public.worker_payroll_profile p on p.worker_id=w.id join public.attendance a on a.worker_id=w.id
   where a.attendance_date between today-5 and today-1 and a.status='present' and p.payment_type in ('weekly','monthly')
   and not private.extra_day_locked(w.id,a.attendance_date)
   and not exists(select 1 from public.worker_staff_classification where worker_id=w.id and classification<>'normal')
   and not exists(select 1 from public.worker_weekly_overtime_override where worker_id=w.id and minutes>0 and a.attendance_date between week_start and week_start+5)
   and (select count(distinct event_timestamp) from public.biometric_attendance_events e where e.worker_id=w.id
     and (e.event_timestamp at time zone 'Africa/Kinshasa')::date=a.attendance_date and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=w.id)>=2
   and exists(select 1 from public.worker_payroll_compensation c where c.worker_id=w.id and c.payment_type=p.payment_type and c.effective_from<=a.attendance_date
     and (c.effective_to is null or c.effective_to>=a.attendance_date) and coalesce(c.daily_rate,c.monthly_salary)>0)
   order by p.payment_type,a.attendance_date desc,w.id
 loop
   d:=target.attendance_date;
   config:=jsonb_build_object('name','Rollback-only generic extra day','team_ids',case when target.payment_type='weekly' then jsonb_build_array(target.team_id) else '[]'::jsonb end,
     'worker_ids',case when target.payment_type='monthly' then jsonb_build_array(target.id) else '[]'::jsonb end,
     'enabled',true,'start_date',d,'end_date',today+3,'start_time','00:00','window_end','23:59:59','minimum_minutes',1);
   rule:=public.admin_save_extra_day_rule(config);
   rows:=public.admin_get_extra_day_reviews(d,d);
   select value into strict row from jsonb_array_elements(rows) where value->>'rule_id'=rule->>'id' and value->>'worker_id'=target.id::text;
   assert not exists(select 1 from public.extra_day_overtime_review r join public.workers w on w.id=r.worker_id where r.rule_id=(rule->>'id')::uuid
     and ((target.payment_type='weekly' and w.team_id<>target.team_id) or (target.payment_type='monthly' and w.id<>target.id))),'Unrelated worker targeted';
   assert row->>'status'='pending' and row->'source'->>'qualified'='true','Candidate missing';
   assert private.extra_day_payroll_sources(target.id,d,d)='[]'::jsonb,'Pending premium payable';
   source:=private.extra_day_source(rule-'history',target.id,d-1);
   assert source->>'qualified'='false','Outside-range candidate qualified';
   entry:=jsonb_build_object('rule_id',rule->>'id','worker_id',target.id,'work_date',d,'expected_version',0,'source_fingerprint',row->'source'->>'fingerprint','decision','approved');
   perform public.admin_decide_extra_day(jsonb_build_array(entry));
   snapshot:=private.extra_day_payroll_sources(target.id,d,d);
   assert jsonb_array_length(snapshot)=1 and (snapshot->0->>'amount')::numeric=(row->'source'->>'daily_wage')::numeric and snapshot->0->>'extra_days'='1','Full daily wage not payable';
   amount:=(snapshot->0->>'amount')::numeric;
   line.worker_id:=target.id;line.attendance_period_start:=d-(extract(isodow from d)::integer-1);line.attendance_period_end:=line.attendance_period_start+5;
   line.currency_code_snapshot:=row->'source'->>'currency';
   line.base_amount:=0;line.transport_amount:=0;line.holiday_amount:=0;line.overtime_amount:=0;line.bonus_amount:=amount;
   line.deduction_amount:=0;line.advance_amount:=0;line.manual_adjustment_amount:=0;line.final_amount:=amount;
   line.compensation_snapshot:='{"overtime_rate_per_hour":600}';
   line.calculation_snapshot:=jsonb_build_object('extra_day_amount',amount,'extra_days',1,'evening_overtime_minutes',0);
   line.attendance_summary_snapshot:=jsonb_build_object('extra_day_premiums',snapshot,'payable_overtime_days',jsonb_build_array(jsonb_build_object('date',d,'minutes',0)));
   perform private.assert_extra_day_payroll(line);
   line.attendance_summary_snapshot:=jsonb_set(line.attendance_summary_snapshot,'{payable_overtime_days,0,minutes}','60');
   begin perform private.assert_extra_day_payroll(line);raise exception 'Overlapping hourly OT accepted';
   exception when raise_exception then if sqlerrm<>'Hourly OT overlaps approved extra day' then raise; end if; end;
   line.attendance_summary_snapshot:=jsonb_set(line.attendance_summary_snapshot,'{payable_overtime_days,0,minutes}','0');
   line.overtime_amount:=600;line.final_amount:=amount+600;
   begin perform private.assert_extra_day_payroll(line);raise exception 'Duplicated hourly amount accepted';
   exception when raise_exception then if sqlerrm<>'Extra-day payroll totals do not reconcile' then raise; end if; end;
   assert exists(select 1 from public.extra_day_overtime_review where rule_id=(rule->>'id')::uuid and worker_id=target.id and actor=auth.uid() and history->-1->>'actor'=auth.uid()::text),'Admin audit missing';
   entry:=entry||jsonb_build_object('expected_version',1,'source_fingerprint','changed');
   begin perform public.admin_decide_extra_day(jsonb_build_array(entry)); raise exception 'Stale evidence accepted';
   exception when raise_exception then if sqlerrm<>'Evidence/wage changed; reload' then raise; end if; end;
   -- Disable/expire the live rule: the frozen historical decision remains.
   rule:=public.admin_save_extra_day_rule(config||jsonb_build_object('enabled',true,'end_date',d), (rule->>'id')::uuid,1);
   assert private.extra_day_payroll_sources(target.id,d,d)=snapshot,'Expiry removed historical approval';
   select count(*) into count_before from public.extra_day_overtime_review where rule_id=(rule->>'id')::uuid;
   perform public.admin_get_extra_day_reviews(d,today);
   assert count_before=(select count(*) from public.extra_day_overtime_review where rule_id=(rule->>'id')::uuid),'Expired rule generated new candidates';
   rule:=public.admin_save_extra_day_rule(config||jsonb_build_object('enabled',false,'end_date',d),(rule->>'id')::uuid,2);
   entry:=entry||jsonb_build_object('source_fingerprint',row->'source'->>'fingerprint','decision','rejected');
   perform public.admin_decide_extra_day(jsonb_build_array(entry));
   assert private.extra_day_payroll_sources(target.id,d,d)='[]'::jsonb,'Rejected premium payable';
   bulk:=bulk||jsonb_build_array(entry||jsonb_build_object('decision','approved','expected_version',2));
 end loop;
 assert (select count(*) from public.extra_day_overtime_rule where name='Rollback-only generic extra day')>=2,'Need real weekly and monthly test workers';
 select jsonb_agg(value order by value->>'worker_id') into bulk from jsonb_array_elements(bulk);
 begin perform public.admin_decide_extra_day(jsonb_set(bulk,'{1,source_fingerprint}','"bad"'));raise exception 'Stale bulk accepted';
 exception when raise_exception then if sqlerrm<>'Evidence/wage changed; reload' then raise; end if; end;
 assert not exists(select 1 from public.extra_day_overtime_review r join jsonb_array_elements(bulk) e on r.rule_id=(e->>'rule_id')::uuid and r.worker_id=(e->>'worker_id')::uuid and r.work_date=(e->>'work_date')::date where r.version<>2),'Partial bulk write';
 assert jsonb_array_length(public.admin_decide_extra_day(bulk))=2,'Bulk approval failed';
 entry:=bulk->0; d:=(entry->>'work_date')::date; monday:=d-(extract(isodow from d)::integer-1);
 insert into public.payroll_run(payment_type,weekly_period_start,weekly_period_end,scheduled_payment_date,currency_code,rule_set_id,status,created_by)
 values('weekly',monday,monday+5,monday+5,'XTS',(select id from public.payroll_rule_set where is_active limit 1),'reviewed',auth.uid()) returning id into lock_id;
 foreach state in array array['reviewed','finalized','paid'] loop
   if state<>'reviewed' then update public.payroll_run set status=state where id=lock_id; end if;
   begin perform public.admin_decide_extra_day(jsonb_build_array(entry||jsonb_build_object('decision','rejected','expected_version',3))); raise exception 'Payroll lock bypassed';
   exception when raise_exception then if sqlerrm<>'Payroll locked' then raise; end if; end;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.admin_save_extra_day_rule(config); raise exception 'Non-admin allowed'; exception when insufficient_privilege then null; end;
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.attendance a where attendance_date between today-7 and today),'Attendance mutated';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) from public.payroll_line l),'Payroll history mutated';
end $$;
rollback;
select 'PASS: team/worker targeting, real exact-identity evidence, weekly/monthly full-day premium, pending/reject=0, stale, expiry/history, audit, admin-only, no attendance/payroll mutation' verification;
