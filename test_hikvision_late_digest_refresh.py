"""No-network check: a late 401 refreshes only the failed AcsEvent batch."""

import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import requests

from hikvision_attendance_sync import (
    RequestDiagnostics,
    attendance_apply_blocked_reason,
    hikvision_events_for_device,
)


class Response:
    def __init__(self, status, result):
        self.status_code = status
        self._result = result

    def raise_for_status(self):
        if self.status_code == 401:
            import requests
            raise requests.exceptions.HTTPError(response=self)

    def json(self):
        return {'AcsEvent': self._result}


class LateDigestRefreshTests(unittest.TestCase):
    def test_late_401_retries_same_position_without_restarting_pages(self):
        positions = []
        refreshes = []
        batch = [{'major': 5, 'minor': 75, 'employeeNoString': '8', 'time': '2026-08-13T08:00:00+01:00'} for _ in range(30)]
        responses = [
            Response(200, {'InfoList': batch, 'responseStatusStrg': 'MORE'})
            for _ in range(6)
        ] + [
            Response(401, {}),
            Response(200, {'InfoList': batch, 'responseStatusStrg': 'OK'}),
        ]

        class Client:
            def __init__(self, *_): pass
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return '192.0.2.1'
            def request(self, _method, _url, **kwargs):
                positions.append(kwargs['json']['AcsEventCond']['searchResultPosition'])
                return responses.pop(0)
            def refresh_digest_session(self): refreshes.append(True)
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client):
            events = hikvision_events_for_device(date(2026, 8, 13), RequestDiagnostics(False), SimpleNamespace(ip='192.0.2.1', username='u', password='p', device_id='main'))
        self.assertEqual(positions, [0, 30, 60, 90, 120, 150, 180, 180])
        self.assertEqual(refreshes, [True])
        self.assertEqual(len(events), 210)

    def test_late_connection_failure_preserves_successful_pages_as_partial(self):
        positions = []
        batch = [
            {'major': 5, 'minor': 75, 'employeeNoString': '8', 'time': '2026-08-13T08:00:00+01:00'}
            for _ in range(60)
        ]
        responses = [
            Response(200, {'InfoList': batch, 'responseStatusStrg': 'MORE'}),
            Response(200, {'InfoList': batch, 'responseStatusStrg': 'MORE'}),
            requests.ConnectionError('RemoteDisconnected'),
        ]

        class Client:
            def __init__(self, *_): pass
            def url(self, path): return f'http://device{path}'
            @property
            def device_ip(self): return '192.0.2.1'
            def request(self, _method, _url, **kwargs):
                positions.append(kwargs['json']['AcsEventCond']['searchResultPosition'])
                response = responses.pop(0)
                if isinstance(response, Exception):
                    raise response
                return response
            def refresh_digest_session(self): pass
            def close(self): pass

        with patch('hikvision_attendance_sync.HikvisionReadClient', Client):
            events, status = hikvision_events_for_device(
                date(2026, 8, 13),
                RequestDiagnostics(False),
                SimpleNamespace(ip='192.0.2.1', username='u', password='p', device_id='main'),
                return_status=True,
            )

        self.assertEqual(positions, [0, 60, 120])
        self.assertEqual(len(events), 120)
        self.assertEqual(status['state'], 'partial')
        self.assertEqual(status['event_count'], 120)
        self.assertIn('ConnectionError', status['error'])

    def test_partial_device_read_blocks_attendance_apply(self):
        reason = attendance_apply_blocked_reason({
            'office-main': {'state': 'partial', 'event_count': 120, 'error': 'ConnectionError'},
            'office-secondary': {'state': 'complete', 'event_count': 122, 'error': None},
        })
        self.assertEqual(
            reason,
            'Attendance apply blocked: incomplete Hikvision device read (office-main=partial).',
        )


if __name__ == '__main__':
    unittest.main()
