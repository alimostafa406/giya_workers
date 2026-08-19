param(
  [string] $ProjectPath = (Split-Path -Parent $PSScriptRoot),
  [string] $PythonPath,
  [string] $DashboardUrl
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$helperScript = Join-Path $ProjectPath 'hikvision_face_helper.py'
$healthUrl = 'http://127.0.0.1:8765/health'
$viteDashboardUrl = 'http://localhost:5173'
$productionDashboardUrl = 'http://127.0.0.1:4173'

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

function Resolve-HelperPythonPath {
  param([string] $ExplicitPythonPath)

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($ExplicitPythonPath) { $candidates.Add($ExplicitPythonPath) }
  if ($env:HIKVISION_PYTHON_PATH) { $candidates.Add($env:HIKVISION_PYTHON_PATH) }

  if ($env:LOCALAPPDATA) {
    $pythonRoot = Join-Path $env:LOCALAPPDATA 'Programs\Python'
    if (Test-Path -LiteralPath $pythonRoot) {
      Get-ChildItem -LiteralPath $pythonRoot -Directory -Filter 'Python*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object {
          $candidates.Add((Join-Path $_.FullName 'pythonw.exe'))
          $candidates.Add((Join-Path $_.FullName 'python.exe'))
        }
    }
  }

  foreach ($commandName in @('pythonw.exe', 'pythonw', 'python.exe', 'python')) {
    $command = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { $candidates.Add($command.Source) }
  }

  foreach ($candidate in $candidates) {
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $siblingPythonw = Join-Path (Split-Path -Parent $candidate) 'pythonw.exe'
    if (Test-Path -LiteralPath $siblingPythonw -PathType Leaf) { return $siblingPythonw }
    return $candidate
  }

  throw 'Python was not found. Supply -PythonPath or install Python under %LOCALAPPDATA%\Programs\Python.'
}

function Test-DashboardHealth {
  param([string] $BaseUrl)
  try {
    $response = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

function Resolve-DashboardUrl {
  param([string] $ExplicitDashboardUrl)
  if ($ExplicitDashboardUrl) {
    $baseUrl = $ExplicitDashboardUrl.TrimEnd('/')
    if (-not (Test-DashboardHealth $baseUrl)) {
      throw "Dashboard is not running at $baseUrl. Start it first."
    }
    return $baseUrl
  }
  if (Test-DashboardHealth $viteDashboardUrl) { return $viteDashboardUrl }
  if (Test-DashboardHealth $productionDashboardUrl) { return $productionDashboardUrl }
  throw 'Dashboard is not running. Start it with npm run dev.'
}

if (-not (Test-HelperHealth)) {
  $pythonPath = Resolve-HelperPythonPath -ExplicitPythonPath $PythonPath

  Start-Process -FilePath $pythonPath -ArgumentList @($helperScript) -WorkingDirectory $ProjectPath -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    if (Test-HelperHealth) { break }
  } while ((Get-Date) -lt $deadline)

  if (-not (Test-HelperHealth)) {
    throw "Hikvision Helper did not become healthy within 15 seconds. Python used: $pythonPath"
  }
}

$activeDashboardUrl = Resolve-DashboardUrl -ExplicitDashboardUrl $DashboardUrl
Start-Process "$activeDashboardUrl/biometric-mapping"
