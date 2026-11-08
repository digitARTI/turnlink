import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Test-only XPC app. Its Unix bridge is same-UID and is not a trust boundary.
export function buildBrokerLeaseFixture(root, bridgePath) {
  const contents = join(root, 'Fixture.app', 'Contents'), service = join(contents, 'XPCServices', 'Lease.xpc', 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(service, 'MacOS'), { recursive: true });
  copyFileSync(resolve('test/fixtures/codex-vm-xpc/app.plist'), join(contents, 'Info.plist'));
  writeFileSync(join(service, 'Info.plist'), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.turnlink.leasefixture.service</string><key>CFBundleExecutable</key><string>Lease</string><key>CFBundlePackageType</key><string>XPC!</string><key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict></dict></plist>');
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=1',
    '-DTURNLINK_BROKER_LEASE_SERVICE="org.turnlink.leasefixture.service"', '-DTURNLINK_BROKER_LEASE_IDENTIFIER="org.turnlink.leasefixture.service"'];
  const client = join(contents, 'MacOS', 'VMClient');
  run('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/lease-client.m'), resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', client]);
  run('/usr/bin/clang', [...flags, `-DTURNLINK_BRIDGE_EXPECTED_UID=${process.getuid()}`,
    '-DTURNLINK_BRIDGE_SERVICE_NAME="org.turnlink.leasefixture.service"', '-DTURNLINK_BRIDGE_CLIENT_IDENTIFIER="org.turnlink.vmfixture.client"',
    `-DTURNLINK_FIXTURE_BROKER_BRIDGE_PATH=${JSON.stringify(bridgePath)}`,
    resolve('native/codex-vm-supervisor/protected-broker-bridge.m'), '-o', join(service, 'MacOS', 'Lease')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', join(contents, 'XPCServices', 'Lease.xpc')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', join(root, 'Fixture.app')]);
  return client;
}

// Exercises exactly fd 3 with a local anonymous XPC listener; ad-hoc identity
// and same-UID fixture are not a production signature or two-UID proof.
export function buildInheritedBrokerBridge(root) {
  const binary = join(root, 'grantbridge');
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=1', '-DTURNLINK_BRIDGE_INHERITED_TEST=1',
    `-DTURNLINK_BRIDGE_EXPECTED_UID=${process.getuid()}`, '-DTURNLINK_BRIDGE_SERVICE_NAME="org.turnlink.leasefixture.service"',
    '-DTURNLINK_BRIDGE_CLIENT_IDENTIFIER="org.turnlink.vmfixture.client"', '-DTURNLINK_BROKER_LEASE_SERVICE="org.turnlink.leasefixture.service"',
    '-DTURNLINK_BROKER_LEASE_IDENTIFIER="org.turnlink.vmfixture.client"'];
  run('/usr/bin/clang', [...flags, resolve('native/codex-vm-supervisor/protected-broker-bridge.m'),
    resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', binary]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.vmfixture.client', binary]);
  return binary;
}

// Test-only launchd parent, with the real broker started as its child. The
// ad-hoc signing and same UID are not production identity or isolation.
export function buildLaunchdBrokerFixture(root, label, configPath, packagedPath, testRoot) {
  const bridge = join(root, 'bridge'), client = join(root, 'probe'), plist = join(root, 'job.plist');
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const def = (key, value) => `-D${key}=${JSON.stringify(value)}`;
  const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-DTURNLINK_BROKER_VERIFIER_FIXTURE=0',
    '-DTURNLINK_BRIDGE_LAUNCHD_TEST=1', '-DTURNLINK_BROKER_LEASE_USER_DOMAIN_TEST=1', '-DTURNLINK_BRIDGE_LAUNCHD_PARENT_TEST=1',
    `-DTURNLINK_BRIDGE_EXPECTED_UID=${process.getuid()}`, def('TURNLINK_BRIDGE_SERVICE_NAME', label),
    def('TURNLINK_BRIDGE_CLIENT_IDENTIFIER', 'org.turnlink.vmfixture.client'), def('TURNLINK_BRIDGE_CLIENT_TEAM', 'ABCDE12345'),
    def('TURNLINK_BROKER_LEASE_SERVICE', label), def('TURNLINK_BROKER_LEASE_IDENTIFIER', 'org.turnlink.bridge.fixture'),
    def('TURNLINK_BROKER_LEASE_TEAM', 'ABCDE12345'), def('TURNLINK_FIXTURE_NODE', process.execPath),
    def('TURNLINK_FIXTURE_BROKER_SCRIPT', resolve('test/fixtures/codex-launchd-broker-child.js')), def('TURNLINK_FIXTURE_BROKER_CONFIG', configPath),
    ...(packagedPath ? ['-DTURNLINK_FIXTURE_PACKAGED_BROKER=1', def('TURNLINK_FIXTURE_PACKAGED_PATH', packagedPath),
      def('TURNLINK_FIXTURE_TEST_ROOT', testRoot), def('TURNLINK_FIXTURE_TEST_UID', String(process.getuid())),
      def('TURNLINK_FIXTURE_TEST_LOG', join(testRoot, 'package-ready.log'))] : [])];
  run('/usr/bin/clang', [...flags, resolve('native/codex-vm-supervisor/protected-broker-bridge.m'), '-o', bridge]);
  run('/usr/bin/clang', [...flags, resolve('test/fixtures/codex-broker-verifier/lease-client.m'),
    resolve('native/codex-vm-supervisor/broker-lease-client.m'), '-o', client]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.bridge.fixture', bridge]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '-i', 'org.turnlink.vmfixture.client', client]);
  let environment = '';
  if (process.env.TURNLINK_TEST_PROTECTED_PRELOAD === '1') {
    const script = join(root, 'preload.cjs'), marker = join(root, 'preload-executed');
    writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'fixture')`, { mode: 0o600 });
    environment = `<key>EnvironmentVariables</key><dict><key>NODE_OPTIONS</key><string>--require=${script}</string></dict>`;
  }
  writeFileSync(plist, `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${bridge}</string></array><key>RunAtLoad</key><true/>${environment}<key>MachServices</key><dict><key>${label}</key><true/></dict></dict></plist>`, { mode: 0o600 });
  run('/usr/bin/plutil', ['-lint', plist]); return { bridge, client, plist };
}
