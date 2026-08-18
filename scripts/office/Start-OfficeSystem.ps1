param(
  [string] $ProjectPath = (Join-Path $PSScriptRoot '..\..'),
  [string] $PythonPath,
  [int] $DashboardPort = 4173
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path

& (Join-Path $PSScriptRoot 'Start-Dashboard.ps1') -ProjectPath $ProjectPath -Port $DashboardPort
& (Join-Path $PSScriptRoot 'Start-AttendanceAgent.ps1') -ProjectPath $ProjectPath -PythonPath $PythonPath

Write-Host "Office system is available at http://127.0.0.1:$DashboardPort"
