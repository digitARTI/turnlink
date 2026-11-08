import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

test('broker executable verification refuses wrong team, content and writable location',
  { skip: process.platform !== 'darwin', timeout: 30000 }, t => {
    const root = privateTemp('/private/tmp/turnlink-broker-exec-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const binary = join(root, 'checker'), run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
    const built = run('/usr/bin/clang', ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'Security',
      resolve('test/fixtures/codex-broker-verifier/executable-check.m'), resolve('native/codex-vm-supervisor/broker-executable-check.m'), '-o', binary]);
    assert.equal(built.status, 0, built.stderr);
    const digest = createHash('sha256').update(readFileSync('/bin/ls')).digest('hex');
    assert.equal(run(binary, ['/bin/ls', 'org.turnlink.broker', 'ABCDE12345', digest]).status, 1, 'foreign signer must fail');
    assert.equal(run(binary, ['/bin/ls', 'org.turnlink.broker', 'ABCDE12345', '0'.repeat(64)]).status, 1, 'wrong content must fail');
    const copy = join(root, 'copy'); copyFileSync('/bin/ls', copy);
    assert.equal(run(binary, [copy, 'org.turnlink.broker', 'ABCDE12345', digest]).status, 1, 'user-owned directory must fail');
    assert.equal(run(binary, ['/bin/ls', 'bad" or true', 'ABCDE12345', digest]).status, 1, 'invalid requirement must fail');
  });

test('review launcher requires explicit start and refuses a non-role UID',
  { skip: process.platform !== 'darwin' || process.getuid() >= 450 && process.getuid() <= 499, timeout: 30000 }, t => {
    const root = privateTemp('/private/tmp/turnlink-broker-launch-review-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const binary = join(root, 'bridge'), run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
    const define = (key, value) => `-D${key}=${JSON.stringify(value)}`;
    const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'Security', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=0',
      '-DTURNLINK_BRIDGE_SPAWN_REVIEW=1', `-DTURNLINK_BRIDGE_EXPECTED_UID=${process.getuid()}`, `-DTURNLINK_BRIDGE_EXPECTED_GID=${process.getgid()}`,
      define('TURNLINK_BRIDGE_SERVICE_NAME', 'org.turnlink.review'), define('TURNLINK_BRIDGE_CLIENT_IDENTIFIER', 'org.turnlink.supervisor'),
      define('TURNLINK_BRIDGE_CLIENT_TEAM', 'ABCDE12345'), define('TURNLINK_BRIDGE_BROKER_EXECUTABLE', '/bin/ls'),
      define('TURNLINK_BRIDGE_BROKER_IDENTIFIER', 'org.turnlink.broker'), define('TURNLINK_BRIDGE_BROKER_TEAM', 'ABCDE12345'),
      define('TURNLINK_BRIDGE_BROKER_SHA256', 'a'.repeat(64))];
    const built = run('/usr/bin/clang', [...flags, resolve('native/codex-vm-supervisor/protected-broker-bridge.m'),
      resolve('native/codex-vm-supervisor/broker-executable-check.m'), '-o', binary]);
    assert.equal(built.status, 0, built.stderr);
    assert.equal(run(binary, []).status, 2); assert.equal(run(binary, ['--start']).status, 3);
  });
