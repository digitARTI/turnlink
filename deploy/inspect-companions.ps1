param([string]$Root = 'C:\ProgramData\turnlink-v0.2', [string]$Profile = $env:USERPROFILE)
$ErrorActionPreference = 'Stop'
if (-not $Profile) { throw 'A Windows profile path is required' }
$config = Get-Content -LiteralPath "$Root\bin\launcher.json" -Raw | ConvertFrom-Json
$source = Join-Path ([IO.Path]::GetDirectoryName($config.codex)) 'codex-code-mode-host.exe'
$expected = Join-Path $Root 'bin\codex-code-mode-host.exe'
$installed = @(Get-ChildItem -LiteralPath (Join-Path $Profile '.vscode\extensions') -Directory -Filter 'openai.chatgpt-*-win32-x64' | ForEach-Object {
  $path = Join-Path $_.FullName 'bin\windows-x86_64\codex-code-mode-host.exe'
  @{ extension = $_.Name; companionExists = (Test-Path -LiteralPath $path); path = $path }
})
[ordered]@{ codex = $config.codex; codexExists = (Test-Path -LiteralPath $config.codex);
  sourceCompanion = $source; sourceExists = (Test-Path -LiteralPath $source);
  launcherCompanion = $expected; launcherExists = (Test-Path -LiteralPath $expected);
  installed = $installed } | ConvertTo-Json -Depth 4
