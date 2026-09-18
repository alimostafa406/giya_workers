"""Admin-triggered, bounded Monday-Saturday biometric attendance review.

This orchestration deliberately reuses the production attendance reader,
resolver, planner and protected write path.  It is exposed only by the
loopback dashboard server; credentials and device access remain local.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from threading import Lock

import requests

from attendance_business_rules import workday_schedule
from hikvision_attendance_sync import (
    RequestDiagnostics,
    SupabaseReadClient,
    apply_biometric_attendance,
    attendance_apply_blocked_reason,
    biometric_identity_is_ignored,
    biometric_identity_needs_review,
    biometric_mapping_for_event,
    configured_devices,
    hikvision_events_with_devices,
    load_local_hikvision_config,
    load_resolution_data,
    local_now,
    plan_attendance,
    require_local_settings,
    resolved_biometric_event_rows,
)


class WeeklyAttendanceReviewError(RuntimeError):
    pass


def monday_saturday_dates(start_date: str, end_date: str) -> list[date]:
    try:
        start = date.fromisoformat(str(start_date))
        end = date.fromisoformat(str(end_date))
    except ValueError as error:
        raise WeeklyAttendanceReviewError('Invalid weekly attendance date range.') from error
    if start.weekday() != 0 or end.weekday() != 5 or end - start != timedelta(days=5):
        raise WeeklyAttendanceReviewError('The review range must be one Monday-Saturday week.')
    return [start + timedelta(days=offset) for offset in range(6)]


def _active_normal_worker_ids(resolution: dict) -> set[str]:
    return {
        worker_id
        for worker_id, worker in resolution['workers'].items()
        if worker.get('is_active') is True
        and resolution['classifications'].get(worker_id, 'normal') == 'normal'
    }


def _unmatched_events(events: list[dict], resolution: dict) -> list[dict]:
    rows = []
    for event in events:
        mapping = biometric_mapping_for_event(resolution, event)
        worker = resolution['workers'].get(str(mapping.get('worker_id') or '')) if mapping else None
        if mapping and worker and worker.get('is_active') is True:
            continue
        if biometric_identity_is_ignored(resolution, event):
            reason = 'ignored_identity_review'
        elif biometric_identity_needs_review(resolution, event):
            reason = 'mapping_needs_review'
        elif mapping and worker and worker.get('is_active') is not True:
            reason = 'inactive_worker'
        else:
            reason = 'unmapped_identity'
        rows.append({
            'employeeNoString': str(event.get('employeeNoString') or ''),
            'device': str(event.get('_device_id') or ''),
            'timestamp': event.get('time'),
            'serialNo': event.get('serialNo') or event.get('eventSerialNo'),
            'reason': reason,
        })
    return rows


def _finalize_current_saturday(plans: list[dict], target_date: date) -> None:
    schedule = workday_schedule(target_date)
    if not schedule or schedule['label'] != 'saturday' or target_date != local_now().date():
        return
    for plan in plans:
        if plan.get('proposed_status') == 'pending' and not plan.get('check_in'):
            plan['proposed_status'] = 'absent'
            plan['day_fraction'] = 0.0


def _stored_status_counts(resolution: dict, worker_ids: set[str]) -> dict:
    counts = Counter()
    for worker_id in worker_ids:
        row = resolution['existing_attendance'].get(worker_id)
        if row:
            counts[str(row.get('status') or 'other')] += 1
    return {key: counts.get(key, 0) for key in ('present', 'half_day', 'absent')}


def review_week_attendance(start_date: str, end_date: str) -> dict:
    review_dates = monday_saturday_dates(start_date, end_date)
    load_local_hikvision_config()
    require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
    configured_devices()
    diagnostics = RequestDiagnostics(False)
    client = SupabaseReadClient(diagnostics)
    overall = Counter()
    per_day = []
    unmatched = []
    errors = []
    evaluated_workers: set[str] = set()

    for target_date in review_dates:
        day = {
            'date': target_date.isoformat(),
            'present': 0,
            'half_day': 0,
            'absent': 0,
            'inserted': 0,
            'updated': 0,
            'unchanged': 0,
            'manual_protected_skipped': 0,
            'events_processed': 0,
            'device_reads': {},
            'errors': [],
        }
        try:
            events, device_reads = hikvision_events_with_devices(
                target_date, diagnostics, include_next_day_tail=True,
            )
            day['events_processed'] = len(events)
            day['device_reads'] = device_reads
            overall['events_processed'] += len(events)
            resolution = load_resolution_data(client, target_date, for_apply=True)
            worker_ids = _active_normal_worker_ids(resolution)
            evaluated_workers.update(worker_ids)
            day_unmatched = _unmatched_events(events, resolution)
            unmatched.extend({**row, 'date': target_date.isoformat()} for row in day_unmatched)
            blocked_reason = attendance_apply_blocked_reason(device_reads)
            if blocked_reason:
                day['errors'].append(blocked_reason)
                errors.append({'date': target_date.isoformat(), 'error': blocked_reason})
                per_day.append(day)
                continue

            client.insert_biometric_attendance_events(
                resolved_biometric_event_rows(events, resolution, target_date)
            )
            plans, _ = plan_attendance(events, resolution, target_date)
            plans = [plan for plan in plans if plan['worker_id'] in worker_ids]
            _finalize_current_saturday(plans, target_date)
            write_results = apply_biometric_attendance(
                client, plans, resolution['existing_attendance'],
            )
            day['inserted'] = write_results.get('inserted', 0)
            day['updated'] = write_results.get('updated', 0)
            day['unchanged'] = write_results.get('unchanged', 0)
            day['manual_protected_skipped'] = write_results.get('skipped_manual_protected', 0)
            for key in ('inserted', 'updated', 'unchanged', 'skipped_manual_protected'):
                overall[key] += write_results.get(key, 0)
            write_errors = sum(
                value for key, value in write_results.items()
                if key in {'errors', 'structural_supabase_error', 'aborted_structural_error'}
            )
            if write_errors:
                message = f'{write_errors} attendance write error(s)'
                day['errors'].append(message)
                errors.append({'date': target_date.isoformat(), 'error': message})

            refreshed = load_resolution_data(client, target_date, for_apply=True)
            day.update(_stored_status_counts(refreshed, worker_ids))
        except (RuntimeError, requests.RequestException, ValueError) as error:
            message = f'{type(error).__name__}: {error}'
            day['errors'].append(message)
            errors.append({'date': target_date.isoformat(), 'error': message})
        per_day.append(day)

    return {
        'selected_week': {'start': start_date, 'end': end_date},
        'workers_evaluated': len(evaluated_workers),
        'workdays_evaluated': len(review_dates),
        'biometric_events_processed': overall['events_processed'],
        'attendance_rows_inserted': overall['inserted'],
        'attendance_rows_updated': overall['updated'],
        'attendance_rows_unchanged': overall['unchanged'],
        'manual_protected_rows_skipped': overall['skipped_manual_protected'],
        'unmatched_biometric_identities': unmatched,
        'errors': errors,
        'per_day': per_day,
        'completed': not errors,
    }


class WeeklyAttendanceReviewer:
    """Reject overlapping requests while allowing later idempotent reviews."""

    def __init__(self) -> None:
        self._lock = Lock()

    def review(self, start_date: str, end_date: str) -> dict:
        if not self._lock.acquire(blocking=False):
            raise WeeklyAttendanceReviewError('A weekly biometric review is already running.')
        try:
            return review_week_attendance(start_date, end_date)
        finally:
            self._lock.release()
