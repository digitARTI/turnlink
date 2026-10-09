import { constants, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync,
  mkdirSync, mkdtempSync, lstatSync, fstatSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const verifiedWindows = new Set();
function windowsPermissions(path, created = false) {
  if (process.platform !== 'win32' || verifiedWindows.has(path)) return;
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./windows-permissions.ps1', import.meta.url)), '-Path', path, '-Created', created ? 'true' : 'false'],
    { windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    verifiedWindows.add(path);
  } catch { throw new Error('Private Windows path needs owner/administrator/SYSTEM-only ACLs'); }
}
// Only a newly and exclusively created directory may have its ACL initialized.
// Existing caller-supplied directories retain fail-closed verification.
export function privateTemp(prefix) {
  const path = mkdtempSync(prefix);
  windowsPermissions(path, true);
  privateDirectory(path);
  return path;
}

export function privateDirectory(path) {
  const created = mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Private directory must not be a symlink');
  if (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) {
    throw new Error('Private directory must belong to this user and have mode 0700');
  }
  windowsPermissions(path, created !== undefined);
}
export function readPrivate(path, maxBytes = 64 * 1024 * 1024) {
  const initial = lstatSync(path);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error('Credential/state path must be a regular file');
  windowsPermissions(path);
  // A legitimate atomic writer may replace the snapshot during ACL inspection.
  // Retry the identity check, never follow a symlink or accept a mismatched fd.
  for (let attempt = 0; attempt < 3; attempt++) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Credential/state path must be a regular file');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = fstatSync(fd);
      if (opened.ino !== stat.ino || opened.dev !== stat.dev) continue;
      if (opened.size > maxBytes) throw new Error('Private file exceeds size limit');
      if (process.platform !== 'win32' && ((opened.mode & 0o077) || opened.uid !== process.getuid())) {
        throw new Error('Credential/state file must belong to this user and have mode 0600');
      }
      return readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
  }
  throw new Error('File changed repeatedly while opening');
}
export function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, value); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
    // Windows does not support fsync on directories. Unix rename durability does.
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
export function acquireStore(path, onCompromised) {
  privateDirectory(path);
  return lockfile.lockSync(path, { realpath: true, stale: 60000, update: 10000,
    onCompromised: error => onCompromised(error), retries: 0 });
}
