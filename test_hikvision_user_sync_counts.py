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
                 patch('hikvision_user_sync.fetch_current_users', return_value=({'office-main': main_users, 'office-secondary': secondary_users}, {})):
                summary = sync_users_dataset()
        self.assertEqual(summary['device_user_counts']['office-secondary'], 254)
        self.assertEqual(summary['device_sync_status']['office-secondary']['state'], 'success')


if __name__ == '__main__':
    unittest.main()
