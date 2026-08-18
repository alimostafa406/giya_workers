"""Focused non-writing tests for agent heartbeat validity on skipped attendance."""

import logging
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

from hikvision_attendance_agent import AttendanceAgent, completion_plans, previous_workday
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
    def make_agent(self):
        logger = logging.getLogger('attendance-agent-test')
        logger.handlers = [logging.NullHandler()]
        # The production entry point loads the local device configuration before
        # constructing the agent. This unit test exercises heartbeat state only,
        # so it deliberately supplies no real-device configuration.
        with patch('hikvision_attendance_agent.configured_devices', return_value=[]):
            agent = AttendanceAgent(dry_run=True, logger=logger)
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
            'supabase_reachable', 'last_user_sync_at', 'last_attendance_sync_at',
            'last_error',
        })
        self.assertEqual(payload['agent_id'], 'test-agent')
        self.assertEqual(payload['machine_name'], 'test-machine')
        self.assertTrue(payload['hikvision_reachable'])
        self.assertTrue(payload['supabase_reachable'])
        self.assertIsNone(payload['last_user_sync_at'])
        self.assertIsNone(payload['last_attendance_sync_at'])
        self.assertIsNone(payload['last_error'])

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


if __name__ == '__main__':
    unittest.main()
