"""Read-only Hikvision user-list synchronization shared by local tools."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from hikvision_http import HIKVISION_PROBE_TIMEOUT, HIKVISION_REQUEST_TIMEOUT, HikvisionReadClient
from hikvision_device_lock import HikvisionDeviceOperationLock
from hikvision_devices import configured_devices


def _users_file() -> Path:
    return Path(os.environ.get(
        "HIKVISION_USERS_FILE",
        Path(__file__).parent / "hikvision_raw" / "hikvision_users_ALL.json",
    ))


def read_cached_users() -> list[dict]:
    users_file = _users_file()
    try:
        with users_file.open("r", encoding="utf-8") as source:
            data = json.load(source)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read local users dataset: {error}") from error


def fetch_current_users_for_device(device) -> list[dict]:
    """Read every device user through Hikvision's paginated UserInfo/Search API."""
    with HikvisionDeviceOperationLock(device.device_id, 'user search'):
        hikvision = HikvisionReadClient(device.ip, device.username, device.password, device.device_id)
        url = hikvision.url('/ISAPI/AccessControl/UserInfo/Search?format=json')
        current_users: list[dict] = []
        position = 0
        successful_batches = 0
        try:
            while True:
                payload = {
                    "UserInfoSearchCond": {
                        "searchID": "local-attendance-user-sync",
                        "searchResultPosition": position,
                        "maxResults": 100,
                    }
                }
                response = hikvision.request('POST', url, json=payload, timeout=HIKVISION_REQUEST_TIMEOUT)
                # Keep first-page 401 strict. A later 401 after successful pages is
                # a stale device Digest challenge: refresh once for this page only.
                if response.status_code == 401 and successful_batches > 0:
                    print(f'[HIKVISION] {device.device_id} stale Digest suspected at user batch position {position}; refreshing once', file=sys.stderr)
                    hikvision.refresh_digest_session()
                    response = hikvision.request('POST', url, json=payload, timeout=HIKVISION_REQUEST_TIMEOUT)
                response.raise_for_status()
                result = response.json().get("UserInfoSearch", {})
                batch = result.get("UserInfo") or []
                if isinstance(batch, dict):
                    batch = [batch]
                current_users.extend([{**user, '_device_id': device.device_id} for user in batch])
                successful_batches += 1
                if result.get("responseStatusStrg") != "MORE" or not batch:
                    break
                position += len(batch)
                time.sleep(0.2)
        finally:
            hikvision.close()
        return current_users


def _selected_devices(target_device_id: str | None = 'all') -> list:
    devices = configured_devices()
    if target_device_id in (None, '', 'all'):
        return devices
    selected = [device for device in devices if device.device_id == target_device_id]
    if not selected:
        raise ValueError(f'Unknown Hikvision device target: {target_device_id}')
    return selected


def fetch_current_users(target_device_id: str | None = 'all') -> tuple[dict[str, list[dict]], dict[str, str]]:
    """Fetch only the requested device, or both devices for the all-device sync."""
    users_by_device: dict[str, list[dict]] = {}
    failures: dict[str, str] = {}
    for device in _selected_devices(target_device_id):
        try:
            device_users = fetch_current_users_for_device(device)
            users_by_device[device.device_id] = device_users
            print(f'[HIKVISION] {device.device_id} user sync success: {len(device_users)} users', file=sys.stderr)
        except (RuntimeError, requests.RequestException, ValueError) as error:
            reason = f'{type(error).__name__}: {error}'
            failures[device.device_id] = reason
            print(f'[HIKVISION] {device.device_id} ({device.ip}) user sync failed: {reason}', file=sys.stderr)
    return users_by_device, failures


