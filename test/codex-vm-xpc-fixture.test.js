import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

// Runs a same-user, ad-hoc-signed application-bundled XPC fixture only.
test('XPC VM supervisor fixture preserves a revocation fence after service crash',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1', timeout: 60000 }, t => {
    const dir = privateTemp('/private/tmp/turnlink-vm-xpc-');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const fixture = resolve('test/fixtures/codex-vm-xpc');
    const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 12000 });
    const must = (cmd, args) => { const out = run(cmd, args); assert.equal(out.status, 0, out.stderr || out.stdout); return out.stdout; };
    const app = join(dir, 'Fixture.app'), contents = join(app, 'Contents');
    const service = join(contents, 'XPCServices', 'VMService.xpc', 'Contents');
    mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(service, 'MacOS'), { recursive: true });
    copyFileSync(join(fixture, 'app.plist'), join(contents, 'Info.plist'));
    copyFileSync(join(fixture, 'service.plist'), join(service, 'Info.plist'));
    const client = join(contents, 'MacOS', 'VMClient'), daemon = join(service, 'MacOS', 'VMService');
    must('/usr/bin/clang', ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', join(fixture, 'client.m'), '-o', client]);
    must('/usr/bin/clang', ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', join(fixture, 'service.m'), '-o', daemon]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', join(contents, 'XPCServices', 'VMService.xpc')]);
    must('/usr/bin/codesign', ['--force', '--sign', '-', app]);
    const state = join(dir, 'state'), crash = join(dir, 'crash'); mkdirSync(state, { mode: 0o700 }); mkdirSync(crash, { mode: 0o700 });
    assert.match(must(client, ['state', state]), /open-no-dispatch/);
    assert.match(must(client, ['state', join(dir, 'missing')]), /^error\s*$/);
    assert.match(must(client, ['revoke', state]), /durable/);
    assert.match(must(client, ['state', state]), /fenced/);
    const interrupted = run(client, ['crash', crash]);
    assert.notEqual(interrupted.status, 0); assert.match(interrupted.stdout, /xpc-error/);
    assert.match(must(client, ['state', crash]), /fenced/);
    assert.match(must(client, ['revoke', crash]), /^error\s*$/);
    assert.match(must(client, ['state', crash]), /fenced/);
    const badApp = join(dir, 'WrongClient.app'); cpSync(app, badApp, { recursive: true });
    const badInfo = join(badApp, 'Contents', 'Info.plist');
    writeFileSync(badInfo, readFileSync(badInfo, 'utf8').replace('org.turnlink.vmfixture.client', 'org.turnlink.vmfixture.other'));
    must('/usr/bin/codesign', ['--force', '--sign', '-', badApp]);
    const rejected = run(join(badApp, 'Contents', 'MacOS', 'VMClient'), ['state', state]);
    assert.notEqual(rejected.status, 0); assert.match(rejected.stdout, /xpc-error/);
  });
