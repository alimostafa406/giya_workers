"""Fail-closed verification layered on the normal Hikvision collector.

The normal broad reader remains the primary path. For workers still lacking
positive evidence, this module scans each relevant device once in bounded time
segments and performs exact confirmed-identity matching locally. A missing
event is trusted only when every segment on every required device completed.
"""

from __future__ import annotations

import os
import time as time_module
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime

from attendance_business_rules import END_OF_DAY, workday_schedule
from hikvision_attendance_sync import (
    MONITORING_TIME_ZONE,
    apply_biometric_attendance,
    biometric_identity_is_ignored,
    biometric_mapping_for_event,
    biometric_mapping_is_ignored,
    deduplicate_hikvision_events,
    hikvision_events_for_device_segmented_verification,
    is_manual_protected,
    load_resolution_data,
    persisted_biometric_events,
    plan_attendance,
    resolved_biometric_event_rows,
)


MORNING_VERIFICATION_TYPE = 'morning'
WORKER_RESULTS = {
    'attendance_present', 'recovered', 'verified_no_event', 'manual_protected',
    'unresolved', 'not_enrolled_excluded',
}


def active_normal_workers(resolution: dict) -> dict[str, dict]:
    return {
        worker_id: worker
        for worker_id, worker in resolution.get('workers', {}).items()
        if worker.get('is_active') is not False
        and resolution.get('classifications', {}).get(worker_id, 'normal') == 'normal'
    }


def biometric_verification_scope(resolution: dict) -> dict[str, dict[str, dict]]:
    """Partition the active Normal roster using explicit durable participation."""
    roster = active_normal_workers(resolution)
    states = resolution.get('biometric_participation', {})
    return {
        'roster': roster,
        'enrolled': {
            worker_id: worker for worker_id, worker in roster.items()
            if states.get(worker_id, 'unknown') == 'enrolled'
        },
        'not_enrolled': {
            worker_id: worker for worker_id, worker in roster.items()
            if states.get(worker_id, 'unknown') == 'not_enrolled'
        },
        'unknown': {
            worker_id: worker for worker_id, worker in roster.items()
            if states.get(worker_id, 'unknown') not in {'enrolled', 'not_enrolled'}
        },
    }


def morning_verification_targets(resolution: dict) -> dict[str, dict]:
    """Return enrolled active Normal workers with no authoritative check-in."""
    return {
        worker_id: worker
        for worker_id, worker in biometric_verification_scope(resolution)['enrolled'].items()
        if not resolution.get('existing_attendance', {}).get(worker_id, {}).get('check_in')
    }


def checkout_verification_targets(resolution: dict) -> dict[str, dict]:
    return {
        worker_id: worker
        for worker_id, worker in active_normal_workers(resolution).items()
        if resolution.get('existing_attendance', {}).get(worker_id, {}).get('check_in')
        and not resolution.get('existing_attendance', {}).get(worker_id, {}).get('check_out')
        and not is_manual_protected(resolution.get('existing_attendance', {}).get(worker_id))
    }


def worker_identity_queries(worker_id: str, resolution: dict, devices: list) -> list[tuple[object, str]]:
    """Expand confirmed mappings while preserving exact-device precedence."""
    queries: dict[tuple[str, str], tuple[object, str]] = {}
    by_id = {device.device_id: device for device in devices}
    for key, mapping in resolution.get('confirmed', {}).items():
        if str(mapping.get('worker_id') or '') != worker_id or biometric_mapping_is_ignored(resolution, mapping):
            continue
        if not isinstance(key, tuple) or len(key) != 2:
            continue
        mapping_device, identity = key
        candidate_devices = [by_id[mapping_device]] if mapping_device in by_id else list(devices) if mapping_device is None else []
        for device in candidate_devices:
            probe = {'_device_id': device.device_id, 'employeeNoString': identity}
            resolved = biometric_mapping_for_event(resolution, probe)
            if resolved and str(resolved.get('worker_id') or '') == worker_id:
                queries[(device.device_id, identity)] = (device, identity)
    return list(queries.values())


