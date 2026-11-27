-- Validate dates without committing snapshots, payroll or attendance.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare report jsonb;
begin
 assert (now() at time zone 'Africa/Kinshasa')::date=date '2026-11-27','Run this fixed-date regression with operational date 2026-11-27';
 assert date '2026-11-22'<=(now() at time zone 'Africa/Kinshasa')::date;
 perform private.final_supervisor_review_before_completion_gate('2026-11-23',false);
 perform private.final_supervisor_review_before_completion_gate('2026-11-27',false);
 begin
  perform private.final_supervisor_review_before_completion_gate('2026-11-28',false);
  raise exception 'Future date accepted';
 exception when invalid_parameter_value then assert sqlerrm='Future work dates are not allowed (Africa/Kinshasa)'; end;
 begin
  perform public.admin_get_final_supervisor_review('2026-11-22',false);
  raise exception 'Sunday incorrectly accepted in Mon-Sat supervisor review';
 exception when invalid_parameter_value then
  assert sqlerrm='Supervisor review is Monday-Saturday; use the Sunday payroll workflow for Sunday dates';
 end;
 -- Sunday remains accepted by its existing canonical workflow. Any automatic
 -- read-side accrual rolls back with this test transaction.
 report:=public.admin_get_sunday_payroll('2026-11-22');
 assert report is not null;
end $$;
rollback;
