"""Focused non-writing checks for existing-attendance protection in planning."""

import unittest
from collections import Counter
from datetime import date, datetime
from unittest.mock import patch

import requests

from hikvision_attendance_sync import apply_biometric_attendance, is_manual_protected, plan_attendance, proposed_status, safe_postgrest_error_details, write_summary


TARGET_DATE = date(2026, 8, 11)  # Tuesday
WORKER_ID = "worker-1"


def resolution_with(existing_row):
    return {
        "confirmed": {
            "8": {
                "worker_id": WORKER_ID,
                "device_employee_no": "8",
            }
        },
        "unconfirmed": set(),
        "ignored": set(),
        "workers": {WORKER_ID: {"id": WORKER_ID, "full_name": "Test Worker", "is_active": True, "team_id": None}},
        "classifications": {WORKER_ID: "special_staff"},
        "existing_attendance": {} if existing_row is None else {WORKER_ID: existing_row},
    }


EVENTS = [{"employeeNoString": "8", "time": "2026-08-11T08:00:00+01:00"}]


class ExistingAttendanceProtectionTests(unittest.TestCase):
    @patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 8, 11, 23, 0))
    def test_current_date_without_morning_punch_never_finalizes_as_absent(self, _local_now):
        self.assertEqual(proposed_status(TARGET_DATE, None, None), ('pending', None))
        self.assertEqual(proposed_status(TARGET_DATE, None, datetime(2026, 8, 11, 17, 20)), ('pending', None))

    @patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 8, 12, 0, 1))
    def test_completed_past_workday_without_morning_punch_is_absent(self, _local_now):
        self.assertEqual(proposed_status(TARGET_DATE, None, None), ('absent', 0.0))

    def test_protection_rules(self):
        self.assertFalse(is_manual_protected(None))
        self.assertTrue(is_manual_protected({"attendance_source": "manual", "manual_override": False}))
        self.assertFalse(is_manual_protected({"attendance_source": "biometric", "manual_override": False}))
        self.assertTrue(is_manual_protected({"attendance_source": "biometric", "manual_override": True}))

    def test_plan_reports_protection_from_existing_row(self):
        cases = (
            (None, None),
            ({"attendance_source": "manual", "manual_override": False}, "manual_protected"),
            ({"attendance_source": "biometric", "manual_override": False}, None),
            ({"attendance_source": "biometric", "manual_override": True}, "manual_protected"),
        )
        for existing_row, expected in cases:
            with self.subTest(existing_row=existing_row):
                plans, _ = plan_attendance(EVENTS, resolution_with(existing_row), TARGET_DATE)
                self.assertEqual(plans[0]["existing_attendance_protection"], expected)

    def test_morning_metadata_without_evening_key_does_not_crash(self):
        plans, _ = plan_attendance(EVENTS, resolution_with(None), TARGET_DATE)
        plan = plans[0]
        self.assertEqual(plan['proposed_status'], 'half_day')
        self.assertIsNone(plan['evening_punch_time'])
        self.assertEqual(plan['biometric_sync_metadata']['check_in_device_id'], None)

    def test_ignored_identity_is_not_planned_for_attendance(self):
        resolution = resolution_with(None)
        resolution['ignored'] = {'8'}
        plans, counters = plan_attendance(EVENTS, resolution, TARGET_DATE)
        self.assertEqual(plans, [])
        self.assertEqual(counters['ignored_old_user'], 1)

    def test_dry_run_status_counters_come_from_final_plans(self):
        plans = [
            {
                'worker_id': 'one',
                'proposed_status': 'present',
                'check_in': '08:00:00',
                'check_out': '17:00:00',
                'day_fraction': 1.0,
                'sync_key': 'hikvision:one:2026-08-11',
                'biometric_sync_metadata': {},
                'checkout_only': False,
            },
            {
                'worker_id': 'two',
                'proposed_status': 'half_day',
                'check_in': '08:00:00',
                'check_out': None,
                'day_fraction': 0.5,
                'sync_key': 'hikvision:two:2026-08-11',
                'biometric_sync_metadata': {},
                'checkout_only': False,
            },
            {
                'worker_id': 'three',
                'proposed_status': 'absent',
                'check_in': None,
                'check_out': None,
                'day_fraction': 0,
                'sync_key': 'hikvision:three:2026-08-11',
                'biometric_sync_metadata': {},
                'checkout_only': True,
            },
            {
                'worker_id': 'four',
                'proposed_status': 'pending',
                'check_in': None,
                'check_out': None,
                'day_fraction': None,
                'sync_key': 'hikvision:four:2026-08-11',
                'biometric_sync_metadata': {},
                'checkout_only': False,
            },
        ]
        summary = write_summary(plans, {}, Counter())
        self.assertEqual(summary['present'], 1)
        self.assertEqual(summary['half_day'], 1)
        self.assertEqual(summary['absent'], 1)
        self.assertEqual(summary['pending'], 1)
        self.assertEqual(summary['checkout_only'], 1)
        self.assertEqual(sum(summary[status] for status in ('present', 'half_day', 'absent', 'pending')), len(plans))


class SupabaseStructuralErrorTests(unittest.TestCase):
    class FakeResponse:
        status_code = 400
        text = ''

        def json(self):
            return {
                'code': '23514',
                'message': 'new row violates check constraint',
                'details': 'Failing row contains an invalid status.',
                'hint': 'Review the constraint.',
            }

    class RejectingClient:
        def __init__(self):
            self.insert_calls = 0

        def insert_attendance(self, _payload):
            self.insert_calls += 1
            error = requests.HTTPError('400 Bad Request')
            error.response = SupabaseStructuralErrorTests.FakeResponse()
            raise error

    @staticmethod
    def plan(worker_id):
        return {
            'worker_id': worker_id,
            'proposed_status': 'present',
            'check_in': '08:00:00',
            'check_out': '17:00:00',
            'day_fraction': 1.0,
            'sync_key': f'hikvision:{worker_id}:2026-08-11',
            'biometric_sync_metadata': {},
        }

    def test_extracts_only_safe_postgrest_error_fields(self):
        error = requests.HTTPError('400 Bad Request')
        error.response = self.FakeResponse()
        self.assertEqual(safe_postgrest_error_details(error), {
            'status': 400,
            'code': '23514',
            'message': 'new row violates check constraint',
            'details': 'Failing row contains an invalid status.',
            'hint': 'Review the constraint.',
        })

    def test_first_structural_400_aborts_remaining_inserts(self):
        client = self.RejectingClient()
        results = apply_biometric_attendance(client, [self.plan('one'), self.plan('two')], {})
        self.assertEqual(client.insert_calls, 1)
        self.assertEqual(results['structural_supabase_error'], 1)
        self.assertEqual(results['aborted_structural_error'], 1)


if __name__ == "__main__":
    unittest.main()
