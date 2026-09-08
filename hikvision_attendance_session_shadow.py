"""Read-only shadow evaluator for the cross-midnight attendance session model."""

from __future__ import annotations

import argparse
import json
from dataclasses import replace
from datetime import date, datetime, time
from pathlib import Path

import requests

from attendance_business_rules import workday_schedule
from attendance_session_assignment import (
    AttendanceSessionState,
    BiometricSessionEvent,
    SESSION_ASSIGNMENT_ALGORITHM_VERSION,
    assign_biometric_event_to_session,
)
from hikvision_attendance_sync import (
    MONITORING_TIME_ZONE,
    RequestDiagnostics,
    SupabaseReadClient,
    biometric_identity_is_ignored,
    biometric_identity_needs_review,
    biometric_mapping_for_event,
    load_resolution_data,
    parse_event_time,
    persisted_biometric_events,
)
from hikvision_local_config import load_local_hikvision_config, require_local_settings


def _attendance_timestamp(row: dict | None, work_date: date, key: str) -> datetime | None:
    if not row or not row.get(key):
        return None
    metadata = row.get('biometric_sync_metadata') or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}
    metadata_key = 'check_in_event_timestamp' if key == 'check_in' else 'check_out_event_timestamp'
    if metadata.get(metadata_key):
        try:
            return parse_event_time(str(metadata[metadata_key])).astimezone(MONITORING_TIME_ZONE)
        except ValueError:
            pass
    try:
        clock = time.fromisoformat(str(row[key])).replace(tzinfo=None)
    except ValueError:
        return None
    return datetime.combine(work_date, clock, tzinfo=MONITORING_TIME_ZONE)


def _session(row: dict | None, work_date: date) -> AttendanceSessionState | None:
    if not row:
        return None
    schedule = workday_schedule(work_date)
    return AttendanceSessionState(
        work_date=work_date,
        check_in_at=_attendance_timestamp(row, work_date, 'check_in'),
        check_out_at=_attendance_timestamp(row, work_date, 'check_out'),
        attendance_source=str(row.get('attendance_source') or 'manual'),
        manual_override=row.get('manual_override') is True,
        work_authorized=schedule is not None,
        checkout_start=schedule['checkout_start'] if schedule else time(16, 30),
        official_end=schedule['official_end'] if schedule else time(17, 0),
    )


def _old_interpretation(event: BiometricSessionEvent, target_date: date) -> dict:
    schedule = workday_schedule(target_date)
    if schedule is None:
        return {'work_date': None, 'role': 'none', 'reason': 'non_working_day'}
    clock = event.timestamp.timetz().replace(tzinfo=None)
    if clock < schedule['workday_boundary']:
        return {'work_date': None, 'role': 'none', 'reason': 'before_technical_boundary'}
    role = 'check_out_candidate' if clock >= schedule['checkout_start'] else 'check_in_or_intermediate'
    return {'work_date': target_date.isoformat(), 'role': role, 'reason': 'calendar_date_planner'}


def _advance_session(
    session: AttendanceSessionState | None,
    work_date: date,
    event_at: datetime,
    role: str,
) -> AttendanceSessionState:
    schedule = workday_schedule(work_date)
    state = session or AttendanceSessionState(
        work_date=work_date,
        work_authorized=schedule is not None,
        checkout_start=schedule['checkout_start'] if schedule else time(16, 30),
        official_end=schedule['official_end'] if schedule else time(17, 0),
    )
    if role == 'check_in':
        state = replace(state, check_in_at=min(filter(None, (state.check_in_at, event_at))))
    elif role == 'check_out':
        state = replace(state, check_out_at=max(filter(None, (state.check_out_at, event_at))))
    if role in {'check_in', 'check_out', 'intermediate'}:
        state = replace(state, recent_accepted_event_at=event_at)
    return state


