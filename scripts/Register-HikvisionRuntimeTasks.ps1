param(
  [string] $ProjectPath = (Split-Path -Parent $PSScriptRoot),
  [string] $PythonPath = 'C:\Users\alimo\AppData\Local\Programs\Python\Python313\pythonw.exe',
  [string] $AgentTaskName = 'WorkersHikvisionAttendanceAgent',
  [string] $HelperTaskName = 'WorkersHikvisionFaceHelper',
  [switch] $StartNow
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$agentScript = Join-Path $ProjectPath 'hikvision_attendance_agent.py'
$helperScript = Join-Path $ProjectPath 'hikvision_face_helper.py'
$configPath = Join-Path $ProjectPath '.env.hikvision_sync'

foreach ($path in @($PythonPath, $agentScript, $helperScript, $configPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required Hikvision runtime file was not found: $path"
  }
}

if (-not [IO.Path]::GetFileName($PythonPath).Equals('pythonw.exe', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'PythonPath must point to pythonw.exe so no console window is opened.'
}

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '06:00'
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$agentAction = New-ScheduledTaskAction `
  -Execute $PythonPath `
  -Argument "`"$agentScript`"" `
  -WorkingDirectory $ProjectPath
$helperAction = New-ScheduledTaskAction `
  -Execute $PythonPath `
  -Argument "`"$helperScript`"" `
  -WorkingDirectory $ProjectPath

foreach ($taskName in @($AgentTaskName, $HelperTaskName)) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existing -and $existing.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
  }
}

Register-ScheduledTask `
  -TaskName $AgentTaskName `
  -Action $agentAction `
  -Trigger @($dailyTrigger, $logonTrigger) `
  -Principal $principal `
  -Settings $settings `
  -Description 'Local Hikvision attendance agent' `
  -Force | Out-Null

Register-ScheduledTask `
  -TaskName $HelperTaskName `
  -Action $helperAction `
  -Trigger $logonTrigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Local Hikvision biometric face and event helper' `
  -Force | Out-Null

if ($StartNow) {
  # An older manually launched helper may own the loopback port. Stop only the
  # Python process that is currently listening on the helper's exact port.
  $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($process -and $process.Name -match '^pythonw?\.exe$') {
      Stop-Process -Id $listener.OwningProcess -Force
    }
  }
  Start-ScheduledTask -TaskName $AgentTaskName
  Start-ScheduledTask -TaskName $HelperTaskName
}

Write-Output "Registered $AgentTaskName and $HelperTaskName for automatic startup."
