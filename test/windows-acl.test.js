import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { atomicWrite, readPrivate, privateDirectory } from '../src/storage.js';

test('Windows atomic config writes restrict the new file even under a broad parent ACL', { skip: process.platform !== 'win32' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-broad-parent-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'),
    [root, '/grant:r', '*S-1-1-0:(OI)(CI)R'], { stdio: 'ignore', windowsHide: true });
  assert.throws(() => privateDirectory(root), /ACLs/);
  const path = join(root, 'synthetic-config.json');
  atomicWrite(path, '{"synthetic":true}');
  assert.equal(readPrivate(path), '{"synthetic":true}');
});
