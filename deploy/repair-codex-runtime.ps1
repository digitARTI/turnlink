param([string]$Root = 'C:\ProgramData\turnlink-v0.2', [string]$Profile = 'C:\Users\Administrator')
$ErrorActionPreference = 'Stop'
$bin = Join-Path $Root 'bin'
if (-not [IO.Directory]::Exists($bin)) { throw 'Expected prepared deployment bin directory' }
$configPath = Join-Path $bin 'launcher.json'
$config = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
$extensions = Join-Path $Profile '.vscode\extensions'
$candidates = @(Get-ChildItem -LiteralPath $extensions -Directory -Filter 'openai.chatgpt-*-win32-x64' |
  Where-Object { [IO.File]::Exists((Join-Path $_.FullName 'bin\windows-x86_64\codex.exe')) -and
                 [IO.File]::Exists((Join-Path $_.FullName 'bin\windows-x86_64\codex-code-mode-host.exe')) } |
  Sort-Object { [version](($_.Name -replace '^openai\.chatgpt-', '') -replace '-win32-x64$', '') } -Descending)
if (-not $candidates.Count) { throw 'No complete matching official Codex runtime installed' }
$extension = $candidates[0]
$source = Join-Path $extension.FullName 'bin\windows-x86_64'
$runtime = Join-Path $bin ('runtime-' + $extension.Name)
if ([IO.Directory]::Exists($runtime)) { throw 'Runtime staging directory already exists; inspect before replacing it' }
$companion = Join-Path $bin 'codex-code-mode-host.exe'
if ([IO.File]::Exists($companion)) { throw 'Existing companion must be inspected before replacement' }
$backup = Join-Path $Root 'private\launcher-before-runtime-repair.json'
if ([IO.File]::Exists($backup)) { throw 'Prior runtime-repair backup exists' }
if (-not [IO.Directory]::Exists((Split-Path -Parent $backup))) { throw 'Prepared private backup directory required' }
New-Item -ItemType Directory -Path $runtime | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $runtime -Recurse
$checks = @()
foreach ($name in @('codex.exe', 'codex-code-mode-host.exe')) {
  $original = Join-Path $source $name
  $copy = Join-Path $runtime $name
  $expected = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash -ne $expected) { throw 'Runtime hash mismatch' }
  $checks += @{ file = $name; sha256 = $expected }
}
# Some clients resolve code-mode-host relative to cliExecutable. Supply the
# matching official companion beside the shim as well as beside real Codex.
[IO.File]::Copy((Join-Path $runtime 'codex-code-mode-host.exe'), $companion)
[IO.File]::Copy($configPath, $backup)
$config.codex = Join-Path $runtime 'codex.exe'
$tmp = $configPath + '.runtime-repair.tmp'
[IO.File]::WriteAllText($tmp, ($config | ConvertTo-Json -Depth 8))
Move-Item -LiteralPath $tmp -Destination $configPath -Force
[ordered]@{ repaired = $true; extension = $extension.Name; codex = $config.codex;
  companion = $companion; verified = $checks; backup = $backup } | ConvertTo-Json -Depth 5
