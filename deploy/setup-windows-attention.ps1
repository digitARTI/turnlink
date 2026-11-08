# Explicit per-user desktop-toast identity setup. No operation displays a toast or starts a daemon.
[CmdletBinding()]
param(
  [ValidateSet('Plan', 'Stage', 'Inspect', 'Install')][string]$Operation = 'Plan',
  [Parameter(Mandatory=$true)][string]$NodeExecutable,
  [Parameter(Mandatory=$true)][string]$AttentionScript,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [string]$ShortcutPath
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
  function ExistingFile([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -match '[\x00-\x1f"]') { throw 'INVALID_PATH' }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INVALID_FILE' }
    return $item.FullName
  }
  $node = ExistingFile $NodeExecutable
  $script = ExistingFile $AttentionScript
  $config = ExistingFile $ConfigPath
  if ([IO.Path]::GetExtension($node) -ne '.exe' -or [IO.Path]::GetExtension($script) -ne '.js') { throw 'INVALID_TARGET' }
  $programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
  $startMenu = [Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)
  $commonStartMenu = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonStartMenu)
  $installedPath = Join-Path $programs 'Turnlink Operator Inbox.lnk'
  if ($Operation -eq 'Install') {
    if ($ShortcutPath -and [IO.Path]::GetFullPath($ShortcutPath) -ne $installedPath) { throw 'INSTALL_PATH_FIXED' }
    $ShortcutPath = $installedPath
  } elseif (-not $ShortcutPath) {
    if ($Operation -eq 'Stage') { throw 'FIXTURE_PATH_REQUIRED' }
    $ShortcutPath = $installedPath
  }
  if (-not [IO.Path]::IsPathRooted($ShortcutPath) -or $ShortcutPath -match '[\x00-\x1f"]' -or [IO.Path]::GetExtension($ShortcutPath) -ne '.lnk') { throw 'INVALID_SHORTCUT' }
  $shortcut = [IO.Path]::GetFullPath($ShortcutPath)
  $startMenuInstalled = $shortcut.Equals($installedPath, [StringComparison]::OrdinalIgnoreCase)
  if ($Operation -eq 'Stage') {
    foreach ($folder in @($startMenu, $commonStartMenu)) {
      if ($folder -and $shortcut.StartsWith(($folder.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'FIXTURE_CANNOT_REGISTER_START_MENU' }
    }
  }
  $arguments = '"' + $script + '" status "' + $config + '"'
  $result = [ordered]@{ version=1; operation=$Operation; appUserModelID='Turnlink'; shortcutPath=$shortcut; target=$node; arguments=$arguments; created=$false; startMenuInstalled=$false }
  if ($Operation -eq 'Plan') { $result | ConvertTo-Json -Compress; exit 0 }
  $parent = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($shortcut)) -Force
  if (-not $parent.PSIsContainer -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INVALID_SHORTCUT_DIRECTORY' }

  # PKEY_AppUserModel_ID and IPropertyStore are the documented desktop-toast prerequisites.
  # https://learn.microsoft.com/windows/win32/shell/enable-desktop-toast-with-appusermodelid
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class TurnlinkShortcutIdentity {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] private class ShellLink {}
  [StructLayout(LayoutKind.Sequential)] private struct PropertyKey { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size=24)] private struct PropVariant {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr text;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  [DllImport("ole32.dll")] private static extern int PropVariantClear(ref PropVariant value);
  public static string Access(string path, bool write) {
    object link = new ShellLink();
    try {
      var file = (IPersistFile)link;
      file.Load(path, write ? 2 : 0);
      var store = (IPropertyStore)link;
      var key = new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = 5 };
      PropVariant value;
      if (write) {
        value = new PropVariant { type = 31, text = Marshal.StringToCoTaskMemUni("Turnlink") };
        try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); Marshal.ThrowExceptionForHR(store.Commit()); file.Save(path, true); }
        finally { PropVariantClear(ref value); }
      }
      Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.type == 31 ? Marshal.PtrToStringUni(value.text) : null; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.FinalReleaseComObject(link); }
  }
}
'@
  $shell = New-Object -ComObject WScript.Shell
  try {
    if (Test-Path -LiteralPath $shortcut) {
      $item = Get-Item -LiteralPath $shortcut -Force
      if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'INVALID_EXISTING_SHORTCUT' }
      $link = $shell.CreateShortcut($shortcut)
      if ($link.TargetPath -ne $node -or $link.Arguments -cne $arguments -or [TurnlinkShortcutIdentity]::Access($shortcut, $false) -cne 'Turnlink') { throw 'EXISTING_SHORTCUT_CONFLICT' }
    } else {
      if ($Operation -eq 'Inspect') { throw 'SHORTCUT_NOT_INSTALLED' }
      # Save the reviewed shortcut beside its destination, then publish without replacing another file.
      $temporary = Join-Path $parent.FullName (([Guid]::NewGuid().ToString()) + '.lnk')
      try {
        $link = $shell.CreateShortcut($temporary)
        $link.TargetPath = $node
        $link.Arguments = $arguments
        $link.WorkingDirectory = [IO.Path]::GetDirectoryName($script)
        $link.Description = 'Inspect private Turnlink operator attention status'
        $link.Save()
        if ([TurnlinkShortcutIdentity]::Access($temporary, $true) -cne 'Turnlink') { throw 'IDENTITY_WRITE_FAILED' }
        [IO.File]::Move($temporary, $shortcut)
        $result.created = $true
      } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    }
    # Reopen the actual on-disk shortcut rather than trusting the in-memory write.
    if ([TurnlinkShortcutIdentity]::Access($shortcut, $false) -cne 'Turnlink') { throw 'IDENTITY_VERIFY_FAILED' }
    $result.startMenuInstalled = $startMenuInstalled
    $result | ConvertTo-Json -Compress
  } finally { if ($shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) } }
} catch {
  [Console]::Error.WriteLine('Turnlink notification shortcut setup refused; inspect explicit paths, existing shortcut and local Windows prerequisites.')
  exit 1
}
