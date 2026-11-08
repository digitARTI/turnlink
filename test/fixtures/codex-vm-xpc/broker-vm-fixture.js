import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, ftruncateSync, mkdirSync, openSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

// Fixture only. The initramfs and key are disposable test inputs; a pinned
// input digest does not prove their provenance or isolation from this UID.
export function fixtureIdentifiers(id = randomUUID()) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  const suffix = id.replaceAll('-', '');
  return { client: `org.turnlink.vmfixture.client.${suffix}`, service: `org.turnlink.vmfixture.service.${suffix}` };
}
export function fixtureStartupPhase(output) {
  if (output.includes('daemon-ping-authenticated')) return 'bridge';
  if (output.includes('vm-started-fixture')) return 'guest-boot-or-image-load';
  return 'vm-start';
}
export async function confirmFixtureStop(requestStop, waitForServiceExit) {
  try {
    const result = await requestStop();
    if (!result || result.code !== 0) return false;
    await waitForServiceExit(result.output);
    return true;
  } catch { return false; }
}
export async function startBrokerVMFixture(root, { streamSocket, diskBytes = 256 * 1024 * 1024 } = {}) {
  const initrd = process.env.TURNLINK_DOCKER_VM_INITRD, hash = process.env.TURNLINK_DOCKER_VM_INITRD_SHA256, key = process.env.TURNLINK_DOCKER_VM_KEY;
  assert.ok(isAbsolute(initrd || '') && isAbsolute(key || '') && /^[a-f0-9]{64}$/.test(hash || ''));
  assert.equal(createHash('sha256').update(readFileSync(initrd)).digest('hex'), hash); assert.equal(readFileSync(key).length, 32);
  assert.ok(Number.isSafeInteger(diskBytes) && diskBytes >= 256 * 1024 * 1024 && diskBytes <= 4 * 1024 * 1024 * 1024);
  const space = statfsSync(root); assert.ok(space.bavail * space.bsize > diskBytes + 1024 * 1024 * 1024);
  const run = (cmd, args) => { const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 50000 }); assert.equal(result.status, 0, result.stderr || result.stdout); };
  const state = join(root, 'vm-state'), fence = join(root, 'vm-fence'); mkdirSync(state, { mode: 0o700 }); mkdirSync(fence, { mode: 0o700 });
  const app = join(root, 'VMClient.app'), contents = join(app, 'Contents'), service = join(contents, 'XPCServices', 'VMService.xpc', 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(service, 'MacOS'), { recursive: true });
  const fixture = resolve('test/fixtures/codex-vm-xpc'), ids = fixtureIdentifiers();
  writeFileSync(join(contents, 'Info.plist'), readFileSync(join(fixture, 'app.plist'), 'utf8').replace('org.turnlink.vmfixture.client', ids.client));
  writeFileSync(join(service, 'Info.plist'), readFileSync(join(fixture, 'service.plist'), 'utf8').replace('org.turnlink.vmfixture.service', ids.service));
  const client = join(contents, 'MacOS', 'VMClient'), daemon = join(service, 'MacOS', 'VMService'), disk = join(root, 'vm-disk.raw');
  const fd = openSync(disk, 'wx', 0o600); try { ftruncateSync(fd, diskBytes); } finally { closeSync(fd); }
  run('/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/mkfs.ext4', ['-q', '-F', disk]);
  const define = (name, value) => `-D${name}=${JSON.stringify(value)}`;
  const flags = ['-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'Virtualization', '-DTURNLINK_VM_FIXTURE=1', '-DTURNLINK_VM_DAEMON_FIXTURE=1',
    `-DTURNLINK_VM_EXPECTED_UID=${process.getuid()}`, define('TURNLINK_VM_STATE_DIR', state), define('TURNLINK_VM_FENCE_DIR', fence),
    define('TURNLINK_VM_KERNEL', '/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/nerdbox-kernel-arm64'),
    define('TURNLINK_VM_INITRD', initrd), define('TURNLINK_VM_DISK', disk), define('TURNLINK_VM_KEY', key),
    define('TURNLINK_VM_PEER_IDENTIFIER', ids.client), define('TURNLINK_VM_SERVICE_NAME', ids.service)];
  run('/usr/bin/clang', [...flags, join(fixture, 'system-client.m'), '-o', client]);
  run('/usr/bin/clang', [...flags, resolve('native/codex-vm-supervisor/supervisor.m'), '-o', daemon]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', resolve('test/fixtures/codex-vm-boundary-entitlements.plist'), join(contents, 'XPCServices', 'VMService.xpc')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  if (streamSocket !== undefined) assert.ok(isAbsolute(streamSocket) && Buffer.byteLength(streamSocket) < 100);
  const child = spawn(client, ['daemon-broker-bridge', ...(streamSocket ? [streamSocket] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; });
  const exited = once(child, 'close');
  let stopped = false;
  const waitForServiceExit = async output => {
    const match = output.match(/vm-stopped-fixture ([1-9][0-9]*)/);
    assert.ok(match, 'VM stop was not confirmed');
    const pid = Number(match[1]);
    for (let i = 0; i < 200; i++) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('fixture XPC service did not exit; retaining VM files');
  };
  const ready = () => output.includes('daemon-ping-authenticated') && (!streamSocket || output.includes(`vm-docker-bridge-ready ${streamSocket}\n`));
  for (let i = 0; i < (streamSocket ? 1200 : 400) && !ready() && child.exitCode === null && child.signalCode === null; i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!ready()) {
    const phase = fixtureStartupPhase(output);
    // A separate client can ask the same instance to stop even while the
    // original client is waiting for its guest ping. Never infer stop from EOF.
    const stopper = spawn(client, ['stop-fixture'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stoppedOutput = ''; stopper.stdout.on('data', data => { stoppedOutput += data; }); stopper.stderr.resume();
    const confirmed = await confirmFixtureStop(async () => {
      let timer;
      const stopResult = await Promise.race([once(stopper, 'close'), new Promise(resolve => { timer = setTimeout(() => resolve(null), 10000); })]);
      clearTimeout(timer);
      if (!stopResult) { stopper.kill('SIGKILL'); return null; }
      return { code: stopResult[0], output: stoppedOutput };
    }, waitForServiceExit);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    throw new Error(`VM fixture not ready: phase=${phase}; stop=${confirmed ? 'confirmed' : 'unconfirmed; retain files'}; output=${output}; errors=${errors}`);
  }
  return {
    ...(streamSocket ? { streamSocket } : {}),
    check() { return !stopped && child.exitCode === null && child.signalCode === null && !child.killed; },
    async revokeAndCrash() { child.stdin.write('revoke-crash\n'); const [code] = await exited;
      assert.equal(code, 0, errors); assert.match(output, /revocation-reply-lost/); },
    async recover() { const recovery = spawn(client, ['daemon-recover'], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
      recovery.stdout.on('data', data => { out += data; }); recovery.stderr.on('data', data => { err += data; });
      const [code] = await once(recovery, 'close'); assert.equal(code, 0, err); assert.match(out, /^guest-revoked-daemon-observed vm-stopped-fixture [1-9][0-9]*\s*$/);
      await waitForServiceExit(out); stopped = true; },
    async close() {
      if (stopped) return;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('fixture service state is uncertain; retaining VM files');
      child.stdin.write('stop\n'); const [code] = await exited; assert.equal(code, 0, errors);
      await waitForServiceExit(output); stopped = true;
    },
  };
}
