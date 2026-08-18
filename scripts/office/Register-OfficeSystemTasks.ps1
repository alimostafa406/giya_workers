param(
  [Parameter(Mandatory = $true)] [string] $ProjectPath,
  [string] $PythonPath,
  [string] $DashboardTaskName = 'WorkersLocalDashboard',
  [string] $AgentTaskName = 'WorkersHikvisionAttendanceAgent'
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$dashboardScript = Join-Path $ProjectPath 'scripts\office\Start-Dashboard.ps1'
$agentPath = Join-Path $ProjectPath 'hikvision_attendance_agent.py'
$configPath = Join-Path $ProjectPath '.env.hikvision_sync'
$distIndex = Join-Path $ProjectPath 'dist\index.html'

if (-not $PythonPath) {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { throw 'Python was not found. Re-run with -PythonPath pointing to python.exe.' }
  $PythonPath = $python.Source
}
foreach ($path in @($PythonPath, $dashboardScript, $agentPath, $configPath, $distIndex)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required office runtime file was not found: $path" }
}

$powershellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances Ignore

# The dashboard task runs the production Vite preview in the foreground so Task
# Scheduler can restart it. The agent runs Python directly for the same reason.
$dashboardArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$dashboardScript`" -ProjectPath `"$ProjectPath`" -Foreground"
$dashboardAction = New-ScheduledTaskAction -Execute $powershellExe -Argument $dashboardArgs -WorkingDirectory $ProjectPath
$agentAction = New-ScheduledTaskAction -Execute $PythonPath -Argument "`"$agentPath`"" -WorkingDirectory $ProjectPath

try {
  Register-ScheduledTask -TaskName $DashboardTaskName -Action $dashboardAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Workers Management production dashboard' -Force -ErrorAction Stop
  Register-ScheduledTask -TaskName $AgentTaskName -Action $agentAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Hikvision attendance agent' -Force -ErrorAction Stop
} catch {
  throw "Unable to register the office startup tasks for the current user. Run PowerShell as the intended office user and check Task Scheduler permissions. $($_.Exception.Message)"
}

Write-Host "Registered $DashboardTaskName and $AgentTaskName. They start at the next user logon."
