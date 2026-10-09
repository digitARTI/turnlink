param([string]$Root = 'C:\ProgramData\turnlink-v0.2')
$ErrorActionPreference = 'Stop'
Set-Location $Root
& 'C:\Program Files\nodejs\npm.cmd' ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Staged npm ci failed' }
& 'C:\Program Files\nodejs\npm.cmd' test
if ($LASTEXITCODE -ne 0) { throw 'Staged synthetic test suite failed' }
& 'C:\Program Files\nodejs\npm.cmd' audit --audit-level=high
if ($LASTEXITCODE -ne 0) { throw 'Dependency audit failed' }
Write-Output 'Staged hardening verification finished; live adapters/services unchanged.'
