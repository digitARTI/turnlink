// Synthetic empty-directory diagnostics only; never reads tokens or state.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'win32') throw new Error('Windows diagnostic only');
const path = mkdtempSync(join(tmpdir(), 'turnlink-acl-diagnostic-'));
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
try {
  for (const sanitized of [false, true]) for (const hidden of [false, true]) {
    const env = { ...process.env };
    if (sanitized) {
      for (const key of Object.keys(env)) if (['PSMODULEPATH', 'PSMODULEANALYSISCACHEPATH'].includes(key.toUpperCase())) delete env[key];
      env.PSModulePath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
    }
    for (const inherited of [false, true]) {
      try {
        execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('src/windows-permissions.ps1'), '-Path', path, '-Created', 'true'],
          { env, windowsHide: hidden, timeout: 3000, stdio: inherited ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
        console.log(JSON.stringify({ sanitized, hidden, inherited, result: 'pass' }));
      } catch (error) {
        console.log(JSON.stringify({ sanitized, hidden, inherited, result: 'fail', code: error.code, status: error.status,
          stderr: error.stderr?.toString().slice(0, 1500) }));
      }
    }
  }
} finally { rmSync(path, { recursive: true, force: true }); }
