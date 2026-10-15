"""Evidence-only historical night reconciliation using the protected writer.

Dry-run by default. Snapshot corrections remain a separate, operator-only SQL
transaction through private.correct_night_supervisor_review; this script emits
its persisted-event proof, never rebuilds a population or calls public RPCs.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, timedelta
import json

from attendance_shift import is_night_worker, night_event_date, night_window
from hikvision_local_config import load_local_hikvision_config
from hikvision_attendance_sync import (
    MONITORING_TIME_ZONE, RequestDiagnostics, SupabaseReadClient,
    apply_biometric_attendance, biometric_identity_is_ignored,
    biometric_mapping_for_event, biometric_payload, is_manual_protected,
    load_resolution_data, local_now, parse_monitoring_event_time,
    persisted_biometric_events, plan_attendance, worker_is_operational_on_date,
)

START_DATE = date(2026, 10, 12)
SOURCE = 'historical_night_shift_reconciliation_v1'


class HistoricalNightClient(SupabaseReadClient):
    """Page the bulk event store without changing the normal day-worker reader."""
    def read(self, table, select, **filters):
        if table != 'biometric_attendance_events':
            return super().read(table, select, **filters)
        rows = []
        cursor = None
        while True:
            page_filters = {**filters, 'order': 'id.asc', 'limit': '500'}
            if cursor:
                page_filters['id'] = f'gt.{cursor}'
            page = super().read(table, select, **page_filters)
            rows.extend(page)
            if len(page) < 500:
                return rows
            cursor = page[-1]['id']


def build_night_reconciliation(events, resolution, target_date):
    if target_date < START_DATE or target_date > local_now().date():
        raise ValueError('Outside authorized historical night date range')
    workers = {wid: w for wid, w in resolution['workers'].items() if is_night_worker(w)}
    grouped = defaultdict(list)
    unsafe = set()
    for event in events:
        if event.get('major') != 5 or event.get('minor') != 75:
            continue
        try:
            if night_event_date(parse_monitoring_event_time(event['time'])) != target_date:
                continue
        except (KeyError, ValueError):
            continue
        mapping = biometric_mapping_for_event(resolution, event)
        ignored = biometric_identity_is_ignored(resolution, event)
        if not mapping or ignored:
            for candidate in resolution.get('active_mapping_rows', []):
                if (candidate.get('device_employee_no') == event.get('employeeNoString')
                    and candidate.get('device_id') in (None, event.get('_device_id'))
                    and candidate.get('worker_id') in workers):
                    unsafe.add(candidate['worker_id'])
            continue
        wid = str(mapping.get('worker_id') or '')
        if wid not in workers:
            continue
        if ('_persisted_worker_id' in event and event['_persisted_worker_id'] != wid) or not event.get('_persisted_event_id'):
            unsafe.add(wid)
            continue
        grouped[wid].append(event)

    plans, reports, proofs = [], [], []
    for wid, worker in sorted(workers.items()):
        existing = resolution['existing_attendance'].get(wid)
        evidence = sorted(grouped[wid], key=lambda e: parse_monitoring_event_time(e['time']))
        report = {'date': target_date.isoformat(), 'worker_id': wid,
                  'worker': worker['full_name'], 'employee_code': worker.get('employee_code'),
                  'events': [{'id': e['_persisted_event_id'], 'device': e['_device_id'],
                              'biometric_id': e['employeeNoString'], 'time': e['time']} for e in evidence],
                  'before': {k: existing.get(k) for k in ('id', 'status', 'check_in', 'check_out', 'attendance_day_fraction', 'manual_override')} if existing else None}
        reports.append(report)
        if wid in unsafe:
            report['action'] = 'skip_ambiguous_or_ignored_identity'
            continue
        if not worker_is_operational_on_date(worker, target_date):
            report['action'] = 'skip_ineligible'
            continue
        if is_manual_protected(existing) or 'supervisor_morning_review' in ((existing or {}).get('biometric_sync_metadata') or {}):
            report['action'] = 'skip_manual_protected'
            continue
        if not evidence:
            report['action'] = 'no_night_evidence_no_change'
            continue
        scoped = {**resolution, 'workers': {wid: worker}, 'existing_attendance': {wid: existing} if existing else {}}
        candidate_plans, _ = plan_attendance(evidence, scoped, target_date)
        if len(candidate_plans) != 1:
            report['action'] = 'skip_planner_disagreement'
            continue
        plan = candidate_plans[0]
        payload = biometric_payload(plan, existing)
        first = parse_monitoring_event_time(evidence[0]['time'])
        last = parse_monitoring_event_time(evidence[-1]['time'])
        expected_checkout = last.strftime('%H:%M:%S') if last > first else None
        if (not payload or payload['status'] != 'present' or payload['attendance_day_fraction'] != 1.0
            or payload['check_in'] != first.strftime('%H:%M:%S') or payload['check_out'] != expected_checkout):
            report['action'] = 'skip_planner_evidence_disagreement'
            continue
        start, end = night_window(target_date, MONITORING_TIME_ZONE)
        metadata = dict(plan.get('biometric_sync_metadata') or {})
        prior = metadata.get('night_reconciliation', {})
        event_ids = list(dict.fromkeys(e['_persisted_event_id'] for e in evidence))
        if prior.get('source') != SOURCE or prior.get('event_ids') != event_ids:
            metadata['night_reconciliation'] = {
                'source': SOURCE, 'reconciled_at': local_now().isoformat(),
                'attendance_date': target_date.isoformat(), 'window_start': start.isoformat(), 'window_end': end.isoformat(),
                'event_ids': event_ids, 'reason': 'Explicit night classification; real evidence in 17:00 to next-day 06:30 window',
                'before': report['before'], 'previous_biometric_metadata': (existing or {}).get('biometric_sync_metadata'),
            }
        plan['biometric_sync_metadata'] = metadata
        plans.append(plan)
        proofs.append({'worker_id': wid, 'event_ids': event_ids})
        report['action'] = 'reconcile_biometric_present'
        report['after'] = {k: payload[k] for k in ('status', 'check_in', 'check_out', 'attendance_day_fraction', 'manual_override')}
    return plans, reports, proofs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--start', type=date.fromisoformat, default=START_DATE)
    parser.add_argument('--end', type=date.fromisoformat)
    parser.add_argument('--apply', action='store_true', help='Apply only proven night attendance using the protected writer')
    args = parser.parse_args()
    end = args.end or local_now().date()
    if args.start < START_DATE or end > local_now().date() or end < args.start:
        parser.error('Select October 12 through today only')
    load_local_hikvision_config()
    client = HistoricalNightClient(RequestDiagnostics(False))
    day = args.start
    output = []
    while day <= end:
        resolution = load_resolution_data(client, day, for_apply=True)
        events, _ = persisted_biometric_events(client, day)
        rows = client.read('biometric_attendance_events', 'id,worker_id',
                           attendance_date=f'in.({day.isoformat()},{(day+timedelta(days=1)).isoformat()})')
        owners = {row['id']: row.get('worker_id') for row in rows}
        for event in events:
            event['_persisted_worker_id'] = owners.get(event['_persisted_event_id'])
        plans, reports, proofs = build_night_reconciliation(events, resolution, day)
        item = {'date': day.isoformat(), 'workers': reports, 'snapshot_evidence': proofs}
        if args.apply:
            item['writer_result'] = dict(apply_biometric_attendance(client, plans, resolution['existing_attendance']))
        output.append(item)
        day += timedelta(days=1)
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
