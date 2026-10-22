-- Same ownership strategy as hikvision_attendance_sync.biometric_mapping_for_event
-- and _ignored_review_applies. Ownership is independent of roster eligibility.
-- Private, read-only helper; no names, numeric coercion or mapping mutations.
create or replace function private.confirmed_biometric_identity_worker(
  p_device_id text, p_employee_no text
) returns uuid language sql stable security invoker
set search_path = public, pg_temp as $$
  with identity as (
    select nullif(btrim(p_device_id),'') device_id, nullif(btrim(p_employee_no),'') employee_no
  ), candidates as (
    select m.worker_id, nullif(btrim(m.device_id),'') device_id
    from public.biometric_worker_mapping m cross join identity i
    where m.is_active is true and m.mapping_review_state='confirmed'
      and btrim(m.device_employee_no)=i.employee_no
      and (nullif(btrim(m.device_id),'')=i.device_id or nullif(btrim(m.device_id),'') is null)
  ), selected_scope as (
    select c.worker_id from candidates c cross join identity i
    where case when exists(select 1 from candidates e where e.device_id=i.device_id)
      then c.device_id=i.device_id else c.device_id is null end
  ), owner as (
    select count(distinct worker_id) owner_count,(array_agg(distinct worker_id))[1] worker_id from selected_scope
  )
  select o.worker_id from owner o cross join identity i
  where o.owner_count=1 and exists(select 1 from public.workers w where w.id=o.worker_id)
    and not exists(select 1 from public.biometric_device_identity_review r
      where r.review_state='ignored' and btrim(r.device_employee_no)=i.employee_no
        and (nullif(btrim(r.device_id),'')=i.device_id
          or (nullif(btrim(r.device_id),'') is null
            and not exists(select 1 from candidates e where e.device_id=i.device_id))))
$$;
revoke all on function private.confirmed_biometric_identity_worker(text,text) from public,anon,authenticated,service_role;

-- Retain the installed authorized workflow verbatim except its identity lookup.
-- Fail closed if the expected source has changed instead of replacing other rules.
do $migration$
declare definition text; old_lookup text := $old$
    select count(*), min(m.worker_id)
      into v_mapping_count, v_mapped_worker
    from public.biometric_worker_mapping m
    where m.is_active = true
      and m.mapping_review_state = 'confirmed'
      and m.device_id = v_event.device_id
      and m.device_employee_no = v_event.device_employee_no;

    if v_mapping_count <> 1 or v_mapped_worker is null then
      raise exception 'exact confirmed device-scoped mapping is not unique' using errcode = '23514';
    end if;
$old$;
new_lookup text := $new$
    v_mapped_worker := private.confirmed_biometric_identity_worker(v_event.device_id,v_event.device_employee_no);
    if v_mapped_worker is null then
      raise exception 'confirmed biometric identity is unresolved, ambiguous or ignored' using errcode = '23514';
    end if;
$new$;
begin
  definition:=pg_get_functiondef('public.resolve_early_morning_biometric_review(uuid,text)'::regprocedure);
  if position(old_lookup in definition)=0 then
    raise exception 'Early-morning resolver changed; inspect before applying identity migration';
  end if;
  execute replace(definition,old_lookup,new_lookup);
end $migration$;
