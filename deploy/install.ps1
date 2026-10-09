$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\agent-channel'
if (-not (Test-Path $root -PathType Container)) { throw 'Deployment directory missing' }
Set-Location $root
& 'C:\Program Files\nodejs\npm.cmd' ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
& 'C:\Program Files\nodejs\node.exe' "$root\deploy\configure.js" $root 'C:\Users\Administrator' --prepare
if ($LASTEXITCODE -ne 0) { throw 'Launcher preparation failed' }
& "$root\bin\agent-channel-codex.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Launcher passthrough check failed' }
& "$root\bin\agent-channel-codex.exe" --channel-doctor
if ($LASTEXITCODE -ne 0) { throw 'Real app-server handshake failed' }
