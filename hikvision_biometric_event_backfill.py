"""Explicit, one-day-only backfill for biometric monitoring observations.

This tool never creates or updates attendance.  It is intentionally separate
from the Agent and requires an explicit confirmation argument.
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
    resolved_biometric_event_rows,
)
from hikvision_devices import configured_devices
from hikvision_local_config import load_local_hikvision_config, require_local_settings


def main() -> int:
    parser = argparse.ArgumentParser(description='Backfill one day of biometric monitoring events only.')
    parser.add_argument('--date', required=True, help='Single date to read: YYYY-MM-DD')
    parser.add_argument('--confirm-event-backfill', action='store_true', help='Required acknowledgement; no attendance is written.')
    args = parser.parse_args()
    if not args.confirm_event_backfill:
        print('BACKFILL ABORTED: --confirm-event-backfill is required. No writes were attempted.', file=sys.stderr)
        return 2
    try:
        target_date = date_type.fromisoformat(args.date)
        load_local_hikvision_config()
        configured_devices()
        require_local_settings('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')
        diagnostics = RequestDiagnostics(False)
        events, device_reads = hikvision_events_with_devices(target_date, diagnostics)
        blocked_reason = attendance_apply_blocked_reason(device_reads)
        if blocked_reason:
            print(f'BACKFILL ABORTED: {blocked_reason} No monitoring rows were written.', file=sys.stderr)
            return 3
        client = SupabaseReadClient(diagnostics)
        resolution = load_resolution_data(client, target_date, for_apply=False)
        rows = resolved_biometric_event_rows(events, resolution, target_date)
        client.insert_biometric_attendance_events(rows)
        print(f'Biometric monitoring backfill complete: date={target_date.isoformat()} events={len(events)} observed_rows={len(rows)}')
        return 0
    except (RuntimeError, requests.RequestException, ValueError) as error:
        print(f'BACKFILL FAILED: {type(error).__name__}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
