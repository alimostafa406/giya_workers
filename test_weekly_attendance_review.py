import unittest
from datetime import date, datetime, timezone, timedelta
from unittest.mock import patch

from hikvision_weekly_attendance_review import (
    WeeklyAttendanceReviewError,
    WeeklyAttendanceReviewer,
    _finalize_current_saturday,
    monday_saturday_dates,
    review_week_attendance,
)


KINSHASA = timezone(timedelta(hours=1))


class FakeClient:
    def __init__(self):
        self.rows = {}
        self.events = []

    def insert_biometric_attendance_events(self, rows):
        for row in rows:
            key = (row['device_id'], row['event_identity'])
            if key not in {(item['device_id'], item['event_identity']) for item in self.events}:
                self.events.append(row)

    def insert_attendance(self, payload):
        key = (payload['worker_id'], payload['attendance_date'])
        if key in self.rows:
            raise AssertionError('duplicate attendance row')
        row = {'id': f"attendance-{len(self.rows) + 1}", 'updated_at': 'v1', **payload}
        self.rows[key] = row
        return row

    def update_attendance_if_unchanged(self, existing, payload):
        key = (existing['worker_id'], existing['attendance_date'])
        self.rows[key] = {**existing, **payload, 'updated_at': 'v2'}
        return self.rows[key]


def resolution(client, target_date):
    worker_id = 'worker-1'
    existing = client.rows.get((worker_id, target_date.isoformat()))
    return {
        'confirmed': {('office-main', '7'): {
            'worker_id': worker_id, 'device_id': 'office-main',
            'device_employee_no': '7',
        }},
        'unconfirmed': set(),
        'mapping_conflicts': set(),
        'ignored': set(),
        'workers': {worker_id: {
            'id': worker_id, 'full_name': 'Worker One', 'is_active': True,
            'team_id': 'team-1',
        }},
        'classifications': {worker_id: 'normal'},
        'existing_attendance': {worker_id: existing} if existing else {},
    }


def biometric_event(day, clock, serial, identity='7'):
    return {
        '_device_id': 'office-main',
        'employeeNoString': identity,
        'name': 'Device Person',
        'time': f'{day}T{clock}+01:00',
        'major': 5,
        'minor': 75,
        'serialNo': serial,
    }


