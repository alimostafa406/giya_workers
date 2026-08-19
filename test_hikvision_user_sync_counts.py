"""No-network regression: successful secondary counts survive the merge."""

import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hikvision_user_sync import fetch_current_users, sync_users_dataset


class UserSyncCountTests(unittest.TestCase):
    devices = [SimpleNamespace(device_id='office-main'), SimpleNamespace(device_id='office-secondary')]

    def test_secondary_254_is_reported_before_merge(self):
        main_users = [{'_device_id': 'office-main', 'employeeNo': str(index), 'name': 'main'} for index in range(259)]
        secondary_users = [{'_device_id': 'office-secondary', 'employeeNo': str(index), 'name': 'secondary'} for index in range(254)]
        with patch('hikvision_user_sync.configured_devices', return_value=self.devices), patch('hikvision_user_sync.fetch_current_users_for_device', side_effect=[main_users, secondary_users]):
            results, failures = fetch_current_users()
        self.assertFalse(failures)
        self.assertEqual(len(results['office-secondary']), 254)
        with tempfile.TemporaryDirectory() as directory:
            with patch('hikvision_user_sync._users_file', return_value=Path(directory) / 'users.json'), \
                 patch('hikvision_user_sync.configured_devices', return_value=self.devices), \
                 patch('hikvision_user_sync.fetch_current_users', return_value=({'office-main': main_users, 'office-secondary': secondary_users}, {})), \
                 patch('hikvision_user_sync.persist_device_identity_presence', return_value={'state': 'success'}):
                summary = sync_users_dataset()
        self.assertEqual(summary['device_user_counts']['office-secondary'], 254)
        self.assertEqual(summary['device_sync_status']['office-secondary']['state'], 'success')

    def test_office_main_target_does_not_query_office_secondary(self):
        main_users = [{'_device_id': 'office-main', 'employeeNo': '100', 'name': 'Main'}]
        with patch('hikvision_user_sync.configured_devices', return_value=self.devices), \
             patch('hikvision_user_sync.fetch_current_users_for_device', return_value=main_users) as fetch:
            results, failures = fetch_current_users('office-main')
        self.assertFalse(failures)
        self.assertEqual(list(results), ['office-main'])
        self.assertEqual(fetch.call_args.args[0].device_id, 'office-main')
        self.assertEqual(fetch.call_count, 1)

    def test_office_secondary_target_does_not_query_office_main(self):
        secondary_users = [{'_device_id': 'office-secondary', 'employeeNo': '200', 'name': 'Secondary'}]
        with patch('hikvision_user_sync.configured_devices', return_value=self.devices), \
             patch('hikvision_user_sync.fetch_current_users_for_device', return_value=secondary_users) as fetch:
            results, failures = fetch_current_users('office-secondary')
        self.assertFalse(failures)
        self.assertEqual(list(results), ['office-secondary'])
        self.assertEqual(fetch.call_args.args[0].device_id, 'office-secondary')
        self.assertEqual(fetch.call_count, 1)

    def test_single_device_sync_only_updates_that_device_presence(self):
        cached_users = [
            {'employeeNo': '100', 'name': 'Shared', 'devices': ['office-main', 'office-secondary'],
             'device_presence': {'office-main': True, 'office-secondary': True}},
            {'employeeNo': '200', 'name': 'Secondary only', 'devices': ['office-secondary'],
             'device_presence': {'office-main': False, 'office-secondary': True}},
        ]
        # A complete office-main response no longer contains 100. It must retain
        # office-secondary presence and must not mark either secondary identity missing.
        main_users = [{'employeeNo': '300', 'name': 'New main', '_device_id': 'office-main'}]
        with tempfile.TemporaryDirectory() as directory:
            users_file = Path(directory) / 'users.json'
            users_file.write_text(__import__('json').dumps(cached_users), encoding='utf-8')
            with patch('hikvision_user_sync._users_file', return_value=users_file), \
                 patch('hikvision_user_sync.configured_devices', return_value=self.devices), \
                 patch('hikvision_user_sync.fetch_current_users', return_value=({'office-main': main_users}, {})), \
                 patch('hikvision_user_sync.persist_device_identity_presence', return_value={'state': 'success'}) as persist:
                summary = sync_users_dataset('office-main')
        self.assertEqual(summary['status'], 'ok')
        self.assertEqual(summary['target_device_id'], 'office-main')
        self.assertEqual(persist.call_args.args[0], {'office-main': main_users})
        preserved = next(user for user in summary['users'] if user['employeeNo'] == '100')
        self.assertEqual(preserved['device_presence'], {'office-main': False, 'office-secondary': True})
        self.assertEqual(preserved['devices'], ['office-secondary'])
        self.assertTrue(preserved['_local_sync']['is_currently_returned'])
        self.assertEqual(summary['device_sync_status']['office-secondary']['state'], 'not_requested')


if __name__ == '__main__':
    unittest.main()
