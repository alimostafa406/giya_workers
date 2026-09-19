"""Focused non-writing checks for existing-attendance protection in planning."""

import unittest
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import requests

from hikvision_attendance_sync import apply_biometric_attendance, biometric_payload, eligible_for_automatic_absence, is_manual_protected, payload_changed, plan_attendance, proposed_status, safe_postgrest_error_details, write_summary


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
        "teams": {},
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

    def test_existing_late_checkin_becomes_present_when_checkout_completes_day(self):
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

        self.assertEqual(payload['status'], 'present')
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

    def test_checkin_boundaries_accept_all_arrivals_as_half_day_without_an_upper_cutoff(self):
        cases = (
            ('06:30:00', 'half_day'),
            ('06:56:00', 'half_day'),
            ('07:00:00', 'half_day'),
            ('07:59:00', 'half_day'),
            ('08:00:00', 'half_day'),
            ('08:01:00', 'half_day'),
            ('08:59:00', 'half_day'),
            ('09:00:00', 'half_day'),
            ('09:01:00', 'half_day'),
            ('10:30:00', 'half_day'),
        )
        for clock, expected_status in cases:
            with self.subTest(clock=clock):
                plans, _ = plan_attendance([attendance_event(clock)], resolution_with(None), TARGET_DATE)
                self.assertEqual(plans[0]['check_in'], clock)
                self.assertEqual(plans[0]['proposed_status'], expected_status)
                self.assertEqual(plans[0]['day_fraction'], 0.5)

    def test_normal_workday_uses_next_day_tail_and_ignores_pre_0630_arrivals(self):
        events = [
            attendance_event('04:20:00', serial=1),
            attendance_event('06:29:59', serial=2),
            attendance_event('07:11:00', serial=3),
            attendance_event('00:31:00', serial=4, event_date='2026-08-12'),
        ]
        plans, counters = plan_attendance(events, resolution_with(None), TARGET_DATE)
        plan = plans[0]

        self.assertEqual(plan['check_in'], '07:11:00')
        self.assertEqual(plan['check_out'], '00:31:00')
        self.assertEqual(plan['proposed_status'], 'present')
        self.assertEqual(plan['biometric_sync_metadata']['check_out_event_timestamp'], '2026-08-12T00:31:00+01:00')
        self.assertEqual(counters['early_morning_needs_review'], 1)

    def test_normal_workday_boundary_accepts_0630_and_rejects_0629(self):
        cases = (
            ('06:29:00', None),
            ('06:30:00', '06:30:00'),
            ('06:56:00', '06:56:00'),
            ('07:00:00', '07:00:00'),
        )
        for clock, expected in cases:
            with self.subTest(clock=clock):
                plan = plan_attendance([attendance_event(clock)], resolution_with(None), TARGET_DATE)[0][0]
                self.assertEqual(plan['check_in'], expected)
                self.assertIsNone(plan['check_out'])

    def test_current_week_previously_unresolved_arrivals_are_valid_without_fake_checkout(self):
        cases = (
            ('NGUVU #22', '06:56:27'),
            ('nguvu #328', '06:56:28'),
            ('metshi #334', '06:55:27'),
        )
        for worker, clock in cases:
            with self.subTest(worker=worker):
                plan = plan_attendance([attendance_event(clock)], resolution_with(None), TARGET_DATE)[0][0]
                self.assertEqual(plan['check_in'], clock)
                self.assertIsNone(plan['check_out'])
                self.assertEqual(plan['proposed_status'], 'half_day')
                self.assertEqual(plan['day_fraction'], 0.5)

    def test_next_day_tail_is_inclusive_through_0200_only(self):
        accepted = [
            attendance_event('07:11:00', serial=1),
            attendance_event('01:59:00', serial=2, event_date='2026-08-12'),
        ]
        rejected = [
            attendance_event('07:11:00', serial=1),
            attendance_event('02:01:00', serial=2, event_date='2026-08-12'),
        ]

        accepted_plan = plan_attendance(accepted, resolution_with(None), TARGET_DATE)[0][0]
        rejected_plan = plan_attendance(rejected, resolution_with(None), TARGET_DATE)[0][0]

        self.assertEqual(accepted_plan['check_out'], '01:59:00')
        self.assertIsNone(rejected_plan['check_out'])
        self.assertEqual(rejected_plan['proposed_status'], 'half_day')

        exact_boundary = [
            attendance_event('07:11:00', serial=1),
            attendance_event('02:00:00', serial=2, event_date='2026-08-12'),
        ]
        boundary_plan = plan_attendance(exact_boundary, resolution_with(None), TARGET_DATE)[0][0]
        self.assertEqual(boundary_plan['check_out'], '02:00:00')

    def test_next_day_checkout_replaces_earlier_same_day_checkout(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'present',
            'check_in': '07:11:00',
            'check_out': '19:00:00',
            'attendance_source': 'biometric',
            'manual_override': False,
        }
        events = [attendance_event('00:31:00', event_date='2026-08-12')]

        plan = plan_attendance(events, resolution_with(existing), TARGET_DATE)[0][0]
        payload = biometric_payload(plan, existing)

        self.assertTrue(plan['check_out_next_day'])
        self.assertEqual(payload['check_out'], '00:31:00')
        self.assertEqual(payload['review_approved_check_out_at'], '2026-08-12T00:31:00+01:00')

    def test_same_day_checkout_does_not_set_next_day_approval_timestamp(self):
        events = [attendance_event('07:11:00'), attendance_event('18:00:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)

        payload = biometric_payload(plans[0], None)

        self.assertEqual(payload['check_out'], '18:00:00')
        self.assertIsNone(payload['review_approved_check_out_at'])

    def test_replay_preserves_existing_next_day_approval_timestamp(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'present',
            'check_in': '07:11:00',
            'check_out': '00:31:00',
            'attendance_source': 'biometric',
            'manual_override': False,
            'review_approved_check_out_at': '2026-08-12T00:31:00+01:00',
        }
        plans, _ = plan_attendance([], resolution_with(existing), TARGET_DATE)

        payload = biometric_payload(plans[0], existing)

        self.assertEqual(payload['check_out'], '00:31:00')
        self.assertEqual(payload['review_approved_check_out_at'], '2026-08-12T00:31:00+01:00')

    def test_equivalent_next_day_approval_offsets_are_unchanged(self):
        existing = {
            'status': 'present', 'check_in': '07:11:00', 'check_out': '00:31:00',
            'attendance_source': 'biometric', 'manual_override': False,
            'biometric_sync_key': 'hikvision:worker-1:2026-08-11',
            'attendance_day_fraction': 1.0, 'biometric_sync_metadata': None,
            'review_approved_check_out_at': '2026-08-11T23:31:00+00:00',
        }
        payload = dict(existing, review_approved_check_out_at='2026-08-12T00:31:00+01:00')

        self.assertFalse(payload_changed(existing, payload))

    def test_explicit_reconciliation_replaces_pre_boundary_biometric_checkin(self):
        existing = {
            'attendance_date': TARGET_DATE.isoformat(),
            'status': 'half_day',
            'check_in': '04:20:00',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
        }
        events = [attendance_event('07:11:00'), attendance_event('17:00:00', serial=2)]

        plan = plan_attendance(events, resolution_with(existing), TARGET_DATE)[0][0]
        payload = biometric_payload(plan, existing)

        self.assertTrue(plan['replace_out_of_window_existing_check_in'])
        self.assertEqual(payload['check_in'], '07:11:00')
        self.assertEqual(payload['check_out'], '17:00:00')

    def test_after_midnight_event_cannot_be_current_day_checkin(self):
        next_day = TARGET_DATE + timedelta(days=1)
        plans, _ = plan_attendance(
            [attendance_event('00:31:00', event_date=next_day.isoformat())],
            resolution_with(None),
            next_day,
        )

        self.assertIsNone(plans[0]['check_in'])
        self.assertIsNone(plans[0]['check_out'])

    def test_chauffeur_keeps_legacy_calendar_day_window(self):
        resolution = resolution_with(None)
        resolution['workers'][WORKER_ID]['team_id'] = 'chauffeur-team'
        resolution['teams'] = {'chauffeur-team': {'id': 'chauffeur-team', 'name': 'Chauffeur'}}
        events = [
            attendance_event('06:16:00', serial=1),
            attendance_event('17:00:00', serial=2),
            attendance_event('00:31:00', serial=3, event_date='2026-08-12'),
        ]

        plan = plan_attendance(events, resolution, TARGET_DATE)[0][0]

        self.assertEqual(plan['check_in'], '06:16:00')
        self.assertEqual(plan['check_out'], '17:00:00')

    def test_saturday_morning_rule_remains_full_day_without_checkout(self):
        saturday = date(2026, 8, 15)
        event = attendance_event('07:11:00', event_date=saturday.isoformat())

        plan = plan_attendance([event], resolution_with(None), saturday)[0][0]

        self.assertEqual(plan['proposed_status'], 'present')
        self.assertTrue(plan['saturday_morning_full_day'])

    def test_later_checkin_and_real_checkout_complete_as_present(self):
        events = [attendance_event('10:30:00', serial=1), attendance_event('17:05:00', serial=2)]
        plans, _ = plan_attendance(events, resolution_with(None), TARGET_DATE)
        plan = plans[0]
        self.assertEqual(plan['proposed_status'], 'present')
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

    def test_saturday_morning_checkin_without_checkout_is_full_day(self):
        saturday = date(2026, 8, 15)
        for clock in ('07:00:00', '08:15:00', '09:00:00'):
            with self.subTest(clock=clock):
                plans, _ = plan_attendance(
                    [attendance_event(clock, event_date='2026-08-15')],
                    resolution_with(None), saturday,
                )
                plan = plans[0]
                payload = biometric_payload(plan, None)
                self.assertEqual(plan['proposed_status'], 'present')
                self.assertEqual(plan['day_fraction'], 1.0)
                self.assertEqual(payload['status'], 'present')
                self.assertEqual(payload['attendance_day_fraction'], 1.0)
                self.assertIsNone(payload['check_out'])

    def test_saturday_later_morning_punch_keeps_earliest_checkin_and_earns_full_day(self):
        saturday = date(2026, 8, 15)
        events = [
            attendance_event('06:34:37', serial=1, event_date=saturday.isoformat()),
            attendance_event('07:18:42', serial=2, event_date=saturday.isoformat()),
        ]
        plan = plan_attendance(events, resolution_with(None), saturday)[0][0]
        payload = biometric_payload(plan, None)

        self.assertEqual(plan['check_in'], '06:34:37')
        self.assertIsNone(plan['check_out'])
        self.assertTrue(plan['saturday_morning_full_day'])
        self.assertEqual(payload['status'], 'present')
        self.assertEqual(payload['attendance_day_fraction'], 1.0)

    def test_saturday_non_morning_checkin_without_checkout_remains_half_day(self):
        saturday = date(2026, 8, 15)
        plans, _ = plan_attendance(
            [attendance_event('09:01:00', event_date='2026-08-15')],
            resolution_with(None), saturday,
        )
        self.assertEqual(plans[0]['proposed_status'], 'half_day')
        self.assertEqual(plans[0]['day_fraction'], 0.5)

    def test_monday_and_friday_without_checkout_remain_half_day(self):
        for target_date, event_date in ((date(2026, 8, 10), '2026-08-10'), (date(2026, 8, 14), '2026-08-14')):
            with self.subTest(target_date=target_date):
                plans, _ = plan_attendance(
                    [attendance_event('08:00:00', event_date=event_date)],
                    resolution_with(None), target_date,
                )
                self.assertEqual(plans[0]['proposed_status'], 'half_day')
                self.assertEqual(plans[0]['day_fraction'], 0.5)

    def test_saturday_without_checkin_is_not_automatically_present(self):
        saturday = date(2026, 8, 15)
        with patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 8, 15, 12, 0)):
            self.assertEqual(proposed_status(saturday, None, None), ('pending', None))

    def test_saturday_manual_override_remains_authoritative(self):
        class NoWriteClient:
            def insert_attendance(self, _payload):
                raise AssertionError('manual row must not be inserted')

            def update_attendance(self, _attendance_id, _payload):
                raise AssertionError('manual row must not be updated')

        saturday = date(2026, 8, 15)
        existing = {
            'id': 'attendance-saturday', 'attendance_date': '2026-08-15',
            'status': 'absent', 'check_in': None, 'check_out': None,
            'attendance_source': 'manual', 'manual_override': True,
        }
        plans, _ = plan_attendance(
            [attendance_event('08:00:00', event_date='2026-08-15')],
            resolution_with(existing), saturday,
        )
        result = apply_biometric_attendance(NoWriteClient(), plans, {WORKER_ID: existing})
        self.assertEqual(result['skipped_manual_protected'], 1)

    def test_saturday_full_day_without_checkout_creates_no_overtime(self):
        saturday = date(2026, 8, 15)
        plans, _ = plan_attendance(
            [attendance_event('08:00:00', event_date='2026-08-15')],
            resolution_with(None), saturday,
        )
        self.assertIsNone(plans[0]['check_out'])
        self.assertNotIn('check_out_event_timestamp', plans[0]['biometric_sync_metadata'])

    @patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 8, 12, 0, 1))
    def test_later_checkin_without_checkout_remains_half_day(self, _local_now):
        self.assertEqual(
            proposed_status(TARGET_DATE, datetime(2026, 8, 11, 10, 30), None),
            ('half_day', 0.5),
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
        self.assertEqual(plans[0]['proposed_status'], 'half_day')

    def test_configured_legacy_boundary_is_respected_for_chauffeur_only(self):
        resolution = resolution_with(None)
        resolution['workers'][WORKER_ID]['team_id'] = 'chauffeur-team'
        resolution['teams'] = {'chauffeur-team': {'id': 'chauffeur-team', 'name': 'Chauffeur'}}
        with patch.dict('os.environ', {'HIKVISION_ATTENDANCE_WORKDAY_BOUNDARY': '06:30'}):
            plans, _ = plan_attendance([attendance_event('06:45:00')], resolution, TARGET_DATE)
        self.assertEqual(plans[0]['check_in'], '06:45:00')

    def test_repeated_later_event_processing_is_idempotent(self):
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

    def test_partial_later_read_cannot_replace_known_earliest_arrival(self):
        existing = {
            'status': 'half_day',
            'check_in': '08:00:00',
            'check_out': None,
            'attendance_source': 'biometric',
            'manual_override': False,
        }
        later_plan, _ = plan_attendance([attendance_event('09:05:00')], resolution_with(existing), TARGET_DATE)
        payload = biometric_payload(later_plan[0], existing)
        self.assertEqual(payload['status'], 'half_day')
        self.assertEqual(payload['check_in'], '08:00:00')

    def test_current_date_without_checkin_stays_pending_all_day(self):
        for clock in ('08:00:00', '17:00:00', '17:15:00', '17:30:00', '23:59:59'):
            with self.subTest(clock=clock), patch(
                'hikvision_attendance_sync.local_now',
                return_value=datetime.fromisoformat(f'2026-08-11T{clock}+01:00'),
            ):
                self.assertEqual(proposed_status(TARGET_DATE, None, None), ('pending', None))

    def test_saturday_without_checkin_stays_pending_after_old_cutoff(self):
        saturday = date(2026, 8, 15)
        with patch(
            'hikvision_attendance_sync.local_now',
            return_value=datetime.fromisoformat('2026-08-15T14:45:00+01:00'),
        ):
            self.assertEqual(proposed_status(saturday, None, None), ('pending', None))

    def test_automatic_absence_uses_explicit_kinshasa_calendar_boundary(self):
        utc = timezone.utc
        self.assertFalse(eligible_for_automatic_absence(
            date(2026, 9, 8), datetime(2026, 9, 8, 22, 59, 59, tzinfo=utc),
        ))
        self.assertTrue(eligible_for_automatic_absence(
            date(2026, 9, 8), datetime(2026, 9, 8, 23, 0, 0, tzinfo=utc),
        ))

    @patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 8, 12, 0, 1))
    def test_completed_past_workday_without_morning_punch_is_absent(self, _local_now):
        self.assertEqual(proposed_status(TARGET_DATE, None, None), ('absent', 0.0))

    @patch('hikvision_attendance_sync.local_now', return_value=datetime(2026, 9, 9, 0, 0, 1, tzinfo=timezone(timedelta(hours=1))))
    def test_september_eight_regression_finalizes_only_after_calendar_advance(self, _local_now):
        self.assertEqual(proposed_status(date(2026, 9, 8), None, None), ('absent', 0.0))

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

    def test_manual_override_is_never_written_by_biometric_processing(self):
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
                'worker_id': 'half-day-later-arrival',
                'proposed_status': 'half_day',
                'check_in': '09:05:00',
                'check_out': None,
                'day_fraction': 0.5,
                'sync_key': 'hikvision:half-day:2026-08-11',
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
        self.assertEqual(summary['half_day'], 2)
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
