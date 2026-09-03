"""Local, read-only Hikvision attendance sync planner.

This first production-safe stage is deliberately DRY RUN ONLY: it reads device
events and Supabase data, prints proposed attendance rows, and never writes.
It must run on the office laptop/network, never on Vercel.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time as time_module
from urllib.parse import urlparse
from collections import Counter, defaultdict
from datetime import date as date_type
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from hikvision_http import HIKVISION_REQUEST_TIMEOUT, HikvisionReadClient
from hikvision_device_lock import HikvisionDeviceOperationLock
from hikvision_devices import configured_devices
from hikvision_local_config import load_local_hikvision_config, require_local_settings
from attendance_business_rules import (
    END_OF_DAY,
    OFFICIAL_START,
    VALID_ATTENDANCE_MAJOR,
    VALID_ATTENDANCE_MINOR,
    workday_schedule,
)


ON_TIME_CHECKIN_END = OFFICIAL_START
HIKVISION_EVENT_BATCH_SIZE = 30
HIKVISION_SUCCESSFUL_PAGE_DELAY_SECONDS = 0.2
HIKVISION_EVENT_WINDOWS = (
    (time(0, 0), time(6, 59, 59)),
    (time(7, 0), time(9, 59, 59)),
    (time(10, 0), time(12, 59, 59)),
    (time(13, 0), time(15, 59, 59)),
    (time(16, 0), time(18, 59, 59)),
    (time(19, 0), time(21, 59, 59)),
    (time(22, 0), time(23, 59, 59)),
)
try:
    MONITORING_TIME_ZONE = ZoneInfo('Africa/Kinshasa')
except ZoneInfoNotFoundError:
    # Windows Python installations without the optional tzdata package still
    # need a safe Kinshasa zone. Kinshasa has no DST and remains UTC+01:00.
    MONITORING_TIME_ZONE = timezone(timedelta(hours=1), name='Africa/Kinshasa')


class RequestDiagnostics:
    """Safe request diagnostics: endpoint host only, never query/body/headers."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled

    def start(self, system: str, target: str, method: str, host: str) -> None:
        if self.enabled:
            print(f'[{system}] {target}... {method} {host}')

    def success(self, system: str, status: int) -> None:
        if self.enabled:
            print(f'[{system}] HTTP {status}')

    def failure(self, system: str, target: str, method: str, host: str, error: Exception) -> None:
        response = getattr(error, 'response', None)
        status = f' | HTTP {response.status_code}' if response is not None else ''
        print(
            f'[{system}] FAILED | target={target} | method={method} | host={host}'
            f'{status} | error={type(error).__name__}: {error}',
            file=sys.stderr,
        )


def require_env(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'Missing required local environment variable: {name}')
    return value


def local_now() -> datetime:
    return datetime.now().astimezone()


def parse_event_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def parse_monitoring_event_time(value: str) -> datetime:
    """Use the terminal's displayed wall-clock time for monitoring only.

    Some terminals label their otherwise-correct local clock with an incorrect
    UTC offset. Official attendance keeps using ``parse_event_time`` unchanged.
    Monitoring stores the displayed clock explicitly as Kinshasa local time.
    """
    raw_timestamp = parse_event_time(value)
    return raw_timestamp.replace(tzinfo=None).replace(tzinfo=MONITORING_TIME_ZONE)


def attendance_time_value(value: datetime | None) -> str | None:
    """Convert a Hikvision timestamp to public.attendance time-without-time-zone."""
    if value is None:
        return None
    return value.timetz().replace(tzinfo=None).strftime('%H:%M:%S')


def event_date(event: dict) -> date_type | None:
    try:
        return parse_event_time(str(event.get('time') or '')).date()
    except ValueError:
        return None


def _filtered_device_events(events: list[dict], target_date: date_type, device) -> list[dict]:
    return [{**event, '_device_id': device.device_id, '_device_ip': device.ip} for event in events if (
        event.get('major') == 5
        and event.get('minor') == 75
        and str(event.get('employeeNoString') or '').strip()
        and event_date(event) == target_date
    )]


def _query_timestamp(target_date: date_type, value: time) -> str:
    return f'{target_date.isoformat()}T{value.strftime("%H:%M:%S")}+01:00'


def hikvision_event_identity(event: dict) -> tuple:
    """Stable per-device identity for merging overlapping/retried event responses."""
    serial = event.get('serialNo') or event.get('eventSerialNo')
    device_id = str(event.get('_device_id') or event.get('device_id') or '')
    if serial is not None and str(serial).strip():
        return ('serial', device_id, str(serial).strip())
    return (
        'event', device_id, str(event.get('employeeNoString') or event.get('employeeNo') or '').strip(),
        str(event.get('time') or ''), event.get('major'), event.get('minor'),
        event.get('cardReaderNo'), event.get('doorNo'),
    )


def deduplicate_hikvision_events(events: list[dict]) -> list[dict]:
    unique: dict[tuple, dict] = {}
    for event in events:
        unique.setdefault(hikvision_event_identity(event), event)
    return list(unique.values())


def resolved_biometric_event_rows(events: list[dict], resolution: dict, target_date: date_type) -> list[dict]:
    """Build append-only monitoring rows without changing attendance planning.

    Every non-ignored device identity is retained. A confirmed active worker is
    attached when available; unmapped observations deliberately keep worker_id
    null. This data is observation-only and is not used by ``plan_attendance``.
    """
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    confirmed = resolution.get('confirmed', {})
    workers = resolution.get('workers', {})

    for event in deduplicate_hikvision_events(events):
        employee_no = str(event.get('employeeNoString') or '').strip()
        if not employee_no or biometric_identity_is_ignored(resolution, event):
            continue
        mapping = biometric_mapping_for_event(resolution, event)
        worker = workers.get(str(mapping.get('worker_id') or '')) if mapping else None
        worker_id = str(worker['id']) if worker and worker.get('is_active') is not False else None
        try:
            event_timestamp = parse_monitoring_event_time(str(event.get('time') or ''))
        except ValueError:
            continue
        if event_timestamp.date() != target_date:
            continue
        device_id = str(event.get('_device_id') or event.get('device_id') or '').strip()
        if not device_id:
            continue
        event_identity = json.dumps(hikvision_event_identity(event), separators=(',', ':'), default=str)
        unique_key = (device_id, event_identity)
        if unique_key in seen:
            continue
        seen.add(unique_key)
        rows.append({
            'worker_id': worker_id,
            'device_employee_no': employee_no,
            'device_name': str(event.get('name') or '').strip() or None,
            'attendance_date': target_date.isoformat(),
            'event_timestamp': event_timestamp.isoformat(),
            'device_id': device_id,
            'event_identity': event_identity,
        })

    return sorted(rows, key=lambda row: (row['event_timestamp'], row['device_id'], row['event_identity']))


