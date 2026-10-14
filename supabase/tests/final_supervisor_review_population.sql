-- Run after 11:00 Kinshasa on a workday. Does not mutate workers/attendance/payroll.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare d date := (now() at time zone 'Africa/Kinshasa')::date;
  first_result jsonb; repeated_result jsonb;
begin
  first_result := public.admin_get_final_supervisor_review(d,true);
  repeated_result := public.admin_get_final_supervisor_review(d,true);
  if first_result->'workers' is distinct from repeated_result->'workers'
    or first_result->'finalized_at' is distinct from repeated_result->'finalized_at' then
    raise exception 'Repeated finalization changed the population';
  end if;
  if (select count(*) from private.supervisor_review_daily_snapshot where attendance_date=d)<>1 then
    raise exception 'Duplicate daily snapshots';
  end if;
  begin
    update private.supervisor_review_daily_snapshot set workers='[]'::jsonb where attendance_date=d;
    raise exception 'Immutable snapshot accepted mutation';
  exception when check_violation then null;
  end;
  if (select workers from private.supervisor_review_daily_snapshot where attendance_date=d)
    is distinct from first_result->'workers' then raise exception 'Snapshot changed'; end if;
end $$;
rollback;

