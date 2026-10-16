# Starts the platform for the internet: the Node server (127.0.0.1:4300) and Caddy (HTTPS on 80/443).
# Run from any folder:  powershell -ExecutionPolicy Bypass -File "<path>\deploy\start.ps1"
# Stop: close the two windows (or Stop-Process the node/caddy processes).

$ErrorActionPreference = 'Stop'
$deploy = $PSScriptRoot
$root = Split-Path $deploy -Parent
$publicUrl = 'https://upexplorer.ddns.net'

# The Node server, with the public address for invitation links.
# If it stops on its own (a failure: the server writes it and ends), it is started again in 5 s —
# the window shows when and with what code. restart.ps1 closes the window itself, loop and all.
$nodeCmd = "`$env:UB_PUBLIC_URL = '$publicUrl'; Set-Location '$root'; while (`$true) { npm start; Write-Host ((Get-Date -Format s) + ' server stopped (code ' + `$LASTEXITCODE + '), starting again in 5 s') -ForegroundColor Yellow; Start-Sleep 5 }"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $nodeCmd -WindowStyle Minimized

# Caddy, from the deploy folder (its certificates and logs stay there).
New-Item -ItemType Directory -Force (Join-Path $deploy 'logs') | Out-Null
Start-Process (Join-Path $deploy 'caddy.exe') -ArgumentList 'run', '--config', 'Caddyfile' -WorkingDirectory $deploy -WindowStyle Minimized

Write-Host "Started. Open $publicUrl"
