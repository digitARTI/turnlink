$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\agent-channel'
$result = [ordered]@{}
$result.launcher = @(Get-CimInstance Win32_Process -Filter "Name='agent-channel-codex.exe'" | ForEach-Object { @{ pid = $_.ProcessId; path = $_.ExecutablePath; session = $_.SessionId } })
$result.codex = @(Get-CimInstance Win32_Process -Filter "Name='codex.exe'" | ForEach-Object { @{ pid = $_.ProcessId; path = $_.ExecutablePath; session = $_.SessionId } })
$result.tunnelListening = [bool](Get-NetTCPConnection -State Listen -LocalPort 47322 -ErrorAction SilentlyContinue)
$result.configured = Test-Path "$root\deployment-status.json"
$result | ConvertTo-Json -Depth 5 -Compress
