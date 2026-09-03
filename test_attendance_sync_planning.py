"""Focused non-writing checks for existing-attendance protection in planning."""

import unittest
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

import requests

from hikvision_attendance_sync import apply_biometric_attendance, biometric_payload, is_manual_protected, payload_changed, plan_attendance, proposed_status, safe_postgrest_error_details, write_summary


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


def attendance_event(clock, *, minor=75, serial=1, event_date='2026-08-11'):
    return {
        "employeeNoString": "8",
        "time": f"{event_date}T{clock}+01:00",
        "major": 5,
        "minor": minor,
        "serialNo": serial,
        "_device_id": "office-main",
    }


class ExistingAttendanceProtectionTests(unittest.TestCase):
    def test_existing_biometric_checkin_pairs_with_checkout_after_discontinuous_read(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'half_day',
            'check_in': '07:08:05',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
            'biometric_sync_metadata': {
                'check_in_device_id': 'office-secondary',
                'check_in_event_serial': '8423',
                'check_in_event_timestamp': '2026-08-11T07:08:05+08:00',
                'recovery': {'reason': 'timezone_change'},
            },
        }
        checkout = attendance_event('17:22:09', serial=8875)
        checkout['_device_id'] = 'office-secondary'
        checkout['employeeNoString'] = '8'

        plans, _ = plan_attendance([checkout], resolution_with(existing), TARGET_DATE)
        plan = plans[0]

        self.assertTrue(plan['check_in_from_existing'])
        self.assertEqual(plan['check_in'], '07:08:05')
        self.assertEqual(plan['check_out'], '17:22:09')
        self.assertEqual(plan['proposed_status'], 'present')
        self.assertEqual(plan['biometric_sync_metadata']['check_in_event_serial'], '8423')
        self.assertEqual(plan['biometric_sync_metadata']['recovery'], {'reason': 'timezone_change'})
        self.assertEqual(plan['biometric_sync_metadata']['check_out_event_serial'], 8875)
        self.assertEqual(plan['biometric_sync_metadata']['check_out_device_id'], 'office-secondary')
        self.assertEqual(plan['biometric_sync_metadata']['check_out_employee_no'], '8')
        self.assertEqual(plan['biometric_sync_metadata']['check_out_event_timestamp'], '2026-08-11T17:22:09+01:00')

    def test_existing_late_checkin_is_preserved_when_checkout_completes_day(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'half_day',
            'check_in': '10:31:15',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
            'biometric_sync_metadata': {'check_in_event_serial': '8613'},
        }
        plans, _ = plan_attendance([attendance_event('16:58:46', serial=205389)], resolution_with(existing), TARGET_DATE)
        payload = biometric_payload(plans[0], existing)

        self.assertEqual(payload['status'], 'late')
        self.assertEqual(payload['check_in'], '10:31:15')
        self.assertEqual(payload['check_out'], '16:58:46')
        self.assertEqual(payload['attendance_day_fraction'], 1.0)
        self.assertEqual(payload['biometric_sync_metadata']['check_in_event_serial'], '8613')

    def test_reconciliation_never_replaces_existing_checkin_with_earlier_observation(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'half_day',
            'check_in': '07:58:00',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
            'biometric_sync_metadata': {
                'check_in_event_serial': 'original-arrival',
                'check_in_event_timestamp': '2026-08-11T07:58:00+01:00',
            },
        }
        events = [attendance_event('05:30:00', serial=1), attendance_event('17:05:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(existing), TARGET_DATE)
        payload = biometric_payload(plans[0], existing)

        self.assertTrue(plans[0]['check_in_from_existing'])
        self.assertEqual(payload['check_in'], '07:58:00')
        self.assertEqual(payload['check_out'], '17:05:00')
        self.assertEqual(payload['biometric_sync_metadata']['check_in_event_serial'], 'original-arrival')
        self.assertEqual(payload['biometric_sync_metadata']['check_in_event_timestamp'], '2026-08-11T07:58:00+01:00')

    def test_checkout_after_finalization_time_upgrades_existing_half_day(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'half_day',
            'check_in': '07:50:00',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
        }
        plans, _ = plan_attendance([attendance_event('17:22:09', serial=2)], resolution_with(existing), TARGET_DATE)
        self.assertEqual(plans[0]['check_in'], '07:50:00')
        self.assertEqual(plans[0]['check_out'], '17:22:09')
        self.assertEqual(plans[0]['proposed_status'], 'present')

    def test_existing_checkin_fallback_rejects_manual_or_wrong_date_rows(self):
        cases = (
            {
                'attendance_date': TARGET_DATE.isoformat(), 'status': 'half_day', 'check_in': '07:50:00',
                'attendance_source': 'manual', 'manual_override': True,
            },
            {
                'attendance_date': '2026-08-10', 'status': 'half_day', 'check_in': '07:50:00',
                'attendance_source': 'biometric', 'manual_override': False,
            },
        )
        for existing in cases:
            with self.subTest(existing=existing):
                plans, _ = plan_attendance([attendance_event('17:22:09')], resolution_with(existing), TARGET_DATE)
                self.assertFalse(plans[0]['check_in_from_existing'])
                self.assertEqual(plans[0]['check_in'], '17:22:09')
                self.assertIsNone(plans[0]['check_out'])

    def test_unmapped_checkout_cannot_use_existing_worker_checkin(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(), 'status': 'half_day', 'check_in': '07:50:00',
            'attendance_source': 'biometric', 'manual_override': False,
        }
        resolution = resolution_with(existing)
        event = attendance_event('17:22:09')
        event['employeeNoString'] = 'unmapped'
        plans, counters = plan_attendance([event], resolution, TARGET_DATE)
        self.assertIsNone(plans[0]['check_out'])
        self.assertEqual(counters['unmapped'], 1)

    def test_checkin_boundaries_accept_late_arrivals_without_an_upper_cutoff(self):
        cases = (
            ('06:45:00', 'half_day'),
            ('07:00:00', 'half_day'),
            ('07:59:00', 'half_day'),
            ('08:00:00', 'half_day'),
            ('08:01:00', 'late'),
            ('08:59:00', 'late'),
            ('09:00:00', 'late'),
            ('09:01:00', 'late'),
            ('10:30:00', 'late'),
        )
        for clock, expected_status in cases:
            with self.subTest(clock=clock):
                plans, _ = plan_attendance([attendance_event(clock)], resolution_with(None), TARGET_DATE)
                self.assertEqual(plans[0]['check_in'], clock)
                self.assertEqual(plans[0]['proposed_status'], expected_status)
                self.assertEqual(plans[0]['day_fraction'], 0.5)

    def test_late_checkin_and_real_checkout_complete_without_becoming_absent(self):
        events = [attendance_event('10:30:00', serial=1), attendance_event('17:05:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)
        plan = plans[0]
        self.assertEqual(plan['proposed_status'], 'late')
        self.assertEqual(plan['check_in'], '10:30:00')
        self.assertEqual(plan['check_out'], '17:05:00')
        self.assertEqual(plan['day_fraction'], 1.0)

    def test_lateness_duration_is_exact_and_informational(self):
        cases = (('08:01:00', 60), ('08:30:00', 1800), ('09:15:00', 4500), ('10:30:00', 9000))
        for clock, expected_seconds in cases:
            with self.subTest(clock=clock):
                plans, _ = plan_attendance([attendance_event(clock)], resolution_with(None), TARGET_DATE)
                self.assertEqual(plans[0]['biometric_sync_metadata']['lateness_seconds'], expected_seconds)
                self.assertEqual(plans[0]['check_in'], clock)

    def test_earliest_legitimate_arrival_wins_over_later_morning_event(self):
        events = [attendance_event('09:13:00', serial=2), attendance_event('06:45:00', serial=1)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)
        self.assertEqual(plans[0]['check_in'], '06:45:00')
        self.assertEqual(plans[0]['proposed_status'], 'half_day')

    def test_exact_22_hour_checkout_is_preserved_on_same_workday(self):
        events = [attendance_event('07:40:00', serial=1), attendance_event('22:00:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)
        self.assertEqual(plans[0]['check_in'], '07:40:00')
        self.assertEqual(plans[0]['check_out'], '22:00:00')
        self.assertEqual(plans[0]['proposed_status'], 'present')

    def test_saturday_checkout_uses_saturday_schedule_and_exact_timestamp(self):
        saturday = date(2026, 8, 15)
        events = [
            attendance_event('07:40:00', serial=1, event_date='2026-08-15'),
            attendance_event('14:31:00', serial=2, event_date='2026-08-15'),
        ]
        plans, _ = plan_attendance(events, resolution_with(None), saturday)
        self.assertEqual(plans[0]['check_out'], '14:31:00')
        self.assertEqual(plans[0]['proposed_status'], 'present')

    @patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 8, 12, 0, 1))
    def test_late_checkin_without_checkout_never_finalizes_as_absent(self, _local_now):
        self.assertEqual(
            proposed_status(TARGET_DATE, datetime(2026, 8, 11, 10, 30), None),
            ('late', 0.5),
        )

    def test_non_attendance_event_is_not_accepted_as_checkin(self):
        plans, counters = plan_attendance(
            [attendance_event('08:15:00', minor=104)],
            resolution_with(None),
            TARGET_DATE,
        )
        self.assertIsNone(plans[0]['check_in'])
        self.assertEqual(plans[0]['proposed_status'], 'absent')
        self.assertEqual(counters['ignored_non_attendance_event'], 1)

    def test_pre_start_event_is_not_accepted_as_checkin(self):
        plans, _ = plan_attendance([attendance_event('00:29:00')], resolution_with(None), TARGET_DATE)
        self.assertIsNone(plans[0]['check_in'])
        self.assertEqual(plans[0]['proposed_status'], 'absent')

    def test_pre_start_event_does_not_hide_a_later_real_arrival(self):
        events = [attendance_event('00:29:00', serial=1), attendance_event('09:05:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)
        self.assertEqual(plans[0]['check_in'], '09:05:00')
        self.assertEqual(plans[0]['proposed_status'], 'late')

    def test_configured_workday_boundary_is_central_and_respected(self):
        with patch.dict('os.environ', {'HIKVISION_ATTENDANCE_WORKDAY_BOUNDARY': '06:30'}):
            plans, _ = plan_attendance([attendance_event('06:45:00')], resolution_with(None), TARGET_DATE)
        self.assertEqual(plans[0]['check_in'], '06:45:00')

    def test_repeated_late_event_processing_is_idempotent(self):
        events = [attendance_event('09:05:00', serial=1), attendance_event('17:05:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)
        first_payload = biometric_payload(plans[0], None)
        repeated_payload = biometric_payload(plans[0], dict(first_payload))
        self.assertEqual(repeated_payload, first_payload)
        self.assertFalse(payload_changed(first_payload, repeated_payload))

    def test_absence_plan_cannot_downgrade_existing_late_biometric_row(self):
        existing = {
            'status': 'late',
            'check_in': '09:05:00',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
        }
        plan = {
            'proposed_status': 'absent',
            'check_in': None,
            'check_out': None,
            'day_fraction': 0.0,
            'sync_key': 'hikvision:worker-1:2026-08-11',
            'biometric_sync_metadata': None,
        }
        self.assertIsNone(biometric_payload(plan, existing))

    def test_partial_late_read_cannot_downgrade_known_on_time_arrival(self):
        existing = {
            'status': 'half_day',
            'check_in': '08:00:00',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
        }
        late_plan, _ = plan_attendance([attendance_event('09:05:00')], resolution_with(existing), TARGET_DATE)
        payload = biometric_payload(late_plan[0], existing)
        self.assertEqual(payload['status'], 'half_day')
        self.assertEqual(payload['check_in'], '08:00:00')

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

    def test_manual_override_is_never_written_by_late_biometric_processing(self):
        class NoWriteClient:
            def insert_attendance(self, _payload):
                raise AssertionError('manual row must not be inserted')

            def update_attendance(self, _attendance_id, _payload):
                raise AssertionError('manual row must not be updated')

        existing = {
            'id': 'attendance-1',
            'status': 'absent',
            'check_in': None,
            'check_out': None,
            'attendance_source': 'manual',
            'manual_override': True,
        }
        plans, _ = plan_attendance([attendance_event('09:05:00')], resolution_with(existing), TARGET_DATE)
        results = apply_biometric_attendance(NoWriteClient(), plans, {WORKER_ID: existing})
        self.assertEqual(results['skipped_manual_protected'], 1)

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
                'worker_id': 'late',
                'proposed_status': 'late',
                'check_in': '09:05:00',
                'check_out': None,
                'day_fraction': 0.5,
                'sync_key': 'hikvision:late:2026-08-11',
                'biometric_sync_metadata': {},
                'checkout_only': False,
            },
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
        self.assertEqual(summary['late'], 1)
        self.assertEqual(summary['half_day'], 1)
        self.assertEqual(summary['absent'], 1)
        self.assertEqual(summary['pending'], 1)
        self.assertEqual(summary['checkout_only'], 1)
        self.assertEqual(sum(summary[status] for status in ('present', 'late', 'half_day', 'absent', 'pending')), len(plans))


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

    def test_atomic_update_skips_a_concurrently_changed_row(self):
        class ConcurrentClient:
            def update_attendance_if_unchanged(self, existing, payload):
                self.existing = existing
                self.payload = payload
                return None

        existing = {
            'id': 'attendance-1', 'attendance_date': TARGET_DATE.isoformat(),
            'status': 'half_day', 'check_in': '07:50:00', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
            'biometric_sync_key': f'hikvision:{WORKER_ID}:{TARGET_DATE.isoformat()}',
            'biometric_sync_metadata': {}, 'attendance_day_fraction': 0.5,
            'updated_at': '2026-08-11T08:00:00+00:00',
        }
        plans, _ = plan_attendance(
            [attendance_event('17:05:00', serial=2)],
            resolution_with(existing), TARGET_DATE,
        )
        client = ConcurrentClient()
        results = apply_biometric_attendance(client, plans, {WORKER_ID: existing})
        self.assertEqual(results['skipped_concurrent_change'], 1)
        self.assertEqual(results['updated'], 0)


class LateStatusMigrationTests(unittest.TestCase):
    def test_manual_migration_supports_late_without_changing_attendance_data(self):
        sql = Path('supabase/sql/attendance_late_arrival_status.sql').read_text(encoding='utf-8')
        self.assertIn("'present', 'late', 'half_day'", sql)
        self.assertIn("when 'late' then case when new.check_out is null then 0.5 else 1.0 end", sql)
        self.assertIn('before insert or update of status, check_in, check_out', sql)
        self.assertIn("status = 'late' and check_in is not null", sql)
        self.assertNotRegex(sql.lower(), r'\b(update|insert into|delete from)\s+public\.attendance\b')


if __name__ == "__main__":
    unittest.main()
