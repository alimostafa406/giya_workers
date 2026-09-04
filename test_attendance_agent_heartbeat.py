"""Focused non-writing tests for agent heartbeat validity on skipped attendance."""

import logging
import unittest
from types import SimpleNamespace
from collections import Counter
from datetime import date, datetime, timezone
from unittest.mock import patch

from hikvision_attendance_agent import AttendanceAgent, completion_plans, positive_evidence_plans, previous_workday, run_agent_loop, run_startup_recovery
from hikvision_device_lock import HikvisionDeviceLockTimeout
from hikvision_attendance_sync import biometric_payload, is_manual_protected, payload_changed


NOW = datetime(2026, 8, 10, 19, 11, 14, tzinfo=timezone.utc)


class CapturingStatusClient:
    host = 'example.supabase.co'

    def __init__(self):
        self.payloads = []

    def upsert_agent_status(self, payload):
        self.payloads.append(payload)
        return payload

    def upsert_agent_device_statuses(self, agent_id, device_statuses):
        return {'agent_id': agent_id, 'devices': device_statuses}


class AttendanceAgentHeartbeatTests(unittest.TestCase):
    def make_agent(self, dry_run=True):
        logger = logging.getLogger('attendance-agent-test')
        logger.handlers = [logging.NullHandler()]
        # The production entry point loads the local device configuration before
        # constructing the agent. This unit test exercises heartbeat state only,
        # so it deliberately supplies no real-device configuration.
        with patch('hikvision_attendance_agent.configured_devices', return_value=[]):
            agent = AttendanceAgent(dry_run=dry_run, logger=logger)
        agent.agent_id = 'test-agent'
        agent.machine_name = 'test-machine'
        agent.client = CapturingStatusClient()
        agent.probe_hikvision = lambda: (True, None)
        return agent

    def test_test_only_date_skips_attendance_and_still_sends_valid_heartbeat(self):
        agent = self.make_agent()
        with patch('hikvision_attendance_agent.local_now', return_value=NOW):
            ok, error = agent.process_today_attendance()
            agent.run_cycle(run_users=False, run_attendance=True)
            agent.heartbeat()
        self.assertTrue(ok)
        self.assertIsNone(error)
        payload = agent.client.payloads[-1]
        self.assertEqual(set(payload), {
            'agent_id', 'machine_name', 'last_seen_at', 'hikvision_reachable',
            'supabase_reachable', 'last_user_sync_at', 'last_error',
        })
        self.assertEqual(payload['agent_id'], 'test-agent')
        self.assertEqual(payload['machine_name'], 'test-machine')
        self.assertTrue(payload['hikvision_reachable'])
        self.assertTrue(payload['supabase_reachable'])
        self.assertIsNone(payload['last_user_sync_at'])
        self.assertNotIn('last_attendance_sync_at', payload)
        self.assertIsNone(payload['last_error'])

    def test_heartbeat_keeps_the_last_successful_processing_timestamp_independent(self):
        agent = self.make_agent()
        agent.last_attendance_sync_at = '2026-08-11T10:14:26+00:00'

        agent.heartbeat()

        self.assertEqual(
            agent.client.payloads[-1]['last_attendance_sync_at'],
            '2026-08-11T10:14:26+00:00',
        )

    def test_successful_attendance_apply_updates_processing_timestamp(self):
        agent = self.make_agent(dry_run=False)
        agent.device_statuses['office-main'] = {
            'reachable': False,
            'last_successful_read_at': None,
            'last_error': None,
        }
        processing_time = datetime(2026, 8, 11, 10, 14, 26, tzinfo=timezone.utc)
        complete_read = {'office-main': {'state': 'complete', 'event_count': 7, 'error': None}}
        resolution = {'existing_attendance': {}}

        with patch('hikvision_attendance_agent.local_now', return_value=processing_time), patch(
            'hikvision_attendance_agent.hikvision_events_with_devices', return_value=([], complete_read),
        ), patch('hikvision_attendance_agent.load_resolution_data', return_value=resolution), patch(
            'hikvision_attendance_agent.plan_attendance', return_value=([], Counter()),
        ), patch('hikvision_attendance_agent.write_summary', return_value=Counter()), patch.object(
            agent, 'persist_observed_biometric_events'
        ), patch('hikvision_attendance_agent.apply_biometric_attendance', return_value=Counter(updated=1)):
            ok, error = agent.process_today_attendance()

        self.assertTrue(ok)
        self.assertIsNone(error)
        self.assertEqual(agent.last_attendance_sync_at, processing_time.isoformat())

    def test_partial_cycle_processes_positive_evidence_without_advancing_complete_sync_timestamp(self):
        agent = self.make_agent(dry_run=False)
        agent.last_attendance_sync_at = '2026-08-11T09:00:00+00:00'
        agent.device_statuses['office-main'] = {
            'reachable': True,
            'last_successful_read_at': None,
            'last_error': None,
        }
        processing_time = datetime(2026, 8, 11, 10, 14, 26, tzinfo=timezone.utc)
        partial_read = {'office-main': {'state': 'partial', 'event_count': 7, 'error': 'connection lost'}}
        resolution = {'existing_attendance': {}}

        positive = {'worker_id': 'positive', 'proposed_status': 'present', 'check_in': '08:00:00', 'check_out': '17:00:00'}
        absent = {'worker_id': 'negative', 'proposed_status': 'absent', 'check_in': None, 'check_out': None}
        with patch('hikvision_attendance_agent.local_now', return_value=processing_time), patch(
            'hikvision_attendance_agent.hikvision_events_with_devices', return_value=([], partial_read),
        ), patch('hikvision_attendance_agent.load_resolution_data', return_value=resolution), patch(
            'hikvision_attendance_agent.plan_attendance', return_value=([positive, absent], Counter()),
        ), patch('hikvision_attendance_agent.write_summary', return_value=Counter()), patch.object(
            agent, 'persist_observed_biometric_events'
        ), patch('hikvision_attendance_agent.apply_biometric_attendance') as apply:
            ok, error = agent.process_today_attendance()

        self.assertFalse(ok)
        self.assertTrue(error)
        apply.assert_called_once_with(agent.client, [positive], {})
        self.assertEqual(agent.last_attendance_sync_at, '2026-08-11T09:00:00+00:00')

    def test_incomplete_coverage_filter_never_allows_absence(self):
        positive = {'worker_id': 'positive', 'proposed_status': 'half_day', 'check_in': '09:05:00'}
        absent = {'worker_id': 'negative', 'proposed_status': 'absent', 'check_in': None}
        pending = {'worker_id': 'pending', 'proposed_status': 'pending', 'check_in': None}
        self.assertEqual(positive_evidence_plans([positive, absent, pending]), [positive, pending])

    def test_failed_attendance_apply_does_not_advance_processing_timestamp(self):
        agent = self.make_agent(dry_run=False)
        agent.last_attendance_sync_at = '2026-08-11T09:00:00+00:00'
        agent.device_statuses['office-main'] = {
            'reachable': False,
            'last_successful_read_at': None,
            'last_error': None,
        }
        processing_time = datetime(2026, 8, 11, 10, 14, 26, tzinfo=timezone.utc)
        complete_read = {'office-main': {'state': 'complete', 'event_count': 7, 'error': None}}
        resolution = {'existing_attendance': {}}

        with patch('hikvision_attendance_agent.local_now', return_value=processing_time), patch(
            'hikvision_attendance_agent.hikvision_events_with_devices', return_value=([], complete_read),
        ), patch('hikvision_attendance_agent.load_resolution_data', return_value=resolution), patch(
            'hikvision_attendance_agent.plan_attendance', return_value=([], Counter()),
        ), patch('hikvision_attendance_agent.write_summary', return_value=Counter()), patch.object(
            agent, 'persist_observed_biometric_events'
        ), patch('hikvision_attendance_agent.apply_biometric_attendance', return_value=Counter(aborted_structural_error=1)):
            agent.process_today_attendance()

        self.assertEqual(agent.last_attendance_sync_at, '2026-08-11T09:00:00+00:00')

    def test_user_sync_success_or_failure_keeps_heartbeat_payload_valid(self):
        for sync_result, expected_reachable in ((True, True), (False, False)):
            with self.subTest(sync_result=sync_result):
                agent = self.make_agent()
                agent.probe_hikvision = lambda: (sync_result, None if sync_result else 'Hikvision test failure.')
                with patch.object(agent, 'sync_users', return_value=sync_result):
                    agent.run_cycle(run_users=True, run_attendance=False)
                agent.heartbeat()
                payload = agent.client.payloads[-1]
                self.assertEqual(payload['hikvision_reachable'], expected_reachable)
                self.assertTrue(payload['supabase_reachable'])
                self.assertEqual(payload['agent_id'], 'test-agent')
                self.assertEqual(payload['machine_name'], 'test-machine')

    def test_one_transient_probe_failure_does_not_flip_known_healthy_status(self):
        agent = self.make_agent()
        agent.hikvision_reachable = True
        agent.probe_hikvision = lambda: (False, 'Hikvision connectivity check timed out.')
        agent.heartbeat()
        self.assertTrue(agent.client.payloads[-1]['hikvision_reachable'])
        agent.heartbeat()
        self.assertFalse(agent.client.payloads[-1]['hikvision_reachable'])

    def test_scheduler_loop_survives_lock_timeout_and_runs_a_later_cycle(self):
        logger = logging.getLogger('attendance-agent-loop-test')
        logger.handlers = [logging.NullHandler()]
        cycle_calls = []
        heartbeats = []

        def run_cycle(*_):
            cycle_calls.append(True)
            if len(cycle_calls) == 1:
                raise HikvisionDeviceLockTimeout('office-main device lock timed out')

        agent = SimpleNamespace(last_error=None, logger=logger, run_cycle=run_cycle, heartbeat=lambda: heartbeats.append(True))
        with patch('hikvision_attendance_agent.time_module.monotonic', side_effect=range(1, 20)), patch(
            'hikvision_attendance_agent.time_module.sleep'
        ):
            run_agent_loop(agent, attendance_interval=1, users_interval=1, heartbeat_interval=1, max_iterations=2)

        self.assertEqual(len(cycle_calls), 2)
        self.assertEqual(len(heartbeats), 2)

    def test_heartbeat_runs_before_each_timed_out_attendance_cycle(self):
        logger = logging.getLogger('attendance-agent-timeout-order-test')
        logger.handlers = [logging.NullHandler()]
        calls = []

        def timed_out_cycle(*_):
            calls.append('cycle')
            raise TimeoutError('office-secondary read timed out')

        agent = SimpleNamespace(
            last_error=None,
            logger=logger,
            run_cycle=timed_out_cycle,
            heartbeat=lambda: calls.append('heartbeat'),
        )
        with patch('hikvision_attendance_agent.time_module.monotonic', side_effect=range(1, 20)), patch(
            'hikvision_attendance_agent.time_module.sleep'
        ):
            run_agent_loop(agent, attendance_interval=1, users_interval=1, heartbeat_interval=1, max_iterations=2)

        self.assertEqual(calls, ['heartbeat', 'cycle', 'heartbeat', 'cycle'])

    def test_startup_heartbeat_precedes_previous_workday_device_recovery(self):
        logger = logging.getLogger('attendance-agent-startup-order-test')
        logger.handlers = [logging.NullHandler()]
        calls = []
        agent = SimpleNamespace(
            last_error=None,
            logger=logger,
            heartbeat=lambda **kwargs: calls.append(('heartbeat', kwargs)),
            complete_previous_workday=lambda: calls.append(('recovery', {})) or (False, 'office-secondary timeout'),
        )

        run_startup_recovery(agent)

        self.assertEqual(calls[0], ('heartbeat', {'probe_devices': False}))
        self.assertEqual(calls[1], ('recovery', {}))
        self.assertEqual(agent.last_error, 'office-secondary timeout')

    def test_running_scheduler_retries_previous_workday_after_transient_failure(self):
        logger = logging.getLogger('attendance-agent-reconciliation-retry-test')
        logger.handlers = [logging.NullHandler()]
        recovery_results = iter([(False, 'Supabase timeout'), (True, None)])
        recoveries = []
        def recover():
            recoveries.append(True)
            return next(recovery_results)
        agent = SimpleNamespace(
            last_error=None, logger=logger, heartbeat=lambda: None,
            run_cycle=lambda *_: None, complete_previous_workday=recover,
        )
        with patch('hikvision_attendance_agent.time_module.monotonic', side_effect=range(1, 80)), patch('hikvision_attendance_agent.time_module.sleep'):
            run_agent_loop(agent, attendance_interval=1000, users_interval=1000, heartbeat_interval=1000, reconciliation_interval=1, max_iterations=3)
        self.assertEqual(len(recoveries), 2)
        self.assertIsNone(agent.last_error)


