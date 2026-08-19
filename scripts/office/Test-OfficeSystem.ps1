param(
  [string] $ProjectPath = (Join-Path $PSScriptRoot '..\..'),
  [string] $DashboardTaskName = 'WorkersLocalDashboard',
  [string] $AgentTaskName = 'WorkersHikvisionAttendanceAgent'
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path

function Get-TaskState([string] $TaskName) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { return 'MISSING' }
  return $task.State.ToString()
}

function Test-LoopbackPort([int] $Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $result.AsyncWaitHandle.WaitOne(700)) { return $false }
    $client.EndConnect($result)
    return $true
  } catch { return $false } finally { $client.Dispose() }
}

function Test-DashboardHttp {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/__health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq 'OK'
  } catch { return $false }
}

$dashboardState = Get-TaskState $DashboardTaskName
$agentState = Get-TaskState $AgentTaskName
$dashboardPort = Test-LoopbackPort 4173
$dashboardHttp = Test-DashboardHttp
$agentProcess = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine -like '*hikvision_attendance_agent.py*'
})
$agentLog = Join-Path $ProjectPath 'logs\hikvision_attendance_agent.log'
$heartbeat = if (Test-Path -LiteralPath $agentLog) {
  (Select-String -LiteralPath $agentLog -Pattern 'Supabase heartbeat succeeded' | Select-Object -Last 1).Line
} else { $null }

Write-Output "Dashboard Task: $dashboardState"
Write-Output "Dashboard Port 4173: $(if ($dashboardPort) { 'OK' } else { 'FAIL' })"
Write-Output "Dashboard HTTP: $(if ($dashboardHttp) { 'OK' } else { 'FAIL' })"
Write-Output "Agent Task: $agentState"
Write-Output "Agent Process: $(if ($agentProcess.Count -eq 1) { 'OK' } elseif ($agentProcess.Count -eq 0) { 'FAIL' } else { 'FAIL (multiple)' })"
Write-Output "Last Agent heartbeat/log timestamp: $(if ($heartbeat) { $heartbeat } else { 'NOT FOUND' })"
$healthy = $dashboardPort -and $dashboardHttp -and $agentProcess.Count -eq 1 -and $dashboardState -eq 'Running' -and $agentState -eq 'Running'
Write-Output "Overall: $(if ($healthy) { 'HEALTHY' } else { 'ATTENTION REQUIRED' })"
