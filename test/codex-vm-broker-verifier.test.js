import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';

test('dedicated-verifier client pins its XPC peer and rejects foreign, stale and lost responses',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1', timeout: 60000 }, t => {
    const root = privateTemp('/private/tmp/turnlink-broker-verifier-');
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = resolve('test/fixtures/codex-broker-verifier');
    const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
    const must = (command, args) => { const result = run(command, args); assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; };
    const app = (name, verifierID) => {
      const contents = join(root, `${name}.app`, 'Contents'), service = join(contents, 'XPCServices', 'BrokerVerifier.xpc', 'Contents');
      mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(service, 'MacOS'), { recursive: true });
      copyFileSync(resolve('test/fixtures/codex-vm-xpc/app.plist'), join(contents, 'Info.plist'));
      copyFileSync(join(source, 'service.plist'), join(service, 'Info.plist'));
      const client = join(contents, 'MacOS', 'VMClient');
      const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=1',
        '-DTURNLINK_BROKER_VERIFIER_SERVICE="org.turnlink.brokerfixture.service"', `-DTURNLINK_BROKER_VERIFIER_IDENTIFIER="${verifierID}"`];
      must('/usr/bin/clang', [...flags, join(source, 'client.m'), resolve('native/codex-vm-supervisor/broker-verifier-client.m'), '-o', client]);
      must('/usr/bin/clang', [...flags, join(source, 'service.m'), '-o', join(service, 'MacOS', 'BrokerVerifier')]);
      must('/usr/bin/codesign', ['--force', '--sign', '-', join(contents, 'XPCServices', 'BrokerVerifier.xpc')]);
      must('/usr/bin/codesign', ['--force', '--sign', '-', join(root, `${name}.app`)]); return client;
    };
    const client = app('Good', 'org.turnlink.brokerfixture.service');
    assert.match(must(client, ['valid']), /^authorized-snapshot\s*$/);
    assert.match(must(client, ['foreign']), /^unavailable\s*$/);
    assert.match(must(client, ['nonce']), /^unavailable\s*$/);
    const wrong = app('Wrong', 'org.turnlink.brokerfixture.other');
    assert.match(must(wrong, ['valid']), /^unavailable\s*$/);
    assert.match(must(client, ['crash']), /^unavailable\s*$/);
  });