def merge_device_users(current_users: list[dict]) -> tuple[dict[str, dict], list[str]]:
    current_by_no: dict[str, dict] = {}
    conflicts = []
    for user in current_users:
        employee_no = str(user.get('employeeNo') or user.get('employeeNoString') or '').strip()
        if not employee_no:
            continue
        name = str(user.get('name') or '').strip()
        existing = current_by_no.get(employee_no)
        if not existing:
            current_by_no[employee_no] = {**user, 'devices': [user['_device_id']]}
        else:
            existing['devices'].append(user['_device_id'])
            if name and existing.get('name') and name != existing['name']:
                existing['device_identity_conflict'] = True
                conflicts.append(employee_no)
    return current_by_no, sorted(set(conflicts))


def build_current_inventory(current_users: list[dict], device_ids: list[str]) -> tuple[dict[str, dict], list[str]]:
    """Pure merge used by sync and tests; only fetched users are current."""
    inventory, conflicts = merge_device_users(current_users)
    for user in inventory.values():
        devices = sorted(set(user.pop('devices', [])))
        user['devices'] = devices
        user['device_presence'] = {device_id: device_id in devices for device_id in device_ids}
        user['_local_sync'] = {'is_currently_returned': True, 'removed_from_all_devices': False}
    return inventory, conflicts


def check_hikvision_reachable() -> tuple[bool, str | None]:
    """Perform a small read-only connectivity probe, without fetching users/events."""
    try:
        results = []
        failures = []
        for device in configured_devices():
            hikvision = HikvisionReadClient(device.ip, device.username, device.password, device.device_id)
            try:
                response = hikvision.request('GET', hikvision.url('/ISAPI/System/capabilities'), timeout=HIKVISION_PROBE_TIMEOUT)
                results.append(response.ok)
            except requests.Timeout as error:
                failures.append(f'{device.device_id} ({device.ip}) timed out')
                print(f'[HIKVISION] device={device.device_id} ip={device.ip} connectivity probe timed out: {type(error).__name__}', file=sys.stderr)
            except requests.RequestException as error:
                failures.append(f'{device.device_id} ({device.ip}) is unreachable')
                print(f'[HIKVISION] device={device.device_id} ip={device.ip} connectivity probe failed: {type(error).__name__}', file=sys.stderr)
            finally:
                hikvision.close()
        if any(results):
            return True, None
        return False, '; '.join(failures) if failures else 'All Hikvision devices are unavailable.'
    except RuntimeError as error:
        # Missing-variable messages name the variable only, never its value.
        return False, str(error)


def persist_device_identity_presence(users_by_device: dict[str, list[dict]]) -> dict:
    """Persist device discovery times without changing attendance or mappings."""
    base_url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    service_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    if not base_url or not service_key:
        raise RuntimeError('Missing Supabase configuration for biometric identity presence persistence.')
    rows = []
    for device_id, users in users_by_device.items():
        for user in users:
            employee_no = str(user.get('employeeNo') or user.get('employeeNoString') or '').strip()
            if employee_no:
                rows.append({'device_id': device_id, 'device_employee_no': employee_no, 'device_name': str(user.get('name') or '').strip() or None})
    seen_at = datetime.now(timezone.utc).isoformat()
    response = requests.post(
        f'{base_url}/rest/v1/rpc/sync_biometric_device_identity_presence',
        headers={'apikey': service_key, 'Authorization': f'Bearer {service_key}', 'Content-Type': 'application/json'},
        json={'p_present': rows, 'p_successful_device_ids': list(users_by_device), 'p_seen_at': seen_at}, timeout=30,
    )
    response.raise_for_status()
    return {'state': 'success', 'observed': len(rows), 'seen_at': seen_at}


def _cached_device_presence(user: dict, device_ids: list[str]) -> dict[str, bool]:
    stored = user.get('device_presence')
    if isinstance(stored, dict):
        return {device_id: bool(stored.get(device_id)) for device_id in device_ids}
    devices = {str(device_id) for device_id in (user.get('devices') or [])}
    return {device_id: device_id in devices for device_id in device_ids}


