-- REVIEW / EXECUTE MANUALLY ONLY.
-- Adds one admin-only transactional RPC. It does not alter attendance,
-- Hikvision inventory, existing mappings, payroll history, or existing workers.

create or replace function public.create_worker_and_confirm_biometric_mapping(
  p_full_name text,
  p_employee_code text,
  p_team_id uuid,
  p_device_employee_no text,
  p_device_id text,
  p_device_name text default null,
  p_device_picture_url text default null
)
returns table (worker_id uuid, mapping_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict error
declare
  v_stage text := 'initialization';
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_employee_code text := btrim(coalesce(p_employee_code, ''));
  v_device_employee_no text := btrim(coalesce(p_device_employee_no, ''));
  v_device_id text := btrim(coalesce(p_device_id, ''));
  v_worker_id uuid;
  v_mapping_id uuid;
  v_existing_mapping_id uuid;
  v_existing_mapping_active boolean;
  v_error_sqlstate text;
  v_error_message text;
  v_error_detail text;
  v_error_hint text;
  v_error_context text;
  v_enriched_detail text;
begin
  v_stage := 'admin validation';
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  v_stage := 'input validation';
  if v_full_name = '' or v_employee_code = '' or v_device_id = '' or v_device_employee_no = '' or p_team_id is null then
    raise exception 'Name, employee code, team, device, and device identity are required.' using errcode = '22023';
  end if;

  v_stage := 'team validation';
  if not exists (select 1 from public.teams as t where t.id = p_team_id and t.is_active) then
    raise exception 'Selected team is not active or does not exist.' using errcode = '23503';
  end if;

  v_stage := 'employee-code validation';
  if exists (select 1 from public.workers as w where lower(btrim(w.employee_code)) = lower(v_employee_code)) then
    raise exception 'Employee code already exists.' using errcode = '23505';
  end if;

  v_stage := 'existing mapping lookup';
  select m.id, m.is_active into v_existing_mapping_id, v_existing_mapping_active
  from public.biometric_worker_mapping as m
  where m.device_employee_no = v_device_employee_no
    and (m.device_id = v_device_id or m.device_id is null)
    and m.is_active is true
  order by (m.device_id = v_device_id) desc
  limit 1
  for update;
  if v_existing_mapping_id is not null and v_existing_mapping_active then
    raise exception 'This device identity is already actively mapped.' using errcode = '23505';
  end if;

  v_stage := 'worker insert';
  insert into public.workers as w (full_name, employee_code, phone, team_id, is_active)
  values (v_full_name, v_employee_code, null, p_team_id, true)
  returning w.id into v_worker_id;

  -- New normal workers follow the established default without changing staff classification.
  v_stage := 'worker_payroll_profile insert';
  insert into public.worker_payroll_profile as profile ("worker_id", payment_type)
  values (v_worker_id, 'weekly');

  v_stage := 'worker_staff_classification insert';
  insert into public.worker_staff_classification as classification ("worker_id", classification)
  values (v_worker_id, 'normal')
  -- worker_id is also an implicit OUT parameter from RETURNS TABLE. Naming the
  -- constraint avoids the PL/pgSQL column/OUT-parameter ambiguity while
  -- preserving the primary-key uniqueness guarantee and concurrent safety.
  on conflict on constraint worker_staff_classification_pkey do nothing;

  if v_existing_mapping_id is null then
    v_stage := 'biometric_worker_mapping insert';
    insert into public.biometric_worker_mapping as m (
      "worker_id", device_id, device_employee_no, device_name, device_picture_url, is_active, mapping_review_state
    ) values (
      v_worker_id, v_device_id, v_device_employee_no, nullif(btrim(coalesce(p_device_name, '')), ''),
      nullif(btrim(coalesce(p_device_picture_url, '')), ''), true, 'confirmed'
    ) returning m.id into v_mapping_id;
  else
    v_stage := 'biometric_worker_mapping update';
    update public.biometric_worker_mapping as m
    set "worker_id" = v_worker_id,
        device_name = nullif(btrim(coalesce(p_device_name, '')), ''),
        device_picture_url = nullif(btrim(coalesce(p_device_picture_url, '')), ''),
        is_active = true,
        mapping_review_state = 'confirmed'
    where m.id = v_existing_mapping_id
    returning m.id into v_mapping_id;
  end if;

  v_stage := 'return result';
  return query select v_worker_id, v_mapping_id;
exception
  when others then
    get stacked diagnostics
      v_error_sqlstate = returned_sqlstate,
      v_error_message = message_text,
      v_error_detail = pg_exception_detail,
      v_error_hint = pg_exception_hint,
      v_error_context = pg_exception_context;

    v_enriched_detail := concat_ws(E'\n',
      format('Original SQLSTATE: %s', v_error_sqlstate),
      case when nullif(v_error_detail, '') is not null then format('Original detail: %s', v_error_detail) end,
      case when nullif(v_error_context, '') is not null then format('Original context: %s', v_error_context) end
    );

    if nullif(v_error_hint, '') is null then
      raise exception using
        errcode = v_error_sqlstate,
        message = format(
          'create_worker_and_confirm_biometric_mapping failed at stage "%s": %s',
          v_stage,
          v_error_message
        ),
        detail = v_enriched_detail;
    end if;

    raise exception using
      errcode = v_error_sqlstate,
      message = format(
        'create_worker_and_confirm_biometric_mapping failed at stage "%s": %s',
        v_stage,
        v_error_message
      ),
      detail = v_enriched_detail,
      hint = v_error_hint;
end;
$$;

do $$
begin
  if to_regprocedure('public.create_worker_and_confirm_biometric_mapping(text,text,uuid,text,text,text)') is not null then
    execute 'revoke execute on function public.create_worker_and_confirm_biometric_mapping(text, text, uuid, text, text, text) from authenticated';
  end if;
end;
$$;
grant execute on function public.create_worker_and_confirm_biometric_mapping(text, text, uuid, text, text, text, text) to authenticated;