def monitoring_timestamp_repairs(rows: list[dict], existing_rows: list[dict]) -> list[dict]:
    """Return minimal timestamp-only repairs keyed by immutable device event identity."""
    existing_by_key = {
        (str(row.get('device_id') or ''), str(row.get('event_identity') or '')): row
        for row in existing_rows
        if row.get('id')
    }
    repairs: list[dict] = []
    for row in rows:
        existing = existing_by_key.get((row['device_id'], row['event_identity']))
        if existing and str(existing.get('event_timestamp') or '') != row['event_timestamp']:
            repairs.append({'id': str(existing['id']), 'event_timestamp': row['event_timestamp']})
    return repairs


def persisted_biometric_events(client, target_date: date_type) -> tuple[list[dict], list[dict]]:
    """Reconstruct attendance inputs only from durable device-event observations."""
    rows = client.read(
        'biometric_attendance_events',
        'id,attendance_date,event_timestamp,device_id,device_employee_no,device_name,event_identity',
        attendance_date=f'eq.{target_date.isoformat()}',
    )
    events: list[dict] = []
    valid_rows: list[dict] = []
    for row in rows:
        device_id = str(row.get('device_id') or '').strip()
        employee_no = str(row.get('device_employee_no') or '').strip()
        event_identity = str(row.get('event_identity') or '')
        try:
            timestamp = parse_event_time(str(row.get('event_timestamp') or '')).astimezone(MONITORING_TIME_ZONE)
            identity_parts = json.loads(event_identity)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not device_id or not employee_no or timestamp.date() != target_date or not isinstance(identity_parts, list):
            continue
        serial = identity_parts[2] if len(identity_parts) >= 3 and identity_parts[0] == 'serial' else None
        events.append({
            'major': 5,
            'minor': 75,
            'employeeNoString': employee_no,
            'serialNo': serial,
            'time': timestamp.isoformat(),
            'name': row.get('device_name'),
            '_device_id': device_id,
            '_persisted_event_id': row.get('id'),
        })
        valid_rows.append(row)
    return deduplicate_hikvision_events(events), valid_rows


def hikvision_events_for_device(
    target_date: date_type,
    diagnostics: RequestDiagnostics,
    device,
    *,
    return_status: bool = False,
    start_time: time | None = None,
    end_time: time | None = None,
    search_suffix: str = '',
) -> list[dict] | tuple[list[dict], dict]:
    hikvision = HikvisionReadClient(device.ip, device.username, device.password, device.device_id)
    url = hikvision.url('/ISAPI/AccessControl/AcsEvent?format=json')
    host = urlparse(url).hostname or hikvision.device_ip
    events: list[dict] = []
    position = 0
    successful_batches = 0
    read_error: Exception | None = None
    failed_position: int | None = None
    start_time = start_time or time(0, 0)
    end_time = end_time or END_OF_DAY
    try:
        while True:
            payload = {'AcsEventCond': {
                'searchID': f'attendance-{target_date.isoformat()}{search_suffix}',
                'searchResultPosition': position,
                'maxResults': HIKVISION_EVENT_BATCH_SIZE,
                'major': 0,
                'minor': 0,
                'startTime': _query_timestamp(target_date, start_time),
                'endTime': _query_timestamp(target_date, end_time),
            }}
            target = f'event search (batch position {position})'
            diagnostics.start('HIKVISION', target, 'POST', host)
            try:
                response = hikvision.request('POST', url, json=payload, timeout=HIKVISION_REQUEST_TIMEOUT)
                # A first-request 401 remains an authentication failure. A 401
                # after earlier 200 batches can be a stale device Digest nonce;
                # refresh once and retry this exact page without restarting.
                if response.status_code == 401 and successful_batches > 0:
                    print(f'[HIKVISION] stale Digest suspected at batch position {position}; refreshing once', file=sys.stderr)
                    hikvision.refresh_digest_session()
                    response = hikvision.request('POST', url, json=payload, timeout=HIKVISION_REQUEST_TIMEOUT)
                response.raise_for_status()
            except requests.RequestException as error:
                diagnostics.failure('HIKVISION', target, 'POST', host, error)
                read_error = error
                failed_position = position
                break
            diagnostics.success('HIKVISION', response.status_code)
            successful_batches += 1
            try:
                acs = response.json().get('AcsEvent', {})
            except ValueError as error:
                diagnostics.failure('HIKVISION', target, 'POST', host, error)
                read_error = RuntimeError(f'Hikvision returned invalid JSON for {target}')
                failed_position = position
                break
            batch = acs.get('InfoList') or []
            if isinstance(batch, dict):
                batch = [batch]
            events.extend(batch)
            if acs.get('responseStatusStrg') != 'MORE' or not batch:
                break
            position += len(batch)
            time_module.sleep(HIKVISION_SUCCESSFUL_PAGE_DELAY_SECONDS)
    finally:
        hikvision.close()

    filtered_events = _filtered_device_events(events, target_date, device)
    if read_error is None:
        state = 'complete'
        error_message = None
    elif events:
        state = 'partial'
        error_message = f'{type(read_error).__name__}: {read_error}'
        print(
            f'[HIKVISION] {device.device_id} attendance read is partial; '
            f'preserving {len(filtered_events)} fetched events.',
            file=sys.stderr,
        )
    else:
        state = 'failed'
        error_message = f'{type(read_error).__name__}: {read_error}'

    timed_out = isinstance(read_error, requests.Timeout)
    if timed_out:
        print(
            f'[HIKVISION] device={device.device_id} ip={device.ip} attendance read timed out; '
            f'state={state} fetched_events={len(filtered_events)} error={error_message}',
            file=sys.stderr,
        )

    status = {
        'device_id': device.device_id,
        'state': state,
        'event_count': len(filtered_events),
        'error': error_message,
        'failed_position': failed_position,
        'timed_out': timed_out,
        'query_start': start_time.strftime('%H:%M:%S'),
        'query_end': end_time.strftime('%H:%M:%S'),
    }
    return (filtered_events, status) if return_status else filtered_events


