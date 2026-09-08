"""Regression coverage for the narrow 01:00-05:59 manual-review boundary."""

import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from early_morning_attendance_review import (
    is_early_morning_review_time,
    partition_early_morning_events,
)
from hikvision_attendance_sync import plan_attendance


KINSHASA = timezone(timedelta(hours=1))
SEP7 = date(2026, 9, 7)
SEP8 = date(2026, 9, 8)


def event(day, clock, serial='1'):
    return {
        'time': f'{day.isoformat()}T{clock}+01:00',
        'employeeNoString': '39', '_device_id': 'office-main',
        'serialNo': serial, 'major': 5, 'minor': 75,
    }


def resolution(existing=None):
    return {
        'workers': {'w1': {'id': 'w1', 'full_name': 'NIVA', 'is_active': True, 'team_id': 't1'}},
        'classifications': {'w1': 'normal'},
        'existing_attendance': {} if existing is None else {'w1': existing},
        'confirmed': {('office-main', '39'): {
            'worker_id': 'w1', 'device_id': 'office-main',
            'device_employee_no': '39', 'is_active': True,
            'mapping_review_state': 'confirmed',
        }},
        'unconfirmed': set(), 'ignored': set(), 'mapping_conflicts': set(),
    }


class EarlyMorningReviewTests(unittest.TestCase):
    def test_review_window_is_exact_and_kinshasa_local(self):
        self.assertFalse(is_early_morning_review_time(time(0, 59, 59)))
        self.assertTrue(is_early_morning_review_time(time(1, 0)))
        self.assertTrue(is_early_morning_review_time(time(5, 59, 59)))
        self.assertFalse(is_early_morning_review_time(time(6, 0)))

    def test_existing_sep7_checkin_and_sep8_0300_never_auto_checkout(self):
        existing = {
            'attendance_date': '2026-09-07', 'status': 'half_day',
            'check_in': '08:00:00', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        }
        plans, counters = plan_attendance([event(SEP8, '03:00:00')], resolution(existing), SEP7)
        self.assertEqual(counters['early_morning_needs_review'], 1)
        self.assertEqual(plans[0]['check_in'], '08:00:00')
        self.assertIsNone(plans[0]['check_out'])
        self.assertEqual(plans[0]['proposed_status'], 'half_day')

    def test_no_previous_attendance_and_sep8_0300_never_auto_checkin(self):
        plans, counters = plan_attendance([event(SEP8, '03:00:00')], resolution(), SEP8)
        self.assertEqual(counters['early_morning_needs_review'], 1)
        self.assertIsNone(plans[0]['check_in'])
        self.assertIsNone(plans[0]['check_out'])

    def test_duplicate_partition_does_not_mutate_or_infer_role(self):
        punch = event(SEP8, '03:00:00')
        review, automatic = partition_early_morning_events(
            [punch, punch],
            parse_timestamp=lambda value: datetime.fromisoformat(value),
        )
        self.assertEqual(review, [punch, punch])
        self.assertEqual(automatic, [])
        self.assertNotIn('attendance_role', punch)

    def test_outside_window_continues_existing_checkin_logic(self):
        plans, counters = plan_attendance([event(SEP8, '06:00:00')], resolution(), SEP8)
        self.assertEqual(counters['early_morning_needs_review'], 0)
        self.assertEqual(plans[0]['check_in'], '06:00:00')
        self.assertEqual(plans[0]['proposed_status'], 'half_day')

    def test_sql_is_idempotent_auditable_and_protects_manual_rows(self):
        sql = Path('supabase/sql/early_morning_biometric_review.sql').read_text(encoding='utf-8')
        self.assertIn('unique (event_id)', sql.lower())
        self.assertIn("if v_review.review_status = 'resolved'", sql.lower())
        self.assertIn('reviewed_by = auth.uid()', sql.lower())
        self.assertIn('previous_workday_check_out', sql)
        self.assertIn("p_decision = 'ignored'", sql)
        self.assertIn("v_attendance.manual_override is true", sql)
        self.assertIn('Pending early-morning biometric review prevents absence', sql)
        self.assertNotIn('biometric_attendance_event_assignment', sql)
        self.assertNotIn('check_in_at timestamptz', sql)

    def test_sql_preserves_exact_timestamp_and_raw_event(self):
        sql = Path('supabase/sql/early_morning_biometric_review.sql').read_text(encoding='utf-8').lower()
        self.assertIn('review_approved_check_out_at = v_review.event_timestamp', sql)
        self.assertIn("'event_timestamp', v_review.event_timestamp", sql)
        self.assertNotIn('delete from public.biometric_attendance_events', sql)
        self.assertNotIn('update public.biometric_attendance_events', sql)


if __name__ == '__main__':
    unittest.main()
