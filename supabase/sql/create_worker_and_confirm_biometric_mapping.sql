-- REVIEW / EXECUTE MANUALLY ONLY.
-- Adds one admin-only transactional RPC. It does not alter attendance,
-- Hikvision inventory, existing mappings, payroll history, or existing workers.

create or replace function public.create_worker_and_confirm_biometric_mapping(
  p_full_name text,
  p_employee_code text,
  p_team_id uuid,
  p_device_employee_no text,
  p_device_name text default null,
  p_device_picture_url text default null
)
returns table (worker_id uuid, mapping_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_employee_code text := btrim(coalesce(p_employee_code, ''));
  v_device_employee_no text := btrim(coalesce(p_device_employee_no, ''));
  v_worker_id uuid;
  v_mapping_id uuid;
  v_existing_mapping_id uuid;
  v_existing_mapping_active boolean;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if v_full_name = '' or v_employee_code = '' or v_device_employee_no = '' or p_team_id is null then
    raise exception 'Name, employee code, team, and device identity are required.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.teams as t where t.id = p_team_id and t.is_active) then
    raise exception 'Selected team is not active or does not exist.' using errcode = '23503';
  end if;
  if exists (select 1 from public.workers as w where lower(btrim(w.employee_code)) = lower(v_employee_code)) then
    raise exception 'Employee code already exists.' using errcode = '23505';
  end if;

  select m.id, m.is_active into v_existing_mapping_id, v_existing_mapping_active
  from public.biometric_worker_mapping as m
  where m.device_employee_no = v_device_employee_no
  for update;
  if v_existing_mapping_id is not null and v_existing_mapping_active then
    raise exception 'This device identity is already actively mapped.' using errcode = '23505';
  end if;

  insert into public.workers as w (full_name, employee_code, phone, team_id, is_active)
  values (v_full_name, v_employee_code, null, p_team_id, true)
  returning w.id into v_worker_id;

  -- New normal workers follow the established default without changing staff classification.
  insert into public.worker_payroll_profile as profile ("worker_id", payment_type)
  values (v_worker_id, 'weekly');
  insert into public.worker_staff_classification as classification ("worker_id", classification)
  values (v_worker_id, 'normal')
  on conflict ("worker_id") do nothing;

  if v_existing_mapping_id is null then
    insert into public.biometric_worker_mapping as m (
      "worker_id", device_employee_no, device_name, device_picture_url, is_active, mapping_review_state
    ) values (
      v_worker_id, v_device_employee_no, nullif(btrim(coalesce(p_device_name, '')), ''),
      nullif(btrim(coalesce(p_device_picture_url, '')), ''), true, 'confirmed'
    ) returning m.id into v_mapping_id;
  else
    update public.biometric_worker_mapping as m
    set "worker_id" = v_worker_id,
        device_name = nullif(btrim(coalesce(p_device_name, '')), ''),
        device_picture_url = nullif(btrim(coalesce(p_device_picture_url, '')), ''),
        is_active = true,
        mapping_review_state = 'confirmed'
    where m.id = v_existing_mapping_id
    returning m.id into v_mapping_id;
  end if;

  return query select v_worker_id as "worker_id", v_mapping_id as "mapping_id";
end;
$$;

grant execute on function public.create_worker_and_confirm_biometric_mapping(text, text, uuid, text, text, text) to authenticated;
