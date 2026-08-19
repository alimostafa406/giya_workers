param(
  [string] $ProjectPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$helperScript = Join-Path $ProjectPath 'hikvision_face_helper.py'
$healthUrl = 'http://127.0.0.1:8765/health'
$dashboardUrl = 'http://127.0.0.1:4173/biometric-mapping'

if (-not (Test-Path -LiteralPath $helperScript)) {
  throw "Hikvision Helper was not found: $helperScript"
}

function Test-HelperHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-HelperHealth)) {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { throw 'Python was not found. Install Python or add it to PATH.' }
  $pythonPath = $python.Source
  $pythonwPath = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
  if (Test-Path -LiteralPath $pythonwPath) { $pythonPath = $pythonwPath }

  Start-Process -FilePath $pythonPath -ArgumentList @($helperScript) -WorkingDirectory $ProjectPath -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    if (Test-HelperHealth) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not (Test-HelperHealth)) {
    throw 'Hikvision Helper did not become healthy within 15 seconds.'
  }
}

Start-Process $dashboardUrl
