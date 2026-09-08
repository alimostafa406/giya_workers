"""Deterministic tests for the non-writing cross-midnight shadow model."""

import re
import unittest
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from attendance_session_assignment import (
    AttendanceSessionState,
    BiometricSessionEvent,
    assign_biometric_event_to_session,
)
from hikvision_attendance_session_shadow import build_shadow_report


KINSHASA = timezone(timedelta(hours=1))
SEP7 = date(2026, 9, 7)
SEP8 = date(2026, 9, 8)


def at(day, clock):
    return datetime.combine(day, time.fromisoformat(clock), tzinfo=KINSHASA)


def event(day, clock, *, serial='1', device='office-main', identity='39', major=5, minor=75):
    return BiometricSessionEvent(
        timestamp=at(day, clock), device_id=device, device_employee_no=identity,
        serial_no=serial, major=major, minor=minor,
    )


def session(day, check_in=None, check_out=None, **overrides):
    values = {
        'work_date': day,
        'check_in_at': at(day, check_in) if check_in else None,
        'check_out_at': at(day, check_out) if check_out else None,
    }
    values.update(overrides)
    return AttendanceSessionState(**values)


def decide(punch, **overrides):
    values = {
        'event': punch,
        'mapped_worker_id': 'worker-1',
        'mapping_state': 'confirmed_exact',
        'mapping_device_id': punch.device_id,
        'previous_session': None,
        'current_session': None,
        'current_work_date': punch.timestamp.date(),
    }
    values.update(overrides)
    return assign_biometric_event_to_session(**values)


