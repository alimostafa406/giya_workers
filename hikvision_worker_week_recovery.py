"""Admin-triggered recovery of one worker's persisted biometric week evidence.

This never queries a device or invents attendance.  It reuses the production
resolver, planner and protected biometric writer after a worker has been made
operational again.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from threading import Lock
from uuid import UUID

import requests

from hikvision_attendance_sync import (
    RequestDiagnostics,
    SupabaseReadClient,
    apply_biometric_attendance,
    biometric_mapping_for_event,
    load_resolution_data,
    persisted_biometric_events,
    plan_attendance,
    worker_is_operational_on_date,
)


class WorkerWeekRecoveryError(RuntimeError):
    pass


def monday_saturday_dates(week_start_date: str) -> list[date]:
    try:
        monday = date.fromisoformat(str(week_start_date))
    except ValueError as error:
        raise WorkerWeekRecoveryError('Choose a valid Monday date.') from error
    if monday.weekday() != 0:
        raise WorkerWeekRecoveryError('The selected week must start on Monday.')
    return [monday + timedelta(days=offset) for offset in range(6)]


def _attendance_summary(row: dict | None) -> dict:
    row = row or {}
    return {
        'status': row.get('status'),
        'check_in': row.get('check_in'),
        'check_out': row.get('check_out'),
        'manual_override': row.get('manual_override') is True,
        'attendance_source': row.get('attendance_source'),
    }


def _event_summary(event: dict) -> dict:
    return {
        'timestamp': event.get('time'),
        'device_id': event.get('_device_id') or event.get('device_id'),
        'employee_no': str(event.get('employeeNoString') or ''),
        'serial_no': event.get('serialNo') or event.get('eventSerialNo'),
    }


def _mapping_was_established_before_event(mapping: dict, event: dict) -> bool:
    """Fail closed when the current mapping was created after persisted evidence."""
    created_at = mapping.get('created_at')
    event_time = event.get('time')
    if not created_at or not event_time:
        return True
    try:
        return datetime.fromisoformat(str(created_at).replace('Z', '+00:00')) <= datetime.fromisoformat(str(event_time).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return False


def _worker_events(events: list[dict], resolution: dict, worker_id: str) -> tuple[list[dict], list[dict]]:
    safe, skipped = [], []
    for event in events:
        mapping = biometric_mapping_for_event(resolution, event)
        if not mapping or str(mapping.get('worker_id') or '') != worker_id:
            continue
        if not _mapping_was_established_before_event(mapping, event):
            skipped.append({**_event_summary(event), 'reason': 'mapping_established_after_event'})
            continue
        safe.append(event)
    return safe, skipped


def recover_worker_week(worker_id: str, week_start_date: str, *, apply: bool = True) -> dict:
    try:
        worker_id = str(UUID(str(worker_id)))
    except (ValueError, TypeError) as error:
        raise WorkerWeekRecoveryError('Invalid worker.') from error

    dates = monday_saturday_dates(week_start_date)
    client = SupabaseReadClient(RequestDiagnostics(False))
    totals = Counter()
    days = []

    for target_date in dates:
        resolution = load_resolution_data(client, target_date, for_apply=True)
        worker = resolution['workers'].get(worker_id)
        if not worker:
            raise WorkerWeekRecoveryError('Worker was not found.')
        before = resolution['existing_attendance'].get(worker_id)
        day = {
            'date': target_date.isoformat(),
            'before': _attendance_summary(before),
            'evidence': [],
            'after': _attendance_summary(before),
            'result': 'unchanged',
            'warnings': [],
        }
        if not worker_is_operational_on_date(worker, target_date):
            day['result'] = 'skipped'
            day['warnings'].append('before_operational_start_date')
            days.append(day)
            totals['skipped'] += 1
            continue

        events, _ = persisted_biometric_events(client, target_date)
        worker_events, skipped_events = _worker_events(events, resolution, worker_id)
        day['evidence'] = [_event_summary(event) for event in worker_events]
        day['warnings'].extend(item['reason'] for item in skipped_events)
        plans, _ = plan_attendance(worker_events, resolution, target_date)
        plan = next((item for item in plans if str(item.get('worker_id')) == worker_id), None)
        if plan is None:
            day['result'] = 'skipped'
            day['warnings'].append('worker_not_plannable')
            days.append(day)
            totals['skipped'] += 1
            continue
        if apply:
            write_result = apply_biometric_attendance(client, [plan], resolution['existing_attendance'])
            if write_result.get('skipped_manual_protected', 0):
                day['result'] = 'skipped'
                day['warnings'].append('manual_protected')
                totals['manual_protected'] += 1
            elif write_result.get('inserted', 0):
                day['result'] = 'recovered'
                totals['inserted'] += 1
            elif write_result.get('updated', 0):
                day['result'] = 'recovered'
                totals['updated'] += 1
            elif write_result.get('unchanged', 0):
                totals['unchanged'] += 1
            elif write_result.get('errors', 0):
                day['result'] = 'error'
                day['warnings'].append('attendance_write_error')
                totals['errors'] += 1
        refreshed = load_resolution_data(client, target_date, for_apply=True)
        day['after'] = _attendance_summary(refreshed['existing_attendance'].get(worker_id))
        days.append(day)

    return {
        'worker_id': worker_id,
        'week': {'start': dates[0].isoformat(), 'end': dates[-1].isoformat()},
        'days': days,
        'recovered': totals['inserted'] + totals['updated'],
        'unchanged': totals['unchanged'],
        'skipped': totals['skipped'] + totals['manual_protected'],
        'warnings': sum((day['warnings'] for day in days), []),
        'completed': totals['errors'] == 0,
    }


class WorkerWeekAttendanceRecovery:
    """Reject concurrent recoveries while retaining idempotent replays."""

    def __init__(self):
        self._lock = Lock()

    def recover(self, worker_id: str, week_start_date: str) -> dict:
        if not self._lock.acquire(blocking=False):
            raise WorkerWeekRecoveryError('Another worker week recovery is already running.')
        try:
            return recover_worker_week(worker_id, week_start_date, apply=True)
        finally:
            self._lock.release()
