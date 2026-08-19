"""Focused non-network tests for append-only biometric monitoring rows."""

import unittest
from datetime import date

from hikvision_attendance_sync import (
    monitoring_timestamp_repairs,
    parse_event_time,
    plan_attendance,
    resolved_biometric_event_rows,
)


TARGET_DATE = date(2026, 8, 18)
WORKER_ID = 'worker-1'


def event(serial, value, employee_no='8', device_id='office-main'):
    return {
        'major': 5,
        'minor': 75,
        'employeeNoString': employee_no,
        'serialNo': serial,
        'time': f'2026-08-18T{value}+01:00',
        '_device_id': device_id,
    }


def event_with_timestamp(serial, timestamp, device_id):
    return {
        'major': 5,
        'minor': 75,
        'employeeNoString': '8',
        'serialNo': serial,
        'time': timestamp,
        '_device_id': device_id,
    }


def resolution():
    return {
        'confirmed': {'8': {'worker_id': WORKER_ID, 'device_employee_no': '8'}},
        'unconfirmed': set(),
        'ignored': set(),
        'workers': {WORKER_ID: {'id': WORKER_ID, 'full_name': 'Monitoring Worker', 'is_active': True, 'team_id': None}},
        'classifications': {WORKER_ID: 'special_staff'},
        'existing_attendance': {},
    }


class BiometricEventMonitoringTests(unittest.TestCase):
    def test_all_resolved_morning_midday_and_evening_events_are_retained(self):
        rows = resolved_biometric_event_rows([
            event('morning', '07:48:00'),
            event('midday', '12:03:00'),
            event('afternoon', '13:17:00'),
            event('evening', '18:22:00'),
        ], resolution(), TARGET_DATE)
        self.assertEqual(len(rows), 4)
        self.assertEqual([row['event_timestamp'][-14:-6] for row in rows], ['07:48:00', '12:03:00', '13:17:00', '18:22:00'])
        self.assertTrue(all(row['worker_id'] == WORKER_ID for row in rows))

    def test_duplicate_and_segmented_recovery_events_produce_one_idempotent_row(self):
        repeated = event('same-event', '12:03:00')
        rows_once = resolved_biometric_event_rows([repeated], resolution(), TARGET_DATE)
        rows_retried = resolved_biometric_event_rows([repeated, dict(repeated)], resolution(), TARGET_DATE)
        self.assertEqual(len(rows_once), 1)
        self.assertEqual(rows_once, rows_retried)
        self.assertEqual(rows_once[0]['device_id'], 'office-main')

    def test_monitoring_preserves_office_main_kinshasa_wall_clock(self):
        row = resolved_biometric_event_rows([
            event_with_timestamp('main-time', '2026-08-18T08:08:00+01:00', 'office-main'),
        ], resolution(), TARGET_DATE)[0]
        self.assertEqual(row['event_timestamp'], '2026-08-18T08:08:00+01:00')

    def test_monitoring_normalizes_secondary_bad_offset_to_kinshasa_wall_clock(self):
        source = '2026-08-18T08:08:00+08:00'
        row = resolved_biometric_event_rows([
            event_with_timestamp('secondary-time', source, 'office-secondary'),
        ], resolution(), TARGET_DATE)[0]
        self.assertEqual(row['event_timestamp'], '2026-08-18T08:08:00+01:00')
        self.assertEqual(parse_event_time(source).isoformat(), source)

    def test_timestamp_repair_keeps_identity_and_only_changes_different_timestamp(self):
        row = resolved_biometric_event_rows([
            event_with_timestamp('secondary-time', '2026-08-18T08:08:00+08:00', 'office-secondary'),
        ], resolution(), TARGET_DATE)[0]
        existing = [{
            'id': 'event-row-1',
            'device_id': row['device_id'],
            'event_identity': row['event_identity'],
            'event_timestamp': '2026-08-18T01:08:00+00:00',
        }]
        repairs = monitoring_timestamp_repairs([row], existing)
        self.assertEqual(repairs, [{'id': 'event-row-1', 'event_timestamp': '2026-08-18T08:08:00+01:00'}])
        self.assertEqual(row['event_identity'], existing[0]['event_identity'])

    def test_unmapped_or_ignored_events_are_never_persisted(self):
        self.assertEqual(resolved_biometric_event_rows([event('unmapped', '12:03:00', employee_no='99')], resolution(), TARGET_DATE), [])
        ignored = resolution()
        ignored['ignored'] = {'8'}
        self.assertEqual(resolved_biometric_event_rows([event('ignored', '12:03:00')], ignored, TARGET_DATE), [])

    def test_monitoring_rows_do_not_change_attendance_planning(self):
        events = [event('morning', '07:48:00'), event('midday', '12:03:00'), event('evening', '18:22:00')]
        plans, _ = plan_attendance(events, resolution(), TARGET_DATE)
        self.assertEqual(len(resolved_biometric_event_rows(events, resolution(), TARGET_DATE)), 3)
        self.assertEqual(plans[0]['check_in'], '07:48:00')
        self.assertEqual(plans[0]['check_out'], '18:22:00')
        self.assertEqual(plans[0]['proposed_status'], 'present')

    def test_monitoring_rpc_shape_is_first_last_and_chronological_times(self):
        rows = resolved_biometric_event_rows([
            event('late', '18:22:00'), event('first', '07:48:00'), event('middle', '12:03:00'),
        ], resolution(), TARGET_DATE)
        times = [row['event_timestamp'][-14:-6] for row in rows]
        self.assertEqual(times[0], '07:48:00')
        self.assertEqual(times[-1], '18:22:00')
        self.assertEqual(times, sorted(times))


if __name__ == '__main__':
    unittest.main()
