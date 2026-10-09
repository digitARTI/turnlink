$ErrorActionPreference = 'Stop'
$result = [ordered]@{
  profile = $env:USERPROFILE
  appData = $env:APPDATA
  node = (Get-Command node -ErrorAction SilentlyContinue).Source
  nodeVersion = (& node --version)
  settings = (Join-Path $env:APPDATA 'Code\User\settings.json')
  codexConfig = (Join-Path $env:USERPROFILE '.codex\config.toml')
}
$codex = Get-CimInstance Win32_Process -Filter "Name='codex.exe'" | Select-Object -First 1
if ($codex) { $result.codex = $codex.ExecutablePath }
$result | ConvertTo-Json -Compress
