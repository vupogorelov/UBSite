# One-time setup that needs administrator rights. Run in PowerShell "as administrator":
#   powershell -ExecutionPolicy Bypass -File "<path>\deploy\setup-admin.ps1"
# 1) lets caddy.exe accept connections on TCP 80 and 443 (Windows Firewall);
# 2) registers autostart at logon (Task Scheduler) for deploy\start.ps1.

$ErrorActionPreference = 'Stop'
$deploy = $PSScriptRoot
$caddy = Join-Path $deploy 'caddy.exe'

foreach ($port in 80, 443) {
  $name = "Urantian Docs Explorer - Caddy $port"
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Program $caddy -Profile Any | Out-Null
  Write-Host "Firewall: TCP $port allowed for caddy.exe"
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $deploy 'start.ps1')`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'Urantian Docs Explorer' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host 'Autostart: task "Urantian Docs Explorer" runs deploy\start.ps1 at logon'