def hikvision_events_for_device_segmented_recovery(
    target_date: date_type,
    diagnostics: RequestDiagnostics,
    device,
    preserved_events: list[dict],
) -> tuple[list[dict], dict]:
    """Recover a failed deep daily search with independent, shallow time windows."""
    print(f'[HIKVISION] {device.device_id} segmented recovery started', file=sys.stderr)
    all_events = list(preserved_events)
    segments = []
    for index, (start_time, end_time) in enumerate(HIKVISION_EVENT_WINDOWS):
        segment_events, status = hikvision_events_for_device(
            target_date,
            diagnostics,
            device,
            return_status=True,
            start_time=start_time,
            end_time=end_time,
            search_suffix=f'-segment-{index}',
        )
        all_events.extend(segment_events)
        segments.append(status)

    merged_events = deduplicate_hikvision_events(all_events)
    incomplete_segments = [segment for segment in segments if segment['state'] != 'complete']
    if not incomplete_segments:
        print(
            f'[HIKVISION] {device.device_id} segmented recovery complete: {len(merged_events)} events',
            file=sys.stderr,
        )
        return merged_events, {
            'device_id': device.device_id,
            'state': 'complete',
            'event_count': len(merged_events),
            'error': None,
            'recovery': 'segmented',
            'segments': segments,
        }

    error_details = ', '.join(
        f"{segment['query_start']}-{segment['query_end']}={segment['state']}"
        for segment in incomplete_segments
    )
    print(
        f'[HIKVISION] {device.device_id} segmented recovery incomplete: {error_details}',
        file=sys.stderr,
    )
    return merged_events, {
        'device_id': device.device_id,
        'state': 'partial' if merged_events else 'failed',
        'event_count': len(merged_events),
        'error': f'segmented recovery incomplete: {error_details}',
        'recovery': 'segmented',
        'segments': segments,
    }


def hikvision_events_for_device_with_recovery(target_date: date_type, diagnostics: RequestDiagnostics, device) -> tuple[list[dict], dict]:
    # Keep the normal read and its possible segmented recovery together.  A
    # Helper request must not start a competing pagination midway through this
    # device operation, while the other configured device remains independent.
    with HikvisionDeviceOperationLock(device.device_id, 'event search'):
        events, status = hikvision_events_for_device(target_date, diagnostics, device, return_status=True)
        if status['state'] == 'complete':
            return events, status
        # A socket timeout is already retried by HikvisionReadClient. Repeating
        # seven segmented reads against the same unresponsive device can delay
        # the agent for many minutes without adding trustworthy observations.
        if status.get('timed_out'):
            return events, status
        failed_position = status.get('failed_position')
        if failed_position is not None:
            print(
                f'[HIKVISION] {device.device_id} normal read {status["state"]} at position {failed_position}',
                file=sys.stderr,
            )
        return hikvision_events_for_device_segmented_recovery(target_date, diagnostics, device, events)


def incomplete_device_reads(device_reads: dict[str, dict]) -> dict[str, dict]:
    return {
        device_id: result
        for device_id, result in device_reads.items()
        if result.get('state') != 'complete'
    }


def attendance_apply_blocked_reason(device_reads: dict[str, dict]) -> str | None:
    incomplete = incomplete_device_reads(device_reads)
    if not incomplete:
        return None
    details = ', '.join(
        f"{device_id}={result.get('state', 'failed')}"
        for device_id, result in sorted(incomplete.items())
    )
    return f'Attendance apply blocked: incomplete Hikvision device read ({details}).'


def hikvision_events_with_devices(target_date: date_type, diagnostics: RequestDiagnostics) -> tuple[list[dict], dict[str, dict]]:
    events: list[dict] = []
    device_reads: dict[str, dict] = {}
    for device in configured_devices():
        try:
            device_events, read_status = hikvision_events_for_device_with_recovery(target_date, diagnostics, device)
            events.extend(device_events)
            device_reads[device.device_id] = read_status
        except (RuntimeError, requests.RequestException, ValueError) as error:
            print(
                f'[HIKVISION] device={device.device_id} ip={device.ip} attendance read failed: '
                f'{type(error).__name__}: {error}',
                file=sys.stderr,
            )
            device_reads[device.device_id] = {
                'device_id': device.device_id,
                'state': 'failed',
                'event_count': 0,
                'error': f'{type(error).__name__}: {error}',
            }
    return events, device_reads


def hikvision_events(target_date: date_type, diagnostics: RequestDiagnostics) -> list[dict]:
    """Compatibility wrapper for helper/CLI callers; multi-device failures are non-fatal."""
    return hikvision_events_with_devices(target_date, diagnostics)[0]