def _merge_single_device_inventory(cached_users: list[dict], device_users: list[dict], target_device_id: str, device_ids: list[str]) -> tuple[list[dict], dict[str, dict], int]:
    """Replace one device's inventory while retaining the other device's last known state."""
    records: dict[str, dict] = {}
    previous_on_target: set[str] = set()
    for cached in cached_users:
        employee_no = str(cached.get('employeeNo') or cached.get('employeeNoString') or '').strip()
        if not employee_no:
            continue
        presence = _cached_device_presence(cached, device_ids)
        if presence.get(target_device_id):
            previous_on_target.add(employee_no)
        presence[target_device_id] = False  # A complete selected-device read replaces this device only.
        records[employee_no] = {**cached, 'employeeNo': employee_no, 'device_presence': presence}

    discovered = 0
    for user in device_users:
        employee_no = str(user.get('employeeNo') or user.get('employeeNoString') or '').strip()
        if not employee_no:
            continue
        if employee_no not in previous_on_target:
            discovered += 1
        existing = records.get(employee_no, {})
        presence = _cached_device_presence(existing, device_ids) if existing else {device_id: False for device_id in device_ids}
        presence[target_device_id] = True
        records[employee_no] = {
            **existing,
            **{key: value for key, value in user.items() if key != '_device_id'},
            'employeeNo': employee_no,
            'device_presence': presence,
        }

    current_by_no: dict[str, dict] = {}
    merged: list[dict] = []
    for employee_no, record in records.items():
        presence = _cached_device_presence(record, device_ids)
        devices = sorted(device_id for device_id, present in presence.items() if present)
        is_current = bool(devices)
        item = {
            **record,
            'devices': devices,
            'device_presence': presence,
            '_local_sync': {
                'is_currently_returned': is_current,
                'removed_from_all_devices': not is_current,
            },
        }
        merged.append(item)
        if is_current:
            current_by_no[employee_no] = item
    return merged, current_by_no, discovered


