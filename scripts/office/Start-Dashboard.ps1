param(
  [string] $ProjectPath = (Join-Path $PSScriptRoot '..\..'),
  [int] $Port = 4173,
  [string] $PythonPath,
  [switch] $Foreground
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$distPath = Join-Path $ProjectPath 'dist'
$indexPath = Join-Path $distPath 'index.html'

if (-not (Test-Path -LiteralPath $indexPath)) {
  throw "Production dashboard build is missing: $indexPath. Run 'npm.cmd run build' in $ProjectPath first."
}

if (-not $PythonPath) {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { throw 'Python was not found. Re-run with -PythonPath pointing to python.exe.' }
  $PythonPath = $python.Source
}
if (-not (Test-Path -LiteralPath $PythonPath)) { throw "Python was not found: $PythonPath" }
$serverPath = Join-Path $ProjectPath 'scripts\office\Serve-Dashboard.py'
if (-not (Test-Path -LiteralPath $serverPath)) { throw "Dashboard server was not found: $serverPath" }

function Test-LocalPortListening {
  param([int] $LocalPort)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect('127.0.0.1', $LocalPort, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(500)) { return $false }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (Test-LocalPortListening -LocalPort $Port) {
  Write-Host "Dashboard is already listening at http://127.0.0.1:$Port"
  exit 0
}

$arguments = @($serverPath, '--dist', $distPath, '--host', '127.0.0.1', '--port', $Port)
if ($Foreground) {
  & $PythonPath @arguments
  exit $LASTEXITCODE
}

$logsPath = Join-Path $ProjectPath 'logs'
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
$process = Start-Process -FilePath $PythonPath -ArgumentList $arguments -WorkingDirectory $ProjectPath -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $logsPath 'office-dashboard.log') `
  -RedirectStandardError (Join-Path $logsPath 'office-dashboard.error.log')
Start-Sleep -Seconds 2
if (-not (Test-LocalPortListening -LocalPort $Port)) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  throw "Dashboard server did not start on http://127.0.0.1:$Port. See logs\office-dashboard.error.log."
}

Write-Host "Dashboard started at http://127.0.0.1:$Port (PID $($process.Id))"
