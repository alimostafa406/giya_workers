"""Explicit, one-day repair for incorrect biometric monitoring timestamps only.

Reads Hikvision again, requires every configured device to be complete, and
updates only existing observation rows identified by (device_id, event_identity).
Attendance, mappings, and event insertion are intentionally out of scope.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date as date_type

import requests

from hikvision_attendance_sync import (
    RequestDiagnostics,
    SupabaseReadClient,
    attendance_apply_blocked_reason,
    hikvision_events_with_devices,
    load_resolution_data,
    monitoring_timestamp_repairs,
    resolved_biometric_event_rows,
)
from hikvision_devices import configured_devices
from hikvision_local_config import load_local_hikvision_config, require_local_settings


def main() -> int:
    parser = argparse.ArgumentParser(description='Dry-run or repair one day of biometric monitoring timestamps only.')
    parser.add_argument('--date', required=True, help='Single date to read: YYYY-MM-DD')
    parser.add_argument(
        '--confirm-monitoring-time-repair', action='store_true',
        help='Required to update existing monitoring event timestamps; no attendance is ever written.',
    )
    args = parser.parse_args()
    try:
        target_date = date_type.fromisoformat(args.date)
        load_local_hikvision_config()
        configured_devices()
        require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
        diagnostics = RequestDiagnostics(False)
        events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
        blocked_reason = attendance_apply_blocked_reason(device_reads)
        if blocked_reason:
            print(f'REPAIR ABORTED: {blocked_reason} No monitoring rows were changed.', file=sys.stderr)
            return 3
        client = SupabaseReadClient(diagnostics)
        resolution = load_resolution_data(client, target_date, for_apply=False)
        rows = resolved_biometric_event_rows(events, resolution, target_date)
        existing = client.read_biometric_attendance_events_by_identity(rows)
        repairs = monitoring_timestamp_repairs(rows, existing)
        if not args.confirm_monitoring_time_repair:
            print(
                f'Monitoring timestamp repair dry run: date={target_date.isoformat()} '
                f'events={len(events)} resolved_rows={len(rows)} matching_rows={len(existing)} '
                f'would_update={len(repairs)}'
            )
            return 0
        for repair in repairs:
            client.update_biometric_attendance_event_timestamp(repair['id'], repair['event_timestamp'])
        print(
            f'Monitoring timestamp repair complete: date={target_date.isoformat()} '
            f'events={len(events)} resolved_rows={len(rows)} matching_rows={len(existing)} '
            f'updated={len(repairs)}'
        )
        return 0
    except (RuntimeError, requests.RequestException, ValueError) as error:
        print(f'REPAIR FAILED: {type(error).__name__}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
