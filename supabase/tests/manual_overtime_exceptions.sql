-- Run with an authenticated real source administrator; all test writes roll back.
begin;
do $$
declare w public.workers;e public.worker_manual_overtime_exception;rates jsonb;saved jsonb;l public.payroll_line;before_att text;after_att text;other record;
 target date:='2026-11-21';
begin
 perform private.extra_day_require_admin();
 select * into strict w from public.workers where id='1c899e95-bb2e-4177-8d9a-83665d0d5bb1'; -- real configured verification worker, JOHN #83
 if exists(select 1 from public.worker_manual_overtime_exception where worker_id=w.id and work_date=target) then raise exception 'Verification fixture already has an exception';end if;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text) into before_att from public.attendance a where worker_id=w.id;
 rates:=private.manual_exception_rates(w.id,target);
 saved:=public.admin_save_manual_overtime_exception(w.id,target,w.team_id,1,120,'Rollback-only feature verification',0,rates->>'fingerprint');
 if (saved->>'full_day_amount')::numeric<>20000 or(saved->>'hourly_amount')::numeric<>6000 or(saved->>'total_amount')::numeric<>26000 or saved->>'updated_by'<>auth.uid()::text then raise exception 'Amount/actor mismatch';end if;
 begin perform public.admin_save_manual_overtime_exception(w.id,target,w.team_id,1,120,'Duplicate stale save',0,rates->>'fingerprint');raise exception 'Stale save unexpectedly succeeded';exception when others then if sqlerrm not like 'Exception changed%' then raise;end if;end;
 select * into e from public.worker_manual_overtime_exception where id=(saved->>'id')::uuid;
 l.worker_id:=w.id;l.attendance_period_start:='2026-11-16';l.attendance_period_end:=target;l.currency_code_snapshot:='CDF';
 l.attendance_summary_snapshot:=jsonb_build_object('extra_day_premiums',private.extra_day_payroll_sources(w.id,l.attendance_period_start,target),
  'payable_overtime_days',jsonb_build_array(jsonb_build_object('date',target,'source','manual_exception','minutes',120,'manual_exception',private.manual_exception_snapshot(e))));
 l.calculation_snapshot:='{"extra_day_amount":20000,"extra_days":1,"evening_overtime_minutes":120}';
 l.compensation_snapshot:='{"overtime_rate_per_hour":3000}';l.base_amount:=0;l.transport_amount:=0;l.overtime_amount:=6000;l.holiday_amount:=0;l.bonus_amount:=20000;l.deduction_amount:=0;l.advance_amount:=0;l.manual_adjustment_amount:=0;l.final_amount:=26000;
 perform private.assert_extra_day_payroll(l);
 l.final_amount:=32000;
 begin perform private.assert_extra_day_payroll(l);raise exception 'Duplicate payment unexpectedly accepted';exception when others then if sqlerrm not like 'Extra-day payroll totals%' then raise;end if;end;
 l.final_amount:=26000;
 saved:=public.admin_save_manual_overtime_exception(w.id,target,w.team_id,2,150,'Edit verification',1,rates->>'fingerprint');
 if (saved->>'total_amount')::numeric<>47500 or(saved->>'version')::integer<>2 then raise exception 'Edit failed';end if;
 begin perform private.assert_extra_day_payroll(l);raise exception 'Stale Draft accepted';exception when others then if sqlerrm not like 'Manual exception changed%' then raise;end if;end;
 saved:=public.admin_save_manual_overtime_exception(w.id,target,w.team_id,2,150,'Clear verification',2,null,true);
 if (saved->>'active')::boolean or jsonb_array_length(saved->'history')<>3 then raise exception 'Clear/audit failed';end if;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]')::text) into after_att from public.attendance a where worker_id=w.id;
 if before_att is distinct from after_att then raise exception 'Attendance changed';end if;
 -- Existing approved Double OT full-day component cannot be duplicated.
 select wr.id,wr.team_id,d.work_date into other from public.extra_day_overtime_review d join public.workers wr on wr.id=d.worker_id
 where d.decision='approved' and not private.extra_day_locked(d.worker_id,d.work_date)
 and jsonb_array_length(private.extra_day_sources_before_manual(d.worker_id,d.work_date,d.work_date))>0 limit 1;
 if other.id is not null then
   begin perform public.admin_save_manual_overtime_exception(other.id,other.work_date,other.team_id,1,0,'Overlap verification',0,private.manual_exception_rates(other.id,other.work_date)->>'fingerprint');raise exception 'Double day overlap accepted';exception when others then if sqlerrm not like 'Overlap:%' then raise;end if;end;
 end if;
end $$;
rollback;
