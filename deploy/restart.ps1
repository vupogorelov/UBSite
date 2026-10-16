# Restarts the platform: stops the Node server (port 4300) with its window and Caddy, optionally
# rebuilds the interface, starts both again (deploy\start.ps1) and checks that they answer.
#
#   powershell -ExecutionPolicy Bypass -File "<path>\deploy\restart.ps1"          # restart
#   powershell -ExecutionPolicy Bypass -File "<path>\deploy\restart.ps1" -Build   # rebuild web/dist first
#
# Only this platform's processes are touched: the node.exe listening on 127.0.0.1:4300 (and the
# npm/PowerShell window that start.ps1 opened for it) and the caddy.exe from this deploy folder.
# Other Node programs on the computer keep running.

param(
  [switch]$Build,
  [int]$Port = 4300
)

$ErrorActionPreference = 'Stop'
$deploy = $PSScriptRoot
$root = Split-Path $deploy -Parent
$caddyExe = Join-Path $deploy 'caddy.exe'

function Step($text) { Write-Host "-> $text" -ForegroundColor Cyan }

# The process and its parents up to (and including) the PowerShell window start.ps1 opened.
function Get-ServerTree([int]$serverPid) {
  $ids = @()
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
  while ($p) {
    $ids += $p.ProcessId
    $cmd = [string]$p.CommandLine
    if ($p.Name -match '^(powershell|pwsh)\.exe$') {
      if ($cmd -notmatch 'npm start') { $ids = $ids[0..($ids.Count - 2)] } # not our window: keep it
      break
    }
    if ($p.Name -notmatch '^(node|cmd|npm)') { $ids = $ids[0..($ids.Count - 2)]; break }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction SilentlyContinue
  }
  return $ids
}

# 1) Optional rebuild while the old server still runs (no downtime for the build itself).
if ($Build) {
  Step 'Building the interface (npm run build)'
  Push-Location $root
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed: the platform keeps running the old version.' }
  } finally { Pop-Location }
}

# 2) Stop the Node server on the port, with its npm/PowerShell window.
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $tree = Get-ServerTree $listener.OwningProcess
  Step "Stopping the server (port $Port, processes $($tree -join ', '))"
  foreach ($id in ($tree | Sort-Object -Unique)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
} else {
  Step "The server was not running on port $Port"
}

# 3) Stop Caddy (only the one from this folder).
$caddy = Get-Process caddy -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $caddyExe }
if ($caddy) {
  Step "Stopping Caddy (process $($caddy.Id -join ', '))"
  $caddy | Stop-Process -Force
}

# 4) Wait until the ports are free.
$deadline = (Get-Date).AddSeconds(15)
while ((Get-NetTCPConnection -State Listen -LocalPort $Port, 80, 443 -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
}

# 5) Start both again.
Step 'Starting'
& (Join-Path $deploy 'start.ps1')

# 6) Check that they answer.
$ok = $false
$deadline = (Get-Date).AddSeconds(30)
while (-not $ok -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3
    $ok = $r.StatusCode -eq 200
  } catch {}
}
if ($ok) { Write-Host "OK  server answers on 127.0.0.1:$Port" -ForegroundColor Green }
else { Write-Host "!!  the server does not answer on 127.0.0.1:$Port - look at its window" -ForegroundColor Red }

$deadline = (Get-Date).AddSeconds(15)
while (-not (Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if (Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue) {
  Write-Host 'OK  Caddy listens on 443 (HTTPS)' -ForegroundColor Green
} else {
  Write-Host '!!  Caddy does not listen on 443 - look at its window or deploy\logs' -ForegroundColor Red
}
