param([string]$Root = 'C:\ProgramData\agent-channel')
$ErrorActionPreference = 'Stop'
$root = $Root
if (-not (Test-Path 'C:\ProgramData' -PathType Container)) { throw 'ProgramData missing' }
New-Item -ItemType Directory -Path $root -Force | Out-Null
foreach ($folder in @('src', 'deploy', 'bin', 'private', 'adapters', 'test', 'test\fixtures', 'dist', 'launcher')) {
  New-Item -ItemType Directory -Path (Join-Path $root $folder) -Force | Out-Null
}
# Only local administrators and SYSTEM can read the credential/deployment files.
& icacls $root /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Directory ACL failed' }
Write-Output 'Deployment directory prepared with restricted ACLs.'
