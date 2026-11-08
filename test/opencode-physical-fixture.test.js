import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { privateTemp } from '../src/storage.js';

for (const fixture of ['opencode-physical-host.py', 'codex-physical-host.py']) test(`${fixture}: cleanup before preparation never contacts a host`, { skip: process.platform !== 'darwin' }, t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-physical-guard-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, 'unexpected-network');
  for (const name of ['ssh', 'scp']) {
    const file = join(root, name); writeFileSync(file, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 }); chmodSync(file, 0o700);
  }
  const result = spawnSync('python3', [resolve('test/fixtures', fixture)], { input: '{"op":"cleanup"}\n',
    encoding: 'utf8', timeout: 15000, env: { HOME: root, PATH: `${root}:/usr/bin:/bin`, TMPDIR: root } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { ok: true, result: { clean: true } });
  assert.equal(existsSync(marker), false);
});

test('Codex physical fixture lists its source transfer without contacting a host', { skip: process.platform !== 'darwin' }, t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-manifest-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, 'unexpected-network');
  for (const name of ['ssh', 'scp']) {
    const file = join(root, name); writeFileSync(file, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 }); chmodSync(file, 0o700);
  }
  const result = spawnSync('python3', [resolve('test/fixtures/codex-physical-host.py')], { input: '{"op":"manifest"}\n',
    encoding: 'utf8', timeout: 15000, env: { HOME: root, PATH: `${root}:/usr/bin:/bin`, TMPDIR: root } });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout.trim()); assert.equal(manifest.ok, true);
  for (const name of ['src/codex-proxy.js', 'src/mcp.js', 'src/windows-permissions.ps1']) assert.ok(manifest.result.sources.includes(name));
  assert.ok(manifest.result.sources.every(name => name.startsWith('src/')));
  assert.equal(existsSync(marker), false);
});
