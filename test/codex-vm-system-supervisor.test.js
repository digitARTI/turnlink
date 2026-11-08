import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, closeSync, copyFileSync, cpSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

test('system supervisor fixture enforces owner lock and retains crash fence',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1', timeout: 150000 }, async t => {
    const dir = privateTemp('/private/tmp/turnlink-vm-system-');
    let vmMayBeActive = false;
    t.after(() => { if (!vmMayBeActive) rmSync(dir, { recursive: true, force: true }); });
    const state = join(dir, 'state'), fence = join(dir, 'fence'); mkdirSync(state, { mode: 0o700 }); mkdirSync(fence, { mode: 0o700 });
    const fixture = resolve('test/fixtures/codex-vm-xpc');
    const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 50000 });
    const must = (cmd, args) => { const out = run(cmd, args); assert.equal(out.status, 0, out.stderr || out.stdout); return out.stdout; };
    const app = join(dir, 'Fixture.app'), contents = join(app, 'Contents');
    const service = join(contents, 'XPCServices', 'VMService.xpc', 'Contents');
    mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(service, 'MacOS'), { recursive: true });
    copyFileSync(join(fixture, 'app.plist'), join(contents, 'Info.plist'));
    copyFileSync(join(fixture, 'service.plist'), join(service, 'Info.plist'));
    const client = join(contents, 'MacOS', 'VMClient'), daemon = join(service, 'MacOS', 'VMService');
    const kernel = '/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/nerdbox-kernel-arm64';
    const initrd = process.env.TURNLINK_DOCKER_VM_INITRD || '/nonexistent';
    const daemonProbe = process.env.TURNLINK_VM_DAEMON_PROBE === '1';
    if (process.env.TURNLINK_VM_CONTROL_PROBE === '1' || daemonProbe) {
      const expected = process.env.TURNLINK_DOCKER_VM_INITRD_SHA256 || '';
      assert.match(expected, /^[a-f0-9]{64}$/);
      assert.equal(createHash('sha256').update(readFileSync(initrd)).digest('hex'), expected);
    }
    const define = (key, value) => `-D${key}=${JSON.stringify(value)}`;
    const disk = join(dir, 'guest.raw'), key = process.env.TURNLINK_DOCKER_VM_KEY || '/nonexistent';
    if (daemonProbe) {
      const space = statfsSync(dir); assert.ok(space.bavail * space.bsize > 1024 * 1024 * 1024);
      assert.equal(readFileSync(key).length, 32);
      const fd = openSync(disk, 'wx', 0o600); ftruncateSync(fd, 256 * 1024 * 1024); closeSync(fd);
      must('/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/mkfs.ext4', ['-q', '-F', disk]);
    }
    const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'Virtualization', '-DTURNLINK_VM_FIXTURE=1',
      define('TURNLINK_VM_STATE_DIR', state), `-DTURNLINK_VM_EXPECTED_UID=${process.getuid()}`,
      define('TURNLINK_VM_FENCE_DIR', fence),
      define('TURNLINK_VM_KERNEL', kernel), define('TURNLINK_VM_INITRD', initrd),
      `-DTURNLINK_VM_DAEMON_FIXTURE=${daemonProbe ? 1 : 0}`, define('TURNLINK_VM_DISK', disk), define('TURNLINK_VM_KEY', key),
      define('TURNLINK_VM_PEER_IDENTIFIER', 'org.turnlink.vmfixture.client'),
      define('TURNLINK_VM_SERVICE_NAME', 'org.turnlink.vmfixture.service')];
    must('/usr/bin/clang', [...flags, join(fixture, 'system-client.m'), '-o', client]);
    must('/usr/bin/clang', [...flags, resolve('native/codex-vm-supervisor/supervisor.m'), '-o', daemon]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', resolve('test/fixtures/codex-vm-boundary-entitlements.plist'), join(contents, 'XPCServices', 'VMService.xpc')]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', app]);

    writeFileSync(join(fence, 'authority.fence'), 'invalid\n', { mode: 0o600 });
    assert.equal(run(daemon, ['--hold-owner']).status, 4);
    rmSync(join(fence, 'authority.fence'));
    const holder = spawn(daemon, ['--hold-owner'], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL'); });
    const [data] = await once(holder.stdout, 'data'); assert.match(data.toString(), /owner-held/);
    const denied = run(client, ['status']); assert.notEqual(denied.status, 0); assert.match(denied.stderr, /xpc-error/);
    holder.kill('SIGKILL'); await once(holder, 'exit');
    chmodSync(state, 0o777);
    assert.equal(run(daemon, ['--hold-owner']).status, 4);
    chmodSync(state, 0o700);
    assert.match(must(client, ['status']), /^fenced\s*$/);
    assert.match(must(client, ['service-auth-good']), /^fenced\s*$/);
    const wrongService = run(client, ['service-auth-bad']);
    assert.notEqual(wrongService.status, 0); assert.match(wrongService.stderr, /xpc-error/);
    assert.match(must(client, ['observe-revocation']), /^no-local-marker\s*$/);
    // The fixture's ad-hoc signed client is runnable by this same-UID process.
    // Test whether dyld can inject code before it sends an authorized request;
    // this is a negative security characterization, not a production guarantee.
    const injectedSource = join(dir, 'inject.c'), injectedLibrary = join(dir, 'inject.dylib'), injectedMarker = join(dir, 'injected');
    writeFileSync(injectedSource, '#include <stdio.h>\n#include <stdlib.h>\n__attribute__((constructor)) static void injected(void) { const char *p=getenv("TURNLINK_INJECT_MARKER"); if(p) { FILE *f=fopen(p,"w"); if(f) { fputs("injected",f); fclose(f); } } }\n');
    must('/usr/bin/clang', ['-dynamiclib', injectedSource, '-o', injectedLibrary]);
    const injected = spawnSync(client, ['status'], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DYLD_INSERT_LIBRARIES: injectedLibrary, TURNLINK_INJECT_MARKER: injectedMarker } });
    assert.equal(injected.status, 0, injected.stderr); assert.match(injected.stdout, /^fenced\s*$/);
    assert.equal(existsSync(injectedMarker), true, 'unhardened ad-hoc fixture client allows library injection');
    const hardenedApp = join(dir, 'Hardened.app'); cpSync(app, hardenedApp, { recursive: true });
    must('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', hardenedApp]);
    const hardenedClient = join(hardenedApp, 'Contents', 'MacOS', 'VMClient');
    assert.match(must(hardenedClient, ['status']), /^fenced\s*$/);
    const hardenedMarker = join(dir, 'hardened-injected');
    const hardened = spawnSync(hardenedClient, ['status'], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, DYLD_INSERT_LIBRARIES: injectedLibrary, TURNLINK_INJECT_MARKER: hardenedMarker } });
    assert.equal(existsSync(hardenedMarker), false, 'hardened fixture must not execute injected library');
    // Refusal to start or successful status with injection stripped are both
    // fail-closed for this library; a production identity still needs its own test.
    if (hardened.status === 0) assert.match(hardened.stdout, /^fenced\s*$/);
    t.diagnostic(`hardened injection attempt: exit=${hardened.status ?? hardened.signal}; library-executed=false`);
    const before = run(client, ['crash-before']); assert.notEqual(before.status, 0); assert.match(before.stderr, /xpc-error/);
    assert.equal(existsSync(join(state, 'pending')), false);
    assert.equal(existsSync(join(state, 'revoked')), false);
    assert.equal(readFileSync(join(fence, 'authority.fence'), 'utf8'), 'fenced\n');
    assert.match(must(client, ['status']), /^fenced\s*$/);
    assert.match(must(client, ['observe-revocation']), /^no-local-marker\s*$/);
    const waitStoppedService = async output => {
      const match = output.match(/vm-stopped-fixture ([1-9][0-9]*)/); assert.ok(match);
      const pid = Number(match[1]);
      for (let i = 0; i < 200; i++) {
        try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('fixture XPC service did not exit');
    };
    if (process.env.TURNLINK_VM_CONTROL_PROBE === '1') {
      vmMayBeActive = true;
      assert.match(must(client, ['start-pause']), /^vm-started-fixture vm-paused-fixture\s*$/);
      await waitStoppedService(must(client, ['stop-fixture'])); vmMayBeActive = false;
    }
    if (daemonProbe) {
      vmMayBeActive = true;
      const daemonCrash = run(client, ['daemon-revoke-crash']);
      assert.notEqual(daemonCrash.status, 0, `daemon probe did not crash: ${daemonCrash.stdout} ${daemonCrash.stderr}`); assert.match(daemonCrash.stdout, /daemon-ping-authenticated wrong-key-rejected/); assert.match(daemonCrash.stderr, /xpc-error/);
      assert.equal(readFileSync(join(fence, 'authority.fence'), 'utf8'), 'fenced\n');
      const recovered = must(client, ['daemon-recover']);
      assert.match(recovered, /^guest-revoked-daemon-observed vm-stopped-fixture [1-9][0-9]*\s*$/);
      await waitStoppedService(recovered); vmMayBeActive = false;
    }
    const during = run(client, ['crash-during']); assert.notEqual(during.status, 0); assert.match(during.stderr, /xpc-error/);
    assert.equal(readFileSync(join(fence, 'authority.fence'), 'utf8'), 'fenced\n');
    assert.match(must(client, ['status']), /^fenced\s*$/);
    assert.match(must(client, ['observe-revocation']), /^uncertain\s*$/);
    rmSync(join(state, 'pending'), { force: true }); // Reset only this disposable crash fixture.
    const interrupted = run(client, ['crash']); assert.notEqual(interrupted.status, 0); assert.match(interrupted.stderr, /xpc-error/);
    assert.match(must(client, ['status']), /^fenced\s*$/);
    assert.match(must(client, ['observe-revocation']), /^uncertain\s*$/);
    assert.match(must(client, ['revoke']), /^fenced-or-error\s*$/);
    rmSync(join(state, 'pending')); // Reset only this disposable crash fixture.
    // Any process of this UID can execute the exact approved hardened binary
    // with another supported command; code identity does not authorize intent.
    assert.match(must(hardenedClient, ['revoke']), /^revoked\s*$/);
    assert.match(must(client, ['observe-revocation']), /^recorded\s*$/);
    assert.match(must(client, ['status']), /^fenced\s*$/);
    writeFileSync(join(state, 'revoked'), 'invalid\n');
    assert.match(must(client, ['observe-revocation']), /^uncertain\s*$/);
    assert.match(must(client, ['status']), /^fenced\s*$/);
    rmSync(join(state, 'revoked'));
    symlinkSync(join(fence, 'authority.fence'), join(state, 'revoked'));
    assert.match(must(client, ['observe-revocation']), /^uncertain\s*$/);
    const badApp = join(dir, 'WrongClient.app'); cpSync(app, badApp, { recursive: true });
    const badInfo = join(badApp, 'Contents', 'Info.plist');
    writeFileSync(badInfo, readFileSync(badInfo, 'utf8').replace('org.turnlink.vmfixture.client', 'org.turnlink.vmfixture.other'));
    must('/usr/bin/codesign', ['--force', '--sign', '-', badApp]);
    const bad = run(join(badApp, 'Contents', 'MacOS', 'VMClient'), ['status']);
    assert.notEqual(bad.status, 0); assert.match(bad.stderr, /xpc-error/);
  });

