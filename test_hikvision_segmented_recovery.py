"""No-network tests for automatic time-window recovery of deep event searches."""

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import requests

from hikvision_attendance_sync import (
    RequestDiagnostics,
    attendance_apply_blocked_reason,
    hikvision_events_for_device_with_recovery,
    hikvision_events_with_devices,
)


TARGET_DATE = date(2026, 8, 18)
DEVICE = SimpleNamespace(ip='192.0.2.1', username='u', password='p', device_id='office-main')


class Response:
    def __init__(self, result):
        self.status_code = 200
        self._result = result

    def raise_for_status(self):
        return None

    def json(self):
        return {'AcsEvent': self._result}


def event(serial, value='2026-08-18T08:00:00+01:00'):
    return {
        'major': 5,
        'minor': 75,
        'employeeNoString': '8',
        'serialNo': serial,
        'time': value,
    }


class SegmentedRecoveryTests(unittest.TestCase):
    def test_deep_failure_recovers_with_complete_deduplicated_segments(self):
        normal_positions = []
        segment_indexes = []

        class Client:
            def __init__(self, *_): pass
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return '192.0.2.1'
            def request(self, _method, _url, **kwargs):
                condition = kwargs['json']['AcsEventCond']
                search_id = condition['searchID']
                if '-segment-' not in search_id:
                    position = condition['searchResultPosition']
                    normal_positions.append(position)
                    if position == 180:
                        raise requests.ConnectionError('RemoteDisconnected')
                    batch = [event(f'normal-{position}-{index}') for index in range(60)]
                    return Response({'InfoList': batch, 'responseStatusStrg': 'MORE'})
                index = int(search_id.rsplit('-', 1)[-1])
                segment_indexes.append(index)
                # Intentionally repeat one serial across windows. It must appear once.
                serial = 'repeated-segment-event' if index in {0, 1} else f'segment-{index}'
                return Response({'InfoList': [event(serial)], 'responseStatusStrg': 'OK'})
            def refresh_digest_session(self): pass
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client), patch(
            'hikvision_attendance_sync.HIKVISION_SUCCESSFUL_PAGE_DELAY_SECONDS', 0,
        ):
            events, status = hikvision_events_for_device_with_recovery(TARGET_DATE, RequestDiagnostics(False), DEVICE)

        self.assertEqual(normal_positions, [0, 60, 120, 180])
        self.assertEqual(segment_indexes, list(range(7)))
        self.assertEqual(status['state'], 'complete')
        self.assertEqual(status['recovery'], 'segmented')
        self.assertTrue(all(segment['state'] == 'complete' for segment in status['segments']))
        self.assertEqual(len(events), 186)  # 180 preserved daily events + 6 unique segment events
        self.assertIsNone(attendance_apply_blocked_reason({'office-main': status}))

    def test_incomplete_segment_keeps_apply_blocked(self):
        class Client:
            def __init__(self, *_): pass
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return '192.0.2.1'
            def request(self, _method, _url, **kwargs):
                search_id = kwargs['json']['AcsEventCond']['searchID']
                if '-segment-' not in search_id:
                    raise requests.ConnectionError('RemoteDisconnected')
                index = int(search_id.rsplit('-', 1)[-1])
                if index == 3:
                    raise requests.ConnectionError('RemoteDisconnected')
                return Response({'InfoList': [event(f'segment-{index}')], 'responseStatusStrg': 'OK'})
            def refresh_digest_session(self): pass
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client), patch(
            'hikvision_attendance_sync.HIKVISION_SUCCESSFUL_PAGE_DELAY_SECONDS', 0,
        ):
            events, status = hikvision_events_for_device_with_recovery(TARGET_DATE, RequestDiagnostics(False), DEVICE)

        self.assertEqual(status['state'], 'partial')
        self.assertEqual(status['recovery'], 'segmented')
        self.assertEqual(len(events), 6)
        self.assertIn('13:00:00-15:59:59=failed', status['error'])
        self.assertIsNotNone(attendance_apply_blocked_reason({'office-main': status}))

    def test_multi_device_reader_uses_segmented_recovery_before_reporting_complete(self):
        class Client:
            def __init__(self, *_): pass
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return '192.0.2.1'
            def request(self, _method, _url, **kwargs):
                condition = kwargs['json']['AcsEventCond']
                if '-segment-' not in condition['searchID']:
                    raise requests.ConnectionError('RemoteDisconnected')
                index = int(condition['searchID'].rsplit('-', 1)[-1])
                return Response({'InfoList': [event(f'segment-{index}')], 'responseStatusStrg': 'OK'})
            def refresh_digest_session(self): pass
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client), patch(
            'hikvision_attendance_sync.configured_devices', return_value=[DEVICE],
        ), patch('hikvision_attendance_sync.HIKVISION_SUCCESSFUL_PAGE_DELAY_SECONDS', 0):
            events, reads = hikvision_events_with_devices(TARGET_DATE, RequestDiagnostics(False))

        self.assertEqual(reads['office-main']['state'], 'complete')
        self.assertEqual(reads['office-main']['recovery'], 'segmented')
        self.assertEqual(len(events), 7)
        self.assertIsNone(attendance_apply_blocked_reason(reads))

    def test_timed_out_secondary_does_not_block_primary_device_read(self):
        secondary = SimpleNamespace(ip='192.0.2.137', username='u', password='p', device_id='office-secondary')
        primary = SimpleNamespace(ip='192.0.2.136', username='u', password='p', device_id='office-main')
        calls = []

        def read_device(_target_date, _diagnostics, device):
            calls.append(device.device_id)
            if device.device_id == 'office-secondary':
                return [], {
                    'device_id': device.device_id, 'state': 'failed', 'event_count': 0,
                    'error': 'ReadTimeout: device did not respond', 'timed_out': True,
                }
            return [event('primary-event')], {
                'device_id': device.device_id, 'state': 'complete', 'event_count': 1,
                'error': None, 'timed_out': False,
            }

        with patch('hikvision_attendance_sync.configured_devices', return_value=[secondary, primary]), patch(
            'hikvision_attendance_sync.hikvision_events_for_device_with_recovery', side_effect=read_device,
        ):
            events, reads = hikvision_events_with_devices(TARGET_DATE, RequestDiagnostics(False))

        self.assertEqual(calls, ['office-secondary', 'office-main'])
        self.assertEqual([item['serialNo'] for item in events], ['primary-event'])
        self.assertEqual(reads['office-secondary']['state'], 'failed')
        self.assertEqual(reads['office-main']['state'], 'complete')

    def test_timed_out_primary_does_not_block_secondary_device_read(self):
        primary = SimpleNamespace(ip='192.0.2.136', username='u', password='p', device_id='office-main')
        secondary = SimpleNamespace(ip='192.0.2.137', username='u', password='p', device_id='office-secondary')
        calls = []

        def read_device(_target_date, _diagnostics, device):
            calls.append(device.device_id)
            if device.device_id == 'office-main':
                return [], {
                    'device_id': device.device_id, 'state': 'failed', 'event_count': 0,
                    'error': 'ReadTimeout: device did not respond', 'timed_out': True,
                }
            return [event('secondary-event')], {
                'device_id': device.device_id, 'state': 'complete', 'event_count': 1,
                'error': None, 'timed_out': False,
            }

        with patch('hikvision_attendance_sync.configured_devices', return_value=[primary, secondary]), patch(
            'hikvision_attendance_sync.hikvision_events_for_device_with_recovery', side_effect=read_device,
        ):
            events, reads = hikvision_events_with_devices(TARGET_DATE, RequestDiagnostics(False))

        self.assertEqual(calls, ['office-main', 'office-secondary'])
        self.assertEqual([item['serialNo'] for item in events], ['secondary-event'])
        self.assertEqual(reads['office-main']['state'], 'failed')
        self.assertEqual(reads['office-secondary']['state'], 'complete')

    def test_socket_timeout_does_not_expand_into_seven_segment_requests(self):
        class Client:
            def __init__(self, *_): pass
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return '192.0.2.137'
            def request(self, _method, _url, **_kwargs):
                raise requests.ReadTimeout('secondary stopped responding')
            def refresh_digest_session(self): pass
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client):
            events, status = hikvision_events_for_device_with_recovery(TARGET_DATE, RequestDiagnostics(False), DEVICE)

        self.assertEqual(events, [])
        self.assertEqual(status['state'], 'failed')
        self.assertTrue(status['timed_out'])
        self.assertNotIn('recovery', status)


if __name__ == '__main__':
    unittest.main()
