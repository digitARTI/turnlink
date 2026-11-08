import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, toNamespacedPath } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { sessionProof, digest } from '../src/config.js';
import { atomicWrite, readPrivate, privateDirectory, privateTemp } from '../src/storage.js';

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


test('Windows private credentials remain verifiable beyond the legacy MAX_PATH length', { skip: process.platform !== 'win32' }, t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-long-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'private'.repeat(13)), agentId = 'opencode:long-path';
  const file = join(directory, digest('local'), `${digest(agentId)}.key`);
  assert.ok(file.length > 260, 'fixture exercises the Windows long-file path');
  const proof = sessionProof('local', agentId, directory);
  assert.match(proof, /^[a-f0-9]{64}$/);
  assert.equal(readPrivate(file), proof);
  execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'),
    [toNamespacedPath(file), '/grant:r', '*S-1-1-0:R'], { stdio: 'ignore', windowsHide: true });
  // A fresh process must still reject a broad long-file ACL; namespace support
  // changes path handling, never the permission policy or cached verification.
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {readPrivate} from './src/storage.js'; readPrivate(process.argv[1]);", file], { encoding: 'utf8', windowsHide: true }), error => {
      assert.equal(error.status, 1); assert.match(error.stderr, /ACLs/); assert.ok(!error.stderr.includes(proof)); return true;
    });
});
