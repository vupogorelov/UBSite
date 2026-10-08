# Starts the platform for the internet: the Node server (127.0.0.1:4300) and Caddy (HTTPS on 80/443).
# Run from any folder:  powershell -ExecutionPolicy Bypass -File "<path>\deploy\start.ps1"
# Stop: close the two windows (or Stop-Process the node/caddy processes).

$ErrorActionPreference = 'Stop'
$deploy = $PSScriptRoot
$root = Split-Path $deploy -Parent
$publicUrl = 'https://95-31-142-59.broadband.corbina.ru'

# The Node server, with the public address for invitation links.
$nodeCmd = "`$env:UB_PUBLIC_URL = '$publicUrl'; Set-Location '$root'; npm start"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $nodeCmd -WindowStyle Minimized

# Caddy, from the deploy folder (its certificates and logs stay there).
New-Item -ItemType Directory -Force (Join-Path $deploy 'logs') | Out-Null
Start-Process (Join-Path $deploy 'caddy.exe') -ArgumentList 'run', '--config', 'Caddyfile' -WorkingDirectory $deploy -WindowStyle Minimized

Write-Host "Started. Open $publicUrl"
