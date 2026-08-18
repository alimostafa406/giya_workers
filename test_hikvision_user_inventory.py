import unittest

from hikvision_user_sync import build_current_inventory


class DeviceInventoryTests(unittest.TestCase):
    devices = ['office-main', 'office-secondary']

    def inventory(self, users):
        return build_current_inventory(users, self.devices)[0]

    def test_user_on_both_devices(self):
        row = self.inventory([{'employeeNo': '072', 'name': 'DAVID', '_device_id': 'office-main'}, {'employeeNo': '072', 'name': 'DAVID', '_device_id': 'office-secondary'}])['072']
        self.assertEqual(row['devices'], self.devices)

    def test_removed_from_first_but_present_on_second(self):
        row = self.inventory([{'employeeNo': '072', 'name': 'DAVID', '_device_id': 'office-secondary'}])['072']
        self.assertFalse(row['device_presence']['office-main'])
        self.assertTrue(row['_local_sync']['is_currently_returned'])

    def test_removed_from_second_but_present_on_first(self):
        row = self.inventory([{'employeeNo': '072', 'name': 'DAVID', '_device_id': 'office-main'}])['072']
        self.assertTrue(row['device_presence']['office-main'])
        self.assertFalse(row['device_presence']['office-secondary'])

    def test_removed_from_both_is_not_in_current_inventory(self):
        self.assertNotIn('072', self.inventory([]))

    def test_new_user_and_same_employee_number_deduplicate(self):
        inventory = self.inventory([{'employeeNo': '999', 'name': 'NEW', '_device_id': 'office-main'}, {'employeeNo': '999', 'name': 'NEW', '_device_id': 'office-secondary'}])
        self.assertEqual(list(inventory), ['999'])


if __name__ == '__main__':
    unittest.main()