def completed_morning_snapshot_compatibility(run: dict, resolution: dict, devices: list) -> dict:
    """Keep a completed snapshot authoritative only for its original members.

    A genuinely new worker created after completion is outside the snapshot.
    Missing/deactivated snapshot members, older workers activated later, changed
    participation, malformed stored scope, or lost safe enrolled mappings all
    fail closed and require a fresh idempotent verification pass.
    """
    snapshot_roster = {str(worker_id) for worker_id in run.get('roster_worker_ids') or []}
    snapshot_enrolled = {str(worker_id) for worker_id in run.get('biometric_in_scope_worker_ids') or []}
    snapshot_not_enrolled = {str(worker_id) for worker_id in run.get('non_biometric_excluded_worker_ids') or []}
    snapshot_unknown = {str(worker_id) for worker_id in run.get('unknown_biometric_status_worker_ids') or []}
    current_scope = biometric_verification_scope(resolution)
    current_roster = set(current_scope['roster'])
    completed_at = _parsed_instant(run.get('completed_at'))
    stored_roster_count = _parsed_nonnegative_int(run.get('active_normal_roster_count'))
    stored_unknown_count = _parsed_nonnegative_int(run.get('unknown_biometric_status_count'))
    stored_unresolved_count = _parsed_nonnegative_int(run.get('unresolved_worker_count'))

    stored_scope_consistent = (
        run.get('status') == 'complete'
        and completed_at is not None
        and stored_unknown_count == 0
        and stored_unresolved_count == 0
        and len(snapshot_roster) > 0
        and stored_roster_count == len(snapshot_roster)
        and snapshot_roster == snapshot_enrolled | snapshot_not_enrolled | snapshot_unknown
        and not (snapshot_enrolled & snapshot_not_enrolled)
        and not (snapshot_enrolled & snapshot_unknown)
        and not (snapshot_not_enrolled & snapshot_unknown)
    )
    missing_snapshot_workers = sorted(snapshot_roster - current_roster)
    added_workers = current_roster - snapshot_roster
    post_verification_workers = []
    unsafe_added_workers = []
    for worker_id in sorted(added_workers):
        created_at = _parsed_instant(current_scope['roster'][worker_id].get('created_at'))
        if completed_at is not None and created_at is not None and created_at > completed_at:
            post_verification_workers.append(worker_id)
        else:
            unsafe_added_workers.append(worker_id)

    participation_changed = sorted(
        (snapshot_enrolled - set(current_scope['enrolled']))
        | (snapshot_not_enrolled - set(current_scope['not_enrolled']))
        | (snapshot_unknown - set(current_scope['unknown']))
    )
    unsafe_mapping_workers = sorted(
        worker_id for worker_id in snapshot_enrolled
        if worker_id in current_roster and not worker_identity_queries(worker_id, resolution, devices)
    )
    compatible = (
        stored_scope_consistent
        and not missing_snapshot_workers
        and not unsafe_added_workers
        and not participation_changed
        and not unsafe_mapping_workers
    )
    return {
        'compatible': compatible,
        'post_verification_worker_ids': post_verification_workers,
        'missing_snapshot_worker_ids': missing_snapshot_workers,
        'unsafe_added_worker_ids': unsafe_added_workers,
        'participation_changed_worker_ids': participation_changed,
        'unsafe_mapping_worker_ids': unsafe_mapping_workers,
    }


