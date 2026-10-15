"""Non-writing batch regressions around the existing protected night writer."""
from copy import deepcopy
from datetime import date
import unittest
from unittest.mock import Mock, patch

from hikvision_night_reconciliation import build_night_reconciliation, HistoricalNightClient
from hikvision_attendance_sync import apply_biometric_attendance, biometric_payload
from test_attendance_sync_planning import resolution_with, attendance_event, WORKER_ID


class HistoricalNightTests(unittest.TestCase):
    def test_event_read_pages_past_postgrest_cap_with_stable_identity_cursor(self):
        client = object.__new__(HistoricalNightClient)
        first = [{'id': f'{n:04}'} for n in range(500)]
        with patch('hikvision_night_reconciliation.SupabaseReadClient.read', side_effect=[first, [{'id': 'last'}]]) as read:
            result = client.read('biometric_attendance_events', 'id,worker_id', attendance_date='eq.2026-10-12')
        self.assertEqual(len(result), 501)
        self.assertEqual(read.call_args_list[1].kwargs['id'], 'gt.0499')

    def fixture(self):
        result = resolution_with(None)
        result['workers'][WORKER_ID]['attendance_shift'] = 'night'
        result['workers']['night2'] = {**result['workers'][WORKER_ID], 'id': 'night2', 'full_name': 'Night Two'}
        result['workers']['day'] = {**result['workers'][WORKER_ID], 'id': 'day', 'attendance_shift': 'day'}
        result['confirmed']['9'] = {'worker_id': 'night2', 'device_employee_no': '9'}
        result['confirmed']['10'] = {'worker_id': 'day', 'device_employee_no': '10'}
        result['active_mapping_rows'] = list(result['confirmed'].values())
        return result

    def event(self, day, clock, number='8', wid=WORKER_ID, serial=1):
        return {**attendance_event(clock, event_date=day.isoformat(), serial=serial),
                'employeeNoString': number, '_persisted_event_id': f'{number}-{day}-{serial}', '_persisted_worker_id': wid}

    def test_multiple_workers_and_dates_never_include_day_workers(self):
        for day in (date(2026, 10, 12), date(2026, 10, 13), date(2026, 10, 14)):
            resolution = self.fixture()
            before = deepcopy(resolution)
            events = [self.event(day, '18:00:00'), self.event(day, '19:00:00', '9', 'night2'), self.event(day, '08:00:00', '10', 'day')]
            plans, reports, proofs = build_night_reconciliation(events, resolution, day)
            self.assertEqual({p['worker_id'] for p in plans}, {WORKER_ID, 'night2'})
            self.assertEqual(len(proofs), 2)
            self.assertEqual(len(reports), 2)
            self.assertEqual(resolution, before)
            for plan in plans:
                payload = biometric_payload(plan, None)
                self.assertEqual(payload['status'], 'present')
                self.assertIsNone(payload['check_out'])
                self.assertFalse(payload['manual_override'])

    def test_cross_midnight_only_assigned_to_previous_night(self):
        day = date(2026, 10, 12)
        event = self.event(date(2026, 10, 13), '05:30:00')
        plans, _, proofs = build_night_reconciliation([event], self.fixture(), day)
        self.assertEqual(plans[0]['check_in'], '05:30:00')
        self.assertIsNone(plans[0]['check_out'])
        self.assertEqual(proofs[0]['event_ids'], [event['_persisted_event_id']])
        next_plans, _, _ = build_night_reconciliation([event], self.fixture(), date(2026, 10, 13))
        self.assertEqual(next_plans, [])

    def test_manual_decisions_and_changed_ownership_are_skipped(self):
        day = date(2026, 10, 12)
        resolution = self.fixture()
        resolution['existing_attendance'][WORKER_ID] = {'attendance_source': 'manual', 'manual_override': True, 'status': 'absent'}
        plans, reports, _ = build_night_reconciliation([self.event(day, '18:00:00')], resolution, day)
        self.assertEqual(plans, [])
        self.assertEqual(next(r for r in reports if r['worker_id']==WORKER_ID)['action'], 'skip_manual_protected')
        plans, reports, _ = build_night_reconciliation([self.event(day, '18:00:00', wid='different-owner')], self.fixture(), day)
        self.assertEqual(plans, [])
        self.assertEqual(next(r for r in reports if r['worker_id']==WORKER_ID)['action'], 'skip_ambiguous_or_ignored_identity')

    def test_no_evidence_no_write_and_before_october12_rejected(self):
        self.assertEqual(build_night_reconciliation([], self.fixture(), date(2026, 10, 12))[0], [])
        with self.assertRaises(ValueError):
            build_night_reconciliation([], self.fixture(), date(2026, 10, 11))

    def test_writer_only_updates_selected_biometric_attendance(self):
        day = date(2026, 10, 12)
        resolution = self.fixture()
        resolution['existing_attendance'][WORKER_ID] = {'id': 'attendance', 'attendance_date': day.isoformat(), 'attendance_source': 'biometric',
            'manual_override': False, 'status': 'half_day', 'check_in': '18:00:00', 'check_out': None}
        plans, _, _ = build_night_reconciliation([self.event(day, '18:00:00')], resolution, day)
        client = Mock()
        apply_biometric_attendance(client, plans, resolution['existing_attendance'])
        client.update_attendance_if_unchanged.assert_called_once()
        payload = client.update_attendance_if_unchanged.call_args.args[1]
        self.assertEqual(payload['status'], 'present')
        self.assertFalse(payload['manual_override'])
        self.assertEqual([call[0] for call in client.mock_calls], ['update_attendance_if_unchanged'])

    def test_audit_is_idempotent_for_unchanged_real_evidence(self):
        day = date(2026, 10, 12)
        resolution = self.fixture()
        event = self.event(day, '18:00:00')
        plans, _, _ = build_night_reconciliation([event], resolution, day)
        payload = biometric_payload(plans[0], None)
        resolution['existing_attendance'][WORKER_ID] = {**payload, 'attendance_date': day.isoformat()}
        repeated, _, _ = build_night_reconciliation([event], resolution, day)
        self.assertEqual(repeated[0]['biometric_sync_metadata']['night_reconciliation'], payload['biometric_sync_metadata']['night_reconciliation'])


if __name__ == '__main__':
    unittest.main()
