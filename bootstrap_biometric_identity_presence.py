"""Manual one-time conservative bootstrap for Hikvision identity discovery tracking."""
import argparse
import json
from datetime import datetime, timedelta, timezone

import requests

from hikvision_devices import configured_devices
from hikvision_local_config import load_local_hikvision_config, require_local_settings
from hikvision_user_sync import read_cached_users


def bootstrap_rows():
    device_ids = [device.device_id for device in configured_devices()]
    rows = []
    for user in read_cached_users():
        employee_no = str(user.get('employeeNo') or user.get('employeeNoString') or '').strip()
        if not employee_no:
            continue
        known_devices = user.get('devices') or device_ids
        is_current = user.get('_local_sync', {}).get('is_currently_returned') is not False
        for device_id in known_devices:
            rows.append({'device_id': device_id, 'device_employee_no': employee_no, 'device_name': str(user.get('name') or '').strip() or None, 'is_current': is_current})
    return rows


def main():
    parser = argparse.ArgumentParser(description='Conservatively bootstrap existing Hikvision identities as older than seven days.')
    parser.add_argument('--confirm-bootstrap', action='store_true', help='Required to write the additive bootstrap rows.')
    args = parser.parse_args()
    load_local_hikvision_config()
    require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
    rows = bootstrap_rows()
    baseline = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    print(f'Biometric identity bootstrap: rows={len(rows)} baseline={baseline} dry_run={not args.confirm_bootstrap}')
    if not args.confirm_bootstrap:
        return
    import os
    url, key = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['SUPABASE_SERVICE_ROLE_KEY']
    response = requests.post(f'{url}/rest/v1/rpc/bootstrap_biometric_device_identity_presence', headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}, json={'p_rows': rows, 'p_baseline_seen_at': baseline}, timeout=60)
    response.raise_for_status()
    print(f'Biometric identity bootstrap complete: inserted_or_preserved={len(rows)}')


if __name__ == '__main__':
    main()
