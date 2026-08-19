"""No-network tests for Agent/Helper per-device Hikvision read serialization."""

import tempfile
import threading
import time
import unittest
from multiprocessing import get_context
from pathlib import Path

from hikvision_device_lock import HikvisionDeviceLockTimeout, HikvisionDeviceOperationLock


def hold_device_lock_in_other_process(directory, acquired, release):
    with HikvisionDeviceOperationLock('office-main', 'agent event search', 2, lock_dir=Path(directory)):
        acquired.set()
        release.wait(3)


class HikvisionDeviceLockTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.lock_dir = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_same_device_agent_and_helper_operations_do_not_overlap(self):
        active = 0
        peak = 0
        entered = threading.Event()
        release = threading.Event()

        def agent_read():
            nonlocal active, peak
            with HikvisionDeviceOperationLock('office-main', 'event search', 2, lock_dir=self.lock_dir):
                active += 1
                peak = max(peak, active)
                entered.set()
                release.wait(1)
                active -= 1

        def helper_read():
            nonlocal active, peak
            with HikvisionDeviceOperationLock('office-main', 'user search', 2, lock_dir=self.lock_dir):
                active += 1
                peak = max(peak, active)
                active -= 1

        first = threading.Thread(target=agent_read)
        second = threading.Thread(target=helper_read)
        first.start()
        self.assertTrue(entered.wait(1))
        second.start()
        time.sleep(.1)
        self.assertEqual(peak, 1)
        release.set()
        first.join(2)
        second.join(2)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(peak, 1)

    def test_office_secondary_is_independent_from_office_main(self):
        main_entered = threading.Event()
        secondary_entered = threading.Event()
        release = threading.Event()

        def hold(device_id, entered):
            with HikvisionDeviceOperationLock(device_id, 'event search', 1, lock_dir=self.lock_dir):
                entered.set()
                release.wait(1)

        first = threading.Thread(target=hold, args=('office-main', main_entered))
        second = threading.Thread(target=hold, args=('office-secondary', secondary_entered))
        first.start()
        self.assertTrue(main_entered.wait(1))
        second.start()
        self.assertTrue(secondary_entered.wait(.5))
        release.set()
        first.join(2)
        second.join(2)

    def test_lock_releases_when_high_volume_read_raises(self):
        with self.assertRaises(RuntimeError):
            with HikvisionDeviceOperationLock('office-main', 'event search', 1, lock_dir=self.lock_dir):
                raise RuntimeError('simulated page failure')
        with HikvisionDeviceOperationLock('office-main', 'user search', .5, lock_dir=self.lock_dir):
            pass

    def test_timeout_is_safe_and_does_not_release_other_operation_lock(self):
        ready = threading.Event()
        release = threading.Event()

        def hold():
            with HikvisionDeviceOperationLock('office-main', 'event search', 1, lock_dir=self.lock_dir):
                ready.set()
                release.wait(1)

        holder = threading.Thread(target=hold)
        holder.start()
        self.assertTrue(ready.wait(1))
        with self.assertRaises(HikvisionDeviceLockTimeout):
            with HikvisionDeviceOperationLock('office-main', 'user search', .05, lock_dir=self.lock_dir):
                pass
        release.set()
        holder.join(2)

    def test_windows_file_lock_serializes_another_process(self):
        context = get_context('spawn')
        acquired = context.Event()
        release = context.Event()
        process = context.Process(target=hold_device_lock_in_other_process, args=(str(self.lock_dir), acquired, release))
        process.start()
        try:
            self.assertTrue(acquired.wait(3))
            with self.assertRaises(HikvisionDeviceLockTimeout):
                with HikvisionDeviceOperationLock('office-main', 'helper user search', .1, lock_dir=self.lock_dir):
                    pass
        finally:
            release.set()
            process.join(3)
            if process.is_alive():
                process.terminate()
                process.join(3)
        self.assertEqual(process.exitcode, 0)


if __name__ == '__main__':
    unittest.main()