class PreviousWorkdayCompletionTests(unittest.TestCase):
    def test_monday_selects_saturday(self):
        self.assertEqual(previous_workday(date(2026, 8, 17)), date(2026, 8, 15))

    def test_late_checkout_upgrades_existing_biometric_half_day(self):
        existing = {'status': 'half_day', 'check_in': '07:50:00', 'check_out': None, 'attendance_source': 'biometric', 'manual_override': False}
        plan = {'proposed_status': 'present', 'check_in': '07:50:00', 'check_out': '20:30:00', 'day_fraction': 1.0, 'sync_key': 'hikvision:worker-1:2026-08-13', 'biometric_sync_metadata': {}}
        payload = biometric_payload(plan, existing)
        self.assertEqual(payload['status'], 'present')
        self.assertEqual(payload['check_out'], '20:30:00')

    def test_present_is_not_downgraded_by_incomplete_recovery(self):
        existing = {'status': 'present', 'check_in': '07:50:00', 'check_out': '17:00:00', 'attendance_source': 'biometric', 'manual_override': False}
        plan = {'proposed_status': 'half_day', 'check_in': '07:50:00', 'check_out': None, 'day_fraction': 0.5, 'sync_key': 'hikvision:worker-1:2026-08-13', 'biometric_sync_metadata': {}}
        payload = biometric_payload(plan, existing)
        self.assertEqual(payload['status'], 'present')
        self.assertEqual(payload['check_out'], '17:00:00')

    def test_manual_rows_remain_protected(self):
        self.assertTrue(is_manual_protected({'attendance_source': 'manual', 'manual_override': False}))
        self.assertTrue(is_manual_protected({'attendance_source': 'biometric', 'manual_override': True}))

    def test_recovery_payload_is_idempotent_after_update(self):
        existing = {'status': 'half_day', 'check_in': '07:50:00', 'check_out': None, 'attendance_source': 'biometric', 'manual_override': False}
        plan = {'proposed_status': 'present', 'check_in': '07:50:00', 'check_out': '20:30:00', 'day_fraction': 1.0, 'sync_key': 'hikvision:worker-1:2026-08-13', 'biometric_sync_metadata': {}}
        payload = biometric_payload(plan, existing)
        self.assertFalse(payload_changed({**existing, **payload}, payload))

    def test_recovery_does_not_create_historical_absence_without_existing_row(self):
        absent_plan = {'worker_id': 'worker-without-row', 'proposed_status': 'absent'}
        self.assertEqual(completion_plans([absent_plan], {}), [])

    def test_recovery_does_not_create_a_missing_historical_row(self):
        checkin_plan = {'worker_id': 'worker-with-device-proof', 'proposed_status': 'half_day', 'check_in': '09:05:00'}
        self.assertEqual(completion_plans([checkin_plan], {}), [])

    def test_recovery_selects_only_unprotected_biometric_row_missing_checkout(self):
        plan = {'worker_id': 'worker-1', 'proposed_status': 'present', 'check_in': '07:50:00', 'check_out': '17:05:00'}
        eligible = {
            'status': 'half_day', 'check_in': '07:50:00', 'check_out': None,
            'attendance_source': 'biometric', 'manual_override': False,
        }
        self.assertEqual(completion_plans([plan], {'worker-1': eligible}), [plan])

        excluded = (
            {**eligible, 'attendance_source': 'manual'},
            {**eligible, 'manual_override': True},
            {**eligible, 'check_in': None},
            {**eligible, 'check_out': '17:00:00'},
        )
        for row in excluded:
            with self.subTest(row=row):
                self.assertEqual(completion_plans([plan], {'worker-1': row}), [])

    def test_previous_workday_uses_shared_resilient_device_reader(self):
        logger = logging.getLogger('attendance-agent-previous-workday-test')
        logger.handlers = [logging.NullHandler()]
        with patch('hikvision_attendance_agent.configured_devices', return_value=[]):
            agent = AttendanceAgent(dry_run=True, logger=logger)
        agent.client = CapturingStatusClient()
        agent.device_statuses['office-main'] = {
            'reachable': False,
            'last_successful_read_at': None,
            'last_error': None,
        }
        complete_read = {'office-main': {'state': 'complete', 'event_count': 7, 'error': None}}
        resolution = {'existing_attendance': {}}
        monday = datetime(2026, 8, 17, 8, 0, tzinfo=timezone.utc)

        with patch('hikvision_attendance_agent.local_now', return_value=monday), patch(
            'hikvision_attendance_agent.hikvision_events_with_devices', return_value=([], complete_read),
        ) as reader, patch('hikvision_attendance_agent.load_resolution_data', return_value=resolution), patch(
            'hikvision_attendance_agent.plan_attendance', return_value=([], Counter()),
        ):
            ok, error = agent.complete_previous_workday()

        self.assertTrue(ok)
        self.assertIsNone(error)
        self.assertEqual(reader.call_args.args[0], date(2026, 8, 15))


if __name__ == '__main__':
    unittest.main()