test('non-root fixture cannot create a second OS identity merely by calling setuid',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1' || typeof process.getuid !== 'function' || [0, 65534].includes(process.getuid()) }, () => {
    // The UID belongs only to the child process. This does not create an
    // account or change any parent process, filesystem permission or service.
    const probe = spawnSync(process.execPath, ['-e', 'try { process.setuid(65534); process.stdout.write("changed"); } catch (e) { process.stdout.write(e.code); }'],
      { encoding: 'utf8', timeout: 5000 });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stdout, 'EPERM');
  });

test('review client refuses unsupported requests and a nonexistent pinned system service',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1', timeout: 30000 }, t => {
    const dir = privateTemp('/private/tmp/turnlink-vm-client-review-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const executable = join(dir, 'client');
    const service = `org.turnlink.absent-${Date.now()}-${process.pid}`;
    const define = (key, value) => `-D${key}=${JSON.stringify(value)}`;
    const built = spawnSync('/usr/bin/clang', ['-fobjc-arc', '-fblocks', '-framework', 'Foundation',
      define('TURNLINK_VM_SERVICE_NAME', service), define('TURNLINK_VM_SERVICE_IDENTIFIER', 'org.turnlink.nonexistent-service'),
      define('TURNLINK_VM_SERVICE_TEAM', 'ABCDE12345'), resolve('native/codex-vm-supervisor/review-client.m'), '-o', executable],
    { encoding: 'utf8', timeout: 20000 });
    assert.equal(built.status, 0, built.stderr);
    const invalid = spawnSync(executable, ['revoke'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(invalid.status, 2); assert.equal(invalid.stdout, '');
    const missing = spawnSync(executable, ['status'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(missing.status, 1); assert.equal(missing.stdout, '');
  });
