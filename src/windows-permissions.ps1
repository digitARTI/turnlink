param([string]$Path, [string]$Created = 'false')
$ErrorActionPreference = 'Stop'
# Use .NET ACL APIs directly: Get-Acl/Set-Acl module autoload can select a
# PowerShell 7 assembly when this Windows PowerShell 5 process has a pwsh parent.
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
  [System.IO.Directory]::SetAccessControl($Path, $security)
}
$acl = if ([System.IO.Directory]::Exists($Path)) {
  [System.IO.Directory]::GetAccessControl($Path)
} else {
  [System.IO.File]::GetAccessControl($Path)
}
$allowed = @($current.Value, $system.Value, $admins.Value, 'S-1-3-0')
$members = $null
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -ne 'Allow') { continue }
  $sid = $rule.IdentityReference.Value
  if ($allowed -contains $sid) { continue }
  # All local administrators already cross this filesystem trust boundary.
  if ($null -eq $members) {
    Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.LocalAccounts\Microsoft.PowerShell.LocalAccounts.psd1')) -Force -ErrorAction Stop
    $members = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.SID.Value })
  }
  if ($members -notcontains $sid) { throw 'Private path grants access outside its owner, local administrators and SYSTEM' }
}
exit 0
