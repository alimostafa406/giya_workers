"""No-network tests for additive Hikvision identity presence persistence."""
import os
import unittest
from unittest.mock import patch

from hikvision_user_sync import persist_device_identity_presence


class IdentityPresenceTests(unittest.TestCase):
    def test_current_rows_are_sent_once_per_device_identity(self):
        response = type('Response', (), {'raise_for_status': lambda self: None})()
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'test-key'}), patch('hikvision_user_sync.requests.post', return_value=response) as post:
            result = persist_device_identity_presence({'office-main': [{'employeeNo': '281', 'name': 'STEVE'}], 'office-secondary': [{'employeeNo': '281', 'name': 'STEVE'}]})
        self.assertEqual(result['state'], 'success')
        payload = post.call_args.kwargs['json']
        self.assertEqual(payload['p_successful_device_ids'], ['office-main', 'office-secondary'])
        self.assertEqual(len(payload['p_present']), 2)
        self.assertEqual(payload['p_present'][0]['device_employee_no'], '281')

    def test_missing_configuration_does_not_guess_or_write(self):
        with patch.dict(os.environ, {'SUPABASE_URL': '', 'SUPABASE_SERVICE_ROLE_KEY': ''}, clear=False):
            with self.assertRaises(RuntimeError):
                persist_device_identity_presence({'office-main': []})


if __name__ == '__main__':
    unittest.main()