def sync_users_dataset(target_device_id: str | None = 'all') -> dict:
    """Keep current device presence separate from retained local audit history."""
    users_file = _users_file()
    cached_users = read_cached_users()
    cached_by_no = {
        str(user.get("employeeNo") or user.get("employeeNoString") or "").strip(): user
        for user in cached_users
    }
    cached_by_no.pop("", None)
    target = target_device_id or 'all'
    device_ids = [device.device_id for device in configured_devices()]
    users_by_device, device_failures = fetch_current_users(target)
    if target != 'all' and target not in users_by_device:
        # Do not alter the local inventory or presence table when the requested
        # device could not be read completely.
        return {
            'status': 'failed', 'target_device_id': target, 'total': 0,
            'device_failures': device_failures, 'users_file_updated': False,
        }

    if target != 'all':
        merged, current_by_no, new_count = _merge_single_device_inventory(
            cached_users, users_by_device[target], target, device_ids,
        )
        conflicts = []
        device_user_counts = {target: len(users_by_device[target])}
        try:
            presence_sync = persist_device_identity_presence(users_by_device)
        except (RuntimeError, requests.RequestException, ValueError) as error:
            presence_sync = {'state': 'failed', 'error': f'{type(error).__name__}: {error}'}
        users_file.parent.mkdir(parents=True, exist_ok=True)
        temporary_file = users_file.with_suffix(f"{users_file.suffix}.tmp")
        with temporary_file.open("w", encoding="utf-8") as destination:
            json.dump(merged, destination, ensure_ascii=False, indent=2)
        temporary_file.replace(users_file)
        return {
            'status': 'ok', 'target_device_id': target, 'total': len(current_by_no),
            'unique_current_users': len(current_by_no), 'device_user_counts': device_user_counts,
            'device_sync_status': {
                device_id: ({'state': 'success', 'count': len(users_by_device[target])}
                            if device_id == target else {'state': 'not_requested', 'count': None})
                for device_id in device_ids
            },
            'present_on_both': sum(1 for user in current_by_no.values() if len(user['devices']) >= 2),
            'office_main_only': sum(1 for user in current_by_no.values() if user['devices'] == ['office-main']),
            'office_secondary_only': sum(1 for user in current_by_no.values() if user['devices'] == ['office-secondary']),
            'removed_from_all_devices': sum(1 for user in merged if user['_local_sync']['removed_from_all_devices']),
            'presence_unknown_due_to_device_failure': 0, 'new': new_count,
            'existing': max(0, len(current_by_no) - new_count), 'disappeared': 0,
            'device_failures': device_failures, 'device_identity_conflicts': conflicts,
            'users_file_updated': True, 'identity_presence_sync': presence_sync, 'users': merged,
        }

    current_users = [user for device_users in users_by_device.values() for user in device_users]
    current_by_no, conflicts = merge_device_users(current_users)
    device_user_counts = {device_id: len(users_by_device[device_id]) for device_id in users_by_device}

    current_by_no, conflicts = build_current_inventory(current_users, device_ids)
    print(f'[HIKVISION] merged unique current users: {len(current_by_no)}', file=sys.stderr)

    merged = list(current_by_no.values())
    removed_from_all = not device_failures
    disappeared = sorted(set(cached_by_no) - set(current_by_no)) if removed_from_all else []
    unknown_due_to_device_failure = sorted(set(cached_by_no) - set(current_by_no)) if device_failures else []
    for employee_no in disappeared:
        historical = {**cached_by_no[employee_no]}
        historical['devices'] = []
        historical['device_presence'] = {device_id: False for device_id in device_ids}
        historical['_local_sync'] = {
            'is_currently_returned': False,
            'removed_from_all_devices': True,
        }
        merged.append(historical)
    # A failed device cannot prove that its historical identities were deleted.
    # Retain them as unknown, never as a current identity and never as removed.
    for employee_no in unknown_due_to_device_failure:
        historical = {**cached_by_no[employee_no]}
        historical['_local_sync'] = {
            'is_currently_returned': False,
            'removed_from_all_devices': False,
            'presence_unknown_due_to_device_failure': True,
        }
        merged.append(historical)

    users_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = users_file.with_suffix(f"{users_file.suffix}.tmp")
    with temporary_file.open("w", encoding="utf-8") as destination:
        json.dump(merged, destination, ensure_ascii=False, indent=2)
    temporary_file.replace(users_file)
    try:
        presence_sync = persist_device_identity_presence(users_by_device)
    except (RuntimeError, requests.RequestException, ValueError) as error:
        # Inventory remains usable; the next existing user-sync cycle retries this additive tracking write.
        presence_sync = {'state': 'failed', 'error': f'{type(error).__name__}: {error}'}
    return {
        "status": "ok",
        "target_device_id": "all",
        "total": len(current_by_no),
        "unique_current_users": len(current_by_no),
        "device_user_counts": device_user_counts,
        "device_sync_status": {
            device_id: {'state': 'success', 'count': len(users_by_device[device_id])}
            if device_id in users_by_device
            else {'state': 'failed', 'count': None, 'error': device_failures.get(device_id, 'unknown')}
            for device_id in device_ids
        },
        "present_on_both": sum(1 for user in current_by_no.values() if len(user['devices']) >= 2),
        "office_main_only": sum(1 for user in current_by_no.values() if user['devices'] == ['office-main']),
        "office_secondary_only": sum(1 for user in current_by_no.values() if user['devices'] == ['office-secondary']),
        "removed_from_all_devices": len(disappeared),
        "presence_unknown_due_to_device_failure": len(unknown_due_to_device_failure),
        "new": len(set(current_by_no) - set(cached_by_no)),
        "existing": len(set(current_by_no) & set(cached_by_no)),
        "disappeared": len(disappeared),
        "device_failures": device_failures,
        "device_identity_conflicts": sorted(set(conflicts)),
        "users_file_updated": True,
        "identity_presence_sync": presence_sync,
        "users": merged,
    }
