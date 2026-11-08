param([string]$Profile = $env:USERPROFILE)
$ErrorActionPreference = 'Stop'
if (-not $Profile) { throw 'A Windows profile path is required' }
$env:CODEX_HOME = Join-Path $Profile '.codex'
Set-Location 'C:\ProgramData\agent-channel'
& 'C:\ProgramData\agent-channel\bin\agent-channel-codex.exe' --channel-doctor
if ($LASTEXITCODE -ne 0) { throw 'Codex profile initialization failed' }
