# Builds the Android app (the site in its own window, with reading aloud in the background) and puts
# the APK where the site serves it: web/public/app/upexplorer.apk -> https://<site>/app/upexplorer.apk
# (the old name, ubsite.apk, is sent on to it by the server: links given before still work)
# (after "npm run build" / deploy\restart.ps1 -Build).
#
#   powershell -ExecutionPolicy Bypass -File "<path>\android\build.ps1"
#
# Needs JDK 21 and the Android SDK (JAVA_HOME, ANDROID_HOME). The first build makes the signing key
# keystore.jks with its password in keystore.properties: keep both (they are not in git). An installed
# app takes an update only signed with the same key. For an update raise versionCode in app\build.gradle.

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path $here -Parent

if (-not $env:JAVA_HOME) { $env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User') }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Java\jdk-21*' | Select-Object -First 1).FullName }
$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User') }
if (-not $sdk) { $sdk = "$env:LOCALAPPDATA\Android\Sdk" }
Set-Content (Join-Path $here 'local.properties') ("sdk.dir=" + ($sdk -replace '\\', '\\'))

# The signing key (once).
$ks = Join-Path $here 'keystore.jks'
$kp = Join-Path $here 'keystore.properties'
if (-not (Test-Path $ks)) {
  Write-Host '-> Making the signing key (keystore.jks)' -ForegroundColor Cyan
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $ks -alias ubsite -keyalg RSA -keysize 3072 -validity 36500 `
    -storepass $pw -keypass $pw -dname 'CN=Urantia Papers Explorer'
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
  Set-Content $kp "password=$pw"
}

# The Gradle wrapper (once): from the Gradle unpacked in %LOCALAPPDATA%\gradle-dist.
if (-not (Test-Path (Join-Path $here 'gradlew.bat'))) {
  $gradle = Get-ChildItem "$env:LOCALAPPDATA\gradle-dist\gradle-*\bin\gradle.bat" | Select-Object -First 1
  if (-not $gradle) { throw 'Gradle not found: unpack gradle-<version>-bin.zip into %LOCALAPPDATA%\gradle-dist' }
  Push-Location $here
  try {
    & $gradle.FullName wrapper --gradle-version 9.8.1 --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'gradle wrapper failed' }
  } finally { Pop-Location }
}

Write-Host '-> Building (gradlew assembleRelease)' -ForegroundColor Cyan
Push-Location $here
try {
  & .\gradlew.bat assembleRelease --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
} finally { Pop-Location }

$apk = Join-Path $here 'app\build\outputs\apk\release\app-release.apk'
$out = Join-Path $root 'web\public\app'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $apk (Join-Path $out 'upexplorer.apk') -Force
# The version on the site: the app compares it with its own ("Переустановить приложение · 1.2 → 1.3").
$gradle = Get-Content (Join-Path $here 'app\build.gradle') -Raw
$name = [regex]::Match($gradle, "versionName = '([^']+)'").Groups[1].Value
$code = [regex]::Match($gradle, 'versionCode = (\d+)').Groups[1].Value
Set-Content (Join-Path $out 'version.json') ('{"code":' + $code + ',"name":"' + $name + '"}') -NoNewline
Write-Host ("OK  web\public\app\upexplorer.apk ({0:N0} KB)" -f ((Get-Item $apk).Length / 1KB)) -ForegroundColor Green
