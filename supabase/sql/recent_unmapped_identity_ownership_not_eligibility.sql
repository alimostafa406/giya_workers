-- REVIEW / EXECUTE MANUALLY. An inactive worker still owns a safely mapped
-- biometric identity. This changes only read-only unmapped classification;
-- it never changes stored events, mappings, workers, or attendance.
create or replace function public.get_recent_unmapped_biometric_identities(
  p_end_date date,
  p_days integer default 7
)
returns table (
  device_employee_no text,
  device_name text,
  latest_event_at timestamptz,
  recent_event_count bigint,
  devices_seen text[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Active admin access is required';
  end if;
  if p_end_date is null then
    raise exception 'End date is required' using errcode = '22004';
  end if;
  if p_days is null or p_days < 1 or p_days > 31 then
    raise exception 'Days must be between 1 and 31' using errcode = '22023';
  end if;

  return query
  with recent_identities as (
    select
      nullif(btrim(e.device_id), '') as identity_device_id,
      btrim(e.device_employee_no) as identity_employee_no,
      (array_agg(e.device_name order by e.event_timestamp desc)
        filter (where e.device_name is not null))[1]::text as latest_device_name,
      max(e.event_timestamp) as latest_event,
      count(*)::bigint as event_count,
      array_agg(distinct btrim(e.device_id) order by btrim(e.device_id))::text[] as seen_devices
    from public.biometric_attendance_events as e
    where e.device_employee_no is not null
      and btrim(e.device_employee_no) <> ''
      and e.attendance_date between (p_end_date - (p_days - 1)) and p_end_date
    group by nullif(btrim(e.device_id), ''), btrim(e.device_employee_no)
  ), resolved as (
    select i.*,
      exact_mapping.owner_count as exact_owner_count,
      exact_worker.id is not null as exact_worker_exists,
      legacy_mapping.owner_count as legacy_owner_count,
      legacy_worker.id is not null as legacy_worker_exists
    from recent_identities as i
    left join lateral (
      select count(distinct m.worker_id) as owner_count,
        (array_agg(distinct m.worker_id))[1] as worker_id
      from public.biometric_worker_mapping as m
      where m.is_active is true
        and m.mapping_review_state = 'confirmed'
        and btrim(m.device_employee_no) = i.identity_employee_no
        and nullif(btrim(m.device_id), '') = i.identity_device_id
    ) as exact_mapping on true
    left join public.workers as exact_worker on exact_worker.id = exact_mapping.worker_id
    left join lateral (
      select count(distinct m.worker_id) as owner_count,
        (array_agg(distinct m.worker_id))[1] as worker_id
      from public.biometric_worker_mapping as m
      where m.is_active is true
        and m.mapping_review_state = 'confirmed'
        and btrim(m.device_employee_no) = i.identity_employee_no
        and nullif(btrim(m.device_id), '') is null
    ) as legacy_mapping on true
    left join public.workers as legacy_worker on legacy_worker.id = legacy_mapping.worker_id
  )
  select
    r.identity_employee_no::text,
    r.latest_device_name,
    r.latest_event,
    r.event_count,
    r.seen_devices
  from resolved as r
  where not (
    case
      -- A conflicting exact identity blocks legacy fallback, just as in the agent.
      when r.exact_owner_count > 1 then false
      when r.exact_owner_count = 1 then r.exact_worker_exists
      when r.legacy_owner_count > 1 then false
      when r.legacy_owner_count = 1 then r.legacy_worker_exists
      else false
    end
  )
    and not exists (
      select 1
      from public.biometric_device_identity_review as review
      where review.review_state = 'ignored'
        and btrim(review.device_employee_no) = r.identity_employee_no
        and (
          nullif(btrim(review.device_id), '') = r.identity_device_id
          or (
            nullif(btrim(review.device_id), '') is null
            and r.exact_owner_count <> 1
          )
        )
    )
  order by r.latest_event desc, r.identity_device_id, r.identity_employee_no;
end;
$$;

revoke all on function public.get_recent_unmapped_biometric_identities(date, integer) from public, anon;
grant execute on function public.get_recent_unmapped_biometric_identities(date, integer) to authenticated;