def build_shadow_report(client: SupabaseReadClient, target_date: date) -> dict:
    previous_date = target_date.fromordinal(target_date.toordinal() - 1)
    current_resolution = load_resolution_data(client, target_date, for_apply=True)
    previous_resolution = load_resolution_data(client, previous_date, for_apply=True)
    events, _ = persisted_biometric_events(client, target_date)
    sessions: dict[str, dict[str, AttendanceSessionState | None]] = {}
    seen: set[tuple] = set()
    comparisons = []

    for raw in sorted(events, key=lambda item: parse_event_time(item['time'])):
        event = BiometricSessionEvent(
            event_id=str(raw.get('_persisted_event_id') or '') or None,
            timestamp=parse_event_time(raw['time']).astimezone(MONITORING_TIME_ZONE),
            device_id=str(raw.get('_device_id') or ''),
            device_employee_no=str(raw.get('employeeNoString') or ''),
            serial_no=str(raw.get('serialNo')) if raw.get('serialNo') is not None else None,
            major=raw.get('major'), minor=raw.get('minor'),
        )
        mapping = None if biometric_identity_is_ignored(current_resolution, raw) else biometric_mapping_for_event(current_resolution, raw)
        worker_id = str(mapping.get('worker_id') or '') if mapping else None
        worker = current_resolution['workers'].get(worker_id or '') or {}
        if mapping:
            mapping_device = str(mapping.get('device_id') or '').strip() or None
            mapping_state = 'confirmed_exact' if mapping_device else 'confirmed_legacy'
        elif biometric_identity_needs_review(current_resolution, raw):
            mapping_device, mapping_state = None, 'needs_review'
        else:
            mapping_device, mapping_state = None, 'unmapped'

        if worker_id and worker_id not in sessions:
            sessions[worker_id] = {
                'previous': _session(previous_resolution['existing_attendance'].get(worker_id), previous_date),
                'current': _session(current_resolution['existing_attendance'].get(worker_id), target_date),
            }
        state = sessions.get(worker_id or '', {'previous': None, 'current': None})
        schedule = workday_schedule(target_date)
        decision = assign_biometric_event_to_session(
            event=event,
            mapped_worker_id=worker_id,
            mapping_state=mapping_state,
            mapping_device_id=mapping_device,
            previous_session=state['previous'],
            current_session=state['current'],
            current_work_date=target_date,
            current_day_work_authorized=schedule is not None,
            current_checkout_start=schedule['checkout_start'] if schedule else time(16, 30),
            current_official_end=schedule['official_end'] if schedule else time(17, 0),
            seen_event_keys=frozenset(seen),
            device_coverage_complete=False,
        )
        seen.add(event.stable_key())
        if worker_id and decision.assigned_work_date and decision.attendance_role != 'none':
            key = 'previous' if decision.assigned_work_date == previous_date else 'current'
            state[key] = _advance_session(
                state[key], decision.assigned_work_date, event.timestamp, decision.attendance_role,
            )
        comparisons.append({
            'worker_id': worker_id,
            'worker': worker.get('full_name'),
            'employee_code': worker.get('employee_code'),
            'event_id': event.event_id,
            'event_timestamp': event.timestamp.isoformat(),
            'device_id': event.device_id,
            'device_employee_no': event.device_employee_no,
            'serial_no': event.serial_no,
            'old_interpretation': _old_interpretation(event, target_date),
            **decision.to_dict(),
        })

    return {
        'mode': 'cross_midnight_session_shadow',
        'writes_enabled': False,
        'algorithm_version': SESSION_ASSIGNMENT_ALGORITHM_VERSION,
        'target_date': target_date.isoformat(),
        'event_count': len(comparisons),
        'comparison_count': len(comparisons),
        'comparisons': comparisons,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only cross-midnight attendance session shadow evaluation')
    parser.add_argument('--date', required=True, help='Observed event date in YYYY-MM-DD format')
    parser.add_argument('--output', help='Optional local JSON output file')
    args = parser.parse_args()
    try:
        target_date = date.fromisoformat(args.date)
        load_local_hikvision_config()
        require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
        report = build_shadow_report(SupabaseReadClient(RequestDiagnostics(False)), target_date)
    except (RuntimeError, ValueError, requests.RequestException) as error:
        print(json.dumps({'mode': 'cross_midnight_session_shadow', 'error': f'{type(error).__name__}: {error}'}))
        return 1
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(rendered + '\n', encoding='utf-8')
    print(rendered)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