test('separate verifier rechecks its pinned broker peer for every request',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1', timeout: 60000 }, t => {
    const root = privateTemp('/private/tmp/turnlink-grant-verifier-');
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const run = (command, args) => { const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; };
    const contents = join(root, 'Fixture.app', 'Contents'), broker = join(contents, 'XPCServices', 'BrokerVerifier.xpc', 'Contents');
    const verifier = join(contents, 'XPCServices', 'GrantVerifier.xpc', 'Contents');
    for (const path of [join(contents, 'MacOS'), join(broker, 'MacOS'), join(verifier, 'MacOS')]) mkdirSync(path, { recursive: true });
    copyFileSync(resolve('test/fixtures/codex-vm-xpc/app.plist'), join(contents, 'Info.plist'));
    copyFileSync(resolve('test/fixtures/codex-broker-verifier/service.plist'), join(broker, 'Info.plist'));
    const plist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.turnlink.grantfixture.service</string><key>CFBundleExecutable</key><string>GrantVerifier</string><key>CFBundlePackageType</key><string>XPC!</string><key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict></dict></plist>';
    writeFileSync(join(verifier, 'Info.plist'), plist);
    const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=1'];
    const define = (key, value) => `-D${key}=${JSON.stringify(value)}`;
    const client = join(contents, 'MacOS', 'VMClient');
    run('/usr/bin/clang', [...flags, '-DTURNLINK_FIXTURE_SETUP_PROXY=1', define('TURNLINK_BROKER_VERIFIER_SERVICE', 'org.turnlink.grantfixture.service'),
      define('TURNLINK_BROKER_VERIFIER_IDENTIFIER', 'org.turnlink.grantfixture.service'), resolve('test/fixtures/codex-broker-verifier/client.m'),
      resolve('native/codex-vm-supervisor/broker-verifier-client.m'), '-o', client]);
    run('/usr/bin/clang', [...flags, '-DTURNLINK_FIXTURE_BROKER_PROXY=1', resolve('test/fixtures/codex-broker-verifier/service.m'), '-o', join(broker, 'MacOS', 'BrokerVerifier')]);
    run('/usr/bin/clang', [...flags, `-DTURNLINK_GRANT_EXPECTED_UID=${process.getuid()}`,
      define('TURNLINK_GRANT_SERVICE_NAME', 'org.turnlink.grantfixture.service'), define('TURNLINK_GRANT_CLIENT_IDENTIFIER', 'org.turnlink.vmfixture.client'),
      define('TURNLINK_BROKER_VERIFIER_SERVICE', 'org.turnlink.brokerfixture.service'), define('TURNLINK_BROKER_VERIFIER_IDENTIFIER', 'org.turnlink.brokerfixture.service'),
      resolve('native/codex-vm-supervisor/broker-verifier-service.m'), resolve('native/codex-vm-supervisor/broker-verifier-client.m'), '-o', join(verifier, 'MacOS', 'GrantVerifier')]);
    const leaseProbe = join(contents, 'MacOS', 'LeaseProbe');
    run('/usr/bin/clang', [...flags, define('TURNLINK_BROKER_LEASE_SERVICE', 'org.turnlink.grantfixture.service'),
      define('TURNLINK_BROKER_LEASE_IDENTIFIER', 'org.turnlink.grantfixture.service'), resolve('test/fixtures/codex-broker-verifier/lease-client.m'),
      resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', leaseProbe]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.vmfixture.client', leaseProbe]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', join(contents, 'XPCServices', 'BrokerVerifier.xpc')]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', join(contents, 'XPCServices', 'GrantVerifier.xpc')]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', join(root, 'Fixture.app')]);
    const lease = spawnSync(leaseProbe, ['hold'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(lease.status, 3, 'review verifier must not issue a retained lease');
    assert.match(run(client, ['valid']), /^authorized-snapshot\s*$/);
    assert.match(run(client, ['foreign']), /^unavailable\s*$/);
    assert.match(run(client, ['nonce']), /^unavailable\s*$/);
    assert.match(run(client, ['crash']), /^unavailable\s*$/);
  });

test('retained XPC observations invalidate on verifier crash and explicit revocation',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_XPC_PROBE !== '1', timeout: 60000 }, t => {
    const root = privateTemp('/private/tmp/turnlink-broker-lease-xpc-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const contents = join(root, 'Fixture.app', 'Contents'), service = join(contents, 'XPCServices', 'Lease.xpc', 'Contents');
    mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(service, 'MacOS'), { recursive: true });
    copyFileSync(resolve('test/fixtures/codex-vm-xpc/app.plist'), join(contents, 'Info.plist'));
    writeFileSync(join(service, 'Info.plist'), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.turnlink.leasefixture.service</string><key>CFBundleExecutable</key><string>Lease</string><key>CFBundlePackageType</key><string>XPC!</string><key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict></dict></plist>');
    const run = (command, args) => { const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; };
    const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=1',
      '-DTURNLINK_BROKER_LEASE_SERVICE="org.turnlink.leasefixture.service"', '-DTURNLINK_BROKER_LEASE_IDENTIFIER="org.turnlink.leasefixture.service"'];
    const client = join(contents, 'MacOS', 'VMClient');
    run('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/lease-client.m'), resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', client]);
    run('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/lease-service.m'), '-o', join(service, 'MacOS', 'Lease')]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', join(contents, 'XPCServices', 'Lease.xpc')]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', join(root, 'Fixture.app')]);
    assert.match(run(client, ['crash']), /^invalidated\s*$/);
    assert.match(run(client, ['revoke']), /^invalidated\s*$/);
  });
