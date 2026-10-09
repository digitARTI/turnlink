param([string]$Path, [string]$Created = 'false')
$ErrorActionPreference = 'Stop'
# Resolve the matching built-in binary module directly. A pwsh 7 parent can
# leave Windows PowerShell 5 with incompatible module discovery/cache paths.
Import-Module (Join-Path $PSHOME 'Microsoft.PowerShell.Security.dll') -Force -ErrorAction Stop
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$admins = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
if ($Created -eq 'true') {
  $security = [System.Security.AccessControl.DirectorySecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($current, $system, $admins)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $security.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $security
}
$acl = Get-Acl -LiteralPath $Path
$allowed = @($current.Value, $system.Value, $admins.Value, 'S-1-3-0')
$members = $null
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -ne 'Allow') { continue }
  $sid = $rule.IdentityReference.Value
  if ($allowed -contains $sid) { continue }
  # All local administrators already cross this filesystem trust boundary.
  if ($null -eq $members) {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.LocalAccounts\Microsoft.PowerShell.LocalAccounts.psd1') -Force -ErrorAction Stop
    $members = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.SID.Value })
  }
  if ($members -notcontains $sid) { throw 'Private path grants access outside its owner, local administrators and SYSTEM' }
}
Write-Output 'ok'
