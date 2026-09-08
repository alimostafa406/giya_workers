-- REVIEW / EXECUTE MANUALLY ONLY.
-- Read-only operational evidence for the current-day "not recorded" state.
-- This function never writes attendance, workers, mappings, events, or payroll.

create or replace function public.get_company_mapped_biometric_events(
  p_date_from date,
  p_date_to date
)
returns table (
  worker_id uuid,
  attendance_date date,
  event_timestamp timestamptz
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
  if p_date_from is null or p_date_to is null then
    raise exception 'Date range is required' using errcode = '22004';
  end if;
  if p_date_to < p_date_from or (p_date_to - p_date_from) > 31 then
    raise exception 'Date range must be between 1 and 32 calendar days' using errcode = '22023';
  end if;

  return query
  with safely_resolved as (
    select
      resolved.worker_id,
      e.attendance_date,
      e.event_timestamp
    from public.biometric_attendance_events as e
    cross join lateral (
      select case
        when not scope.exact_ignored and scope.exact_owner_count = 1
          then scope.exact_worker_id
        when not scope.exact_ignored
          and scope.exact_owner_count = 0
          and not scope.legacy_ignored
          and scope.legacy_owner_count = 1
          then scope.legacy_worker_id
        else null
      end as worker_id
      from (
        select
          exists (
            select 1
            from public.biometric_device_identity_review as review
            where review.device_id = e.device_id
              and btrim(review.device_employee_no) = btrim(e.device_employee_no)
              and review.review_state = 'ignored'
          ) as exact_ignored,
          exists (
            select 1
            from public.biometric_device_identity_review as review
            where review.device_id is null
              and btrim(review.device_employee_no) = btrim(e.device_employee_no)
              and review.review_state = 'ignored'
          ) as legacy_ignored,
          (
            select count(distinct mapping.worker_id)
            from public.biometric_worker_mapping as mapping
            where mapping.device_id = e.device_id
              and btrim(mapping.device_employee_no) = btrim(e.device_employee_no)
              and mapping.is_active is true
              and mapping.mapping_review_state = 'confirmed'
          ) as exact_owner_count,
          (
            select (array_agg(distinct mapping.worker_id))[1]
            from public.biometric_worker_mapping as mapping
            where mapping.device_id = e.device_id
              and btrim(mapping.device_employee_no) = btrim(e.device_employee_no)
              and mapping.is_active is true
              and mapping.mapping_review_state = 'confirmed'
          ) as exact_worker_id,
          (
            select count(distinct mapping.worker_id)
            from public.biometric_worker_mapping as mapping
            where mapping.device_id is null
              and btrim(mapping.device_employee_no) = btrim(e.device_employee_no)
              and mapping.is_active is true
              and mapping.mapping_review_state = 'confirmed'
          ) as legacy_owner_count,
          (
            select (array_agg(distinct mapping.worker_id))[1]
            from public.biometric_worker_mapping as mapping
            where mapping.device_id is null
              and btrim(mapping.device_employee_no) = btrim(e.device_employee_no)
              and mapping.is_active is true
              and mapping.mapping_review_state = 'confirmed'
          ) as legacy_worker_id
      ) as scope
    ) as resolved
    where e.device_employee_no is not null
      and e.attendance_date between p_date_from and p_date_to
      and resolved.worker_id is not null
  ),
  reviewable_early_events as (
    select
      review.worker_id,
      review.current_work_date as attendance_date,
      review.event_timestamp
    from public.biometric_early_morning_review as review
    where review.worker_id is not null
      and review.review_status = 'needs_review'
      and review.current_work_date between p_date_from and p_date_to
  ),
  operational_evidence as (
    select * from safely_resolved
    union
    select * from reviewable_early_events
  )
  select distinct
    evidence.worker_id,
    evidence.attendance_date,
    evidence.event_timestamp
  from operational_evidence as evidence
  join public.workers as worker
    on worker.id = evidence.worker_id
   and worker.is_active is true
  where not exists (
    select 1
    from public.worker_staff_classification as classification
    where classification.worker_id = worker.id
      and classification.classification = 'special_staff'
  )
  order by evidence.attendance_date, evidence.worker_id, evidence.event_timestamp;
end;
$$;

revoke all on function public.get_company_mapped_biometric_events(date, date) from public, anon;
grant execute on function public.get_company_mapped_biometric_events(date, date) to authenticated;

comment on function public.get_company_mapped_biometric_events(date, date) is
  'Read-only current-day biometric evidence; never infers or writes attendance.';