class CrossMidnightSessionAssignmentTests(unittest.TestCase):
    def test_scenario_a_henry_post_midnight_event_closes_previous_session(self):
        previous = session(SEP7, '07:54:00', '20:04:00')
        result = decide(event(SEP8, '00:31:00'), previous_session=previous)
        self.assertEqual(result.assigned_work_date, SEP7)
        self.assertEqual(result.assignment_result, 'previous_session')
        self.assertEqual(result.attendance_role, 'check_out')
        self.assertEqual(result.status_candidate, 'present')
        self.assertTrue(result.overtime_review_required)

    def test_scenario_b_pre_boundary_event_starts_current_day_without_prior_session(self):
        result = decide(event(SEP8, '03:00:00'))
        self.assertEqual(result.assigned_work_date, SEP8)
        self.assertEqual(result.assignment_result, 'current_session')
        self.assertEqual(result.attendance_role, 'check_in')
        self.assertEqual(result.status_candidate, 'half_day')
        self.assertEqual(result.assignment_reason, 'pre_boundary_new_session_no_prior_open_session')

    def test_scenario_c_post_midnight_closes_previous_then_morning_starts_current(self):
        previous = session(SEP7, '08:00:00')
        overnight = decide(event(SEP8, '02:30:00'), previous_session=previous)
        morning = decide(event(SEP8, '07:50:00', serial='2'), previous_session=previous)
        self.assertEqual((overnight.assigned_work_date, overnight.attendance_role), (SEP7, 'check_out'))
        self.assertEqual((morning.assigned_work_date, morning.attendance_role), (SEP8, 'check_in'))

    def test_scenario_d_pre_boundary_starts_day_and_0800_is_intermediate(self):
        first = decide(event(SEP8, '02:45:00'))
        current = session(SEP8, '02:45:00', recent_accepted_event_at=at(SEP8, '02:45:00'))
        repeated = decide(event(SEP8, '08:00:00', serial='2'), current_session=current)
        self.assertEqual(first.attendance_role, 'check_in')
        self.assertEqual(repeated.assigned_work_date, SEP8)
        self.assertEqual(repeated.attendance_role, 'intermediate')

    def test_scenario_e_latest_safe_post_midnight_event_replaces_checkout(self):
        previous = session(SEP7, '08:00:00', '18:00:00')
        first = decide(event(SEP8, '00:20:00'), previous_session=previous)
        advanced = AttendanceSessionState(
            work_date=SEP7, check_in_at=at(SEP7, '08:00:00'),
            check_out_at=at(SEP8, '00:20:00'), recent_accepted_event_at=at(SEP8, '00:20:00'),
        )
        latest = decide(event(SEP8, '00:31:00', serial='2'), previous_session=advanced)
        self.assertEqual(first.attendance_role, 'check_out')
        self.assertEqual(latest.attendance_role, 'check_out')
        self.assertTrue(latest.overtime_review_required)

    def test_more_than_twenty_hours_is_ambiguous(self):
        previous = session(SEP7, '06:00:00')
        result = decide(event(SEP8, '02:00:01'), previous_session=previous)
        self.assertEqual(result.assignment_result, 'ambiguous_review')
        self.assertEqual(result.assignment_reason, 'maximum_session_duration_exceeded')
        self.assertTrue(result.review_required)

    def test_manual_protected_previous_session_is_never_attached(self):
        previous = session(SEP7, '08:00:00', attendance_source='manual', manual_override=True)
        result = decide(event(SEP8, '00:31:00'), previous_session=previous)
        self.assertEqual(result.assignment_result, 'ambiguous_review')
        self.assertEqual(result.assignment_reason, 'previous_session_manual_protected')
        self.assertEqual(result.attendance_role, 'none')

    def test_incomplete_coverage_allows_positive_event_but_no_negative_evidence(self):
        result = decide(event(SEP8, '07:30:00'), device_coverage_complete=False)
        self.assertEqual(result.attendance_role, 'check_in')
        self.assertFalse(result.negative_evidence_allowed)

    def test_duplicate_device_serial_is_ignored_idempotently(self):
        punch = event(SEP8, '07:30:00', serial='same')
        first = decide(punch)
        duplicate = decide(punch, seen_event_keys=frozenset({punch.stable_key()}))
        self.assertEqual(first.attendance_role, 'check_in')
        self.assertEqual(duplicate.assignment_result, 'duplicate')
        self.assertEqual(duplicate.attendance_role, 'none')

    def test_recognition_burst_is_a_duplicate_not_a_new_role(self):
        current = session(SEP8, '07:30:00', recent_accepted_event_at=at(SEP8, '07:30:00'))
        result = decide(event(SEP8, '07:30:04', serial='2'), current_session=current)
        self.assertEqual(result.assignment_result, 'duplicate')
        self.assertEqual(result.assignment_reason, 'recognition_burst_duplicate')

    def test_unmapped_identity_never_creates_a_session(self):
        result = decide(event(SEP8, '07:30:00'), mapped_worker_id=None, mapping_state='unmapped')
        self.assertEqual(result.assignment_result, 'ambiguous_review')
        self.assertIsNone(result.assigned_work_date)

    def test_exact_mapping_cannot_cross_device_scope(self):
        result = decide(
            event(SEP8, '07:30:00', device='office-secondary'),
            mapping_device_id='office-main',
        )
        self.assertEqual(result.assignment_reason, 'exact_mapping_device_mismatch')
        self.assertTrue(result.review_required)

    def test_saturday_session_can_continue_into_sunday(self):
        saturday = date(2026, 9, 12)
        sunday = date(2026, 9, 13)
        previous = session(saturday, '08:00:00', checkout_start=time(14, 0), official_end=time(14, 30))
        result = decide(event(sunday, '01:00:00'), previous_session=previous)
        self.assertEqual((result.assigned_work_date, result.attendance_role), (saturday, 'check_out'))

    def test_unauthorized_sunday_without_previous_session_requires_review(self):
        sunday = date(2026, 9, 13)
        result = decide(event(sunday, '03:00:00'), current_day_work_authorized=False)
        self.assertEqual(result.assignment_result, 'ambiguous_review')
        self.assertEqual(result.assignment_reason, 'current_day_work_not_authorized')

    def test_authorized_sunday_session_can_continue_into_monday(self):
        sunday = date(2026, 9, 13)
        monday = date(2026, 9, 14)
        previous = session(sunday, '10:00:00', work_authorized=True)
        result = decide(event(monday, '02:00:00'), previous_session=previous)
        self.assertEqual((result.assigned_work_date, result.attendance_role), (sunday, 'check_out'))

    def test_holiday_without_explicit_authorization_requires_review(self):
        holiday = date(2026, 9, 10)
        result = decide(event(holiday, '07:30:00'), current_day_work_authorized=False)
        self.assertEqual(result.assignment_result, 'ambiguous_review')
        self.assertEqual(result.attendance_role, 'none')

    def test_independently_established_current_session_wins_before_0400(self):
        previous = session(SEP7, '08:00:00')
        current = session(SEP8, '02:00:00')
        result = decide(event(SEP8, '03:00:00'), previous_session=previous, current_session=current)
        self.assertEqual(result.assigned_work_date, SEP8)
        self.assertEqual(result.attendance_role, 'intermediate')

    def test_repeated_shadow_evaluation_is_pure_and_idempotent(self):
        kwargs = {'previous_session': session(SEP7, '07:54:00', '20:04:00')}
        first = decide(event(SEP8, '00:31:00'), **kwargs)
        second = decide(event(SEP8, '00:31:00'), **kwargs)
        self.assertEqual(first, second)

    def test_invalid_event_type_is_never_attendance(self):
        result = decide(event(SEP8, '07:30:00', minor=104))
        self.assertEqual(result.assignment_result, 'invalid_event_type')
        self.assertEqual(result.attendance_role, 'none')


