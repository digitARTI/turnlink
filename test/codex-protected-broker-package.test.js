import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

const node = process.env.TURNLINK_SEA_NODE, esbuild = process.env.TURNLINK_SEA_ESBUILD, postject = process.env.TURNLINK_SEA_POSTJECT;
test('offline broker review packaging is reproducible and refuses overwrite or fixture UID bypass',
  { skip: process.platform !== 'darwin' || !node || !esbuild || !postject, timeout: 180000 }, t => {
    const root = privateTemp('/private/tmp/turnlink-sea-test-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const build = (name, fixture) => {
      const out = join(root, name), args = [resolve('native/codex-vm-supervisor/package/build-review.mjs'), '--out', out,
        '--node', node, '--esbuild', esbuild, '--postject', postject, '--uid', String(fixture ? process.getuid() : 480),
        '--root', fixture ? '/private/tmp/turnlink-unused' : '/private/var/turnlink-vm-proof/private', '--fixture', fixture ? '1' : '0'];
      const result = spawnSync(node, args, { encoding: 'utf8', timeout: 150000 }); assert.equal(result.status, 0, result.stderr);
      return { out, args, manifest: JSON.parse(readFileSync(join(out, 'manifest.json'))) };
    };
    const first = build('one', true), second = build('two', true);
    for (const field of ['inputGraphSha256', 'bundleSha256', 'blobSha256', 'executableSha256']) assert.equal(first.manifest[field], second.manifest[field]);
    assert.equal(first.manifest.signature, 'ad-hoc-review-only'); assert.equal(first.manifest.productionReady, false);
    const repeated = spawnSync(node, first.args, { encoding: 'utf8', timeout: 10000 }); assert.notEqual(repeated.status, 0);
    assert.equal(JSON.parse(readFileSync(join(first.out, 'manifest.json'))).executableSha256, first.manifest.executableSha256);
    const production = build('production-review', false), marker = join(root, 'preload-executed'), preload = join(root, 'preload.cjs');
    assert.equal(production.manifest.fixture, false); assert.equal(production.manifest.uid, 480); assert.equal(production.manifest.productionReady, false);
    writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fixture')`, { mode: 0o600 });
    const direct = spawnSync(join(production.out, 'protected-broker'), [], { encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, TURNLINK_PROTECTED_BROKER_TEST_ROOT: root, TURNLINK_PROTECTED_BROKER_TEST_UID: String(process.getuid()) } });
    assert.notEqual(direct.status, 0, 'test env must not bypass the fixed review UID');
    assert.equal(existsSync(marker), true, 'direct same-UID invocation can inject NODE_OPTIONS before the application guard');
  });
