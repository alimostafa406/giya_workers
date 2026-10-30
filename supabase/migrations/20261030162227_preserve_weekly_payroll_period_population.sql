-- Read-only, admin-only historical population evidence. Current worker status
-- must not remove recorded weekly work or change immutable historical identity.
create function public.admin_get_weekly_payroll_population(p_start date,p_end date)
returns jsonb language plpgsql stable security definer
set search_path=public,private,auth,pg_temp as $$
begin
  if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then
    raise exception 'Active admin required' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end>p_start+31 then
    raise exception 'Invalid payroll population range' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('worker_id',worker_id,'date',date,'identity',identity) order by worker_id)
    from (select distinct on(worker_id) worker_id,date,identity from (
      select (w->>'id')::uuid as worker_id,s.attendance_date as date,
        w-'id'-'biometric_id' as identity,1 as priority
      from private.supervisor_review_daily_snapshot s cross join lateral jsonb_array_elements(s.workers) w
      where s.attendance_date between p_start and p_end
      union all
      select l.worker_id,greatest(l.attendance_period_start,p_start),
        l.attendance_summary_snapshot->'worker_identity_snapshot',2 as priority
      from public.payroll_line l join public.payroll_run r on r.id=l.payroll_run_id
      where r.payment_type='weekly' and l.attendance_period_start<=p_end and l.attendance_period_end>=p_start
    ) evidence order by worker_id,priority desc,date desc) population),'[]'::jsonb);
end $$;
revoke all on function public.admin_get_weekly_payroll_population(date,date) from public,anon;
grant execute on function public.admin_get_weekly_payroll_population(date,date) to authenticated;

-- This is an evidence READ, not a permission to enter new OT for inactive staff.
-- Approval/write protections remain unchanged; existing decisions stay available
-- to the canonical payroll engine after current-roster deactivation.
CREATE OR REPLACE FUNCTION public.admin_get_biometric_overtime_review(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
 where a.attendance_date between p_start and p_end and (w.is_active or a.attendance_date <= (now() at time zone 'Africa/Kinshasa')::date)
  and coalesce(c.classification,'normal')='normal'
  and p.payment_type in ('weekly','monthly') and t.name not in ('Adminstration','Chauffeur')
  and (w.operational_start_date is null or w.operational_start_date<=a.attendance_date)
  and a.attendance_source='biometric' and a.check_out is not null and a.status in ('present','late','half_day')
  and (not coalesce(a.manual_override,false) or a.emergency_overtime_mode='manual_overtime_duration')), '[]'::jsonb);
end $function$;
notify pgrst,'reload schema';
