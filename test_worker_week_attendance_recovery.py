import unittest
from datetime import date

from hikvision_worker_week_recovery import (
    WorkerWeekRecoveryError,
    _mapping_was_established_before_event,
    _worker_events,
    monday_saturday_dates,
)


class WorkerWeekAttendanceRecoveryTests(unittest.TestCase):
    def test_selected_week_is_exactly_monday_through_saturday(self):
        self.assertEqual([item.isoformat() for item in monday_saturday_dates('2026-09-21')], [
            '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
        ])
        with self.assertRaises(WorkerWeekRecoveryError):
            monday_saturday_dates('2026-09-22')

    def test_mapping_created_after_evidence_is_skipped(self):
        mapping = {'created_at': '2026-09-22T08:00:00+01:00'}
        event = {'time': '2026-09-21T18:39:00+01:00'}
        self.assertFalse(_mapping_was_established_before_event(mapping, event))

    def test_only_exact_confirmed_worker_mapping_is_used(self):
        resolution = {
            'confirmed': {('office-main', '71'): {'worker_id': 'worker-a', 'created_at': '2026-09-01T00:00:00+01:00'}},
            'mapping_conflicts': set(),
        }
        events = [
            {'_device_id': 'office-main', 'employeeNoString': '71', 'time': '2026-09-21T07:53:00+01:00'},
            {'_device_id': 'office-main', 'employeeNoString': '72', 'time': '2026-09-21T07:53:00+01:00'},
        ]
        safe, skipped = _worker_events(events, resolution, 'worker-a')
        self.assertEqual([event['employeeNoString'] for event in safe], ['71'])
        self.assertEqual(skipped, [])

    def test_conflicted_identity_cannot_be_recovered(self):
        resolution = {
            'confirmed': {},
            'mapping_conflicts': {('office-main', '71')},
        }
        safe, skipped = _worker_events([{'_device_id': 'office-main', 'employeeNoString': '71', 'time': '2026-09-21T07:53:00+01:00'}], resolution, 'worker-a')
        self.assertEqual(safe, [])
        self.assertEqual(skipped, [])


if __name__ == '__main__':
    unittest.main()
