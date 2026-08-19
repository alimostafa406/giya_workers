"""No-network tests for the Helper's asynchronous Hikvision user-sync job."""

import threading
import time
import unittest
from http.server import ThreadingHTTPServer

import requests
import hikvision_face_helper as helper
from hikvision_face_helper import Handler, UserSyncJob


class HelperUserSyncJobTests(unittest.TestCase):
    def test_helper_server_can_bind_without_starting_a_user_sync(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        try:
            self.assertGreater(server.server_address[1], 0)
        finally:
            server.server_close()

    def test_start_returns_immediately_and_duplicate_start_reuses_running_job(self):
        entered = threading.Event()
        release = threading.Event()

        def sync():
            entered.set()
            release.wait(1)
            return {"status": "ok", "users": []}

        job = UserSyncJob(sync)
        started_at = time.monotonic()
        created, initial = job.start()
        elapsed = time.monotonic() - started_at
        self.assertTrue(created)
        self.assertLess(elapsed, 0.2)
        self.assertEqual(initial["status"], "running")
        self.assertTrue(entered.wait(1))
        duplicate_created, duplicate = job.start()
        self.assertFalse(duplicate_created)
        self.assertEqual(duplicate["status"], "running")
        release.set()
        self.assertTrue(self._wait_for_status(job, "success"))
        self.assertEqual(job.snapshot()["result"], {"status": "ok", "users": []})

    def test_failed_job_reports_a_safe_failed_status(self):
        job = UserSyncJob(lambda: (_ for _ in ()).throw(ConnectionError("do not expose endpoint")))
        created, _ = job.start()
        self.assertTrue(created)
        self.assertTrue(self._wait_for_status(job, "failed"))
        status = job.snapshot()
        self.assertEqual(status["progress"], None)
        self.assertIn("ConnectionError", status["error"])
        self.assertNotIn("endpoint", status["error"])

    def test_start_and_status_endpoints_do_not_wait_for_the_background_sync(self):
        entered = threading.Event()
        release = threading.Event()

        def sync():
            entered.set()
            release.wait(1)
            return {"status": "ok", "users": []}

        previous_job = helper.USER_SYNC_JOB
        helper.USER_SYNC_JOB = UserSyncJob(sync)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            started_at = time.monotonic()
            response = requests.post(f"{base_url}/sync-users/start", timeout=.5)
            self.assertLess(time.monotonic() - started_at, .2)
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.json()["status"], "running")
            self.assertTrue(entered.wait(1))
            self.assertEqual(requests.get(f"{base_url}/sync-users/status", timeout=.5).json()["status"], "running")
            release.set()
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                status = requests.get(f"{base_url}/sync-users/status", timeout=.5).json()
                if status["status"] == "success":
                    break
                time.sleep(.01)
            self.assertEqual(status["status"], "success")
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(1)
            helper.USER_SYNC_JOB = previous_job

    @staticmethod
    def _wait_for_status(job, expected):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            if job.snapshot()["status"] == expected:
                return True
            time.sleep(.01)
        return False


if __name__ == '__main__':
    unittest.main()
