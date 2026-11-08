import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, ftruncateSync, openSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

// Opt-in disposable fixture only. The prebuilt initramfs contains a test key;
// its digest must be supplied explicitly and its key must never be committed.
const enabled = process.env.TURNLINK_DOCKER_VM_PROBE === '1';
test('isolated Docker VM: authentication, crash, revocation, pause and disk reconciliation',
  { skip: process.platform !== 'darwin' || !enabled, timeout: 150000 }, t => {
    const initrd = process.env.TURNLINK_DOCKER_VM_INITRD, key = process.env.TURNLINK_DOCKER_VM_KEY;
    const expected = process.env.TURNLINK_DOCKER_VM_INITRD_SHA256;
    assert.ok(isAbsolute(initrd || '') && isAbsolute(key || '') && /^[a-f0-9]{64}$/.test(expected || ''));
    assert.equal(createHash('sha256').update(readFileSync(initrd)).digest('hex'), expected);
    assert.equal(readFileSync(key).length, 32);
    const root = privateTemp('/private/tmp/turnlink-docker-vm-test-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const enoughSpace = () => { const stat = statfsSync(root); assert.ok(stat.bavail * stat.bsize > 1024 * 1024 * 1024,
      'need over 1 GiB free so a 256 MiB test disk cannot cross the 700 MiB safety floor'); };
    const run = (command, args, timeout = 60000) => spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
    const must = (command, args, timeout) => { const result = run(command, args, timeout); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; };
    const binary = join(root, 'controller'), cache = process.env.TURNLINK_VM_SWIFT_CACHE || join(root, 'swift-cache');
    const kernel = '/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/nerdbox-kernel-arm64';
    const mkfs = '/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/mkfs.ext4';
    enoughSpace(); must('/usr/bin/swiftc', ['-module-cache-path', cache, resolve('test/fixtures/codex-guest-docker-controller.swift'), '-o', binary]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', resolve('test/fixtures/codex-vm-boundary-entitlements.plist'), binary]);
    const disk = name => { enoughSpace(); const path = join(root, `${name}.raw`), fd = openSync(path, 'wx', 0o600); ftruncateSync(fd, 256 * 1024 * 1024); closeSync(fd); must(mkfs, ['-q', '-F', path]); return path; };
    const probe = (path, mode) => { enoughSpace(); return run(binary, [kernel, initrd, path, key, mode]); };
    const success = (path, mode, expectedOutput) => { const result = probe(path, mode); assert.equal(result.status, 0, result.stderr || result.stdout); assert.match(result.stdout, expectedOutput); return result.stdout; };

    const crash = disk('crash');
    const peer = run(process.execPath, ['-e', `const fs = require('node:fs');
      fs.accessSync(process.argv[1], fs.constants.R_OK);
      fs.accessSync(process.argv[2], fs.constants.W_OK);
      process.stdout.write('same_uid_key_readable_disk_writable=true');`, key, crash]);
    assert.equal(peer.status, 0, peer.stderr);
    assert.match(peer.stdout, /same_uid_key_readable_disk_writable=true/);
    const seeded = probe(crash, 'seed');
    assert.equal(seeded.signal, 'SIGKILL', seeded.stderr || seeded.stdout);
    assert.match(seeded.stdout, /bad_hmac_denied=true docker_ping=true docker_create=true revoke_durable=true post_revoke_denied=true/);
    success(crash, 'recover', /recovery_denied=true/);
    const pending = disk('pending'), interrupted = probe(pending, 'pending-crash');
    assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr || interrupted.stdout);
    assert.match(interrupted.stdout, /pending_record_durable=true crash_before_rename=true/);
    success(pending, 'recover', /recovery_denied=true/);
    success(disk('recheck'), 'recheck', /recheck_blocked_daemon_create=true/);
    success(disk('race'), 'race', /revoked_before_daemon_create=true/);
    const paused = disk('paused'), pausedOutput = success(paused, 'pause-stop', /pause_confirmed=true effect_during_pause=false stopped_without_resume=true/);
    assert.match(pausedOutput, /pause_callback_ms=[0-9.]+/); success(paused, 'inspect', /reconstructed_daemon_container_absent=true/);
    const inflight = disk('inflight'), inflightOutput = success(inflight, 'pause-inflight', /daemon_accepted_before_pause=true io_started=true pause_confirmed=true stopped_without_resume=true/);
    assert.match(inflightOutput, /pause_callback_ms=[0-9.]+/);
    const observed = success(inflight, 'inspect-present', /reconstructed_daemon_container_present=(true|false) io_state=(partial|complete|missing|unverified)/);
    t.diagnostic(`in-flight reconstruction: ${observed.trim()}`);
    const synced = disk('synced'); success(synced, 'create-sync-stop', /docker_create_and_guest_sync=true/);
    success(synced, 'inspect-present', /reconstructed_daemon_container_present=true/);
  });
