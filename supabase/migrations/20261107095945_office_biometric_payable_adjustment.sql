-- Same canonical review row and writer as existing office/viewer approvals.
-- Raw reference minutes are audit metadata, never a replacement for evidence.
-- Fingerprint and optimistic-version validation stay in the shared writer.
create or replace function public.admin_decide_biometric_overtime(p_date date,p_entries jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); result jsonb; e jsonb;
begin
  if actor_id is null or not public.is_admin() or not exists(select 1 from public.admins where id=actor_id and is_active) then
    raise exception 'Active admin required' using errcode='42501'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 200 then raise exception 'Invalid review batch'; end if;
  for e in select value from jsonb_array_elements(p_entries) loop
    if e ? 'original_biometric_minutes' and (
      e->>'original_biometric_minutes' is null or (e->>'original_biometric_minutes')!~'^[0-9]+$'
      or (e->>'original_biometric_minutes')::integer not between 30 and 1440
      or jsonb_typeof(e->'note') is distinct from 'string' or length(e->>'note')>1000) then
      raise exception 'Invalid biometric reference'; end if;
  end loop;
  result:=private.viewer_biometric_ot_core(p_date,p_entries,actor_id,null,null);
  for e in select value from jsonb_array_elements(p_entries) loop
    if e ? 'original_biometric_minutes' then
      update public.worker_biometric_overtime_review r set history=jsonb_set(r.history,array[(jsonb_array_length(r.history)-1)::text],
        (r.history->-1)||jsonb_build_object('original_biometric_minutes',(e->>'original_biometric_minutes')::integer,
          'adjusted_approved_minutes',(e->>'minutes')::integer,'note',e->>'note','worker_id',r.worker_id,'attendance_date',p_date))
      where r.worker_id=(e->>'worker_id')::uuid and r.attendance_date=p_date;
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function public.admin_decide_biometric_overtime(date,jsonb) from public,anon;
grant execute on function public.admin_decide_biometric_overtime(date,jsonb) to authenticated;
