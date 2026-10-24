create table public.worker_weekly_overtime_override (
  worker_id uuid not null references public.workers(id),
  week_start date not null check(extract(isodow from week_start)=1),
  minutes integer null check(minutes between 0 and 8640),
  source text not null default 'manual' check(source='manual'),
  version integer not null default 1 check(version>0),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb check(jsonb_typeof(history)='array'),
  primary key(week_start,worker_id)
);
alter table public.worker_weekly_overtime_override enable row level security;
revoke all on public.worker_weekly_overtime_override from public,anon,authenticated;
grant select on public.worker_weekly_overtime_override to authenticated;
create policy weekly_overtime_admin_read on public.worker_weekly_overtime_override for select to authenticated
using ((select public.is_admin()) and exists(select 1 from public.admins a where a.id=(select auth.uid()) and a.is_active));

create function public.admin_set_weekly_overtime(p_week_start date,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare actor uuid:=auth.uid(); e jsonb; wid uuid; v_minutes integer; old public.worker_weekly_overtime_override%rowtype;
  result jsonb:='[]';
begin
  if actor is null or not public.is_admin() or not exists(select 1 from public.admins where id=actor and is_active) then
    raise exception 'Active admin required' using errcode='42501'; end if;
  if p_week_start is null or extract(isodow from p_week_start)<>1 or p_entries is null
    or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 200 then
    raise exception 'Invalid weekly overtime batch'; end if;
  if (select count(distinct value->>'worker_id') from jsonb_array_elements(p_entries))<>jsonb_array_length(p_entries) then raise exception 'Duplicate worker'; end if;
  -- Serialize against payroll status transitions, then worker/week writers in
  -- consistent order, including the first insert when no row exists yet.
  lock table public.payroll_run in share mode;
  for e in select value from jsonb_array_elements(p_entries) order by value->>'worker_id' loop
    wid:=(e->>'worker_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(wid::text||':'||p_week_start::text,0));
    if not exists(select 1 from public.workers w join public.worker_payroll_profile pp on pp.worker_id=w.id
      left join public.worker_staff_classification c on c.worker_id=w.id
      where w.id=wid and w.is_active and pp.payment_type='weekly' and coalesce(c.classification,'normal')='normal'
        and (w.operational_start_date is null or w.operational_start_date<=p_week_start+5)) then raise exception 'Worker not eligible: %',wid; end if;
    if exists(select 1 from public.payroll_run r where r.payment_type='weekly' and r.weekly_period_start=p_week_start
      and r.status in ('reviewed','finalized','paid')) then raise exception 'Payroll week locked'; end if;
    select * into old from public.worker_weekly_overtime_override where worker_id=wid and week_start=p_week_start for update;
    if e->>'expected_version' is null or (e->>'expected_version')::integer<>coalesce(old.version,0) then raise exception 'Weekly overtime changed; reload'; end if;
    if not (e ? 'minutes') or (e->>'minutes' is not null and (e->>'minutes') !~ '^\d+$') then raise exception 'Invalid weekly duration'; end if;
    v_minutes:=(e->>'minutes')::integer;
    if v_minutes is not null and v_minutes not between 0 and 8640 then raise exception 'Weekly duration must be 0..144 hours'; end if;
    insert into public.worker_weekly_overtime_override(worker_id,week_start,minutes,created_by,updated_by,history)
      values(wid,p_week_start,v_minutes,actor,actor,jsonb_build_array(jsonb_build_object('previous',null,'minutes',v_minutes,'actor',actor,'at',now())))
      on conflict(week_start,worker_id) do update set minutes=excluded.minutes,version=old.version+1,updated_by=actor,updated_at=now(),
        history=old.history||jsonb_build_array(jsonb_build_object('previous',old.minutes,'minutes',v_minutes,'previous_version',old.version,'actor',actor,'at',now()));
    result:=result||jsonb_build_array(jsonb_build_object('worker_id',wid,'minutes',v_minutes,'version',coalesce(old.version,0)+1));
  end loop;
  return result;
end $$;
revoke all on function public.admin_set_weekly_overtime(date,jsonb) from public,anon;
grant execute on function public.admin_set_weekly_overtime(date,jsonb) to authenticated;
