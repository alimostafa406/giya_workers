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
from datetime import datetime, time, timezone

import requests
from hikvision_http import HikvisionReadClient
from hikvision_devices import configured_devices
from hikvision_local_config import load_local_hikvision_config, require_local_settings


MORNING_START = time(7, 0)
MORNING_END = time(9, 0)
WEEKDAY_CHECKOUT_START = time(16, 30)  # permits a genuine 16:58 exit for a 17:00 finish
SATURDAY_CHECKOUT_START = time(14, 0)  # permits a genuine 14:xx exit for a 14:30 finish
WEEKDAY_FINALIZATION = time(17, 15)
SATURDAY_FINALIZATION = time(14, 45)
END_OF_DAY = time(23, 59, 59)
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
                response = hikvision.request('POST', url, json=payload, timeout=30)
                # A first-request 401 remains an authentication failure. A 401
                # after earlier 200 batches can be a stale device Digest nonce;
                # refresh once and retry this exact page without restarting.
                if response.status_code == 401 and successful_batches > 0:
                    print(f'[HIKVISION] stale Digest suspected at batch position {position}; refreshing once', file=sys.stderr)
                    hikvision.refresh_digest_session()
                    response = hikvision.request('POST', url, json=payload, timeout=30)
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

    status = {
        'device_id': device.device_id,
        'state': state,
        'event_count': len(filtered_events),
        'error': error_message,
        'failed_position': failed_position,
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
    events, status = hikvision_events_for_device(target_date, diagnostics, device, return_status=True)
    if status['state'] == 'complete':
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


def load_resolution_data(client: SupabaseReadClient, target_date: date_type, for_apply: bool = False) -> dict:
    active_mappings = client.read(
        'biometric_worker_mapping',
        'worker_id,device_employee_no,is_active,mapping_review_state',
        is_active='eq.true',
    )
    workers = client.read('workers', 'id,full_name,is_active,team_id')
    classifications = client.read('worker_staff_classification', 'worker_id,classification')
    ignored_identity_rows = client.read('biometric_device_identity_review', 'device_employee_no,review_state', review_state='eq.ignored')
    attendance_select = 'id,worker_id,attendance_date,status,check_in,check_out,note,recorded_by'
    if for_apply:
        # Apply requires attendance_biometric_workflow_upgrade.sql to have been
        # approved and executed by the administrator first.
        attendance_select += ',attendance_source,manual_override,biometric_sync_key,biometric_sync_metadata,attendance_day_fraction'
    existing_attendance = client.read(
        'attendance',
        attendance_select,
        attendance_date=f'eq.{target_date.isoformat()}',
    )
    workers_by_id = {str(worker['id']): worker for worker in workers if worker.get('id')}
    classifications_by_worker = {str(item['worker_id']): item.get('classification', 'normal') for item in classifications if item.get('worker_id')}
    confirmed: dict[str, dict] = {}
    unconfirmed_device_numbers: set[str] = set()
    for mapping in active_mappings:
        employee_no = str(mapping.get('device_employee_no') or '').strip()
        if not employee_no:
            continue
        if mapping.get('mapping_review_state') == 'confirmed':
            confirmed[employee_no] = mapping
        else:
            unconfirmed_device_numbers.add(employee_no)
    return {
        'confirmed': confirmed,
        'unconfirmed': unconfirmed_device_numbers,
        'ignored': {str(row.get('device_employee_no') or '').strip() for row in ignored_identity_rows},
        'workers': workers_by_id,
        'classifications': classifications_by_worker,
        'existing_attendance': {
            str(row['worker_id']): row
            for row in existing_attendance
            if row.get('worker_id')
        },
    }


def workday_schedule(target_date: date_type) -> dict | None:
    """Return acceptance and finalization independently; ISO weekday Monday is 0."""
    weekday = target_date.weekday()  # Monday=0, Saturday=5, Sunday=6
    if weekday <= 4:
        return {
            'label': 'monday_friday',
            'checkout_start': WEEKDAY_CHECKOUT_START,
            'checkout_end': END_OF_DAY,
            'finalization_time': WEEKDAY_FINALIZATION,
        }
    if weekday == 5:
        return {
            'label': 'saturday',
            'checkout_start': SATURDAY_CHECKOUT_START,
            'checkout_end': END_OF_DAY,
            'finalization_time': SATURDAY_FINALIZATION,
        }
    return None


def day_has_finalized(target_date: date_type, finalization_time: time | None) -> bool:
    if finalization_time is None:
        return True
    now = local_now()
    if target_date < now.date():
        return True
    if target_date > now.date():
        return False
    return now.time() >= finalization_time


def proposed_status(target_date: date_type, check_in: datetime | None, check_out: datetime | None) -> tuple[str, float | None]:
    schedule = workday_schedule(target_date)
    if schedule is None:
        return 'non_working_day', None
    if check_in and check_out:
        return 'present', 1.0
    if check_in:
        # Management rule: a valid morning arrival is visible as half day
        # immediately, then is upgraded when a valid checkout is later found.
        return 'half_day', 0.5
    # A valid evening event without a morning arrival is still absent. The raw
    # evening event is preserved as metadata by the caller, never as check_out.
    if check_out:
        return 'absent', 0.0
    if not day_has_finalized(target_date, schedule['finalization_time']):
        return 'pending', None
    return 'absent', 0.0


def plan_attendance(events: list[dict], resolution: dict, target_date: date_type) -> tuple[list[dict], Counter]:
    counters = Counter()
    events_by_worker: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        employee_no = str(event.get('employeeNoString') or '').strip()
        if employee_no in resolution.get('ignored', set()):
            counters['ignored_old_user'] += 1
            continue
        mapping = resolution['confirmed'].get(employee_no)
        if not mapping:
            counters['needs_review' if employee_no in resolution['unconfirmed'] else 'unmapped'] += 1
            continue
        worker = resolution['workers'].get(str(mapping.get('worker_id') or ''))
        if not worker or worker.get('is_active') is False:
            counters['ignored_inactive_worker'] += 1
            continue
        events_by_worker[str(worker['id'])].append(event)
        counters['resolved_events'] += 1

    eligible_workers: dict[str, dict] = {}
    for mapping in resolution['confirmed'].values():
        if str(mapping.get('device_employee_no') or '').strip() in resolution.get('ignored', set()):
            continue
        worker_id = str(mapping.get('worker_id') or '')
        worker = resolution['workers'].get(worker_id)
        if worker and worker.get('is_active') is not False:
            eligible_workers[worker_id] = worker

    plans = []
    schedule = workday_schedule(target_date)
    for worker_id, worker in eligible_workers.items():
        worker_events = events_by_worker.get(worker_id, [])
        parsed = sorted(((parse_event_time(event['time']), event) for event in worker_events), key=lambda item: item[0])
        morning = [item for item in parsed if MORNING_START <= item[0].timetz().replace(tzinfo=None) <= MORNING_END]
        checkout = [] if schedule is None else [
            item for item in parsed
            if schedule['checkout_start'] <= item[0].timetz().replace(tzinfo=None) <= schedule['checkout_end']
        ]
        check_in = morning[0][0] if morning else None
        checkout_event = checkout[-1] if checkout else None
        checkout_time = checkout_event[0] if checkout_event else None
        status, fraction = proposed_status(target_date, check_in, checkout_time)
        checkout_only = bool(not check_in and checkout_time)
        # Existing attendance is keyed by worker and the selected attendance date.
        # Only explicitly biometric, non-overridden records can be revised later.
        existing = resolution['existing_attendance'].get(worker_id)
        existing_protection = 'manual_protected' if is_manual_protected(existing) else None
        metadata = None if not checkout_only else {
            'checkout_only': True,
            'evening_punch_time': attendance_time_value(checkout_time),
            'evening_event_serial': checkout_event[1].get('serialNo') or checkout_event[1].get('eventSerialNo'),
            'evening_event_timestamp': checkout_event[1].get('time'),
            'evening_device_id': checkout_event[1].get('_device_id'),
        }
        devices_seen = sorted({event.get('_device_id') for event in worker_events if event.get('_device_id')})
        if check_in:
            metadata = metadata or {}
            metadata.update({
                'check_in_device_id': morning[0][1].get('_device_id'),
                'check_in_event_serial': morning[0][1].get('serialNo') or morning[0][1].get('eventSerialNo'),
                'check_in_event_timestamp': morning[0][1].get('time'),
                'devices_seen': devices_seen,
            })
        if checkout_event and check_in:
            metadata = metadata or {}
            metadata.update({
                'check_out_device_id': checkout_event[1].get('_device_id'),
                'check_out_event_serial': checkout_event[1].get('serialNo') or checkout_event[1].get('eventSerialNo'),
                'check_out_event_timestamp': checkout_event[1].get('time'),
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
    return plan.get('proposed_status') in {'half_day', 'present', 'absent'}


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
        if existing_status == 'present' and existing.get('check_in') and existing.get('check_out'):
            status = 'present'
            check_in = earlier_time(existing.get('check_in'), check_in)
            check_out = later_time(existing.get('check_out'), check_out)
        elif status == 'present':
            check_in = earlier_time(existing.get('check_in'), check_in)
            check_out = later_time(existing.get('check_out'), check_out)
        elif status == 'half_day':
            check_in = earlier_time(existing.get('check_in'), check_in)
            check_out = None
        elif status == 'absent' and existing_status in {'half_day', 'present'}:
            # A partial device response must never downgrade a biometric record
            # that already contains a valid morning arrival or checkout.
            return None

    metadata = plan.get('biometric_sync_metadata')
    if metadata is None and existing:
        metadata = normalized_metadata(existing.get('biometric_sync_metadata'))

    return {
        'status': status,
        'check_in': check_in,
        'check_out': check_out,
        'attendance_source': 'biometric',
        'manual_override': False,
        'biometric_sync_key': plan['sync_key'],
        'biometric_sync_metadata': metadata,
        'attendance_day_fraction': plan['day_fraction'],
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
    for status in ('present', 'half_day', 'absent', 'pending'):
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
    args = parser.parse_args()
    try:
        load_local_hikvision_config()
        configured_devices()
        require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
    except RuntimeError as error:
        print(f'Attendance sync configuration error: {error}', file=sys.stderr)
        return 2
    if args.apply and not args.confirm_write:
        print('APPLY ABORTED: --apply requires --confirm-write. No Supabase writes were attempted.', file=sys.stderr)
        return 2
    try:
        target_date = date_type.fromisoformat(args.date)
        diagnostics = RequestDiagnostics(args.debug)
        events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
        client = SupabaseReadClient(diagnostics)
        resolution = load_resolution_data(client, target_date, for_apply=args.apply)
        plans, counters = plan_attendance(events, resolution, target_date)
    except (RuntimeError, requests.RequestException, ValueError) as error:
        print(f'DRY RUN FAILED: {error}', file=sys.stderr)
        return 1

    planned_writes = write_summary(plans, resolution['existing_attendance'], counters)
    apply_blocked_reason = attendance_apply_blocked_reason(device_reads)
    if args.apply:
        print(json.dumps({
            'mode': 'apply_preflight',
            'date': target_date.isoformat(),
            'schema_prerequisite': 'attendance_biometric_workflow_upgrade.sql must already be approved and executed',
            'device_reads': device_reads,
            'apply_blocked_reason': apply_blocked_reason,
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
            'errors': write_results.get('errors', 0),
        }, ensure_ascii=False, indent=2))
    else:
        write_results = None

    report = {
        'mode': 'apply' if args.apply else 'dry_run',
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
        'proposals': plans,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as report_file:
            json.dump(report, report_file, ensure_ascii=False, indent=2)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
