"""Cutoff completion regressions; all device/DB writes are fake."""
import unittest
from datetime import date, datetime, time
from unittest.mock import patch, Mock, MagicMock
from types import SimpleNamespace

from morning_report_completion import complete_cutoff_run, cutoff_pass, processing
from hikvision_attendance_verification import run_targeted_verification, _query_targets
from test_attendance_final_verification import FakeClient, base_resolution, DEVICE_MAIN, DEVICE_SECONDARY

DAY = date(2026, 10, 19)
V = {'roster': 'r', 'mapping': 'm', 'evidence': 'e'}

def event(clock, identity='0336699'):
    return {'time': f'2026-10-19T{clock}+01:00', 'employeeNoString': identity,
            'major': 5, 'minor': 75, 'serialNo': clock, '_device_id': 'office-main'}

def coverage(device='office-main', **extra):
    return {'device_id': device, 'state': 'complete', 'query_start': '06:30:00', 'query_end': '11:00:00',
            'segment_count': 2, 'segments_complete': 2,
            'segments': [{'state': 'complete', 'pagination_complete': True}], **extra}


class CompletionTests(unittest.TestCase):
    def test_clock_is_cutoff_not_completion_and_early_run_is_not_certificate(self):
        self.assertFalse(cutoff_pass(DAY, datetime.fromisoformat('2026-10-19T10:59:59+01:00')))
        self.assertTrue(cutoff_pass(DAY, datetime.fromisoformat('2026-10-19T11:00:00+01:00')))
        self.assertFalse(complete_cutoff_run({'status': 'complete', 'device_failure_summary': {'cutoff_verification': None}}))
        proof = {'coverage': [coverage(query_end='09:15:50')], 'persistence_complete': True, 'reconciliation_complete': True}
        self.assertFalse(complete_cutoff_run({'status': 'complete', 'device_failure_summary': {'cutoff_verification': proof}}))
        proof['coverage'][0]['query_end'] = '11:00:00'
        self.assertTrue(complete_cutoff_run({'status': 'complete', 'device_failure_summary': {'cutoff_verification': proof}}))

    def run_pass(self, *, pagination=True, mapping_changed=False, persist_failure=False, batch=False):
        client = FakeClient()
        client.morning_input_versions = lambda _: V
        if batch:
            client.base_url = 'fake'
            client.upsert = Mock()
        if persist_failure:
            client.insert_biometric_attendance_events = lambda _: (_ for _ in ()).throw(RuntimeError('persistence failed'))
        before = base_resolution()
        after = base_resolution({'check_in': '10:58:25', 'attendance_source': 'biometric', 'manual_override': False})
        statuses = {'office-main': ([event('10:58:25'), event('11:00:00'), event('11:01:00')], coverage(
            segments=[{'state': 'complete', 'pagination_complete': pagination}])),
            'office-secondary': ([], coverage('office-secondary'))}
        with patch('hikvision_attendance_verification.cutoff_pass', return_value=True), \
             patch('hikvision_attendance_verification.versions', side_effect=[V, {**V, 'mapping': 'changed'} if mapping_changed else V]), \
             patch('hikvision_attendance_verification.load_resolution_data', side_effect=[before, after]), \
             patch('hikvision_attendance_verification.persisted_biometric_events', return_value=([], None)), \
             patch('hikvision_attendance_verification._query_targets', return_value=(statuses, {'w1': {('office-main', '0336699')}})), \
             patch('hikvision_attendance_verification.plan_attendance', return_value=([{'proposed_status': 'present'}], {})), \
             patch('morning_report_completion.rpc', return_value='job'), \
             patch('hikvision_attendance_verification.rpc', return_value={'state': 'FINAL'}), \
             patch('hikvision_attendance_verification.apply_biometric_attendance', return_value={'updated': 1}):
            result = run_targeted_verification(client=client, target_date=DAY,
                devices=[DEVICE_MAIN, DEVICE_SECONDARY], diagnostics=None, agent_id='test')
        return result, client

    def test_delayed_1058_and_inclusive_1100_are_persisted_but_1101_is_excluded(self):
        result, client = self.run_pass()
        self.assertEqual(result['status'], 'complete')
        stamps = [row['event_timestamp'] for row in client.inserted_events]
        self.assertEqual(len(stamps), 2)
        self.assertTrue(any('09:58:25' in stamp or '10:58:25' in stamp for stamp in stamps))
        self.assertTrue(complete_cutoff_run(client.runs[0]))

    def test_incomplete_pagination_blocks(self):
        result, _ = self.run_pass(pagination=False)
        self.assertEqual(result['status'], 'incomplete')

    def test_mapping_changed_during_verification_blocks(self):
        result, _ = self.run_pass(mapping_changed=True)
        self.assertEqual(result['status'], 'incomplete')

    def test_persistence_failure_cannot_publish_complete_header(self):
        with self.assertRaisesRegex(RuntimeError, 'persistence failed'):
            self.run_pass(persist_failure=True)

    def test_every_device_is_scanned_to_cutoff_even_with_no_targets(self):
        with patch('hikvision_attendance_verification.hikvision_events_for_device_segmented_verification', return_value=([], coverage())) as scan:
            results, _ = _query_targets({}, base_resolution(), [DEVICE_MAIN, DEVICE_SECONDARY], DAY, None, time(6,30), 2, cutoff=True)
        self.assertEqual(set(results), {'office-main', 'office-secondary'})
        self.assertEqual(scan.call_count, 2)
        self.assertTrue(all(call.kwargs['end_time'] == time(11) for call in scan.call_args_list))

    def test_durable_operations_register_before_work_and_fail_closed(self):
        client = SimpleNamespace(base_url='fake', headers={})
        with patch('morning_report_completion.rpc', return_value='job') as call:
            with processing('historical_checkout', '2026-10-18', client=client):
                self.assertEqual(call.call_args.args[2]['p_date_from'], '2026-10-18')
                self.assertFalse(call.call_args.args[2]['p_identity'])
            self.assertEqual(call.call_args.args[2]['p_status'], 'complete')
            with self.assertRaises(ValueError):
                with processing('identity_sync', identity=True, client=client):
                    raise ValueError('retry')
            self.assertEqual(call.call_args.args[2]['p_status'], 'failed')

    def test_worker_evidence_batch_finishes_before_complete_header(self):
        result, client = self.run_pass(batch=True)
        self.assertEqual(result['status'], 'complete')
        client.upsert.assert_called_once()
        table, rows, conflict = client.upsert.call_args.args
        self.assertEqual(table, 'attendance_verification_worker')
        self.assertEqual(conflict, 'run_id,worker_id')
        self.assertEqual([row['worker_id'] for row in rows], ['w1'])
        self.assertEqual(rows[0]['run_id'], client.runs[0]['id'])

    def test_agent_does_not_reuse_certificate_while_shared_gate_still_waits(self):
        from hikvision_attendance_agent import AttendanceAgent
        agent = AttendanceAgent.__new__(AttendanceAgent)
        agent.client = MagicMock(base_url='https://example.invalid')
        agent.client.morning_verification_for_date.return_value = {'status': 'complete'}
        agent.logger = MagicMock(); agent.agent_id = 'test'; agent.dry_run = False
        with patch('hikvision_attendance_agent.local_now', return_value=datetime.fromisoformat('2026-10-19T12:00:00+01:00')), \
             patch('hikvision_attendance_agent.rpc', return_value={'state': 'PROCESSING_AFTER_CUTOFF'}), \
             patch('hikvision_attendance_agent.configured_devices', return_value=[]), \
             patch('hikvision_attendance_agent.run_targeted_verification', return_value={'status': 'complete'}) as verify:
            self.assertEqual(agent.run_final_morning_verification(), (True, None))
            verify.assert_called_once()


if __name__ == '__main__':
    unittest.main()