class SupabaseReadClient:
    def __init__(self, diagnostics: RequestDiagnostics) -> None:
        self.base_url = require_env('SUPABASE_URL').rstrip('/')
        self.host = urlparse(self.base_url).hostname or 'supabase'
        self.diagnostics = diagnostics
        self.headers = {
            'apikey': require_env('SUPABASE_SERVICE_ROLE_KEY'),
            'Authorization': f'Bearer {require_env("SUPABASE_SERVICE_ROLE_KEY")}',
        }

    def read(self, table: str, select: str, **filters: str) -> list[dict]:
        target = f'reading {table}'
        self.diagnostics.start('SUPABASE', target, 'GET', self.host)
        try:
            response = requests.get(
                f'{self.base_url}/rest/v1/{table}',
                headers=self.headers,
                params={'select': select, **filters},
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'GET', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)
        try:
            data = response.json()
        except ValueError as error:
            self.diagnostics.failure('SUPABASE', target, 'GET', self.host, error)
            raise RuntimeError(f'Supabase returned invalid JSON for {target}') from error
        return data if isinstance(data, list) else []

    def insert_attendance(self, payload: dict) -> dict:
        """Apply-only operation. This method is never called by dry run."""
        target = 'inserting biometric attendance'
        self.diagnostics.start('SUPABASE', target, 'POST', self.host)
        try:
            response = requests.post(
                f'{self.base_url}/rest/v1/attendance',
                headers={**self.headers, 'Prefer': 'return=representation'},
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'POST', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)
        data = response.json()
        return data[0] if isinstance(data, list) and data else data

    def update_attendance(self, attendance_id: str, payload: dict) -> dict:
        """Apply-only operation. This method is never called by dry run."""
        target = 'updating biometric attendance'
        self.diagnostics.start('SUPABASE', target, 'PATCH', self.host)
        try:
            response = requests.patch(
                f'{self.base_url}/rest/v1/attendance',
                headers={**self.headers, 'Prefer': 'return=representation'},
                params={'id': f'eq.{attendance_id}'},
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'PATCH', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)
        data = response.json()
        return data[0] if isinstance(data, list) and data else data

    def update_attendance_if_unchanged(self, existing: dict, payload: dict) -> dict | None:
        """Atomically update only the exact unprotected biometric row reconciled."""
        target = 'updating unchanged biometric attendance'
        self.diagnostics.start('SUPABASE', target, 'PATCH', self.host)
        params = {
            'id': f"eq.{existing['id']}",
            'attendance_source': 'eq.biometric',
            'manual_override': 'eq.false',
            'check_in': f"eq.{existing['check_in']}",
            'check_out': 'is.null' if existing.get('check_out') is None else f"eq.{existing['check_out']}",
        }
        if existing.get('updated_at'):
            params['updated_at'] = f"eq.{existing['updated_at']}"
        try:
            response = requests.patch(
                f'{self.base_url}/rest/v1/attendance',
                headers={**self.headers, 'Prefer': 'return=representation'},
                params=params,
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'PATCH', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)
        data = response.json()
        return data[0] if isinstance(data, list) and data else None

    def upsert_agent_status(self, payload: dict) -> dict:
        """Write a non-sensitive local-agent heartbeat; never used for attendance."""
        target = 'upserting attendance agent status'
        self.diagnostics.start('SUPABASE', target, 'POST', self.host)
        try:
            response = requests.post(
                f'{self.base_url}/rest/v1/attendance_agent_status',
                headers={
                    **self.headers,
                    'Prefer': 'resolution=merge-duplicates,return=representation',
                },
                params={'on_conflict': 'agent_id'},
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'POST', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)
        data = response.json()
        return data[0] if isinstance(data, list) and data else data

    def upsert_agent_device_statuses(self, agent_id: str, statuses: dict) -> None:
        for device_id, status in statuses.items():
            self.upsert('attendance_agent_device_status', {
                'agent_id': agent_id, 'device_id': device_id,
                'hikvision_reachable': status['reachable'],
                'last_successful_read_at': status['last_successful_read_at'],
                'last_error': status['last_error'],
                'last_seen_at': local_now().isoformat(),
            }, 'agent_id,device_id')

    def upsert(self, table: str, payload: dict, conflict: str) -> dict:
        response = requests.post(f'{self.base_url}/rest/v1/{table}', headers={**self.headers, 'Prefer': 'resolution=merge-duplicates,return=representation'}, params={'on_conflict': conflict}, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()

    def insert_biometric_attendance_events(self, rows: list[dict]) -> None:
        """Append observed events once; duplicate device events are ignored."""
        if not rows:
            return
        target = f'inserting observed biometric events ({len(rows)})'
        self.diagnostics.start('SUPABASE', target, 'POST', self.host)
        try:
            response = requests.post(
                f'{self.base_url}/rest/v1/biometric_attendance_events',
                headers={**self.headers, 'Prefer': 'resolution=ignore-duplicates,return=minimal'},
                params={'on_conflict': 'device_id,event_identity'},
                json=rows,
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'POST', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)

    def read_biometric_attendance_events_by_identity(self, rows: list[dict]) -> list[dict]:
        """Read only existing monitoring rows matching supplied stable event identities."""
        existing: list[dict] = []
        for row in rows:
            existing.extend(self.read(
                'biometric_attendance_events',
                'id,device_id,event_identity,event_timestamp',
                device_id=f"eq.{row['device_id']}",
                event_identity=f"eq.{row['event_identity']}",
            ))
        return existing

    def update_biometric_attendance_event_timestamp(self, event_id: str, event_timestamp: str) -> None:
        """Repair a monitoring timestamp only; attendance is never touched."""
        target = 'repairing observed biometric event timestamp'
        self.diagnostics.start('SUPABASE', target, 'PATCH', self.host)
        try:
            response = requests.patch(
                f'{self.base_url}/rest/v1/biometric_attendance_events',
                headers={**self.headers, 'Prefer': 'return=minimal'},
                params={'id': f'eq.{event_id}'},
                json={'event_timestamp': event_timestamp},
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'PATCH', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)

    def reactivate_worker_from_persisted_biometric_event(self, device_id: str, event_identity: str) -> dict:
        """Ask the database to verify one persisted event and reactivate its unique confirmed owner."""
        target = 'reactivating worker from persisted biometric event'
        self.diagnostics.start('SUPABASE', target, 'POST', self.host)
        try:
            response = requests.post(
                f'{self.base_url}/rest/v1/rpc/reactivate_worker_from_biometric_event',
                headers={**self.headers, 'Prefer': 'return=representation'},
                json={'p_device_id': device_id, 'p_event_identity': event_identity},
                timeout=30,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            self.diagnostics.failure('SUPABASE', target, 'POST', self.host, error)
            raise
        self.diagnostics.success('SUPABASE', response.status_code)
        data = response.json()
        return data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else {}


def load_resolution_data(client: SupabaseReadClient, target_date: date_type, for_apply: bool = False) -> dict:
    active_mappings = client.read(
        'biometric_worker_mapping',
        'worker_id,device_id,device_employee_no,is_active,mapping_review_state',
        is_active='eq.true',
    )
    workers = client.read('workers', 'id,full_name,is_active,team_id')
    classifications = client.read('worker_staff_classification', 'worker_id,classification')
    ignored_identity_rows = client.read('biometric_device_identity_review', 'device_id,device_employee_no,review_state', review_state='eq.ignored')
    attendance_select = 'id,worker_id,attendance_date,status,check_in,check_out,note,recorded_by'
    if for_apply:
        # Apply requires attendance_biometric_workflow_upgrade.sql to have been
        # approved and executed by the administrator first.
        attendance_select += ',attendance_source,manual_override,biometric_sync_key,biometric_sync_metadata,attendance_day_fraction,updated_at'
    existing_attendance = client.read(
        'attendance',
        attendance_select,
        attendance_date=f'eq.{target_date.isoformat()}',
    )
    workers_by_id = {str(worker['id']): worker for worker in workers if worker.get('id')}
    classifications_by_worker = {str(item['worker_id']): item.get('classification', 'normal') for item in classifications if item.get('worker_id')}
    confirmed: dict[tuple[str | None, str], dict] = {}
    unconfirmed_device_numbers: set[tuple[str | None, str]] = set()
    for mapping in active_mappings:
        employee_no = str(mapping.get('device_employee_no') or '').strip()
        if not employee_no:
            continue
        mapping_key = (str(mapping.get('device_id') or '').strip() or None, employee_no)
        if mapping.get('mapping_review_state') == 'confirmed':
            confirmed[mapping_key] = mapping
        else:
            unconfirmed_device_numbers.add(mapping_key)
    return {
        'confirmed': confirmed,
        'unconfirmed': unconfirmed_device_numbers,
        'ignored': {
            (str(row.get('device_id') or '').strip() or None, str(row.get('device_employee_no') or '').strip())
            for row in ignored_identity_rows
        },
        'workers': workers_by_id,
        'classifications': classifications_by_worker,
        'existing_attendance': {
            str(row['worker_id']): row
            for row in existing_attendance
            if row.get('worker_id')
        },
    }


def auto_reactivate_inactive_workers(client: SupabaseReadClient, persisted_rows: list[dict], resolution: dict) -> Counter:
    """Reactivate only inactive owners backed by persisted, confirmed biometric evidence.

    The database RPC repeats the authoritative mapping checks under row locks.
    This client-side prefilter only avoids unnecessary RPC calls; it never grants
    reactivation authority by itself.
    """
    results = Counter()
    seen: set[tuple[str, str]] = set()
    workers = resolution.get('workers', {})
    for row in persisted_rows:
        device_id = str(row.get('device_id') or '').strip()
        event_identity = str(row.get('event_identity') or '')
        employee_no = str(row.get('device_employee_no') or '').strip()
        key = (device_id, event_identity)
        if not device_id or not event_identity or not employee_no or key in seen:
            continue
        seen.add(key)
        mapping = biometric_mapping_for_event(resolution, {
            '_device_id': device_id,
            'employeeNoString': employee_no,
        })
        worker = workers.get(str(mapping.get('worker_id') or '')) if mapping else None
        if not worker or worker.get('is_active') is not False:
            continue
        try:
            outcome = client.reactivate_worker_from_persisted_biometric_event(device_id, event_identity)
        except requests.RequestException:
            results['errors'] += 1
            continue
        outcome_name = str(outcome.get('outcome') or 'unknown')
        results[outcome_name] += 1
        if outcome_name in {'reactivated', 'already_active'}:
            results['reload_required'] += 1
    return results


def biometric_mapping_for_event(resolution: dict, event: dict) -> dict | None:
    employee_no = str(event.get('employeeNoString') or event.get('employeeNo') or '').strip()
    device_id = str(event.get('_device_id') or event.get('device_id') or '').strip()
    confirmed = resolution.get('confirmed', {})
    # Exact device identity wins. Null-device mappings are compatibility rows
    # created before device-scoped mappings existed.
    return (
        confirmed.get((device_id, employee_no))
        or confirmed.get((None, employee_no))
        or confirmed.get(employee_no)  # Backward-compatible test/fixture shape.
    )


def biometric_identity_needs_review(resolution: dict, event: dict) -> bool:
    employee_no = str(event.get('employeeNoString') or event.get('employeeNo') or '').strip()
    device_id = str(event.get('_device_id') or event.get('device_id') or '').strip()
    unconfirmed = resolution.get('unconfirmed', set())
    return (device_id, employee_no) in unconfirmed or (None, employee_no) in unconfirmed or employee_no in unconfirmed


def biometric_identity_is_ignored(resolution: dict, event: dict) -> bool:
    employee_no = str(event.get('employeeNoString') or event.get('employeeNo') or '').strip()
    device_id = str(event.get('_device_id') or event.get('device_id') or '').strip()
    ignored = resolution.get('ignored', set())
    return (device_id, employee_no) in ignored or (None, employee_no) in ignored or employee_no in ignored


def biometric_mapping_is_ignored(resolution: dict, mapping: dict) -> bool:
    employee_no = str(mapping.get('device_employee_no') or '').strip()
    device_id = str(mapping.get('device_id') or '').strip() or None
    ignored = resolution.get('ignored', set())
    return (device_id, employee_no) in ignored or (None, employee_no) in ignored or employee_no in ignored


def day_has_finalized(target_date: date_type, finalization_time: time | None) -> bool:
    """Absence is final only once the target date is a completed past day."""
    now = local_now()
    return target_date < now.date()


def existing_biometric_check_in(existing: dict | None, target_date: date_type) -> datetime | None:
    """Return only a same-day, unprotected biometric arrival already on file."""
    if (
        not existing
        or is_manual_protected(existing)
        or existing.get('attendance_source') != 'biometric'
        or str(existing.get('attendance_date') or '') != target_date.isoformat()
        or not existing.get('check_in')
    ):
        return None
    try:
        check_in_time = time.fromisoformat(str(existing['check_in'])).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None
    return datetime.combine(target_date, check_in_time, tzinfo=MONITORING_TIME_ZONE)


def proposed_status(target_date: date_type, check_in: datetime | None, check_out: datetime | None) -> tuple[str, float | None]:
    schedule = workday_schedule(target_date)
    if schedule is None:
        return 'non_working_day', None
    if check_in:
        arrival_time = check_in.timetz().replace(tzinfo=None)
        if arrival_time > ON_TIME_CHECKIN_END:
            # A genuine late arrival proves attendance. Preserve the existing
            # incomplete-day fraction until a real checkout is observed, but
            # never allow finalization to turn this worker into absent.
            return 'late', 1.0 if check_out else 0.5
        if check_out:
            return 'present', 1.0
        # An on-time arrival is visible as half day immediately, then upgraded
        # when a valid checkout is later found.
        return 'half_day', 0.5
    # Missing attendance remains
    # temporary for the entire current business date. The raw evening event is
    # preserved as metadata by the caller, never as check_out.
    if not day_has_finalized(target_date, schedule['finalization_time']):
        return 'pending', None
    return 'absent', 0.0


def plan_attendance(events: list[dict], resolution: dict, target_date: date_type) -> tuple[list[dict], Counter]:
    counters = Counter()
    events_by_worker: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        # Direct readers already filter events, but persisted-event replay and
        # callers receive the same defense-in-depth protection. Legacy test or
        # integration fixtures without event codes remain compatible.
        if event.get('major') is not None or event.get('minor') is not None:
            if event.get('major') != VALID_ATTENDANCE_MAJOR or event.get('minor') != VALID_ATTENDANCE_MINOR:
                counters['ignored_non_attendance_event'] += 1
                continue
        employee_no = str(event.get('employeeNoString') or '').strip()
        if biometric_identity_is_ignored(resolution, event):
            counters['ignored_old_user'] += 1
            continue
        mapping = biometric_mapping_for_event(resolution, event)
        if not mapping:
            counters['needs_review' if biometric_identity_needs_review(resolution, event) else 'unmapped'] += 1
            continue
        worker = resolution['workers'].get(str(mapping.get('worker_id') or ''))
        if not worker or worker.get('is_active') is False:
            counters['ignored_inactive_worker'] += 1
            continue
        events_by_worker[str(worker['id'])].append(event)
        counters['resolved_events'] += 1

    eligible_workers: dict[str, dict] = {}
    for mapping in resolution['confirmed'].values():
        if biometric_mapping_is_ignored(resolution, mapping):
            continue
        worker_id = str(mapping.get('worker_id') or '')
        worker = resolution['workers'].get(worker_id)
        if worker and worker.get('is_active') is not False:
            eligible_workers[worker_id] = worker

    plans = []
    schedule = workday_schedule(target_date)
    for worker_id, worker in eligible_workers.items():
        # Existing attendance is constrained to target_date by load_resolution_data.
        # Recheck the date here before using its real biometric arrival as a
        # continuity anchor across device pagination/timezone discontinuities.
        existing = resolution['existing_attendance'].get(worker_id)
        stored_check_in = existing_biometric_check_in(existing, target_date)
        worker_events = events_by_worker.get(worker_id, [])
        # Attendance is based on the terminal's displayed local wall clock. A
        # terminal offset correction must not reorder events or rewrite their
        # exact raw timestamp metadata.
        parsed = sorted(
            ((parse_monitoring_event_time(event['time']), event) for event in worker_events),
            key=lambda item: item[0],
        )
        arrivals = [] if schedule is None else [
            item for item in parsed
            if schedule['workday_boundary'] <= item[0].timetz().replace(tzinfo=None)
        ]
        check_in_event = arrivals[0] if arrivals and schedule is not None else None
        check_in = check_in_event[0] if check_in_event else None
        # Once a real biometric arrival has been stored, historical/current
        # reconciliation may attach later positive evidence but must never
        # reinterpret or replace that established arrival. This is especially
        # important across terminal timezone corrections and discontinuous reads.
        check_in_from_existing = bool(stored_check_in)
        if check_in_from_existing:
            check_in = stored_check_in
            check_in_event = None
        checkout = [] if schedule is None else [
            item for item in parsed
            if schedule['checkout_start'] <= item[0].timetz().replace(tzinfo=None) <= schedule['checkout_end']
            and (check_in is None or item[0] > check_in)
        ]
        checkout_event = checkout[-1] if checkout else None
        checkout_time = checkout_event[0] if checkout_event else None
        status, fraction = proposed_status(target_date, check_in, checkout_time)
        checkout_only = bool(not check_in and checkout_time)
        # Existing attendance is keyed by worker and the selected attendance date.
        # Only explicitly biometric, non-overridden records can be revised later.
        existing_protection = 'manual_protected' if is_manual_protected(existing) else None
        existing_metadata = normalized_metadata(existing.get('biometric_sync_metadata')) if existing else None
        metadata = dict(existing_metadata) if isinstance(existing_metadata, dict) else None
        if checkout_only:
            metadata = metadata or {}
            metadata.update({
            'checkout_only': True,
            'evening_punch_time': attendance_time_value(checkout_time),
            'evening_event_serial': checkout_event[1].get('serialNo') or checkout_event[1].get('eventSerialNo'),
            'evening_event_timestamp': checkout_event[1].get('time'),
            'evening_device_id': checkout_event[1].get('_device_id'),
            })
        devices_seen = sorted({event.get('_device_id') for event in worker_events if event.get('_device_id')})
        if check_in and check_in_event:
            metadata = metadata or {}
            arrival_time = check_in.timetz().replace(tzinfo=None)
            on_time_end = datetime.combine(check_in.date(), ON_TIME_CHECKIN_END, tzinfo=check_in.tzinfo)
            metadata.update({
                'check_in_device_id': check_in_event[1].get('_device_id'),
                'check_in_event_serial': check_in_event[1].get('serialNo') or check_in_event[1].get('eventSerialNo'),
                'check_in_event_timestamp': check_in_event[1].get('time'),
                'check_in_employee_no': check_in_event[1].get('employeeNoString'),
                'check_in_device_name': check_in_event[1].get('name'),
                'late_arrival': arrival_time > ON_TIME_CHECKIN_END,
                'lateness_minutes': max(0, int((check_in - on_time_end).total_seconds() // 60)),
                'lateness_seconds': max(0, int((check_in - on_time_end).total_seconds())),
                'devices_seen': devices_seen,
            })
        elif check_in_from_existing:
            # Preserve the original check-in audit fields exactly. Only extend
            # devices_seen with devices contributing newly observed evidence.
            metadata = metadata or {}
            metadata['devices_seen'] = sorted(set(metadata.get('devices_seen') or []).union(devices_seen))
        if checkout_event and check_in:
            metadata = metadata or {}
            metadata.update({
                'check_out_device_id': checkout_event[1].get('_device_id'),
                'check_out_event_serial': checkout_event[1].get('serialNo') or checkout_event[1].get('eventSerialNo'),
                'check_out_event_timestamp': checkout_event[1].get('time'),
                'check_out_employee_no': checkout_event[1].get('employeeNoString'),
                'check_out_device_name': checkout_event[1].get('name'),
                'devices_seen': devices_seen,
            })
        plans.append({
            'worker_id': worker_id,
            'full_name': worker.get('full_name'),
            'classification': resolution['classifications'].get(worker_id, 'normal'),
            'team_id': worker.get('team_id'),
            'check_in': attendance_time_value(check_in),
            'check_out': attendance_time_value(checkout_time) if check_in else None,
            'proposed_status': status,
            'day_fraction': fraction,
            'checkout_only': checkout_only,
            # Metadata is also populated for normal check-in/check-out audit data;
            # evening-only fields exist only for checkout-only attendance.
            'evening_punch_time': metadata.get('evening_punch_time') if metadata else None,
            'biometric_sync_metadata': metadata,
            'raw_events_used': len(worker_events),
            'check_in_from_existing': check_in_from_existing,
            'sync_key': f'hikvision:{worker_id}:{target_date.isoformat()}',
            'existing_attendance_protection': existing_protection,
            # A future write stage may upgrade its own half_day row to present when
            # a later valid checkout is discovered; it never changes manual rows.
            'late_checkout_recovery_eligible': bool(
                check_in and checkout_time and not is_manual_protected(existing)
            ),
        })
        counters[status] += 1
    return plans, counters


def is_manual_protected(row: dict | None) -> bool:
    """Unknown/legacy rows are protected too; only explicit biometric rows may change."""
    return bool(row) and (
        row.get('attendance_source') != 'biometric'
        or row.get('manual_override') is True
    )


def is_writeable_plan(plan: dict) -> bool:
    return plan.get('proposed_status') in {'half_day', 'present', 'late', 'absent'}


def earlier_time(first: str | None, second: str | None) -> str | None:
    values = [value for value in (first, second) if value]
    return min(values) if values else None


def later_time(first: str | None, second: str | None) -> str | None:
    values = [value for value in (first, second) if value]
    return max(values) if values else None


def normalized_metadata(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def biometric_payload(plan: dict, existing: dict | None) -> dict | None:
    """Merge a new plan without downgrading a previously complete biometric day."""
    status = plan['proposed_status']
    check_in = plan['check_in']
    check_out = plan['check_out']

    if existing:
        existing_status = existing.get('status')
        if existing_status in {'present', 'late'} and existing.get('check_in') and existing.get('check_out'):
            # A partial/replayed read cannot replace the established biometric
            # arrival or downgrade a completed day.
            status = 'present' if existing_status == 'present' or status == 'present' else 'late'
            check_in = existing.get('check_in')
            check_out = later_time(existing.get('check_out'), check_out)
        elif status in {'present', 'late'}:
            check_in = existing.get('check_in') or check_in
            check_out = later_time(existing.get('check_out'), check_out)
        elif status == 'half_day':
            check_in = existing.get('check_in') or check_in
            check_out = None
        elif status == 'absent' and existing_status in {'half_day', 'present', 'late'}:
            # A partial device response must never downgrade a biometric record
            # that already contains a valid arrival or checkout.
            return None

    metadata = plan.get('biometric_sync_metadata')
    if metadata is None and existing:
        metadata = normalized_metadata(existing.get('biometric_sync_metadata'))

    if status in {'present', 'late', 'half_day'} and check_in:
        # Recompute from the final merged earliest arrival. A partial device
        # response containing only a later punch must not downgrade an already
        # known on-time biometric arrival to late.
        status = (
            'late'
            if str(check_in)[:8] > ON_TIME_CHECKIN_END.strftime('%H:%M:%S')
            else ('present' if check_out else 'half_day')
        )

    if status == 'present':
        day_fraction = 1.0
    elif status == 'late':
        day_fraction = 1.0 if check_out else 0.5
    elif status == 'half_day':
        day_fraction = 0.5
    elif status == 'absent':
        day_fraction = 0.0
    else:
        day_fraction = plan['day_fraction']

    return {
        'status': status,
        'check_in': check_in,
        'check_out': check_out,
        'attendance_source': 'biometric',
        'manual_override': False,
        'biometric_sync_key': plan['sync_key'],
        'biometric_sync_metadata': metadata,
        'attendance_day_fraction': day_fraction,
    }


def payload_changed(existing: dict, payload: dict) -> bool:
    fields = ('status', 'check_in', 'check_out', 'attendance_source', 'manual_override', 'biometric_sync_key', 'attendance_day_fraction')
    if any(existing.get(field) != payload.get(field) for field in fields):
        return True
    return normalized_metadata(existing.get('biometric_sync_metadata')) != payload.get('biometric_sync_metadata')


def safe_postgrest_error_details(error: requests.HTTPError) -> dict:
    """Extract only PostgREST's public error fields; never request headers/secrets."""
    response = error.response
    details = {'status': getattr(response, 'status_code', None), 'code': None, 'message': None, 'details': None, 'hint': None}
    if response is None:
        return details
    try:
        body = response.json()
    except ValueError:
        body = {'message': str(getattr(response, 'text', '') or '').strip()[:1000]}
    if isinstance(body, dict):
        for field in ('code', 'message', 'details', 'hint'):
            value = body.get(field)
            details[field] = str(value).strip()[:1000] if value is not None else None
    return details


def log_structural_attendance_error(error: requests.HTTPError, operation: str) -> None:
    details = safe_postgrest_error_details(error)
    print(f'[SUPABASE] attendance {operation} rejected:', file=sys.stderr)
    for field in ('status', 'code', 'message', 'details', 'hint'):
        print(f'{field}={details[field]}', file=sys.stderr)


def write_summary(plans: list[dict], existing_attendance: dict, counters: Counter) -> dict:
    summary = Counter()
    for plan in plans:
        if not is_writeable_plan(plan):
            continue
        existing = existing_attendance.get(plan['worker_id'])
        if is_manual_protected(existing):
            summary['skipped_manual_protected'] += 1
            continue
        payload = biometric_payload(plan, existing)
        if payload is None or (existing and not payload_changed(existing, payload)):
            summary['unchanged'] += 1
        elif existing:
            summary['update'] += 1
        else:
            summary['insert'] += 1
    # These are derived from the final plans, rather than re-evaluating any
    # attendance rule for reporting. A checkout-only plan remains absent and
    # is counted separately as additional diagnostic information.
    for status in ('present', 'late', 'half_day', 'absent', 'pending'):
        summary[status] = sum(1 for plan in plans if plan.get('proposed_status') == status)
    summary['checkout_only'] = sum(1 for plan in plans if plan.get('checkout_only') is True)
    summary['confirmed_workers_considered'] = len(plans)
    summary['unmapped'] = counters.get('unmapped', 0)
    summary['needs_review'] = counters.get('needs_review', 0)
    return dict(summary)


def apply_biometric_attendance(client: SupabaseReadClient, plans: list[dict], existing_attendance: dict) -> Counter:
    results = Counter()
    for plan in plans:
        if not is_writeable_plan(plan):
            results['not_finalized_or_non_working'] += 1
            continue
        existing = existing_attendance.get(plan['worker_id'])
        if is_manual_protected(existing):
            results['skipped_manual_protected'] += 1
            continue
        payload = biometric_payload(plan, existing)
        if payload is None or (existing and not payload_changed(existing, payload)):
            results['unchanged'] += 1
            continue
        try:
            if existing:
                if hasattr(client, 'update_attendance_if_unchanged'):
                    updated = client.update_attendance_if_unchanged(existing, payload)
                    results['updated' if updated else 'skipped_concurrent_change'] += 1
                else:
                    client.update_attendance(str(existing['id']), payload)
                    results['updated'] += 1
            else:
                client.insert_attendance({
                    'worker_id': plan['worker_id'],
                    'attendance_date': plan['sync_key'].rsplit(':', 1)[-1],
                    **payload,
                })
                results['inserted'] += 1
        except requests.HTTPError as error:
            if not existing and error.response is not None and error.response.status_code == 400:
                # A 400 is a structural schema/validation mismatch. Continuing
                # would repeat the same invalid write for every remaining plan.
                log_structural_attendance_error(error, 'insert')
                results['structural_supabase_error'] += 1
                results['aborted_structural_error'] += 1
                break
            if error.response is not None and error.response.status_code == 409:
                # A concurrent run inserted the worker/date row. Re-read it and
                # only update if it is explicitly biometric and unprotected.
                rows = client.read(
                    'attendance',
                    'id,worker_id,attendance_date,status,check_in,check_out,attendance_source,manual_override,biometric_sync_key,biometric_sync_metadata,attendance_day_fraction',
                    worker_id=f"eq.{plan['worker_id']}",
                    attendance_date=f"eq.{plan['sync_key'].rsplit(':', 1)[-1]}",
                )
                concurrent = rows[0] if rows else None
                if is_manual_protected(concurrent):
                    results['skipped_manual_protected'] += 1
                elif concurrent:
                    retry_payload = biometric_payload(plan, concurrent)
                    if retry_payload and payload_changed(concurrent, retry_payload):
                        client.update_attendance(str(concurrent['id']), retry_payload)
                        results['updated'] += 1
                    else:
                        results['unchanged'] += 1
                else:
                    results['errors'] += 1
            else:
                results['errors'] += 1
        except requests.RequestException:
            results['errors'] += 1
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description='Local Hikvision → Supabase attendance DRY RUN')
    parser.add_argument('--date', default=local_now().date().isoformat(), help='Work date: YYYY-MM-DD')
    parser.add_argument('--output', help='Optional local JSON report path')
    parser.add_argument('--debug', action='store_true', help='Show safe request-stage diagnostics')
    parser.add_argument('--apply', action='store_true', help='Apply biometric attendance writes (requires --confirm-write)')
    parser.add_argument('--confirm-write', action='store_true', help='Explicit acknowledgement required together with --apply')
    parser.add_argument('--from-persisted-events', action='store_true', help='Use only real biometric events already persisted in Supabase')
    args = parser.parse_args()
    try:
        load_local_hikvision_config()
        require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
        if not args.from_persisted_events:
            configured_devices()
    except RuntimeError as error:
        print(f'Attendance sync configuration error: {error}', file=sys.stderr)
        return 2
    if args.apply and not args.confirm_write:
        print('APPLY ABORTED: --apply requires --confirm-write. No Supabase writes were attempted.', file=sys.stderr)
        return 2
    try:
        target_date = date_type.fromisoformat(args.date)
        diagnostics = RequestDiagnostics(args.debug)
        client = SupabaseReadClient(diagnostics)
        if args.from_persisted_events:
            events, persisted_rows = persisted_biometric_events(client, target_date)
            device_reads = {'persisted-event-store': {
                'device_id': 'persisted-event-store',
                'state': 'complete',
                'event_count': len(events),
                'error': None,
            }}
        else:
            events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
            persisted_rows = []
        resolution = load_resolution_data(client, target_date, for_apply=args.apply)
        apply_blocked_reason = attendance_apply_blocked_reason(device_reads)
        reactivation_results = None
        if args.apply and not apply_blocked_reason:
            if not args.from_persisted_events:
                persisted_rows = resolved_biometric_event_rows(events, resolution, target_date)
                client.insert_biometric_attendance_events(persisted_rows)
            reactivation_results = auto_reactivate_inactive_workers(client, persisted_rows, resolution)
            if reactivation_results.get('reload_required'):
                resolution = load_resolution_data(client, target_date, for_apply=True)
        plans, counters = plan_attendance(events, resolution, target_date)
    except (RuntimeError, requests.RequestException, ValueError) as error:
        print(f'DRY RUN FAILED: {error}', file=sys.stderr)
        return 1

    planned_writes = write_summary(plans, resolution['existing_attendance'], counters)
    if args.apply:
        print(json.dumps({
            'mode': 'apply_preflight',
            'date': target_date.isoformat(),
            'schema_prerequisite': 'attendance_biometric_workflow_upgrade.sql and biometric_auto_reactivation.sql must already be approved and executed',
            'device_reads': device_reads,
            'apply_blocked_reason': apply_blocked_reason,
            'auto_reactivation': dict(reactivation_results or {}),
            **planned_writes,
        }, ensure_ascii=False, indent=2))
        if apply_blocked_reason:
            print(apply_blocked_reason, file=sys.stderr)
            return 3
        write_results = apply_biometric_attendance(client, plans, resolution['existing_attendance'])
        write_results['unmapped'] = counters.get('unmapped', 0)
        write_results['needs_review'] = counters.get('needs_review', 0)
        print(json.dumps({
            'mode': 'apply_results',
            'inserted': write_results.get('inserted', 0),
            'updated': write_results.get('updated', 0),
            'skipped_manual_protected': write_results.get('skipped_manual_protected', 0),
            'unmapped': write_results.get('unmapped', 0),
            'needs_review': write_results.get('needs_review', 0),
            'workers_reactivated': (reactivation_results or {}).get('reactivated', 0),
            'reactivation_errors': (reactivation_results or {}).get('errors', 0),
            'errors': write_results.get('errors', 0),
        }, ensure_ascii=False, indent=2))
    else:
        write_results = None

    report = {
        'mode': 'apply' if args.apply else 'dry_run',
        'event_source': 'persisted_supabase_events' if args.from_persisted_events else 'direct_hikvision_devices',
        'date': target_date.isoformat(),
        'event_count': len(events),
        'device_reads': device_reads,
        'apply_blocked_reason': apply_blocked_reason,
        'schedule': {
            'weekday': target_date.strftime('%A'),
            'checkout_acceptance': 'Mon-Fri 16:30-23:59:59; Saturday 14:00-23:59:59',
            'finalization': 'Mon-Fri 17:15; Saturday 14:45',
        },
        'counts': dict(counters),
        'write_preflight': planned_writes,
        'write_results': dict(write_results) if write_results is not None else None,
        'auto_reactivation': dict(reactivation_results or {}) if args.apply else None,
        'proposals': plans,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as report_file:
            json.dump(report, report_file, ensure_ascii=False, indent=2)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
