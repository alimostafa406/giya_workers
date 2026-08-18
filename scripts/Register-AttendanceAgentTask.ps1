param(
  [string] $PythonPath,
  [Parameter(Mandatory = $true)] [string] $ProjectPath,
  [string] $TaskName = 'WorkersHikvisionAttendanceAgent'
)

# This script is inert until an administrator explicitly runs it. It does not
# run during development, builds, or deployment.
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$agentPath = Join-Path $ProjectPath 'hikvision_attendance_agent.py'
$configPath = Join-Path $ProjectPath '.env.hikvision_sync'
if (-not $PythonPath) {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $pythonCommand) { $pythonCommand = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $pythonCommand) { throw 'Python was not found on PATH. Re-run with -PythonPath pointing to the installed python.exe.' }
  $PythonPath = $pythonCommand.Source
}
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python was not found: $PythonPath" }
if (-not (Test-Path -LiteralPath $agentPath)) { throw "Agent was not found: $agentPath" }
if (-not (Test-Path -LiteralPath $configPath)) { throw "Local configuration was not found: $configPath" }

# The agent reads every setting, including the production write switch, from the
# local .env.hikvision_sync file. No credentials are included in task arguments.
$arguments = "`"$agentPath`""
$action = New-ScheduledTaskAction -Execute $PythonPath -Argument $arguments -WorkingDirectory $ProjectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances Ignore
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Hikvision attendance agent' -Force -ErrorAction Stop
Write-Host "Registered $TaskName. The agent starts at the next user logon."
