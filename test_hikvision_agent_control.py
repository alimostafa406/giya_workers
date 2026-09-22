"""No-network tests for the restored local attendance-agent controls."""

import unittest
from unittest.mock import Mock, patch

import hikvision_agent_control as control_module


class AgentControlTests(unittest.TestCase):
    def setUp(self):
        self.controller = control_module.AgentControl()

    @patch.object(control_module.AgentControl, '_run_task_command')
    @patch.object(control_module.AgentControl, '_wait_for_count')
    @patch.object(control_module.AgentControl, 'agent_processes')
    def test_restart_uses_only_the_exact_scheduled_task(self, processes, wait, run_task):
        processes.return_value = [{'ProcessId': 123}]
        wait.side_effect = [[], [{'ProcessId': 456}]]
        result = self.controller.control_agent('restart')
        self.assertEqual(result, {'action': 'restart', 'process_count': 1, 'pids': [456]})
        self.assertEqual(run_task.call_args_list[0].args, ('/End',))
        self.assertEqual(run_task.call_args_list[1].args, ('/Run',))

    @patch.object(control_module.AgentControl, '_run_task_command')
    @patch.object(control_module.AgentControl, '_wait_for_count')
    @patch.object(control_module.AgentControl, 'agent_processes')
    def test_start_does_not_touch_other_processes(self, processes, wait, run_task):
        processes.return_value = []
        wait.return_value = [{'ProcessId': 321}]
        result = self.controller.control_agent('start')
        self.assertEqual(result['process_count'], 1)
        run_task.assert_called_once_with('/Run')

    def test_rejects_unknown_control_actions(self):
        with self.assertRaises(control_module.AgentControlError):
            self.controller.control_agent('delete-attendance')

    @patch('hikvision_agent_control.subprocess.run')
    def test_powershell_status_read_uses_no_console_window(self, run):
        run.return_value = Mock(returncode=0, stdout='[]')

        self.controller._powershell('$null')

        self.assertEqual(run.call_args.kwargs['creationflags'], control_module.NO_CONSOLE_WINDOW)
        self.assertTrue(run.call_args.kwargs['capture_output'])
        self.assertEqual(run.call_args.kwargs['timeout'], 15)

    @patch('hikvision_agent_control.subprocess.run')
    def test_task_control_uses_no_console_window(self, run):
        run.return_value = Mock(returncode=0, stdout='')

        self.controller._run_task_command('/Run')

        self.assertEqual(run.call_args.kwargs['creationflags'], control_module.NO_CONSOLE_WINDOW)
        self.assertTrue(run.call_args.kwargs['capture_output'])
        self.assertEqual(run.call_args.kwargs['timeout'], 20)


if __name__ == '__main__':
    unittest.main()
