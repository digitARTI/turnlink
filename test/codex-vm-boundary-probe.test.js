import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

const mode = process.env.TURNLINK_VM_PROBE_MODE;
test('diskless and networkless VM capability probe', { skip: process.platform !== 'darwin' || !['sandbox-denied', 'host-allowed'].includes(mode), timeout: 60000 }, t => {
  const root = privateTemp('/private/tmp/turnlink-vm-probe-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, 'probe'), cache = process.env.TURNLINK_VM_SWIFT_CACHE || join(root, 'cache');
  const compile = spawnSync('/usr/bin/swiftc', ['-module-cache-path', cache, resolve('test/fixtures/codex-vm-boundary-probe.swift'), '-o', binary], { encoding: 'utf8', timeout: 45000 });
  assert.equal(compile.status, 0, compile.stderr);
  const sign = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', resolve('test/fixtures/codex-vm-boundary-entitlements.plist'), binary], { encoding: 'utf8', timeout: 10000 });
  assert.equal(sign.status, 0, sign.stderr);
  const probe = spawnSync(binary, [join(root, 'efi')], { encoding: 'utf8', timeout: 15000 });
  if (mode === 'sandbox-denied') {
    assert.equal(probe.status, 1, probe.stderr); assert.match(probe.stdout, /Virtualization is not available on this hardware/);
  } else {
    assert.equal(probe.status, 0, probe.stderr); assert.match(probe.stdout, /configuration_valid=true/); assert.match(probe.stdout, /start=success/);
  }
});