class WeeklyAttendanceReviewTests(unittest.TestCase):
    def test_range_is_exactly_one_monday_saturday_week(self):
        self.assertEqual(
            [item.isoformat() for item in monday_saturday_dates('2026-09-07', '2026-09-12')],
            ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'],
        )
        for start, end in (('2026-09-06', '2026-09-12'), ('2026-09-07', '2026-09-13')):
            with self.subTest(start=start, end=end), self.assertRaises(WeeklyAttendanceReviewError):
                monday_saturday_dates(start, end)

    def test_current_saturday_review_finalizes_only_missing_saturday(self):
        saturday_plan = {'proposed_status': 'pending', 'check_in': None, 'day_fraction': None}
        with patch('hikvision_weekly_attendance_review.local_now', return_value=datetime(2026, 9, 12, 14, 0, tzinfo=KINSHASA)):
            _finalize_current_saturday([saturday_plan], date(2026, 9, 12))
        self.assertEqual(saturday_plan['proposed_status'], 'absent')
        self.assertEqual(saturday_plan['day_fraction'], 0.0)

        weekday_plan = {'proposed_status': 'pending', 'check_in': None, 'day_fraction': None}
        with patch('hikvision_weekly_attendance_review.local_now', return_value=datetime(2026, 9, 7, 14, 0, tzinfo=KINSHASA)):
            _finalize_current_saturday([weekday_plan], date(2026, 9, 7))
        self.assertEqual(weekday_plan['proposed_status'], 'pending')

    def test_full_review_processes_six_bounded_days_and_is_idempotent(self):
        client = FakeClient()
        requested_dates = []

        def read_events(target_date, _diagnostics):
            requested_dates.append(target_date.isoformat())
            return [], {'office-main': {'state': 'complete', 'pagination_complete': True}}

        def load(_client, target_date, for_apply=False):
            self.assertTrue(for_apply)
            return resolution(client, target_date)

        patches = (
            patch('hikvision_weekly_attendance_review.load_local_hikvision_config'),
            patch('hikvision_weekly_attendance_review.require_local_settings'),
            patch('hikvision_weekly_attendance_review.configured_devices', return_value=[object()]),
            patch('hikvision_weekly_attendance_review.SupabaseReadClient', return_value=client),
            patch('hikvision_weekly_attendance_review.hikvision_events_with_devices', side_effect=read_events),
            patch('hikvision_weekly_attendance_review.load_resolution_data', side_effect=load),
            patch('hikvision_weekly_attendance_review.local_now', return_value=datetime(2026, 9, 12, 14, 0, tzinfo=KINSHASA)),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            first = review_week_attendance('2026-09-07', '2026-09-12')
            second = review_week_attendance('2026-09-07', '2026-09-12')

        self.assertEqual(first['workdays_evaluated'], 6)
        self.assertEqual(first['attendance_rows_inserted'], 6)
        self.assertEqual(second['attendance_rows_inserted'], 0)
        self.assertEqual(second['attendance_rows_unchanged'], 6)
        self.assertEqual(len(client.rows), 6)
        self.assertEqual(requested_dates[:6], [
            '2026-09-07', '2026-09-08', '2026-09-09',
            '2026-09-10', '2026-09-11', '2026-09-12',
        ])
        self.assertTrue(first['completed'])

    def test_incomplete_device_coverage_fails_closed_without_writes(self):
        client = FakeClient()
        with (
            patch('hikvision_weekly_attendance_review.load_local_hikvision_config'),
            patch('hikvision_weekly_attendance_review.require_local_settings'),
            patch('hikvision_weekly_attendance_review.configured_devices', return_value=[object()]),
            patch('hikvision_weekly_attendance_review.SupabaseReadClient', return_value=client),
            patch('hikvision_weekly_attendance_review.hikvision_events_with_devices', return_value=([], {
                'office-main': {'state': 'partial', 'error': 'pagination incomplete'},
            })),
            patch('hikvision_weekly_attendance_review.load_resolution_data', side_effect=lambda _client, day, for_apply=False: resolution(client, day)),
        ):
            result = review_week_attendance('2026-09-07', '2026-09-12')
        self.assertFalse(result['completed'])
        self.assertEqual(client.rows, {})
        self.assertEqual(len(result['errors']), 6)

    def test_review_upgrades_half_day_from_late_checkout_and_preserves_exact_events(self):
        client = FakeClient()
        client.rows[('worker-1', '2026-09-07')] = {
            'id': 'attendance-1', 'worker_id': 'worker-1', 'attendance_date': '2026-09-07',
            'status': 'half_day', 'check_in': '08:00:00', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
            'attendance_day_fraction': 0.5, 'updated_at': 'v1',
        }

        def read_events(target_date, _diagnostics):
            events = []
            if target_date.isoformat() == '2026-09-07':
                events = [
                    biometric_event('2026-09-07', '07:55:00', 1),
                    biometric_event('2026-09-07', '17:05:00', 2),
                    biometric_event('2026-09-07', '08:10:00', 3, identity='999'),
                ]
            return events, {
                'office-main': {'state': 'complete', 'pagination_complete': True},
                'office-secondary': {'state': 'complete', 'pagination_complete': True},
            }

        with (
            patch('hikvision_weekly_attendance_review.load_local_hikvision_config'),
            patch('hikvision_weekly_attendance_review.require_local_settings'),
            patch('hikvision_weekly_attendance_review.configured_devices', return_value=[object(), object()]),
            patch('hikvision_weekly_attendance_review.SupabaseReadClient', return_value=client),
            patch('hikvision_weekly_attendance_review.hikvision_events_with_devices', side_effect=read_events),
            patch('hikvision_weekly_attendance_review.load_resolution_data', side_effect=lambda _client, day, for_apply=False: resolution(client, day)),
            patch('hikvision_weekly_attendance_review.local_now', return_value=datetime(2026, 9, 12, 14, 0, tzinfo=KINSHASA)),
        ):
            result = review_week_attendance('2026-09-07', '2026-09-12')

        monday = client.rows[('worker-1', '2026-09-07')]
        self.assertEqual(monday['status'], 'present')
        self.assertEqual(monday['check_in'], '07:55:00')
        self.assertEqual(monday['check_out'], '17:05:00')
        self.assertEqual(result['attendance_rows_updated'], 1)
        self.assertEqual(result['unmatched_biometric_identities'][0]['employeeNoString'], '999')

    def test_manual_protected_row_is_reported_and_never_changed(self):
        client = FakeClient()
        original = {
            'id': 'attendance-1', 'worker_id': 'worker-1', 'attendance_date': '2026-09-07',
            'status': 'absent', 'check_in': None, 'check_out': None,
            'attendance_source': 'manual', 'manual_override': True,
            'attendance_day_fraction': 0.0, 'updated_at': 'v1',
        }
        client.rows[('worker-1', '2026-09-07')] = dict(original)

        with (
            patch('hikvision_weekly_attendance_review.load_local_hikvision_config'),
            patch('hikvision_weekly_attendance_review.require_local_settings'),
            patch('hikvision_weekly_attendance_review.configured_devices', return_value=[object()]),
            patch('hikvision_weekly_attendance_review.SupabaseReadClient', return_value=client),
            patch('hikvision_weekly_attendance_review.hikvision_events_with_devices', side_effect=lambda day, _: (
                [biometric_event(day.isoformat(), '08:00:00', 1)] if day.isoformat() == '2026-09-07' else [],
                {'office-main': {'state': 'complete', 'pagination_complete': True}},
            )),
            patch('hikvision_weekly_attendance_review.load_resolution_data', side_effect=lambda _client, day, for_apply=False: resolution(client, day)),
            patch('hikvision_weekly_attendance_review.local_now', return_value=datetime(2026, 9, 12, 14, 0, tzinfo=KINSHASA)),
        ):
            result = review_week_attendance('2026-09-07', '2026-09-12')

        self.assertEqual(client.rows[('worker-1', '2026-09-07')], original)
        self.assertEqual(result['manual_protected_rows_skipped'], 1)

    def test_overlapping_submission_is_rejected(self):
        reviewer = WeeklyAttendanceReviewer()
        reviewer._lock.acquire()
        try:
            with self.assertRaises(WeeklyAttendanceReviewError):
                reviewer.review('2026-09-07', '2026-09-12')
        finally:
            reviewer._lock.release()


if __name__ == '__main__':
    unittest.main()