class CrossMidnightMigrationTests(unittest.TestCase):
    def test_migration_is_additive_and_keeps_legacy_columns(self):
        sql = Path('supabase/sql/attendance_cross_midnight_session_shadow.sql').read_text(encoding='utf-8')
        self.assertIn('add column if not exists check_in_at timestamptz', sql)
        self.assertIn('add column if not exists check_out_at timestamptz', sql)
        self.assertIn('create table if not exists public.biometric_attendance_event_assignment', sql)
        self.assertNotRegex(sql.lower(), r'\bdrop\s+(table|column)\b')
        self.assertNotRegex(sql.lower(), r'\b(update|insert into|delete from)\s+public\.(attendance|workers|payroll|biometric_attendance_events)\b')

    def test_assignment_table_is_append_only_scoped_and_auditable(self):
        sql = Path('supabase/sql/attendance_cross_midnight_session_shadow.sql').read_text(encoding='utf-8')
        for value in ('current_session', 'previous_session', 'ambiguous_review', 'duplicate', 'invalid_event_type'):
            self.assertIn(value, sql)
        for value in ('check_in', 'check_out', 'intermediate', 'none'):
            self.assertIn(value, sql)
        self.assertIn('unique (event_id, algorithm_version)', sql)
        self.assertIn('and worker_id is not null', sql)
        self.assertIn('before update or delete', sql)
        self.assertIn('enable row level security', sql)
        self.assertIn('grant select, insert', sql)

    def test_timestamp_constraints_are_date_aware(self):
        sql = Path('supabase/sql/attendance_cross_midnight_session_shadow.sql').read_text(encoding='utf-8')
        self.assertIn('check_out_at >= check_in_at', sql)
        self.assertIn("at time zone 'Africa/Kinshasa'", sql)
        self.assertIn('between attendance_date and (attendance_date + 1)', sql)

    def test_shadow_entry_point_contains_no_database_mutation(self):
        source = Path('hikvision_attendance_session_shadow.py').read_text(encoding='utf-8')
        self.assertIn("'writes_enabled': False", source)
        self.assertNotRegex(source, re.compile(r'client\.(insert|update|upsert|delete|rpc)', re.IGNORECASE))
        self.assertNotIn('--apply', source)

    @patch('hikvision_attendance_session_shadow.persisted_biometric_events')
    @patch('hikvision_attendance_session_shadow.load_resolution_data')
    def test_shadow_report_is_structured_and_evaluates_persisted_events_only(self, load, persisted):
        worker = {'id': 'worker-1', 'full_name': 'HENRY', 'employee_code': '155', 'is_active': True}
        current = {
            'confirmed': {('office-main', '55550016'): {
                'worker_id': 'worker-1', 'device_id': 'office-main',
                'device_employee_no': '55550016',
            }},
            'mapping_conflicts': set(), 'unconfirmed': set(), 'ignored': set(),
            'workers': {'worker-1': worker}, 'existing_attendance': {},
        }
        previous = {
            **current,
            'existing_attendance': {'worker-1': {
                'attendance_date': '2026-09-07', 'check_in': '07:54:00', 'check_out': '20:04:00',
                'attendance_source': 'biometric', 'manual_override': False,
            }},
        }
        load.side_effect = [current, previous]
        persisted.return_value = ([{
            '_persisted_event_id': 'event-1', '_device_id': 'office-main',
            'employeeNoString': '55550016', 'serialNo': '209062',
            'major': 5, 'minor': 75, 'time': '2026-09-08T00:31:00+01:00',
        }], [])

        report = build_shadow_report(object(), SEP8)

        self.assertFalse(report['writes_enabled'])
        self.assertEqual(report['comparison_count'], 1)
        comparison = report['comparisons'][0]
        self.assertEqual(comparison['worker'], 'HENRY')
        self.assertEqual(comparison['old_interpretation']['reason'], 'before_technical_boundary')
        self.assertEqual(comparison['assigned_work_date'], '2026-09-07')
        self.assertEqual(comparison['attendance_role'], 'check_out')
        self.assertTrue(comparison['review_required'] is False)
        self.assertTrue(comparison['overtime_review_required'])


if __name__ == '__main__':
    unittest.main()
