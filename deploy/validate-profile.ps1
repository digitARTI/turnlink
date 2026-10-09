$ErrorActionPreference = 'Stop'
$env:CODEX_HOME = 'C:\Users\Administrator\.codex'
Set-Location 'C:\ProgramData\agent-channel'
& 'C:\ProgramData\agent-channel\bin\agent-channel-codex.exe' --channel-doctor
if ($LASTEXITCODE -ne 0) { throw 'Administrator Codex profile initialization failed' }
