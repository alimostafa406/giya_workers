-- REVIEW / EXECUTE MANUALLY.  Fixes the output-column/table-column ambiguity
-- in the administrator-only, today-only snapshot rebuild RPC.

begin;

create or replace function public.admin_rebuild_today_normal_report_snapshot()
returns table(report_date date, verification_run_id uuid, finalized_at timestamptz)
language plpgsql
volatile
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Kinshasa')::date;
  v_verification_run_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;

  select v.id into v_verification_run_id
  from public.attendance_verification_run v
  where v.work_date=v_today
    and v.verification_type='morning'
    and v.status='complete'
  order by v.completed_at desc nulls last,v.created_at desc
  limit 1;

  if v_verification_run_id is null then
    raise exception 'today morning verification is not complete' using errcode='P0001';
  end if;

  return query
  insert into public.foreign_monitoring_normal_report_snapshot as snapshot (
    report_date,verification_run_id,payload,finalized_at
  ) values (
    v_today,v_verification_run_id,
    public.foreign_monitoring_normal_report_payload(v_today,v_today),now()
  )
  on conflict on constraint foreign_monitoring_normal_report_snapshot_pkey do update
    set verification_run_id=excluded.verification_run_id,
        payload=excluded.payload,
        finalized_at=excluded.finalized_at
  returning snapshot.report_date,snapshot.verification_run_id,snapshot.finalized_at;
end;
$$;

revoke all on function public.admin_rebuild_today_normal_report_snapshot() from public,anon;
grant execute on function public.admin_rebuild_today_normal_report_snapshot() to authenticated;

commit;
