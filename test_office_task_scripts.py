"""Static/syntax checks for the office task definitions; never register tasks."""

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OFFICE = ROOT / 'scripts' / 'office'


class OfficeTaskScriptTests(unittest.TestCase):
    def test_registration_has_long_lived_direct_python_actions_and_restart_policy(self):
        source = (OFFICE / 'Register-OfficeSystemTasks.ps1').read_text(encoding='utf-8')
        self.assertIn('pythonw.exe', source)
        self.assertIn('-MultipleInstances IgnoreNew', source)
        self.assertIn('-RestartCount 999', source)
        self.assertIn('-DontStopIfGoingOnBatteries', source)
        self.assertIn('Serve-Dashboard.py', source)
        self.assertIn('hikvision_attendance_agent.py', source)
        self.assertNotIn('Start-AttendanceAgent.ps1`"', source)

    def test_agent_launcher_retains_duplicate_process_guard(self):
        source = (OFFICE / 'Start-AttendanceAgent.ps1').read_text(encoding='utf-8')
        self.assertIn('Get-CimInstance Win32_Process', source)
        self.assertIn('hikvision_attendance_agent.py', source)

    def test_office_scripts_parse_without_execution(self):
        for script in ('Start-Dashboard.ps1', 'Start-AttendanceAgent.ps1', 'Register-OfficeSystemTasks.ps1', 'Test-OfficeSystem.ps1'):
            path = OFFICE / script
            command = f"[void][scriptblock]::Create((Get-Content -LiteralPath '{path}' -Raw))"
            result = subprocess.run(
                ['powershell.exe', '-NoProfile', '-Command', command],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
