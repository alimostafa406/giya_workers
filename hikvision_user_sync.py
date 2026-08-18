"""Read-only Hikvision user-list synchronization shared by local tools."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import requests
from hikvision_http import HikvisionReadClient
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
            response = hikvision.request('POST', url, json=payload, timeout=30)
            # Keep first-page 401 strict. A later 401 after successful pages is
            # a stale device Digest challenge: refresh once for this page only.
            if response.status_code == 401 and successful_batches > 0:
                print(f'[HIKVISION] {device.device_id} stale Digest suspected at user batch position {position}; refreshing once', file=sys.stderr)
                hikvision.refresh_digest_session()
                response = hikvision.request('POST', url, json=payload, timeout=30)
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
    finally:
        hikvision.close()
    return current_users


def fetch_current_users() -> tuple[dict[str, list[dict]], dict[str, str]]:
    users_by_device: dict[str, list[dict]] = {}
    failures: dict[str, str] = {}
    for device in configured_devices():
        try:
            device_users = fetch_current_users_for_device(device)
            users_by_device[device.device_id] = device_users
            print(f'[HIKVISION] {device.device_id} user sync success: {len(device_users)} users', file=sys.stderr)
        except (RuntimeError, requests.RequestException, ValueError) as error:
            reason = f'{type(error).__name__}: {error}'
            failures[device.device_id] = reason
            print(f'[HIKVISION] {device.device_id} user sync failed: {reason}', file=sys.stderr)
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
        for device in configured_devices():
            hikvision = HikvisionReadClient(device.ip, device.username, device.password, device.device_id)
            try:
                response = hikvision.request('GET', hikvision.url('/ISAPI/System/capabilities'), timeout=10)
                results.append(response.ok)
            finally:
                hikvision.close()
        return any(results), None if any(results) else 'All Hikvision devices are unavailable.'
    except requests.Timeout:
        return False, "Hikvision connectivity check timed out."
    except requests.RequestException:
        return False, "Hikvision is unreachable from the office laptop."
    except RuntimeError as error:
        # Missing-variable messages name the variable only, never its value.
        return False, str(error)


def sync_users_dataset() -> dict:
    """Keep current device presence separate from retained local audit history."""
    users_file = _users_file()
    cached_users = read_cached_users()
    cached_by_no = {
        str(user.get("employeeNo") or user.get("employeeNoString") or "").strip(): user
        for user in cached_users
    }
    cached_by_no.pop("", None)
    users_by_device, device_failures = fetch_current_users()
    current_users = [user for device_users in users_by_device.values() for user in device_users]
    current_by_no, conflicts = merge_device_users(current_users)
    device_ids = [device.device_id for device in configured_devices()]
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
    return {
        "status": "ok",
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
        "users": merged,
    }
