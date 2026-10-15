-- Integration assertions against existing reconciled evidence. All test
-- snapshot/audit changes roll back; no worker, event or payroll fixtures added.
begin;
do $$
declare
  s record; proof jsonb; expected jsonb; result jsonb; ids text[];
  count_before bigint; count_after bigint; blocked boolean;
  payroll_before text; manual_before text; payroll_after text; manual_after text;
begin
  if has_function_privilege('anon','private.correct_night_supervisor_review(date,jsonb,text)','execute')
    or has_function_privilege('authenticated','private.correct_night_supervisor_review(date,jsonb,text)','execute')
    or has_function_privilege('service_role','private.correct_night_supervisor_review(date,jsonb,text)','execute') then
    raise exception 'Correction must not be executable through public clients';
  end if;
  select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into payroll_before from public.payroll_line l;
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into manual_before from public.attendance a
    where a.manual_override or coalesce(a.biometric_sync_metadata,'{}'::jsonb) ? 'supervisor_morning_review';
  blocked := false;
  begin
    perform private.correct_night_supervisor_review('2026-10-11','[]','test out-of-scope date');
  exception when invalid_parameter_value then blocked := true;
  end;
  if not blocked then raise exception 'Dates before October 12 must be rejected'; end if;
  for s in select * from private.supervisor_review_daily_snapshot
    where attendance_date between date '2026-10-12' and (now() at time zone 'Africa/Kinshasa')::date order by attendance_date loop
    select coalesce(jsonb_agg(jsonb_build_object('worker_id',a.worker_id,
      'event_ids',a.biometric_sync_metadata->'night_reconciliation'->'event_ids')),'[]'::jsonb)
      into proof from public.attendance a join public.workers w on w.id=a.worker_id
      where a.attendance_date=s.attendance_date and w.attendance_shift='night'
        and a.biometric_sync_metadata->'night_reconciliation'->>'source'='historical_night_shift_reconciliation_v1';
    select coalesce(array_agg(value->>'worker_id'),array[]::text[]) into ids from jsonb_array_elements(proof);
    select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into expected
      from jsonb_array_elements(s.workers) with ordinality where not coalesce(value->>'id'=any(ids),false);
    select count(*) into count_before from private.night_supervisor_review_correction;
    result := private.correct_night_supervisor_review(s.attendance_date,proof,'ROLLBACK integration verification');
    if (select workers from private.supervisor_review_daily_snapshot where attendance_date=s.attendance_date) <> expected
      or (result->>'removed')::integer <> jsonb_array_length(s.workers)-jsonb_array_length(expected) then
      raise exception 'Correction changed unrelated worker objects or removal counts';
    end if;
    if (select to_jsonb(x)-'workers'-'version' from private.supervisor_review_daily_snapshot x where attendance_date=s.attendance_date)
      <> to_jsonb(s)-'workers'-'version' then raise exception 'Snapshot header changed'; end if;
    select count(*) into count_after from private.night_supervisor_review_correction;
    result := private.correct_night_supervisor_review(s.attendance_date,proof,'ROLLBACK repeated verification');
    if (result->>'removed')::integer<>0 or (select count(*) from private.night_supervisor_review_correction)<>count_after then
      raise exception 'Repeated correction must be idempotent';
    end if;
    if count_after-count_before <> (case when expected=s.workers then 0 else 1 end) then
      raise exception 'Exactly one audit per changed population required';
    end if;
    blocked := false;
    begin
      update private.supervisor_review_daily_snapshot set workers=workers where attendance_date=s.attendance_date;
    exception when check_violation then blocked := true;
    end;
    if not blocked then raise exception 'Unaudited snapshot updates must stay blocked'; end if;
  end loop;
  blocked := false;
  begin
    update private.night_supervisor_review_correction set reason=reason;
  exception when check_violation then blocked := true;
  end;
  if exists(select 1 from private.night_supervisor_review_correction) and not blocked then
    raise exception 'Correction audit must be append-only';
  end if;
  select md5(coalesce(jsonb_agg(to_jsonb(l) order by l.id)::text,'')) into payroll_after from public.payroll_line l;
  select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into manual_after from public.attendance a
    where a.manual_override or coalesce(a.biometric_sync_metadata,'{}'::jsonb) ? 'supervisor_morning_review';
  if payroll_before<>payroll_after or manual_before<>manual_after then raise exception 'Payroll/manual data changed'; end if;
end;
$$;
rollback;
select 'snapshot removal, unrelated row preservation, idempotency, immutable audit, permissions, payroll/manual protection: PASS' as verification;
