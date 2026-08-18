param(
  [string] $DesktopPath = [Environment]::GetFolderPath('Desktop'),
  [int] $Port = 4173
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $DesktopPath)) { throw "Desktop path was not found: $DesktopPath" }

$shortcutPath = Join-Path $DesktopPath 'Workers Management.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\rundll32.exe'
$shortcut.Arguments = "url.dll,FileProtocolHandler http://127.0.0.1:$Port"
$shortcut.Description = 'Open the local Workers Management dashboard'
$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
