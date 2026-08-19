"""No-network tests for the local pythonw-safe dashboard server."""

import http.client
import importlib.util
import sys
import tempfile
import threading
import unittest
from contextlib import contextmanager
from pathlib import Path


SERVER_PATH = Path(__file__).resolve().parent / 'scripts' / 'office' / 'Serve-Dashboard.py'
SPEC = importlib.util.spec_from_file_location('office_dashboard_server_test', SERVER_PATH)
office_dashboard_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(office_dashboard_server)


@contextmanager
def without_console_streams():
    stdout, stderr = sys.stdout, sys.stderr
    sys.stdout = None
    sys.stderr = None
    try:
        yield
    finally:
        sys.stdout, sys.stderr = stdout, stderr


class OfficeDashboardServerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.dist = Path(self.directory.name) / 'dist'
        (self.dist / 'assets').mkdir(parents=True)
        (self.dist / 'index.html').write_text('<!doctype html><title>Workers Dashboard</title>', encoding='utf-8')
        (self.dist / 'assets' / 'app.js').write_text('window.dashboardLoaded = true;', encoding='utf-8')
        self.server = office_dashboard_server.create_server(self.dist, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.directory.cleanup()

    def get(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, response.read(), response.getheader('Content-Type')
        finally:
            connection.close()

    def test_requests_work_when_pythonw_has_no_console_streams(self):
        with without_console_streams():
            status, body, _ = self.get('/')
        self.assertEqual(status, 200)
        self.assertIn(b'Workers Dashboard', body)

    def test_health_endpoint_is_independent_of_react(self):
        status, body, content_type = self.get('/__health')
        self.assertEqual(status, 200)
        self.assertEqual(body, b'OK\n')
        self.assertIn('text/plain', content_type)

    def test_react_route_falls_back_to_index(self):
        status, body, _ = self.get('/attendance')
        self.assertEqual(status, 200)
        self.assertIn(b'Workers Dashboard', body)

    def test_existing_static_asset_is_served_and_missing_asset_is_not_spa_fallback(self):
        status, body, content_type = self.get('/assets/app.js')
        self.assertEqual(status, 200)
        self.assertIn(b'dashboardLoaded', body)
        self.assertIn('text/javascript', content_type)

        status, body, _ = self.get('/assets/missing.js')
        self.assertEqual(status, 404)
        self.assertNotIn(b'Workers Dashboard', body)


if __name__ == '__main__':
    unittest.main()
