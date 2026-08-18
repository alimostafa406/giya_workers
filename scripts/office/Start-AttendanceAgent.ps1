param(
  [string] $ProjectPath = (Join-Path $PSScriptRoot '..\..'),
  [string] $PythonPath
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$agentPath = Join-Path $ProjectPath 'hikvision_attendance_agent.py'
$configPath = Join-Path $ProjectPath '.env.hikvision_sync'

if (-not $PythonPath) {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { throw 'Python was not found. Re-run with -PythonPath pointing to python.exe.' }
  $PythonPath = $python.Source
}
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python was not found: $PythonPath" }
if (-not (Test-Path -LiteralPath $agentPath)) { throw "Attendance Agent was not found: $agentPath" }
if (-not (Test-Path -LiteralPath $configPath)) { throw "Local Agent configuration was not found: $configPath" }

$runningAgent = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine -like '*hikvision_attendance_agent.py*'
}
if ($runningAgent) {
  Write-Host "Attendance Agent is already running (PID $($runningAgent[0].ProcessId))."
  exit 0
}

$logsPath = Join-Path $ProjectPath 'logs'
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
$process = Start-Process -FilePath $PythonPath -ArgumentList @($agentPath) -WorkingDirectory $ProjectPath -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $logsPath 'office-attendance-agent.out.log') `
  -RedirectStandardError (Join-Path $logsPath 'office-attendance-agent.error.log')
Start-Sleep -Seconds 2
if ($process.HasExited) {
  throw "Attendance Agent exited during startup. See logs\office-attendance-agent.error.log."
}

Write-Host "Attendance Agent started (PID $($process.Id))."
