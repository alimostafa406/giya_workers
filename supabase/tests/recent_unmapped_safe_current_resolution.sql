-- Read-only truth table for the current safe identity-resolution predicate.
-- Run as a SELECT; no production worker, event, mapping, or attendance rows are touched.
with workers(worker_id, is_active, operational_start_date) as (
  values
    ('bob', true, null::date), ('francis', true, null::date),
    ('heritier', true, null::date), ('pembele', true, null::date),
    ('mukiana', true, null::date), ('legacy', true, null::date),
    ('review', true, null::date), ('owner_a', true, null::date),
    ('owner_b', true, null::date), ('inactive', false, null::date),
    ('buini', false, null::date), ('jean', false, null::date),
    ('jones', false, null::date),
    ('future', true, date '2026-10-01')
), mappings(device_id, employee_no, worker_id, is_active, review_state) as (
  values
    ('office-secondary', '71', 'bob', true, 'confirmed'),
    ('office-main', '77', 'francis', true, 'confirmed'),
    ('office-main', '78', 'heritier', true, 'confirmed'),
    (null, '30', 'pembele', true, 'confirmed'),
    (null, '071', 'mukiana', true, 'confirmed'),
    (null, '88', 'review', true, 'needs_review'),
    ('office-main', '99', 'owner_a', true, 'confirmed'),
    ('office-main', '99', 'owner_b', true, 'confirmed'),
    ('office-main', '50', 'buini', true, 'confirmed'),
    ('office-secondary', '50', 'buini', true, 'confirmed'),
    (null, '19', 'jean', true, 'confirmed'),
    (null, '32', 'jones', true, 'confirmed'),
    (null, '55', 'inactive', true, 'confirmed'),
    (null, '56', 'future', true, 'confirmed'),
    (null, '57', 'legacy', true, 'confirmed'),
    ('office-main', '57', 'owner_a', true, 'confirmed'),
    ('office-main', '57', 'owner_b', true, 'confirmed')
), events(test_case, device_id, employee_no, historical_worker_id, expected_unmapped) as (
  values
    ('BOB secondary 71 with old NULL event', 'office-secondary', '71', null, false),
    ('FRANCIS 77 with old NULL event', 'office-main', '77', null, false),
    ('heritier 78 with old NULL event', 'office-main', '78', null, false),
    ('buini main 50 while inactive', 'office-main', '50', null, false),
    ('buini secondary 50 while inactive', 'office-secondary', '50', null, false),
    ('jean22 19 resolves through JEAN legacy mapping', 'office-main', '19', null, false),
    ('jonas 32 main resolves through jones legacy mapping', 'office-main', '32', null, false),
    ('jonas 32 secondary resolves through jones legacy mapping', 'office-secondary', '32', null, false),
    ('MARCUS 030 without mapping', 'office-main', '030', null, true),
    ('030 is not legacy 30', 'office-secondary', '030', null, true),
    ('71 is not legacy 071', 'office-main', '71', null, true),
    ('confirmed exact-string legacy fallback', 'office-secondary', '071', null, false),
    ('active needs_review is unsafe', 'office-main', '88', null, true),
    ('conflicting exact ownership is unsafe', 'office-main', '99', null, true),
    ('mapping on another device does not resolve', 'office-secondary', '77', null, true),
    ('inactive worker still owns identity', 'office-main', '55', null, false),
    ('future operational start does not change identity', 'office-main', '56', null, false),
    ('exact conflict blocks legacy fallback', 'office-main', '57', null, true)
), resolved as (
  select e.*,
    exact_mapping.owner_count as exact_owner_count,
    exact_worker.worker_id is not null as exact_worker_exists,
    legacy_mapping.owner_count as legacy_owner_count,
    legacy_worker.worker_id is not null as legacy_worker_exists
  from events as e
  left join lateral (
    select count(distinct m.worker_id) as owner_count,
      (array_agg(distinct m.worker_id))[1] as worker_id
    from mappings as m
    where m.is_active is true and m.review_state = 'confirmed'
      and btrim(m.employee_no) = btrim(e.employee_no)
      and nullif(btrim(m.device_id), '') = nullif(btrim(e.device_id), '')
  ) as exact_mapping on true
  left join workers as exact_worker on exact_worker.worker_id = exact_mapping.worker_id
  left join lateral (
    select count(distinct m.worker_id) as owner_count,
      (array_agg(distinct m.worker_id))[1] as worker_id
    from mappings as m
    where m.is_active is true and m.review_state = 'confirmed'
      and btrim(m.employee_no) = btrim(e.employee_no)
      and nullif(btrim(m.device_id), '') is null
  ) as legacy_mapping on true
  left join workers as legacy_worker on legacy_worker.worker_id = legacy_mapping.worker_id
), results as (
  select test_case, expected_unmapped,
    not (
      case
        when exact_owner_count > 1 then false
        when exact_owner_count = 1 then exact_worker_exists
        when legacy_owner_count > 1 then false
        when legacy_owner_count = 1 then legacy_worker_exists
        else false
      end
    ) as actual_unmapped
  from resolved
)
select count(*) as cases_checked,
  count(*) filter (where actual_unmapped is distinct from expected_unmapped) as failures,
  coalesce(jsonb_agg(test_case) filter (where actual_unmapped is distinct from expected_unmapped), '[]'::jsonb) as failed_cases
from results;
