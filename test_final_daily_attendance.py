"""Read-only regressions for the dated present/absent biometric rule."""

import unittest
from datetime import date
from unittest.mock import patch

from hikvision_attendance_sync import (
    apply_biometric_attendance, biometric_payload, plan_attendance,
)


WORKDAY = date(2026, 10, 13)
WORKER = 'worker-1'


def resolution(existing=None):
    return {
        'confirmed': {('office-main', '021'): {'worker_id': WORKER, 'device_id': 'office-main', 'device_employee_no': '021'}},
        'unconfirmed': set(), 'ignored': set(), 'mapping_conflicts': set(),
        'workers': {WORKER: {'id': WORKER, 'full_name': 'Test Worker', 'is_active': True, 'team_id': None}},
        'teams': {}, 'classifications': {WORKER: 'normal'},
        'existing_attendance': {WORKER: existing} if existing else {},
    }


def event(clock, *, day='2026-10-13', identity='021', serial=1):
    return {'employeeNoString': identity, '_device_id': 'office-main',
            'time': f'{day}T{clock}+01:00', 'major': 5, 'minor': 75, 'serialNo': serial}


class FinalDailyAttendanceTests(unittest.TestCase):
    def test_one_morning_or_evening_event_is_present_without_fake_checkout(self):
        for clock in ('08:00:00', '17:13:11'):
            with self.subTest(clock=clock):
                plan = plan_attendance([event(clock)], resolution(), WORKDAY)[0][0]
                payload = biometric_payload(plan, None)
                self.assertEqual(payload['status'], 'present')
                self.assertEqual(payload['attendance_day_fraction'], 1.0)
                self.assertEqual(payload['check_in'], clock)
                self.assertIsNone(payload['check_out'])

    def test_two_real_events_keep_earliest_and_latest(self):
        events = [event('18:30:00', serial=2), event('07:30:00')]
        plan = plan_attendance(events, resolution(), WORKDAY)[0][0]
        payload = biometric_payload(plan, None)
        self.assertEqual((payload['status'], payload['check_in'], payload['check_out']),
                         ('present', '07:30:00', '18:30:00'))

    def test_next_day_checkout_only_is_present_without_fake_checkin(self):
        plan = plan_attendance([event('00:31:00', day='2026-10-14')], resolution(), WORKDAY)[0][0]
        payload = biometric_payload(plan, None)
        self.assertEqual((payload['status'], payload['check_in'], payload['check_out']),
                         ('present', None, '00:31:00'))
        self.assertTrue(payload['review_approved_check_out_at'].startswith('2026-10-14T00:31'))

    @patch('hikvision_attendance_sync.eligible_for_automatic_absence', return_value=True)
    def test_no_event_is_absent_only_after_safe_finalization(self, _eligible):
        plan = plan_attendance([], resolution(), WORKDAY)[0][0]
        self.assertEqual((plan['proposed_status'], plan['day_fraction']), ('absent', 0.0))

    @patch('hikvision_attendance_sync.eligible_for_automatic_absence', return_value=False)
    def test_no_event_remains_provisional_during_current_day(self, _eligible):
        plan = plan_attendance([], resolution(), WORKDAY)[0][0]
        self.assertEqual(plan['proposed_status'], 'pending')

    def test_exact_leading_zero_identity_is_not_name_matched(self):
        plans, counters = plan_attendance([event('08:00:00', identity='21')], resolution(), WORKDAY)
        self.assertEqual(counters['unmapped'], 1)
        self.assertNotEqual(plans[0]['proposed_status'], 'present')

    def test_supervisor_manual_choices_cannot_be_overwritten_by_sync(self):
        class NoWriteClient:
            def insert_attendance(self, _payload):
                raise AssertionError('protected result must not be inserted')

            def update_attendance(self, _id, _payload):
                raise AssertionError('protected result must not be updated')

        for choice, status, reason in (('P', 'present', None), ('O', 'present', 'working_outside'),
                                       ('A', 'absent', None), ('M', 'absent', 'medical')):
            with self.subTest(choice=choice):
                existing = {'id': 'attendance-1', 'attendance_date': WORKDAY.isoformat(),
                            'status': status, 'check_in': None, 'check_out': None,
                            'attendance_source': 'manual', 'manual_override': True,
                            'biometric_sync_metadata': {'supervisor_morning_review': {'choice': choice, 'reason': reason}}}
                plans, _ = plan_attendance([event('08:00:00')], resolution(existing), WORKDAY)
                results = apply_biometric_attendance(NoWriteClient(), plans, {WORKER: existing})
                self.assertEqual(results['skipped_manual_protected'], 1)
                self.assertEqual(existing['status'], status)

    def test_pre_cutover_historical_half_day_is_preserved(self):
        old_day = date(2026, 10, 12)
        plan = plan_attendance([event('08:00:00', day='2026-10-12')], resolution(), old_day)[0][0]
        self.assertEqual(plan['proposed_status'], 'half_day')


if __name__ == '__main__':
    unittest.main()
