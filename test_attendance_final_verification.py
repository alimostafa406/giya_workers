"""Regression coverage for durable targeted attendance verification."""

import unittest
from datetime import date, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

from hikvision_attendance_sync import (
    RequestDiagnostics,
    SupabaseReadClient,
    deduplicate_hikvision_events,
    hikvision_events_for_device,
    hikvision_events_for_device_segmented_verification,
    plan_attendance,
    verification_event_windows,
)
from hikvision_attendance_verification import (
    _query_targets,
    absence_plans_with_verification,
    biometric_verification_scope,
    checkout_verification_targets,
    completed_morning_snapshot_compatibility,
    filter_worker_events,
    morning_verification_targets,
    reconcile_completed_morning_verification_children,
    run_targeted_verification,
    verification_event_evidence,
    worker_identity_queries,
)


DAY = date(2026, 9, 4)
DEVICE_MAIN = SimpleNamespace(device_id='office-main', ip='127.0.0.1', username='u', password='p')
DEVICE_SECONDARY = SimpleNamespace(device_id='office-secondary', ip='127.0.0.2', username='u', password='p')


def base_resolution(existing=None, confirmed=None):
    return {
        'workers': {'w1': {'id': 'w1', 'full_name': 'BENJAMIN', 'is_active': True, 'team_id': 't1', 'created_at': '2026-09-01T08:00:00+00:00'}},
        'classifications': {'w1': 'normal'},
        'biometric_participation': {'w1': 'enrolled'},
        'existing_attendance': {} if existing is None else {'w1': existing},
        'confirmed': (
            {('office-main', '0336699'): {'worker_id': 'w1', 'device_id': 'office-main', 'device_employee_no': '0336699'}}
            if confirmed is None else confirmed
        ),
        'unconfirmed': set(), 'ignored': set(), 'mapping_conflicts': set(),
    }


def event(clock, serial, identity='0336699', device='office-main'):
    return {'time': f'2026-09-04T{clock}+01:00', 'employeeNoString': identity, 'major': 5, 'minor': 75, 'serialNo': serial, '_device_id': device}


class FakeClient:
    def __init__(self):
        self.runs = []
        self.workers = []
        self.worker_rows = {}
        self.inserted_events = []

    def start_attendance_verification_run(self, payload):
        open_run = next((run for run in reversed(self.runs) if run.get('status') != 'complete'), None)
        if open_run:
            open_run.update(payload)
            return dict(open_run)
        run = {'id': f'run-{len(self.runs) + 1}', **payload}
        self.runs.append(run)
        return dict(run)

    def update_attendance_verification_run(self, run_id, payload):
        run = next((item for item in self.runs if item['id'] == run_id), None)
        if not run or run.get('status') == 'complete':
            raise RuntimeError('Attendance verification run is complete or no longer available')
        run.update(payload)
        return dict(run)

    def upsert_attendance_verification_worker(self, payload):
        self.workers.append(payload)
        self.worker_rows[(payload['run_id'], payload['worker_id'])] = payload
        return payload

    def insert_biometric_attendance_events(self, rows):
        self.inserted_events.extend(rows)

    def read(self, table, _select, **filters):
        if table != 'attendance_verification_worker':
            raise AssertionError(f'unexpected table read: {table}')
        run_id = str(filters.get('run_id') or '').removeprefix('eq.')
        return [
            row for (row_run_id, _worker_id), row in self.worker_rows.items()
            if row_run_id == run_id
        ]


