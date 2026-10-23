"""Execution lifecycle tests; all network calls and OS observations are fake."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from morning_processing_lifecycle import ProcessingLifecycle


class LifecycleTests(unittest.TestCase):
    def manager(self):
        with patch('morning_processing_lifecycle.process_token', return_value='birth-token'):
            return ProcessingLifecycle(SimpleNamespace(base_url='fake'), Mock(return_value=[]), background=False)

    def test_active_operation_heartbeats_and_cannot_be_attested_inactive(self):
        manager = self.manager()
        with manager.processing('current_attendance', '2026-10-23'):
            job = next(iter(manager.active))
            candidate = dict(id=job, owner_execution_id=manager.execution_id, owner_host=manager.host)
            self.assertIsNone(manager.inactivity_evidence(candidate))
            manager.tick()
            manager.rpc.assert_any_call(manager.client, 'agent_morning_processing_heartbeat',
                                        {'p_execution_id': manager.execution_id, 'p_job_ids': [job]})
        self.assertFalse(manager.active)
        self.assertFalse(manager.pending)

    def test_failed_terminal_write_is_retained_and_retried_without_fabricating_success(self):
        manager = self.manager()
        fail = True
        calls = []
        def rpc(client, name, payload):
            calls.append((name, payload))
            if name.endswith('_finish') and fail:
                raise ConnectionError('DNS failure')
            return []
        manager.rpc = rpc
        with self.assertRaisesRegex(ValueError, 'actual processing failed'):
            with manager.processing('current_attendance', '2026-10-23'):
                raise ValueError('actual processing failed')
        self.assertFalse(manager.active)
        self.assertEqual(len(manager.pending), 1)
        self.assertEqual(next(iter(manager.pending.values()))['p_status'], 'failed')
        fail = False
        manager.tick()
        self.assertFalse(manager.pending)
        self.assertTrue(all(p['p_status'] == 'failed' for n, p in calls if n.endswith('_finish')))

    def test_successful_work_does_not_rerun_when_terminal_ack_is_lost(self):
        manager = self.manager()
        fail = True
        def rpc(client, name, payload):
            if name.endswith('_finish') and fail:
                raise TimeoutError('lost response')
            return []
        manager.rpc = rpc
        with manager.processing('current_attendance'):
            pass
        self.assertEqual(next(iter(manager.pending.values()))['p_status'], 'complete')
        fail = False
        manager.tick()
        self.assertFalse(manager.pending)

    def test_dead_process_or_reused_pid_produces_identity_bound_evidence(self):
        manager = self.manager()
        job = {'id': 'old', 'owner_host': manager.host, 'owner_execution_id': 'other',
               'owner_pid': 123, 'owner_process_token': 'old-birth'}
        for observed in [None, 'new-birth']:
            with patch('morning_processing_lifecycle.process_token', return_value=observed):
                evidence = manager.inactivity_evidence(job)
            self.assertEqual(evidence['kind'], 'owner_process_exited')
            self.assertEqual(evidence['owner_process_token'], 'old-birth')
            self.assertEqual(evidence['observed_process_token'], observed)

    def test_old_but_live_process_is_never_classified_from_age(self):
        manager = self.manager()
        job = {'id': 'old', 'owner_host': manager.host, 'owner_execution_id': 'other',
               'owner_pid': 123, 'owner_process_token': 'old-birth'}
        with patch('morning_processing_lifecycle.process_token', return_value='old-birth'):
            self.assertIsNone(manager.inactivity_evidence(job))
        with patch('morning_processing_lifecycle.process_token', side_effect=OSError('denied')):
            self.assertIsNone(manager.inactivity_evidence(job))

    def test_same_execution_inactive_operation_is_provable_without_killing_agent(self):
        manager = self.manager()
        job = {'id': 'ended', 'owner_host': manager.host, 'owner_execution_id': manager.execution_id,
               'owner_pid': manager.pid, 'owner_process_token': manager.token}
        self.assertEqual(manager.inactivity_evidence(job)['kind'], 'owner_execution_inactive')

    def test_legacy_and_other_host_records_are_not_automatically_attested(self):
        manager = self.manager()
        self.assertIsNone(manager.inactivity_evidence({'id': 'legacy', 'owner_host': manager.host}))
        self.assertIsNone(manager.inactivity_evidence({'id': 'remote', 'owner_host': 'other-host',
                                                     'owner_execution_id': 'other'}))

    def test_lost_registration_response_does_not_execute_unfenced_work(self):
        manager = self.manager()
        manager.rpc.side_effect = TimeoutError('ambiguous registration')
        worked = False
        with self.assertRaises(TimeoutError):
            with manager.processing('current_attendance'):
                worked = True
        self.assertFalse(worked)
        self.assertFalse(manager.active)


if __name__ == '__main__':
    unittest.main()