def reconcile_completed_morning_verification_children(client, run: dict, resolution: dict) -> dict:
    """Converge safe current-state child rows without recreating negatives.

    The caller must first establish completed snapshot compatibility.  Positive
    attendance and explicit participation are safe to project into child rows.
    Negative evidence is preserved only when an existing same-run child row
    still contains complete query evidence; it is never inferred here.
    """
    run_id = str(run.get('id') or '')
    roster = {str(worker_id) for worker_id in run.get('roster_worker_ids') or []}
    if not run_id or not roster:
        return {'safe': False, 'reason': 'missing_run_identity_or_roster', 'failures': []}

    child_rows = client.read(
        'attendance_verification_worker',
        'run_id,worker_id,verification_result,relevant_query_count,evidence_event_count,'
        'verification_details,verified_at',
        run_id=f'eq.{run_id}',
    )
    current_rows = {}
    failures = []
    for row in child_rows:
        worker_id = str(row.get('worker_id') or '')
        if (
            str(row.get('run_id') or '') != run_id
            or not worker_id
            or worker_id in current_rows
            or worker_id not in roster
            or row.get('verification_result') not in WORKER_RESULTS
        ):
            failures.append({'worker_id': worker_id or None, 'reason': 'malformed_child_row'})
            continue
        current_rows[worker_id] = row

    participation = resolution.get('biometric_participation', {})
    attendance = resolution.get('existing_attendance', {})
    planned_upserts = []
    preserved_negative_count = 0
    for worker_id in sorted(roster):
        state = participation.get(worker_id, 'unknown')
        existing = attendance.get(worker_id)
        child = current_rows.get(worker_id)
        current_result = child.get('verification_result') if child else None

        if state == 'not_enrolled':
            desired_result = 'not_enrolled_excluded'
            reason = 'explicit_not_enrolled'
        elif state != 'enrolled':
            failures.append({'worker_id': worker_id, 'reason': 'unknown_biometric_participation'})
            continue
        elif is_manual_protected(existing):
            desired_result = 'manual_protected'
            reason = 'manual_protected_attendance'
        elif existing and existing.get('check_in'):
            if current_result in {'attendance_present', 'recovered'}:
                continue
            desired_result = 'attendance_present'
            reason = 'existing_attendance_check_in'
        else:
            if not _valid_preserved_verified_no_event(child):
                failures.append({'worker_id': worker_id, 'reason': 'missing_or_invalid_negative_evidence'})
                continue
            preserved_negative_count += 1
            continue

        if current_result == desired_result:
            continue
        planned_upserts.append({
            'run_id': run_id,
            'worker_id': worker_id,
            'verification_result': desired_result,
            'relevant_query_count': 0,
            'evidence_event_count': 0,
            'verification_details': {
                'reason': reason,
                'queries': [],
                'events': [],
            },
            'verified_at': datetime.now().astimezone().isoformat(),
        })

    if failures:
        return {
            'safe': False,
            'reason': 'completed_child_evidence_inconsistent',
            'failures': failures,
            'planned_upserts': 0,
            'preserved_verified_no_event': preserved_negative_count,
        }

    for payload in planned_upserts:
        client.upsert_attendance_verification_worker(payload)
    return {
        'safe': True,
        'reason': 'completed_child_evidence_reconciled',
        'failures': [],
        'upserted': len(planned_upserts),
        'historical_verified_no_event': _parsed_nonnegative_int(
            run.get('workers_verified_no_event_count')
        ),
        'preserved_verified_no_event': preserved_negative_count,
    }


def _valid_preserved_verified_no_event(row: dict | None) -> bool:
    if not row or row.get('verification_result') != 'verified_no_event':
        return False
    if row.get('evidence_event_count') != 0:
        return False
    try:
        if int(row.get('relevant_query_count') or 0) <= 0:
            return False
    except (TypeError, ValueError):
        return False
    details = row.get('verification_details')
    if not isinstance(details, dict) or details.get('events') != []:
        return False
    queries = details.get('queries')
    if not isinstance(queries, list) or not queries:
        return False
    for query in queries:
        if not isinstance(query, dict) or query.get('state') != 'complete':
            return False
        segments = query.get('segments')
        if not isinstance(segments, list) or not segments:
            return False
        if any(
            not isinstance(segment, dict)
            or segment.get('state') != 'complete'
            or segment.get('pagination_complete') is not True
            for segment in segments
        ):
            return False
    return True


def _parsed_instant(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or '').replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.astimezone()


def _parsed_nonnegative_int(value) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def filter_worker_events(events: list[dict], worker_id: str, resolution: dict, *, start_time) -> list[dict]:
    result = []
    for event in events:
        if biometric_identity_is_ignored(resolution, event):
            continue
        mapping = biometric_mapping_for_event(resolution, event)
        if not mapping or str(mapping.get('worker_id') or '') != worker_id:
            continue
        try:
            event_time = datetime.fromisoformat(str(event.get('time') or '').replace('Z', '+00:00')).timetz().replace(tzinfo=None)
        except ValueError:
            continue
        if event_time >= start_time:
            result.append(event)
    return deduplicate_hikvision_events(result)


def verification_event_evidence(events: list[dict]) -> list[dict]:
    """Retain only non-secret immutable event evidence in the verification audit."""
    return [{
        'device_id': str(event.get('_device_id') or ''),
        'device_employee_no': str(event.get('employeeNoString') or ''),
        'raw_timestamp': str(event.get('time') or ''),
        'serial': str(event.get('serialNo') or event.get('eventSerialNo') or '') or None,
        'major': event.get('major'),
        'minor': event.get('minor'),
        'reason': 'broad_read_miss_recovered',
    } for event in events]