class FinalMorningVerificationTests(unittest.TestCase):
    @staticmethod
    def completed_run(**extra):
        return {
            'id': 'run-1', 'status': 'complete', 'completed_at': '2026-09-07T09:53:26+00:00',
            'active_normal_roster_count': 1, 'unknown_biometric_status_count': 0,
            'unresolved_worker_count': 0, 'workers_verified_no_event_count': 0,
            'roster_worker_ids': ['w1'],
            'biometric_in_scope_worker_ids': ['w1'],
            'non_biometric_excluded_worker_ids': [],
            'unknown_biometric_status_worker_ids': [], **extra,
        }

    @staticmethod
    def verified_no_event_row(run_id='run-1', worker_id='w1'):
        return {
            'run_id': run_id,
            'worker_id': worker_id,
            'verification_result': 'verified_no_event',
            'relevant_query_count': 1,
            'evidence_event_count': 0,
            'verification_details': {
                'events': [],
                'queries': [{
                    'state': 'complete',
                    'segments': [{'state': 'complete', 'pagination_complete': True}],
                }],
            },
            'verified_at': '2026-09-07T09:53:00+00:00',
        }

    def test_post_completion_new_worker_does_not_replace_completed_snapshot(self):
        resolution = base_resolution()
        resolution['workers']['new'] = {
            'id': 'new', 'full_name': 'NEW', 'is_active': True, 'team_id': 't1',
            'created_at': '2026-09-07T10:09:01+00:00',
        }
        resolution['classifications']['new'] = 'normal'
        resolution['biometric_participation']['new'] = 'unknown'
        result = completed_morning_snapshot_compatibility(
            self.completed_run(), resolution, [DEVICE_MAIN, DEVICE_SECONDARY],
        )
        self.assertTrue(result['compatible'])
        self.assertEqual(result['post_verification_worker_ids'], ['new'])

    def test_existing_worker_reactivated_after_completion_requires_new_verification(self):
        resolution = base_resolution()
        resolution['workers']['old'] = {
            'id': 'old', 'full_name': 'OLD', 'is_active': True, 'team_id': 't1',
            'created_at': '2026-08-01T08:00:00+00:00',
        }
        resolution['classifications']['old'] = 'normal'
        resolution['biometric_participation']['old'] = 'enrolled'
        result = completed_morning_snapshot_compatibility(
            self.completed_run(), resolution, [DEVICE_MAIN, DEVICE_SECONDARY],
        )
        self.assertFalse(result['compatible'])
        self.assertEqual(result['unsafe_added_worker_ids'], ['old'])

    def test_snapshot_participation_or_mapping_change_fails_closed(self):
        changed_participation = base_resolution()
        changed_participation['biometric_participation']['w1'] = 'not_enrolled'
        result = completed_morning_snapshot_compatibility(
            self.completed_run(), changed_participation, [DEVICE_MAIN, DEVICE_SECONDARY],
        )
        self.assertFalse(result['compatible'])
        self.assertEqual(result['participation_changed_worker_ids'], ['w1'])

        ambiguous_mapping = base_resolution(confirmed={})
        ambiguous_mapping['mapping_conflicts'] = {('office-main', '0336699')}
        result = completed_morning_snapshot_compatibility(
            self.completed_run(), ambiguous_mapping, [DEVICE_MAIN, DEVICE_SECONDARY],
        )
        self.assertFalse(result['compatible'])
        self.assertEqual(result['unsafe_mapping_worker_ids'], ['w1'])

    def test_missing_snapshot_worker_fails_closed(self):
        resolution = base_resolution()
        resolution['workers']['w1']['is_active'] = False
        result = completed_morning_snapshot_compatibility(
            self.completed_run(), resolution, [DEVICE_MAIN, DEVICE_SECONDARY],
        )
        self.assertFalse(result['compatible'])
        self.assertEqual(result['missing_snapshot_worker_ids'], ['w1'])

    def test_completed_child_reconciliation_supersedes_stale_unresolved_with_attendance(self):
        client = FakeClient()
        client.worker_rows[('run-1', 'w1')] = {
            'run_id': 'run-1', 'worker_id': 'w1', 'verification_result': 'unresolved',
            'relevant_query_count': 0, 'evidence_event_count': 0,
            'verification_details': {'reason': 'unknown_biometric_participation'},
        }
        resolution = base_resolution({
            'check_in': '10:52:01', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        })

        result = reconcile_completed_morning_verification_children(
            client, self.completed_run(), resolution,
        )

        self.assertTrue(result['safe'])
        self.assertEqual(result['upserted'], 1)
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'attendance_present')

    def test_completed_child_reconciliation_projects_manual_protection(self):
        client = FakeClient()
        resolution = base_resolution({
            'check_in': '08:00:00', 'check_out': None,
            'attendance_source': 'manual', 'manual_override': True,
        })

        result = reconcile_completed_morning_verification_children(
            client, self.completed_run(), resolution,
        )

        self.assertTrue(result['safe'])
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'manual_protected')

    def test_completed_child_reconciliation_projects_explicit_not_enrolled(self):
        client = FakeClient()
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation']['w1'] = 'not_enrolled'
        run = self.completed_run(
            biometric_in_scope_worker_ids=[],
            non_biometric_excluded_worker_ids=['w1'],
        )

        result = reconcile_completed_morning_verification_children(client, run, resolution)

        self.assertTrue(result['safe'])
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'not_enrolled_excluded')

    def test_completed_child_reconciliation_preserves_existing_negative_evidence(self):
        client = FakeClient()
        negative = self.verified_no_event_row()
        client.worker_rows[('run-1', 'w1')] = dict(negative)

        result = reconcile_completed_morning_verification_children(
            client, self.completed_run(workers_verified_no_event_count=1), base_resolution(),
        )

        self.assertTrue(result['safe'])
        self.assertEqual(result['preserved_verified_no_event'], 1)
        self.assertEqual(client.workers, [])
        self.assertEqual(client.worker_rows[('run-1', 'w1')], negative)

    def test_later_positive_attendance_supersedes_current_negatives_without_rewriting_snapshot(self):
        client = FakeClient()
        for worker_id in ('w1', 'w2', 'w3'):
            client.worker_rows[('run-1', worker_id)] = self.verified_no_event_row(
                worker_id=worker_id,
            )
        run = self.completed_run(
            active_normal_roster_count=3,
            workers_verified_no_event_count=3,
            roster_worker_ids=['w1', 'w2', 'w3'],
            biometric_in_scope_worker_ids=['w1', 'w2', 'w3'],
        )
        original_run = dict(run)
        resolution = base_resolution({
            'check_in': '13:16:35', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        })
        resolution['workers'].update({
            'w2': {'id': 'w2', 'full_name': 'CHRISTIAN', 'is_active': True, 'team_id': 't1'},
            'w3': {'id': 'w3', 'full_name': 'STILL MISSING', 'is_active': True, 'team_id': 't1'},
        })
        resolution['classifications'].update({'w2': 'normal', 'w3': 'normal'})
        resolution['biometric_participation'].update({'w2': 'enrolled', 'w3': 'enrolled'})
        resolution['existing_attendance']['w2'] = {
            'check_in': '13:39:00', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        }

        result = reconcile_completed_morning_verification_children(client, run, resolution)

        self.assertTrue(result['safe'])
        self.assertEqual(result['upserted'], 2)
        self.assertEqual(result['historical_verified_no_event'], 3)
        self.assertEqual(result['preserved_verified_no_event'], 1)
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'attendance_present')
        self.assertEqual(client.worker_rows[('run-1', 'w2')]['verification_result'], 'attendance_present')
        self.assertEqual(client.worker_rows[('run-1', 'w3')]['verification_result'], 'verified_no_event')
        self.assertEqual(run, original_run)

    def test_completed_child_reconciliation_never_infers_missing_negative_evidence(self):
        client = FakeClient()

        result = reconcile_completed_morning_verification_children(
            client, self.completed_run(workers_verified_no_event_count=1), base_resolution(),
        )

        self.assertFalse(result['safe'])
        self.assertEqual(client.workers, [])
        self.assertIn('missing_or_invalid_negative_evidence', {
            failure['reason'] for failure in result['failures']
        })

    def test_completed_child_reconciliation_rejects_malformed_negative_evidence(self):
        client = FakeClient()
        malformed = self.verified_no_event_row()
        malformed['verification_details'] = {
            'events': [], 'queries': [{
                'state': 'complete',
                'segments': [{'state': 'complete', 'pagination_complete': False}],
            }],
        }
        client.worker_rows[('run-1', 'w1')] = malformed

        result = reconcile_completed_morning_verification_children(
            client, self.completed_run(workers_verified_no_event_count=1), base_resolution(),
        )

        self.assertFalse(result['safe'])
        self.assertEqual(client.workers, [])

    def test_completed_child_reconciliation_is_run_scoped_and_idempotent(self):
        client = FakeClient()
        old_row = self.verified_no_event_row(run_id='run-old')
        client.worker_rows[('run-old', 'w1')] = dict(old_row)
        client.worker_rows[('run-1', 'w1')] = {
            'run_id': 'run-1', 'worker_id': 'w1', 'verification_result': 'unresolved',
            'relevant_query_count': 0, 'evidence_event_count': 0,
            'verification_details': {'reason': 'unknown_biometric_participation'},
        }
        resolution = base_resolution({
            'check_in': '10:52:01', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        })

        first = reconcile_completed_morning_verification_children(
            client, self.completed_run(), resolution,
        )
        second = reconcile_completed_morning_verification_children(
            client, self.completed_run(), resolution,
        )

        self.assertTrue(first['safe'])
        self.assertTrue(second['safe'])
        self.assertEqual(first['upserted'], 1)
        self.assertEqual(second['upserted'], 0)
        self.assertEqual(len(client.workers), 1)
        self.assertEqual(client.worker_rows[('run-old', 'w1')], old_row)

    @patch('hikvision_attendance_agent.run_targeted_verification')
    @patch('hikvision_attendance_agent.reconcile_completed_morning_verification_children')
    @patch('hikvision_attendance_agent.completed_morning_snapshot_compatibility')
    @patch('hikvision_attendance_agent.load_resolution_data')
    @patch('hikvision_attendance_agent.configured_devices', return_value=[])
    def test_completed_fast_path_reconciles_children_without_device_verification(
        self, _devices, load, compatibility, reconcile, targeted,
    ):
        from hikvision_attendance_agent import AttendanceAgent

        agent = AttendanceAgent.__new__(AttendanceAgent)
        agent.client = MagicMock()
        agent.client.morning_verification_for_date.return_value = self.completed_run()
        agent.agent_id = 'agent'
        agent.dry_run = False
        agent.logger = MagicMock()
        load.return_value = base_resolution()
        compatibility.return_value = {'compatible': True, 'post_verification_worker_ids': []}
        reconcile.return_value = {'safe': True, 'upserted': 1}

        result = agent.run_final_morning_verification()

        self.assertEqual(result, (True, None))
        reconcile.assert_called_once_with(agent.client, self.completed_run(), load.return_value)
        targeted.assert_not_called()

    @patch('hikvision_attendance_agent.run_targeted_verification')
    @patch('hikvision_attendance_agent.reconcile_completed_morning_verification_children')
    @patch('hikvision_attendance_agent.completed_morning_snapshot_compatibility')
    @patch('hikvision_attendance_agent.load_resolution_data')
    @patch('hikvision_attendance_agent.configured_devices', return_value=[])
    def test_completed_fast_path_fails_closed_into_real_verification_for_unsafe_children(
        self, _devices, load, compatibility, reconcile, targeted,
    ):
        from hikvision_attendance_agent import AttendanceAgent

        agent = AttendanceAgent.__new__(AttendanceAgent)
        agent.client = MagicMock()
        agent.client.morning_verification_for_date.return_value = self.completed_run()
        agent.agent_id = 'agent'
        agent.dry_run = False
        agent.logger = MagicMock()
        load.return_value = base_resolution()
        compatibility.return_value = {'compatible': True, 'post_verification_worker_ids': []}
        reconcile.return_value = {
            'safe': False,
            'reason': 'completed_child_evidence_inconsistent',
            'failures': [{'worker_id': 'w1', 'reason': 'missing_or_invalid_negative_evidence'}],
        }
        targeted.return_value = {'status': 'complete'}

        result = agent.run_final_morning_verification()

        self.assertEqual(result, (True, None))
        targeted.assert_called_once()

    def test_completed_header_cannot_transition_or_clear_completion(self):
        client = FakeClient()
        completed = self.completed_run(
            workers_expected_count=217,
            workers_verified_no_event_count=55,
            roster_worker_ids=['w1'],
        )
        client.runs.append(dict(completed))

        with self.assertRaisesRegex(RuntimeError, 'complete or no longer available'):
            client.update_attendance_verification_run('run-1', {
                'status': 'running',
                'completed_at': None,
                'workers_expected_count': 218,
            })

        self.assertEqual(client.runs[0], completed)

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_real_fallback_after_complete_creates_distinct_run_without_mutating_snapshot(
        self, load, _persisted, _query,
    ):
        client = FakeClient()
        historical = self.completed_run(
            workers_expected_count=217,
            workers_verified_no_event_count=55,
            roster_worker_ids=['w1'],
        )
        client.runs.append(dict(historical))
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation'] = {}
        load.return_value = resolution

        result = run_targeted_verification(
            client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )

        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(len(client.runs), 2)
        self.assertEqual(client.runs[0], historical)
        self.assertEqual(client.runs[1]['id'], 'run-2')
        self.assertEqual(client.runs[1]['status'], 'incomplete')
        self.assertIn(('run-2', 'w1'), client.worker_rows)
        self.assertNotIn(('run-1', 'w1'), client.worker_rows)

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_retry_reuses_only_the_open_attempt(self, load, _persisted, _query):
        client = FakeClient()
        client.runs.extend([
            self.completed_run(workers_expected_count=217, workers_verified_no_event_count=55),
            {
                'id': 'run-2', 'work_date': DAY.isoformat(), 'verification_type': 'morning',
                'status': 'incomplete', 'completed_at': '2026-09-07T12:30:00+00:00',
            },
        ])
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation'] = {}
        load.return_value = resolution

        run_targeted_verification(
            client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )

        self.assertEqual(len(client.runs), 2)
        self.assertEqual(client.runs[0]['status'], 'complete')
        self.assertEqual(client.runs[0]['workers_verified_no_event_count'], 55)
        self.assertEqual(client.runs[1]['status'], 'incomplete')
        self.assertIn(('run-2', 'w1'), client.worker_rows)

    def test_lifecycle_migration_enforces_distinct_open_attempt_and_immutable_complete(self):
        sql = Path('supabase/sql/attendance_verification_run_lifecycle.sql').read_text(encoding='utf-8')
        self.assertIn('drop constraint if exists attendance_verification_run_date_type_key', sql)
        self.assertIn("where status <> 'complete'", sql)
        self.assertIn('old.status = \'complete\'', sql)
        self.assertIn('before update or delete', sql)
        self.assertNotIn('update public.attendance', sql.lower())
        self.assertNotIn('update public.workers', sql.lower())

    def test_new_attempt_conflict_without_an_open_run_fails_closed(self):
        client = SupabaseReadClient.__new__(SupabaseReadClient)
        conflict_response = MagicMock(status_code=409)
        conflict = requests.HTTPError('conflict', response=conflict_response)
        client.open_morning_verification_for_date = MagicMock(side_effect=[None, None])
        client.create_attendance_verification_run = MagicMock(side_effect=conflict)
        client.update_attendance_verification_run = MagicMock()

        with self.assertRaises(requests.HTTPError):
            client.start_attendance_verification_run({
                'work_date': DAY.isoformat(),
                'verification_type': 'morning',
                'status': 'running',
            })

        client.update_attendance_verification_run.assert_not_called()

    @patch('hikvision_attendance_sync.HikvisionDeviceOperationLock')
    @patch('hikvision_attendance_sync.hikvision_events_for_device')
    def test_segmented_scan_uses_broad_requests_unique_search_ids_and_clipped_boundaries(self, read, lock):
        lock.return_value.__enter__.return_value = None
        read.return_value = ([], {'state': 'complete', 'timed_out': False})
        _, status = hikvision_events_for_device_segmented_verification(
            DAY, None, DEVICE_MAIN, start_time=time(4, 0), end_time=time(9, 15),
        )
        calls = [call.kwargs for call in read.call_args_list]
        self.assertEqual(verification_event_windows(time(4, 0), time(9, 15)), [
            (time(4, 0), time(6, 59, 59)), (time(7, 0), time(9, 15)),
        ])
        self.assertEqual(verification_event_windows(time(6, 30), time(9, 15)), [
            (time(6, 30), time(6, 59, 59)), (time(7, 0), time(9, 15)),
        ])
        self.assertEqual([(call['start_time'], call['end_time']) for call in calls], verification_event_windows(time(4, 0), time(9, 15)))
        self.assertEqual(len({call['search_id'] for call in calls}), 2)
        self.assertTrue(all(len(call['search_id']) <= 32 for call in calls))
        self.assertTrue(all('employee_no' not in call for call in calls))
        self.assertEqual(status['state'], 'complete')

    @patch('hikvision_attendance_sync.HikvisionDeviceOperationLock')
    @patch('hikvision_attendance_sync.hikvision_events_for_device')
    def test_one_segment_http_400_makes_coverage_incomplete(self, read, lock):
        lock.return_value.__enter__.return_value = None
        read.side_effect = [
            ([event('05:00:00', 1)], {'state': 'complete', 'timed_out': False}),
            ([], {'state': 'failed', 'timed_out': False, 'error': 'HTTPError: 400'}),
        ]
        events, status = hikvision_events_for_device_segmented_verification(
            DAY, None, DEVICE_MAIN, start_time=time(4, 0), end_time=time(9, 15),
        )
        self.assertEqual(status['state'], 'partial')
        self.assertEqual(len(events), 1)
        self.assertEqual(status['segments_complete'], 1)

    @patch('hikvision_attendance_sync.HikvisionDeviceOperationLock')
    @patch('hikvision_attendance_sync.hikvision_events_for_device')
    def test_one_segment_timeout_makes_coverage_incomplete(self, read, lock):
        lock.return_value.__enter__.return_value = None
        read.side_effect = [
            ([], {'state': 'complete', 'timed_out': False}),
            ([], {'state': 'failed', 'timed_out': True, 'error': 'ReadTimeout'}),
        ]
        _, status = hikvision_events_for_device_segmented_verification(
            DAY, None, DEVICE_MAIN, start_time=time(4, 0), end_time=time(9, 15),
        )
        self.assertEqual(status['state'], 'failed')
        self.assertTrue(status['timed_out'])

    @patch('hikvision_attendance_sync.HikvisionDeviceOperationLock')
    @patch('hikvision_attendance_sync.hikvision_events_for_device')
    def test_duplicate_event_from_adjacent_segments_is_returned_once(self, read, lock):
        lock.return_value.__enter__.return_value = None
        duplicate = event('06:59:59', 206784)
        read.side_effect = [
            ([duplicate], {'state': 'complete', 'timed_out': False}),
            ([dict(duplicate)], {'state': 'complete', 'timed_out': False}),
        ]
        events, status = hikvision_events_for_device_segmented_verification(
            DAY, None, DEVICE_MAIN, start_time=time(4, 0), end_time=time(9, 15),
        )
        self.assertEqual(status['state'], 'complete')
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['serialNo'], 206784)

    def test_total_matches_shortfall_is_incomplete_even_when_device_says_ok(self):
        class Response:
            status_code = 200
            def __init__(self, payload): self.payload = payload
            def raise_for_status(self): return None
            def json(self): return {'AcsEvent': self.payload}

        class Client:
            def __init__(self, *_): self.calls = 0
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return DEVICE_MAIN.ip
            def request(self, *_args, **_kwargs):
                self.calls += 1
                if self.calls == 1:
                    return Response({'InfoList': [event('07:58:11', 1)], 'responseStatusStrg': 'OK', 'totalMatches': 2})
                return Response({'InfoList': [], 'responseStatusStrg': 'OK', 'totalMatches': 2})
            def refresh_digest_session(self): pass
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client), patch(
            'hikvision_attendance_sync.HIKVISION_SUCCESSFUL_PAGE_DELAY_SECONDS', 0,
        ):
            _, status = hikvision_events_for_device(
                DAY, RequestDiagnostics(False), DEVICE_MAIN, return_status=True,
                start_time=time(4, 0), end_time=time(9, 15),
            )
        self.assertEqual(status['state'], 'partial')
        self.assertFalse(status['pagination_complete'])
        self.assertEqual(status['reported_total_matches'], 2)

    @patch('hikvision_attendance_verification.hikvision_events_for_device_segmented_verification')
    def test_multiple_workers_on_one_device_share_one_scan(self, scan):
        resolution = base_resolution()
        resolution['workers']['w2'] = {'id': 'w2', 'full_name': 'SECOND', 'is_active': True, 'team_id': 't1'}
        resolution['classifications']['w2'] = 'normal'
        resolution['confirmed'][('office-main', '2')] = {
            'worker_id': 'w2', 'device_id': 'office-main', 'device_employee_no': '2',
        }
        scan.return_value = ([], {'state': 'complete', 'attempted': True, 'segments': []})
        results, worker_keys = _query_targets(
            resolution['workers'], resolution, [DEVICE_MAIN], DAY, None, time(4, 0), 2,
        )
        self.assertEqual(scan.call_count, 1)
        self.assertEqual(set(results), {'office-main'})
        self.assertEqual(worker_keys['w1'], {('office-main', '0336699')})
        self.assertEqual(worker_keys['w2'], {('office-main', '2')})

    def test_existing_attendance_needs_no_identity_query(self):
        resolution = base_resolution({'check_in': '07:58:11', 'check_out': None})
        self.assertEqual(morning_verification_targets(resolution), {})

    def test_missing_attendance_is_targeted(self):
        self.assertEqual(set(morning_verification_targets(base_resolution())), {'w1'})

    def test_benjamin_exact_confirmed_mapping_remains_biometric_in_scope(self):
        scope = biometric_verification_scope(base_resolution())
        self.assertEqual(set(scope['enrolled']), {'w1'})
        self.assertEqual(scope['not_enrolled'], {})
        self.assertEqual(scope['unknown'], {})

    def test_not_enrolled_worker_is_excluded_from_morning_targets(self):
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation']['w1'] = 'not_enrolled'
        self.assertEqual(morning_verification_targets(resolution), {})

    def test_unknown_worker_is_not_silently_excluded_as_non_biometric(self):
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation'] = {}
        scope = biometric_verification_scope(resolution)
        self.assertEqual(set(scope['unknown']), {'w1'})
        self.assertEqual(scope['not_enrolled'], {})

    def test_special_staff_is_not_targeted(self):
        resolution = base_resolution()
        resolution['classifications']['w1'] = 'special_staff'
        self.assertEqual(morning_verification_targets(resolution), {})

    def test_inactive_worker_is_not_targeted(self):
        resolution = base_resolution()
        resolution['workers']['w1']['is_active'] = False
        self.assertEqual(morning_verification_targets(resolution), {})

    def test_exact_confirmed_mapping_queries_only_its_device(self):
        queries = worker_identity_queries('w1', base_resolution(), [DEVICE_MAIN, DEVICE_SECONDARY])
        self.assertEqual([(item[0].device_id, item[1]) for item in queries], [('office-main', '0336699')])

    def test_benjamin_exact_mapping_overrides_legacy_ignore_only_on_office_main(self):
        resolution = base_resolution()
        resolution['ignored'] = {(None, '0336699')}

        queries = worker_identity_queries('w1', resolution, [DEVICE_MAIN, DEVICE_SECONDARY])

        self.assertEqual([(item[0].device_id, item[1]) for item in queries], [('office-main', '0336699')])

    def test_exact_scoped_ignore_blocks_verification_query_even_with_exact_mapping(self):
        resolution = base_resolution()
        resolution['ignored'] = {('office-main', '0336699'), (None, '0336699')}

        self.assertEqual(worker_identity_queries('w1', resolution, [DEVICE_MAIN, DEVICE_SECONDARY]), [])

    def test_exact_scoped_ignore_rejects_preexisting_persisted_verification_evidence(self):
        resolution = base_resolution()
        resolution['ignored'] = {('office-main', '0336699')}

        self.assertEqual(
            filter_worker_events(
                [event('07:58:11', 206784)], 'w1', resolution, start_time=time(4, 0),
            ),
            [],
        )

    def test_legacy_confirmed_mapping_queries_each_safe_device(self):
        resolution = base_resolution(confirmed={(None, '68'): {'worker_id': 'w1', 'device_id': None, 'device_employee_no': '68'}})
        queries = worker_identity_queries('w1', resolution, [DEVICE_MAIN, DEVICE_SECONDARY])
        self.assertEqual({(item[0].device_id, item[1]) for item in queries}, {('office-main', '68'), ('office-secondary', '68')})

    def test_conflicting_identity_never_becomes_a_query(self):
        resolution = base_resolution(confirmed={})
        resolution['mapping_conflicts'] = {('office-main', '0336699')}
        self.assertEqual(worker_identity_queries('w1', resolution, [DEVICE_MAIN]), [])

    def test_absence_is_blocked_without_complete_verification(self):
        plans = [{'worker_id': 'w1', 'proposed_status': 'absent'}, {'worker_id': 'w2', 'proposed_status': 'half_day'}]
        self.assertEqual(absence_plans_with_verification(plans, {'status': 'incomplete'}), [plans[1]])

    def test_absence_is_allowed_only_for_explicit_verified_worker(self):
        plans = [{'worker_id': 'w1', 'proposed_status': 'absent'}, {'worker_id': 'w9', 'proposed_status': 'absent'}]
        result = absence_plans_with_verification(plans, {'status': 'complete', 'verified_no_event_worker_ids': ['w1']})
        self.assertEqual(result, [plans[0]])

    def test_0758_and_1304_events_create_half_day_without_checkout(self):
        plans, _ = plan_attendance([event('07:58:11', 206784), event('13:04:05', 207094)], base_resolution(), DAY)
        self.assertEqual(plans[0]['check_in'], '07:58:11')
        self.assertIsNone(plans[0]['check_out'])
        self.assertEqual(plans[0]['proposed_status'], 'half_day')

    def test_checkout_target_requires_checkin_and_missing_checkout(self):
        existing = {'attendance_date': DAY.isoformat(), 'check_in': '07:58:11', 'check_out': None, 'attendance_source': 'biometric', 'manual_override': False}
        self.assertEqual(set(checkout_verification_targets(base_resolution(existing))), {'w1'})
        self.assertEqual(checkout_verification_targets(base_resolution({**existing, 'check_out': '17:05:00'})), {})

    def test_duplicate_recovered_event_is_idempotent(self):
        same = event('07:58:11', 206784)
        self.assertEqual(len(deduplicate_hikvision_events([same, dict(same)])), 1)

    def test_verification_audit_preserves_raw_timestamp_identity_type_and_serial(self):
        evidence = verification_event_evidence([event('07:58:11', 206784)])[0]
        self.assertEqual(evidence, {
            'device_id': 'office-main', 'device_employee_no': '0336699',
            'raw_timestamp': '2026-09-04T07:58:11+01:00', 'serial': '206784',
            'major': 5, 'minor': 75, 'reason': 'broad_read_miss_recovered',
        })

    @patch('hikvision_attendance_verification.apply_biometric_attendance')
    @patch('hikvision_attendance_verification.resolved_biometric_event_rows')
    @patch('hikvision_attendance_verification.hikvision_events_for_device_segmented_verification')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_benjamin_broad_omission_is_recovered_by_segmented_scan(self, load, _persisted, scan, rows, apply):
        before = base_resolution()
        after = base_resolution({'check_in': '07:58:11', 'check_out': None, 'attendance_source': 'biometric', 'manual_override': False})
        load.side_effect = [before, after]
        scan.return_value = (
            [
                event('07:58:11', 206784),
                event('13:04:05', 207094),
                event('08:15:00', 999999, identity='unrelated'),
            ],
            {'state': 'complete', 'segments': []},
        )
        rows.return_value = [{'device_id': 'office-main', 'event_identity': '["serial","office-main","206784"]'}]
        apply.return_value = {'inserted': 1}
        result = run_targeted_verification(client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent')
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['recovered_worker_count'], 1)
        self.assertEqual(result['verification_device_scans'], 1)
        self.assertEqual(scan.call_count, 1)
        plans = apply.call_args.args[1]
        self.assertEqual(plans[0]['check_in'], '07:58:11')
        self.assertIsNone(plans[0]['check_out'])
        self.assertEqual(plans[0]['proposed_status'], 'half_day')
        self.assertEqual({item['serialNo'] for item in rows.call_args.args[0]}, {206784, 207094})

    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_worker_without_safe_mapping_remains_unresolved(self, load, _persisted, query):
        resolution = base_resolution(confirmed={})
        load.return_value = resolution
        query.return_value = ({}, {})
        result = run_targeted_verification(
            client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['worker_results'][0]['verification_result'], 'unresolved')
        self.assertEqual(result['failures'][0]['reason'], 'no_safe_confirmed_mapping')

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_explicit_not_enrolled_is_excluded_without_negative_evidence(self, load, _persisted, _query):
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation']['w1'] = 'not_enrolled'
        load.return_value = resolution

        result = run_targeted_verification(
            client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )

        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['target_workers'], 0)
        self.assertEqual(result['non_biometric_excluded_count'], 1)
        self.assertEqual(result['workers_verified_no_event'], 0)
        self.assertEqual(result['unresolved_worker_count'], 0)
        self.assertEqual(result['worker_results'][0]['verification_result'], 'not_enrolled_excluded')

    @patch('hikvision_attendance_verification.apply_biometric_attendance')
    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_not_enrolled_manual_attendance_is_preserved(self, load, _persisted, _query, apply):
        resolution = base_resolution({
            'check_in': '08:00:00', 'check_out': None,
            'attendance_source': 'manual', 'manual_override': True,
        }, confirmed={})
        resolution['biometric_participation']['w1'] = 'not_enrolled'
        load.return_value = resolution

        result = run_targeted_verification(
            client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )

        apply.assert_not_called()
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['workers_with_existing_check_in'], 1)
        self.assertEqual(result['worker_results'][0]['verification_result'], 'not_enrolled_excluded')

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_unknown_participation_fails_closed_even_without_device_candidate(self, load, _persisted, _query):
        resolution = base_resolution(confirmed={})
        resolution['biometric_participation'] = {}
        load.return_value = resolution

        result = run_targeted_verification(
            client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )

        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['unknown_biometric_status_count'], 1)
        self.assertEqual(result['unresolved_worker_count'], 1)
        self.assertEqual(result['failures'][0]['reason'], 'unknown_biometric_participation')
        self.assertEqual(result['workers_verified_no_event'], 0)

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_unknown_retry_with_enrolled_existing_checkin_supersedes_stale_unresolved(
        self, load, _persisted, _query,
    ):
        client = FakeClient()
        unknown = base_resolution(confirmed={})
        unknown['biometric_participation'] = {}
        load.return_value = unknown

        first = run_targeted_verification(
            client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )
        self.assertEqual(first['status'], 'incomplete')
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'unresolved')

        enrolled = base_resolution({
            'check_in': '10:52:01', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        })
        load.return_value = enrolled
        second = run_targeted_verification(
            client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )

        self.assertEqual(second['status'], 'complete')
        self.assertEqual(second['unresolved_worker_count'], 0)
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'attendance_present')
        self.assertEqual(
            client.worker_rows[('run-1', 'w1')]['verification_details']['reason'],
            'existing_attendance_check_in',
        )

    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_unresolved_retry_converges_to_verified_no_event(self, load, _persisted, query):
        client = FakeClient()
        unsafe = base_resolution(confirmed={})
        load.return_value = unsafe
        query.return_value = ({}, {})
        first = run_targeted_verification(
            client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )
        self.assertEqual(first['status'], 'incomplete')
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'unresolved')

        load.return_value = base_resolution()
        query.return_value = (
            {'office-main': ([], {'state': 'complete', 'segments': []})},
            {'w1': {('office-main', '0336699')}},
        )
        second = run_targeted_verification(
            client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
        )
        self.assertEqual(second['status'], 'complete')
        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'verified_no_event')

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_unresolved_retry_is_idempotent_and_other_run_is_untouched(self, load, _persisted, _query):
        client = FakeClient()
        client.worker_rows[('run-old', 'w1')] = {
            'run_id': 'run-old', 'worker_id': 'w1', 'verification_result': 'verified_no_event',
        }
        unresolved = base_resolution(confirmed={})
        load.return_value = unresolved

        for _ in range(2):
            result = run_targeted_verification(
                client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
            )
            self.assertEqual(result['status'], 'incomplete')

        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'unresolved')
        self.assertEqual(client.worker_rows[('run-old', 'w1')]['verification_result'], 'verified_no_event')
        self.assertEqual(set(client.worker_rows), {('run-old', 'w1'), ('run-1', 'w1')})

    @patch('hikvision_attendance_verification._query_targets', return_value=({}, {}))
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_new_verification_after_completed_checkin_run_uses_distinct_identity(self, load, _persisted, _query):
        client = FakeClient()
        load.return_value = base_resolution({
            'check_in': '07:58:11', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        })

        for _ in range(2):
            result = run_targeted_verification(
                client=client, target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent',
            )
            self.assertEqual(result['status'], 'complete')

        self.assertEqual(client.worker_rows[('run-1', 'w1')]['verification_result'], 'attendance_present')
        self.assertEqual(client.worker_rows[('run-2', 'w1')]['verification_result'], 'attendance_present')
        self.assertEqual(len(client.worker_rows), 2)
        self.assertEqual(len(client.runs), 2)
        self.assertTrue(all(run['status'] == 'complete' for run in client.runs))

    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data', return_value=base_resolution())
    def test_complete_no_event_is_verified_negative(self, _load, _persisted, query):
        query.return_value = ({'office-main': ([], {'state': 'complete', 'segments': []})}, {'w1': {('office-main', '0336699')}})
        result = run_targeted_verification(client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent')
        self.assertEqual(query.call_args.args[5], time(6, 30))
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['worker_results'][0]['verification_result'], 'verified_no_event')

    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data', return_value=base_resolution())
    def test_timeout_never_becomes_negative_evidence(self, _load, _persisted, query):
        query.return_value = ({'office-main': ([], {'state': 'failed', 'error': 'ReadTimeout', 'timed_out': True, 'segments': []})}, {'w1': {('office-main', '0336699')}})
        result = run_targeted_verification(client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent')
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['worker_results'][0]['verification_result'], 'unresolved')

    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_multiple_relevant_devices_require_every_negative_query_to_complete(self, load, _persisted, query):
        resolution = base_resolution(confirmed={
            ('office-main', '0336699'): {'worker_id': 'w1', 'device_id': 'office-main', 'device_employee_no': '0336699'},
            ('office-secondary', '94'): {'worker_id': 'w1', 'device_id': 'office-secondary', 'device_employee_no': '94'},
        })
        load.return_value = resolution
        query.return_value = ({
            'office-main': ([], {'state': 'complete', 'segments': []}),
            'office-secondary': ([], {'state': 'failed', 'error': 'timeout', 'segments': []}),
        }, {'w1': {('office-main', '0336699'), ('office-secondary', '94')}})
        result = run_targeted_verification(client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN, DEVICE_SECONDARY], diagnostics=None, agent_id='agent')
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['worker_results'][0]['verification_result'], 'unresolved')
        self.assertEqual(result['unresolved_worker_count'], 1)

    @patch('hikvision_attendance_verification.apply_biometric_attendance')
    @patch('hikvision_attendance_verification.resolved_biometric_event_rows', return_value=[])
    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_checkout_fallback_recovers_only_qualifying_event(self, load, _persisted, query, _rows, apply):
        before = base_resolution({'attendance_date': DAY.isoformat(), 'check_in': '07:58:11', 'check_out': None, 'attendance_source': 'biometric', 'manual_override': False})
        after = base_resolution({'attendance_date': DAY.isoformat(), 'check_in': '07:58:11', 'check_out': '17:04:05', 'attendance_source': 'biometric', 'manual_override': False})
        load.side_effect = [before, after]
        query.return_value = ({'office-main': ([event('17:04:05', 207999)], {'state': 'complete', 'segments': []})}, {'w1': {('office-main', '0336699')}})
        apply.return_value = {'updated': 1}
        result = run_targeted_verification(client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent', mode='checkout')
        self.assertEqual(result['status'], 'complete')
        plan = apply.call_args.args[1][0]
        self.assertEqual(plan['check_out'], '17:04:05')
        self.assertEqual(plan['proposed_status'], 'present')

    @patch('hikvision_attendance_verification._query_targets')
    @patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], []))
    @patch('hikvision_attendance_verification.load_resolution_data')
    def test_manual_protected_row_is_never_overwritten(self, load, _persisted, query):
        protected = {'check_in': None, 'check_out': None, 'attendance_source': 'manual', 'manual_override': True}
        load.return_value = base_resolution(protected)
        query.return_value = ({'office-main': ([event('07:58:11', 1)], {'state': 'complete', 'segments': []})}, {'w1': {('office-main', '0336699')}})
        with patch('hikvision_attendance_verification.resolved_biometric_event_rows', return_value=[]), patch('hikvision_attendance_verification.apply_biometric_attendance') as apply:
            result = run_targeted_verification(client=FakeClient(), target_date=DAY, devices=[DEVICE_MAIN], diagnostics=None, agent_id='agent')
        apply.assert_called_once()
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['worker_results'][0]['verification_result'], 'manual_protected')


if __name__ == '__main__':
    unittest.main()
