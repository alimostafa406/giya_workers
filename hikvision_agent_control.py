"""Local-only controls for the exact attendance-agent Scheduled Task."""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
AGENT_SCRIPT = (PROJECT_ROOT / 'hikvision_attendance_agent.py').resolve()
AGENT_TASK_NAME = 'WorkersHikvisionAttendanceAgent'
CONTROL_LOCK = threading.Lock()


class AgentControlError(RuntimeError):
    """A safe, user-facing local control error."""


class AgentControl:
    """Controls only the named Windows Scheduled Task; never business data."""

    @staticmethod
    def _powershell(script: str) -> str:
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=15, check=False,
        )
        if result.returncode != 0:
            raise AgentControlError('Unable to read the local Windows service status.')
        return result.stdout.strip()

    def agent_processes(self) -> list[dict]:
        escaped = str(AGENT_SCRIPT).replace("'", "''")
        output = self._powershell(
            "$target=[IO.Path]::GetFullPath('" + escaped + "'); "
            "$items=Get-CimInstance Win32_Process | Where-Object { "
            "$_.Name -in @('python.exe','pythonw.exe') -and $_.CommandLine -and "
            "$_.CommandLine.IndexOf($target,[StringComparison]::OrdinalIgnoreCase) -ge 0 }; "
            "@($items | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine) | ConvertTo-Json -Compress"
        )
        if not output:
            return []
        data = json.loads(output)
        return data if isinstance(data, list) else [data]

    def task_status(self) -> dict:
        escaped = AGENT_TASK_NAME.replace("'", "''")
        output = self._powershell(
            "$task=Get-ScheduledTask -TaskName '" + escaped + "' -ErrorAction Stop; "
            "$info=Get-ScheduledTaskInfo -TaskName '" + escaped + "' -ErrorAction Stop; "
            "[pscustomobject]@{State=[string]$task.State;LastRunTime=$info.LastRunTime;"
            "LastTaskResult=$info.LastTaskResult;NextRunTime=$info.NextRunTime} | ConvertTo-Json -Compress"
        )
        return json.loads(output)

    @staticmethod
    def _run_task_command(*arguments: str) -> None:
        result = subprocess.run(
            ['schtasks.exe', *arguments, '/TN', AGENT_TASK_NAME],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=20, check=False,
        )
        if result.returncode != 0:
            raise AgentControlError('Unable to run the attendance-agent Scheduled Task command.')

    def _wait_for_count(self, expected: int, timeout_seconds: float = 20) -> list[dict]:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            processes = self.agent_processes()
            if len(processes) == expected:
                return processes
            time.sleep(0.5)
        raise AgentControlError(f'Agent process count did not reach {expected} within the safe timeout.')

    def control_agent(self, action: str) -> dict:
        if action not in {'start', 'stop', 'restart'}:
            raise AgentControlError('Agent control action is not allowed.')
        if not CONTROL_LOCK.acquire(blocking=False):
            raise AgentControlError('Another agent control action is already running.')
        try:
            before = self.agent_processes()
            if len(before) > 1:
                raise AgentControlError('More than one agent is running; control was stopped to protect the system.')
            if action == 'start':
                if not before:
                    self._run_task_command('/Run')
                after = self._wait_for_count(1)
            elif action == 'stop':
                if before:
                    self._run_task_command('/End')
                    after = self._wait_for_count(0)
                else:
                    after = []
            else:
                if before:
                    self._run_task_command('/End')
                    self._wait_for_count(0)
                self._run_task_command('/Run')
                after = self._wait_for_count(1)
            return {'action': action, 'process_count': len(after), 'pids': [item['ProcessId'] for item in after]}
        finally:
            CONTROL_LOCK.release()

    def status(self) -> dict:
        processes = self.agent_processes()
        return {
            'agent': {
                'running': len(processes) == 1,
                'process_count': len(processes),
                'pids': [item.get('ProcessId') for item in processes],
                'script_path': str(AGENT_SCRIPT),
                'task': self.task_status(),
            },
        }
