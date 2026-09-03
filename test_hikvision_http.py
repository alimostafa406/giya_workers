"""No-network tests for transient Hikvision retry handling."""

import unittest
from unittest.mock import Mock, patch

import requests

from hikvision_http import (
    HIKVISION_CONNECT_TIMEOUT_SECONDS,
    HIKVISION_REQUEST_TIMEOUT,
    HikvisionReadClient,
)


class HikvisionHttpRetryTests(unittest.TestCase):
    def test_recreates_session_after_transient_failure(self):
        first = Mock()
        first.request.side_effect = requests.exceptions.ConnectTimeout('temporary')
        second = Mock()
        response = Mock()
        second.request.return_value = response
        client = HikvisionReadClient('192.0.2.1', 'user', 'password')
        with patch.object(client, '_new_session', side_effect=[first, second]) as new_session:
            with patch('hikvision_http.time.sleep') as sleep:
                actual = client.request('GET', 'http://192.0.2.1/ISAPI/System/capabilities', timeout=10)
        self.assertIs(actual, response)
        self.assertEqual(new_session.call_count, 2)
        sleep.assert_called_once_with(2)
        first.close.assert_called_once()
        self.assertEqual(first.request.call_args.kwargs['timeout'], (HIKVISION_CONNECT_TIMEOUT_SECONDS, 10.0))

    def test_does_not_retry_http_auth_failure(self):
        session = Mock()
        response = Mock()
        response.raise_for_status.side_effect = requests.exceptions.HTTPError(response=response)
        session.request.return_value = response
        client = HikvisionReadClient('192.0.2.1', 'user', 'password')
        with patch.object(client, '_new_session', return_value=session):
            actual = client.request('GET', 'http://192.0.2.1/ISAPI/System/capabilities', timeout=10)
        self.assertIs(actual, response)
        self.assertEqual(session.request.call_count, 1)

    def test_preserves_successful_digest_session_for_later_requests(self):
        session = Mock()
        session.request.return_value = Mock()
        client = HikvisionReadClient('192.0.2.1', 'user', 'password')
        with patch.object(client, '_new_session', return_value=session) as new_session:
            client.request('POST', 'http://192.0.2.1/ISAPI/AccessControl/AcsEvent?format=json', json={}, timeout=30)
            client.request('POST', 'http://192.0.2.1/ISAPI/AccessControl/AcsEvent?format=json', json={}, timeout=30)
        self.assertEqual(new_session.call_count, 1)
        self.assertEqual(session.request.call_count, 2)

    def test_missing_timeout_is_replaced_with_explicit_connect_and_read_deadlines(self):
        session = Mock()
        response = Mock()
        session.request.return_value = response
        client = HikvisionReadClient('192.0.2.137', 'user', 'password', 'office-secondary')
        with patch.object(client, '_new_session', return_value=session):
            actual = client.request('GET', 'http://192.0.2.137/ISAPI/System/capabilities')
        self.assertIs(actual, response)
        self.assertEqual(session.request.call_args.kwargs['timeout'], HIKVISION_REQUEST_TIMEOUT)

    def test_read_timeout_exhausts_existing_retry_budget_and_names_device(self):
        sessions = [Mock() for _ in range(3)]
        for session in sessions:
            session.request.side_effect = requests.exceptions.ReadTimeout('unresponsive device')
        client = HikvisionReadClient('192.0.2.137', 'user', 'password', 'office-secondary')
        with patch.object(client, '_new_session', side_effect=sessions), patch(
            'hikvision_http.time.sleep'
        ), patch('sys.stderr') as stderr:
            with self.assertRaises(requests.exceptions.ReadTimeout):
                client.request('POST', 'http://192.0.2.137/ISAPI/AccessControl/AcsEvent', json={})
        self.assertEqual(sum(session.request.call_count for session in sessions), 3)
        logged = ''.join(str(call) for call in stderr.write.call_args_list)
        self.assertIn('office-secondary', logged)
        self.assertIn('192.0.2.137', logged)

    def test_windowless_pythonw_diagnostics_do_not_mask_device_timeout(self):
        sessions = [Mock() for _ in range(3)]
        for session in sessions:
            session.request.side_effect = requests.exceptions.ReadTimeout('unresponsive device')
        client = HikvisionReadClient('192.0.2.137', 'user', 'password', 'office-secondary')
        with patch.object(client, '_new_session', side_effect=sessions), patch(
            'hikvision_http.time.sleep'
        ), patch('hikvision_http.sys.stderr', None):
            with self.assertRaises(requests.exceptions.ReadTimeout):
                client.request('POST', 'http://192.0.2.137/ISAPI/AccessControl/AcsEvent', json={})
        self.assertEqual(sum(session.request.call_count for session in sessions), 3)


if __name__ == '__main__':
    unittest.main()
