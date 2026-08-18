import unittest
from datetime import date
from hikvision_attendance_sync import plan_attendance
from hikvision_user_sync import merge_device_users

class MultiDevicePlanningTests(unittest.TestCase):
    def test_earliest_and_latest_across_devices(self):
        resolution = {'confirmed': {'072': {'worker_id': 'w'}}, 'unconfirmed': set(), 'workers': {'w': {'id': 'w', 'is_active': True, 'team_id': None}}, 'classifications': {'w': 'special_staff'}, 'existing_attendance': {}}
        events = [
            {'employeeNoString': '072', 'time': '2026-08-12T08:10:00+01:00', '_device_id': 'secondary'},
            {'employeeNoString': '072', 'time': '2026-08-12T07:48:00+01:00', '_device_id': 'main'},
            {'employeeNoString': '072', 'time': '2026-08-12T16:58:00+01:00', '_device_id': 'main'},
            {'employeeNoString': '072', 'time': '2026-08-12T17:06:00+01:00', '_device_id': 'secondary'},
        ]
        plans, _ = plan_attendance(events, resolution, date(2026, 8, 12))
        self.assertEqual(plans[0]['check_in'], '07:48:00')
        self.assertEqual(plans[0]['check_out'], '17:06:00')
        self.assertEqual(plans[0]['biometric_sync_metadata']['check_out_device_id'], 'secondary')

    def test_manual_protection_and_special_staff_are_preserved(self):
        resolution = {'confirmed': {'8': {'worker_id': 'w'}}, 'unconfirmed': set(), 'workers': {'w': {'id': 'w', 'is_active': True, 'team_id': None}}, 'classifications': {'w': 'special_staff'}, 'existing_attendance': {'w': {'attendance_source': 'biometric', 'manual_override': True}}}
        plans, _ = plan_attendance([{'employeeNoString': '8', 'time': '2026-08-12T08:00:00+01:00', '_device_id': 'main'}], resolution, date(2026, 8, 12))
        self.assertEqual(plans[0]['classification'], 'special_staff')
        self.assertEqual(plans[0]['existing_attendance_protection'], 'manual_protected')

    def test_same_identity_deduplicates_and_conflicting_name_is_flagged(self):
        merged, conflicts = merge_device_users([
            {'employeeNo': '072', 'name': 'DAVID', '_device_id': 'main'},
            {'employeeNo': '072', 'name': 'DAVID OTHER', '_device_id': 'secondary'},
        ])
        self.assertEqual(merged['072']['devices'], ['main', 'secondary'])
        self.assertTrue(merged['072']['device_identity_conflict'])
        self.assertEqual(conflicts, ['072'])

    def test_duplicate_events_do_not_change_earliest_or_latest_selection(self):
        resolution = {'confirmed': {'1': {'worker_id': 'w'}}, 'unconfirmed': set(), 'workers': {'w': {'id': 'w', 'is_active': True, 'team_id': 't'}}, 'classifications': {}, 'existing_attendance': {}}
        event = {'employeeNoString': '1', 'time': '2026-08-12T07:55:00+01:00', '_device_id': 'main'}
        plans, _ = plan_attendance([event, {**event, '_device_id': 'secondary'}], resolution, date(2026, 8, 12))
        self.assertEqual(plans[0]['check_in'], '07:55:00')
