-- REVIEW / EXECUTE MANUALLY. Keeps durable verification participation aligned
-- with an active, confirmed biometric mapping. It never changes attendance,
-- worker identities, device users, or a participation state on mapping removal.

begin;

create or replace function public.enroll_confirmed_biometric_mapping_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active is true and new.mapping_review_state = 'confirmed' then
    insert into public.worker_biometric_participation (
      worker_id, participation_state, decision_source, decision_note, decided_at, decided_by
    ) values (
      new.worker_id,
      'enrolled',
      'confirmed_active_mapping_trigger',
      'Active confirmed biometric mapping established enrollment',
      now(),
      null::uuid
    )
    on conflict (worker_id) do update
      set participation_state = 'enrolled',
          decision_source = 'confirmed_active_mapping_trigger',
          decision_note = 'Active confirmed biometric mapping established enrollment',
          decided_at = now(),
          decided_by = null::uuid
      where public.worker_biometric_participation.participation_state is distinct from 'enrolled';
  end if;
  return new;
end;
$$;

drop trigger if exists biometric_mapping_enroll_participation on public.biometric_worker_mapping;
create trigger biometric_mapping_enroll_participation
after insert or update on public.biometric_worker_mapping
for each row execute function public.enroll_confirmed_biometric_mapping_participation();

-- Backfill the lifecycle gap introduced after the original one-time migration.
-- An explicit not_enrolled decision is intentionally left unchanged: lack of a
-- mapping never implies not_enrolled, and this migration only repairs missing
-- or unknown rows backed by an active confirmed mapping.
insert into public.worker_biometric_participation (
  worker_id, participation_state, decision_source, decision_note, decided_at, decided_by
)
select distinct
  mapping.worker_id,
  'enrolled',
  'confirmed_active_mapping_lifecycle_backfill',
  'Backfilled from an active confirmed biometric mapping',
  now(),
  null::uuid
from public.biometric_worker_mapping as mapping
where mapping.is_active is true
  and mapping.mapping_review_state = 'confirmed'
on conflict (worker_id) do update
  set participation_state = 'enrolled',
      decision_source = 'confirmed_active_mapping_lifecycle_backfill',
      decision_note = 'Backfilled from an active confirmed biometric mapping',
      decided_at = now(),
      decided_by = null::uuid
  where public.worker_biometric_participation.participation_state = 'unknown';

commit;
