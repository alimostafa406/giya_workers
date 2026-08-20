"""Static regression checks for the Dashboard's Agent-status data source."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class DashboardAttendanceStatusTests(unittest.TestCase):
    def test_dashboard_uses_agent_status_instead_of_an_attendance_row_timestamp(self):
        dashboard = (ROOT / 'src' / 'pages' / 'Dashboard.jsx').read_text(encoding='utf-8')
        self.assertIn("import AttendanceAgentStatus from '../components/Attendance/AttendanceAgentStatus'", dashboard)
        self.assertIn('<AttendanceAgentStatus />', dashboard)
        self.assertNotIn("label: t('dashboard.lastUpdate')", dashboard)

    def test_status_component_distinguishes_processing_freshness_from_heartbeat(self):
        component = (ROOT / 'src' / 'components' / 'Attendance' / 'AttendanceAgentStatus.jsx').read_text(encoding='utf-8')
        api = (ROOT / 'src' / 'api' / 'attendanceAgentApi.js').read_text(encoding='utf-8')
        self.assertIn('isAttendanceProcessingRecent(status)', component)
        self.assertIn('status.last_attendance_sync_at', component)
        self.assertIn('status.last_seen_at', component)
        self.assertIn('معالجة الحضور متأخرة', component)
        self.assertIn('ATTENDANCE_PROCESSING_STALE_AFTER_MS', api)
        self.assertIn('last_attendance_sync_at', api)


if __name__ == '__main__':
    unittest.main()
