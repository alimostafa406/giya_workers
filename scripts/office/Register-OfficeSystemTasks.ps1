param(
  [Parameter(Mandatory = $true)] [string] $ProjectPath,
  [string] $PythonPath,
  [string] $DashboardTaskName = 'WorkersLocalDashboard',
  [string] $AgentTaskName = 'WorkersHikvisionAttendanceAgent',
  [switch] $StartNow
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$dashboardScript = Join-Path $ProjectPath 'scripts\office\Start-Dashboard.ps1'
$dashboardServer = Join-Path $ProjectPath 'scripts\office\Serve-Dashboard.py'
$agentPath = Join-Path $ProjectPath 'hikvision_attendance_agent.py'
$configPath = Join-Path $ProjectPath '.env.hikvision_sync'
$distIndex = Join-Path $ProjectPath 'dist\index.html'

if (-not $PythonPath) {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { throw 'Python was not found. Re-run with -PythonPath pointing to python.exe.' }
  $PythonPath = $python.Source
}
foreach ($path in @($PythonPath, $dashboardScript, $dashboardServer, $agentPath, $configPath, $distIndex)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required office runtime file was not found: $path" }
}

$pythonWindowlessPath = $PythonPath
if ([IO.Path]::GetFileName($PythonPath).Equals('python.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
  $candidate = Join-Path (Split-Path -Parent $PythonPath) 'pythonw.exe'
  if (Test-Path -LiteralPath $candidate) { $pythonWindowlessPath = $candidate }
}

$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew

# Each task directly owns its long-lived Python process. Scheduler therefore
# reports Running while it is alive and restarts it after an unexpected exit.
$dashboardAction = New-ScheduledTaskAction -Execute $pythonWindowlessPath -Argument "`"$dashboardServer`" --dist `"$ProjectPath\dist`" --host 127.0.0.1 --port 4173" -WorkingDirectory $ProjectPath
$agentAction = New-ScheduledTaskAction -Execute $pythonWindowlessPath -Argument "`"$agentPath`"" -WorkingDirectory $ProjectPath

try {
  # Stop an old action before replacing it so a legacy launcher or server does
  # not remain alive after its task definition has been repaired.
  foreach ($taskName in @($DashboardTaskName, $AgentTaskName)) {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask -and $existingTask.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }
  }
  Register-ScheduledTask -TaskName $DashboardTaskName -Action $dashboardAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Workers Management production dashboard' -Force -ErrorAction Stop
  Register-ScheduledTask -TaskName $AgentTaskName -Action $agentAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Hikvision attendance agent' -Force -ErrorAction Stop
} catch {
  throw "Unable to register the office startup tasks for the current user. Run PowerShell as the intended office user and check Task Scheduler permissions. $($_.Exception.Message)"
}

Write-Host "Registered $DashboardTaskName and $AgentTaskName. They start at the next user logon."
if ($StartNow) {
  Start-ScheduledTask -TaskName $DashboardTaskName
  Start-ScheduledTask -TaskName $AgentTaskName
  Write-Host 'Started both office tasks.'
}