def absence_plans_with_verification(plans: list[dict], verification: dict | None) -> list[dict]:
    """Positive evidence always flows; absence requires durable verified negative evidence."""
    verified = set((verification or {}).get('verified_no_event_worker_ids', []))
    run_complete = (verification or {}).get('status') == 'complete'
    return [
        plan for plan in plans
        if plan.get('proposed_status') != 'absent'
        or plan.get('classification', 'normal') != 'normal'
        or (run_complete and plan.get('worker_id') in verified)
    ]


def _query_targets(targets, resolution, devices, target_date, diagnostics, start_time, max_workers):
    worker_query_keys = defaultdict(set)
    device_targets = {}
    for worker_id in targets:
        for device, identity in worker_identity_queries(worker_id, resolution, devices):
            key = (device.device_id, identity)
            worker_query_keys[worker_id].add(key)
            target = device_targets.setdefault(device.device_id, {'device': device, 'identities': set()})
            target['identities'].add(identity)

    snapshot_now = datetime.now(MONITORING_TIME_ZONE)
    if target_date == snapshot_now.date():
        snapshot_end = snapshot_now.time().replace(tzinfo=None, microsecond=0)
    else:
        snapshot_end = END_OF_DAY

    def query_device(target):
        device = target['device']
        try:
            events, status = hikvision_events_for_device_segmented_verification(
                target_date, diagnostics, device, start_time=start_time, end_time=snapshot_end,
            )
            return device.device_id, events, {
                **status,
                'identity_count': len(target['identities']),
            }
        except Exception as error:
            return device.device_id, [], {
                'device_id': device.device_id, 'state': 'failed', 'attempted': True,
                'error': f'{type(error).__name__}: {error}',
                'verification': 'segmented_device_scan',
                'identity_count': len(target['identities']), 'segments': [],
                'query_start': start_time.strftime('%H:%M:%S'),
                'query_end': snapshot_end.strftime('%H:%M:%S'),
            }

    results = {}
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(device_targets) or 1))) as pool:
        futures = [pool.submit(query_device, target) for target in device_targets.values()]
        for future in as_completed(futures):
            try:
                device_id, events, status = future.result()
                results[device_id] = (events, status)
            except Exception:
                # query_device converts device failures into fail-closed results.
                continue
    return results, worker_query_keys


