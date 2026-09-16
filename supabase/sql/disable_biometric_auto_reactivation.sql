-- REVIEW / EXECUTE MANUALLY after biometric_auto_reactivation.sql if that legacy
-- migration was deployed. Worker reactivation is now an explicit admin UI action.
begin;

revoke all on function public.reactivate_worker_from_biometric_event(text,text)
  from public, anon, authenticated, service_role;

create or replace function public.reactivate_worker_from_biometric_event(
  p_device_id text,
  p_event_identity text
)
returns table(biometric_event_id uuid, worker_id uuid, outcome text)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  raise exception 'automatic worker reactivation is disabled; use the explicit admin Reactivate action'
    using errcode='42501';
end;
$$;

revoke all on function public.reactivate_worker_from_biometric_event(text,text)
  from public, anon, authenticated, service_role;

comment on function public.reactivate_worker_from_biometric_event(text,text) is
  'Disabled legacy biometric auto-reactivation entry point. Reactivation is manual only.';

commit;
