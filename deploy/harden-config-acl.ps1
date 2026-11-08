param([string]$Config, [string]$Backup)
$ErrorActionPreference = 'Stop'
if (-not [IO.File]::Exists($Config) -or [IO.File]::Exists($Backup)) { throw 'Expected existing config and a new ACL backup path' }
$old = [IO.File]::GetAccessControl($Config)
$sddl = $old.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
[IO.File]::WriteAllText($Backup, $sddl)
$owner = $old.GetOwner([Security.Principal.SecurityIdentifier])
$acl = [Security.AccessControl.FileSecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($owner, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
}
[IO.File]::SetAccessControl($Config, $acl)
Write-Output 'Config ACL restricted; original ACL saved privately. Config contents unchanged.'