def run_targeted_verification(
    *, client, target_date: date, devices: list, diagnostics, agent_id: str,
    mode: str = MORNING_VERIFICATION_TYPE, dry_run: bool = False, logger=None,
) -> dict:
    """Verify missing morning arrivals or missing checkouts with bounded reads."""
    schedule = workday_schedule(target_date)
    if schedule is None:
        return {'status': 'complete', 'target_workers': 0, 'reason': 'non_working_day'}
    resolution = load_resolution_data(client, target_date, for_apply=True)
    started_monotonic = time_module.monotonic()
    normal_workers = active_normal_workers(resolution)
    if mode == MORNING_VERIFICATION_TYPE:
        scope = biometric_verification_scope(resolution)
        biometric_in_scope = scope['enrolled']
        non_biometric_excluded = scope['not_enrolled']
        unknown_biometric_status = scope['unknown']
        targets = morning_verification_targets(resolution)
    else:
        # Checkout verification does not define morning-report authority.
        biometric_in_scope = normal_workers
        non_biometric_excluded = {}
        unknown_biometric_status = {}
        targets = checkout_verification_targets(resolution)
    counters = Counter(
        target_workers=len(targets),
        workers_with_existing_check_in=sum(
            1 for worker_id in normal_workers
            if resolution.get('existing_attendance', {}).get(worker_id, {}).get('check_in')
        ),
    )
    counters['workers_expected'] = len(normal_workers)
    counters['active_normal_roster_count'] = len(normal_workers)
    counters['biometric_in_scope_count'] = len(biometric_in_scope)
    counters['non_biometric_excluded_count'] = len(non_biometric_excluded)
    counters['unknown_biometric_status_count'] = len(unknown_biometric_status)
    counters['workers_already_verified'] = counters['workers_with_existing_check_in']
    run = None
    if mode == MORNING_VERIFICATION_TYPE and not dry_run:
        run = client.start_attendance_verification_run({
            'work_date': target_date.isoformat(), 'verification_type': mode, 'status': 'running',
            'started_at': datetime.now().astimezone().isoformat(), 'completed_at': None,
            'agent_id': agent_id, 'target_worker_count': len(targets), 'verified_worker_count': 0,
            'workers_expected_count': len(normal_workers),
            'active_normal_roster_count': len(normal_workers),
            'biometric_in_scope_count': len(biometric_in_scope),
            'non_biometric_excluded_count': len(non_biometric_excluded),
            'unknown_biometric_status_count': len(unknown_biometric_status),
            'workers_with_checkin_count': counters['workers_with_existing_check_in'],
            'workers_verified_no_event_count': 0,
            'recovered_worker_count': 0, 'unresolved_worker_count': 0, 'recovered_event_count': 0,
            'roster_worker_ids': sorted(normal_workers),
            'biometric_in_scope_worker_ids': sorted(biometric_in_scope),
            'non_biometric_excluded_worker_ids': sorted(non_biometric_excluded),
            'unknown_biometric_status_worker_ids': sorted(unknown_biometric_status),
            'device_failure_summary': {},
        })

    persisted, _ = persisted_biometric_events(client, target_date)
    persisted_by_worker = {
        worker_id: filter_worker_events(persisted, worker_id, resolution, start_time=schedule['workday_boundary'])
        for worker_id in targets
    }
    satisfied = {worker_id for worker_id, events in persisted_by_worker.items() if events}
    counters['workers_found_in_persisted_events'] = len(satisfied)

    query_targets = {worker_id: worker for worker_id, worker in targets.items() if worker_id not in satisfied}
    counters['workers_requiring_direct_verification'] = len(query_targets)
    counters['workers_requiring_identity_fallback'] = len(query_targets)
    start_time = schedule['workday_boundary'] if mode == MORNING_VERIFICATION_TYPE else schedule['checkout_start']
    query_results, worker_query_keys = _query_targets(
        query_targets, resolution, devices, target_date, diagnostics, start_time,
        int(os.environ.get('HIKVISION_VERIFICATION_MAX_DEVICE_CONCURRENCY', '2')),
    )
    query_statuses = [status for _, status in query_results.values()]
    counters['device_queries_attempted'] = sum(status.get('attempted', True) for status in query_statuses)
    counters['device_queries_succeeded'] = sum(status.get('state') == 'complete' for status in query_statuses)
    counters['device_queries_timed_out'] = sum(bool(status.get('timed_out')) for status in query_statuses)
    counters['device_queries_failed'] = sum(status.get('state') != 'complete' for status in query_statuses)
    counters['identity_fallback_mapping_count'] = sum(len(keys) for keys in worker_query_keys.values())
    counters['identity_queries_started'] = 0
    counters['identity_queries_completed'] = 0
    counters['identity_queries_failed'] = 0
    counters['verification_device_scans'] = len(query_statuses)
    segments = [segment for status in query_statuses for segment in status.get('segments', [])]
    counters['verification_segments_started'] = len(segments)
    counters['verification_segments_completed'] = sum(segment.get('state') == 'complete' for segment in segments)
    counters['verification_segments_failed'] = sum(segment.get('state') != 'complete' for segment in segments)
    fully_covered_workers = {
        worker_id
        for worker_id, keys in worker_query_keys.items()
        if keys and all(
            device_id in query_results and query_results[device_id][1].get('state') == 'complete'
            for device_id, _ in keys
        )
    }
    direct_events = []
    for device_events, device_status in query_results.values():
        if device_status.get('state') != 'complete':
            continue
        for event in device_events:
            mapping = biometric_mapping_for_event(resolution, event)
            worker_id = str(mapping.get('worker_id') or '') if mapping else ''
            event_key = (str(event.get('_device_id') or ''), str(event.get('employeeNoString') or ''))
            if worker_id in fully_covered_workers and event_key in worker_query_keys.get(worker_id, set()):
                direct_events.append(event)
    direct_events = deduplicate_hikvision_events(direct_events)
    recovered_rows = resolved_biometric_event_rows(direct_events, resolution, target_date)
    if recovered_rows and not dry_run:
        client.insert_biometric_attendance_events(recovered_rows)
    counters['recovered_events'] = len(recovered_rows)
    counters['recovered_event_count'] = len(recovered_rows)
    counters['events_recovered_by_identity_query'] = len(recovered_rows)
    direct_worker_ids = {
        worker_id for worker_id in query_targets
        if filter_worker_events(direct_events, worker_id, resolution, start_time=start_time)
    }
    counters['workers_recovered_by_identity_query'] = len(direct_worker_ids)
    for recovered_event in direct_events:
        mapping = biometric_mapping_for_event(resolution, recovered_event)
        worker = resolution['workers'].get(str(mapping.get('worker_id') or '')) if mapping else None
        if logger and worker:
            logger.info(
                'Recovered biometric event: reason=broad_read_miss_recovered worker_id=%s employee_code=%s device=%s identity=%s timestamp=%s serial=%s',
                worker.get('id'), worker.get('employee_code'), recovered_event.get('_device_id'),
                recovered_event.get('employeeNoString'), recovered_event.get('time'),
                recovered_event.get('serialNo') or recovered_event.get('eventSerialNo'),
            )

    all_positive_events = deduplicate_hikvision_events([
        event for events in persisted_by_worker.values() for event in events
    ] + direct_events)
    apply_results = Counter()
    if all_positive_events and not dry_run:
        plans, _ = plan_attendance(all_positive_events, resolution, target_date)
        positive_plans = [plan for plan in plans if plan.get('proposed_status') in {'half_day', 'present'}]
        apply_results = apply_biometric_attendance(client, positive_plans, resolution['existing_attendance'])
        counters.update({f'attendance_{key}': value for key, value in apply_results.items()})
        counters['attendance_rows_created'] = apply_results.get('inserted', 0)
        counters['attendance_rows_updated'] = apply_results.get('updated', 0)
        counters['attendance_rows_skipped_manual_protected'] = apply_results.get('skipped_manual_protected', 0)
        resolution_after_apply = load_resolution_data(client, target_date, for_apply=True)
    else:
        resolution_after_apply = resolution

    worker_results = []
    failures = []
    for worker_id in targets:
        existing = resolution['existing_attendance'].get(worker_id)
        worker_events = filter_worker_events(all_positive_events, worker_id, resolution, start_time=start_time)
        required_by_device = defaultdict(list)
        for device_id, identity in worker_query_keys.get(worker_id, set()):
            required_by_device[device_id].append(identity)
        statuses = [
            {**query_results[device_id][1], 'identities': sorted(identities)}
            for device_id, identities in required_by_device.items()
            if device_id in query_results
        ]
        current = resolution_after_apply['existing_attendance'].get(worker_id)
        if worker_events and current and current.get('check_in'):
            result = 'manual_protected' if is_manual_protected(current) else 'recovered'
            counters['recovered_worker_count'] += int(result == 'recovered')
        elif worker_events and is_manual_protected(existing):
            # The real event verifies biometric presence, while the authoritative
            # manual row remains completely untouched.
            result = 'manual_protected'
        elif worker_events:
            result = 'unresolved'
            failures.append({
                'worker_id': worker_id,
                'reason': 'attendance_apply_failed',
            })
        elif not worker_query_keys.get(worker_id):
            result = 'unresolved'
            failures.append({'worker_id': worker_id, 'reason': 'no_safe_confirmed_mapping'})
        elif statuses and all(status.get('state') == 'complete' for status in statuses):
            result = 'verified_no_event'
            counters['verified_no_event'] += 1
        else:
            result = 'unresolved'
            failures.append({'worker_id': worker_id, 'reason': 'device_query_incomplete', 'queries': statuses})
        counters['unresolved_worker_count'] += int(result == 'unresolved')
        worker_results.append({
            'worker_id': worker_id, 'verification_result': result,
            'relevant_query_count': len(worker_query_keys.get(worker_id, set())),
            'evidence_event_count': len(worker_events),
            'verification_details': {
                'queries': statuses,
                'events': verification_event_evidence(worker_events),
            },
            'verified_at': datetime.now().astimezone().isoformat(),
        })

    unresolved_in_scope_count = counters['unresolved_worker_count']
    if mode == MORNING_VERIFICATION_TYPE:
        for worker_id in non_biometric_excluded:
            worker_results.append({
                'worker_id': worker_id,
                'verification_result': 'not_enrolled_excluded',
                'relevant_query_count': 0,
                'evidence_event_count': 0,
                'verification_details': {
                    'reason': 'explicit_not_enrolled',
                    'queries': [],
                    'events': [],
                },
                'verified_at': datetime.now().astimezone().isoformat(),
            })
        for worker_id in unknown_biometric_status:
            worker_results.append({
                'worker_id': worker_id,
                'verification_result': 'unresolved',
                'relevant_query_count': 0,
                'evidence_event_count': 0,
                'verification_details': {
                    'reason': 'unknown_biometric_participation',
                    'queries': [],
                    'events': [],
                },
                'verified_at': datetime.now().astimezone().isoformat(),
            })
            failures.append({
                'worker_id': worker_id,
                'reason': 'unknown_biometric_participation',
            })
        counters['unresolved_worker_count'] += len(unknown_biometric_status)

        # A retry must describe the current state of every worker in this run's
        # roster.  In particular, an enrolled worker with an existing check-in
        # is no longer a negative-verification target, but may still have an
        # unresolved child row left by an earlier pass.  Upserting a positive
        # current-state result for the same (run_id, worker_id) supersedes that
        # stale evidence without touching rows from any other run.
        represented_worker_ids = {result['worker_id'] for result in worker_results}
        for worker_id in normal_workers:
            if worker_id in represented_worker_ids:
                continue
            current = resolution_after_apply.get('existing_attendance', {}).get(worker_id)
            if current and current.get('check_in'):
                result = 'manual_protected' if is_manual_protected(current) else 'attendance_present'
                details = {
                    'reason': 'existing_attendance_check_in',
                    'queries': [],
                    'events': [],
                }
            else:
                # The roster partition should make this unreachable.  Fail
                # closed if attendance/scope changes concurrently instead of
                # allowing a complete run with no current child evidence.
                result = 'unresolved'
                details = {
                    'reason': 'verification_state_changed',
                    'queries': [],
                    'events': [],
                }
                failures.append({
                    'worker_id': worker_id,
                    'reason': 'verification_state_changed',
                })
                counters['unresolved_worker_count'] += 1
            worker_results.append({
                'worker_id': worker_id,
                'verification_result': result,
                'relevant_query_count': 0,
                'evidence_event_count': 0,
                'verification_details': details,
                'verified_at': datetime.now().astimezone().isoformat(),
            })

    status = 'complete' if not failures else 'incomplete'
    counters['verified_worker_count'] = len(targets) - unresolved_in_scope_count
    counters['workers_verified_no_event'] = counters['verified_no_event']
    counters['workers_unresolved_due_to_device_failure'] = sum(
        failure.get('reason') == 'device_query_incomplete' for failure in failures
    )
    counters['run_duration_seconds'] = round(time_module.monotonic() - started_monotonic, 3)
    counters['workers_unresolved'] = counters['unresolved_worker_count']
    counters['device_failures'] = counters['device_queries_failed']
    counters['morning_verification_status'] = status if mode == MORNING_VERIFICATION_TYPE else None
    counters['morning_verification_duration'] = counters['run_duration_seconds'] if mode == MORNING_VERIFICATION_TYPE else None
    if mode == MORNING_VERIFICATION_TYPE and not dry_run and run:
        for result in worker_results:
            client.upsert_attendance_verification_worker({**result, 'run_id': run['id']})
        client.update_attendance_verification_run(run['id'], {
            'status': status,
            'completed_at': datetime.now().astimezone().isoformat(), 'agent_id': agent_id,
            'target_worker_count': len(targets), 'verified_worker_count': counters['verified_worker_count'],
            'workers_expected_count': len(normal_workers),
            'active_normal_roster_count': len(normal_workers),
            'biometric_in_scope_count': len(biometric_in_scope),
            'non_biometric_excluded_count': len(non_biometric_excluded),
            'unknown_biometric_status_count': len(unknown_biometric_status),
            'workers_with_checkin_count': counters['workers_with_existing_check_in'],
            'workers_verified_no_event_count': counters['workers_verified_no_event'],
            'recovered_worker_count': counters['recovered_worker_count'],
            'unresolved_worker_count': counters['unresolved_worker_count'],
            'recovered_event_count': counters['recovered_event_count'],
            'roster_worker_ids': sorted(normal_workers),
            'biometric_in_scope_worker_ids': sorted(biometric_in_scope),
            'non_biometric_excluded_worker_ids': sorted(non_biometric_excluded),
            'unknown_biometric_status_worker_ids': sorted(unknown_biometric_status),
            'device_failure_summary': {'failures': failures},
        })
    if logger:
        logger.info('Targeted %s verification: status=%s counters=%s', mode, status, dict(counters))
    return {'status': status, **dict(counters), 'worker_results': worker_results, 'failures': failures}
