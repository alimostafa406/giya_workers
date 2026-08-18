param(
  [string] $DashboardTaskName = 'WorkersLocalDashboard',
  [string] $AgentTaskName = 'WorkersHikvisionAttendanceAgent'
)

$ErrorActionPreference = 'Stop'
foreach ($taskName in @($DashboardTaskName, $AgentTaskName)) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Unregistered $taskName."
  } else {
    Write-Host "Task not found: $taskName"
  }
}
