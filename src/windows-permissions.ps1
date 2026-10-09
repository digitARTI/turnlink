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
} elseif ($Created -eq 'file') {
  # Initialize a newly created EMPTY temp file before any private bytes are
  # written, including configuration files under a broadly inherited parent.
  $security = [System.Security.AccessControl.FileSecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($current, $system, $admins)) {
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
  }
  [System.IO.File]::SetAccessControl($Path, $security)
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
    # LocalAccounts is absent on some supported Windows hosts. Query the local
    # SAM through .NET/ADSI instead of depending on another PowerShell module.
    [void][System.Reflection.Assembly]::LoadWithPartialName('System.DirectoryServices')
    $name = $admins.Translate([System.Security.Principal.NTAccount]).Value.Split('\')[-1]
    $group = [System.DirectoryServices.DirectoryEntry]::new('WinNT://' + [Environment]::MachineName + '/' + $name + ',group')
    try {
      $members = @(foreach ($member in $group.Invoke('Members')) {
        $bytes = $member.GetType().InvokeMember('objectSid', [System.Reflection.BindingFlags]::GetProperty, $null, $member, $null)
        [System.Security.Principal.SecurityIdentifier]::new([byte[]]$bytes, 0).Value
      })
    } finally { $group.Dispose() }
  }
  if ($members -notcontains $sid) { throw 'Private path grants access outside its owner, local administrators and SYSTEM' }
}
exit 0
