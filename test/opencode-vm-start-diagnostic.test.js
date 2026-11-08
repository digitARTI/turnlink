import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { get as httpGet } from 'node:http';
import { startBrokerVMFixture } from './fixtures/codex-vm-xpc/broker-vm-fixture.js';
import { connectOpenCodeVMSupervisorFixture } from '../src/opencode-vm-supervisor-fixture-client.js';
import { createOpenCodeVMDaemonLease, openCodeVMDaemonScope } from '../src/opencode-vm-daemon-handshake.js';
import { createOpenCodeDaemonUnixProxy } from '../src/opencode-daemon-unix-proxy.js';

test('diagnose VM plugin start without automatic container removal',
  { skip: process.env.TURNLINK_OPENCODE_VM_START_DIAGNOSTIC !== '1', timeout: 180000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlvmd-'), socket = join(root, 'vm.sock');
    const name = 'turnlink-plugin-test-00000000-0000-4000-8000-000000000001', sessionID = 'ses_vm_fixture';
    const directory = '/private/tmp/turnlink-vm-source-fixture/project', image = 'sha256:e7145600e1f15f63c0e01ef7ff7da9b29f1467dd4c2dc8c78320762dae8ab690';
    const scope = openCodeVMDaemonScope({ grantScope: 'a'.repeat(64), image, name, sessionID, directory });
    const secret = readFileSync(process.env.TURNLINK_DOCKER_VM_KEY), diagnostics = [];
    let fixture, lease, proxy, child, stopped = false;
    try {
      fixture = await startBrokerVMFixture(root, { streamSocket: socket, diskBytes: 2 * 1024 ** 3 });
      const connect = kind => connectOpenCodeVMSupervisorFixture({ path: socket, kind });
      lease = await createOpenCodeVMDaemonLease({ controlStream: await connect('control'), connectAPI: () => connect('api'), secret, scope });
      let probe;
      for (let i = 0; i < 30 && !probe; i++) {
        try { probe = await lease.openStream(); } catch (error) { if (i === 29 || !lease.check()) throw error; await delay(100); }
      }
      probe.destroy();
      proxy = await createOpenCodeDaemonUnixProxy({ path: join(root, 'docker.sock'), openStream: lease.openStream,
        onDiagnostic: value => { if (diagnostics.length < 100) diagnostics.push(value); } });
      const reduced = process.env.TURNLINK_VM_CREATE_START_ONLY === '1';
      const docker = '/opt/homebrew/bin/docker', args = ['--host', proxy.endpoint, reduced ? 'create' : 'run', '-i', '--name', name,
        '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--entrypoint', '/usr/bin/env', image,
        '-i', 'TURNLINK_STREAM_IPC=1', 'NODE_NO_WARNINGS=1', '/usr/local/bin/turnlink-node', '--permission', '--allow-fs-read=/sealed',
        '--disallow-code-generation-from-strings', '--import', '/sealed/guard.mjs', '/sealed/plugin.mjs', 'unused', sessionID, directory];
      child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let createOutput = ''; if (reduced) child.stdout.on('data', chunk => { createOutput = (createOutput + chunk.toString()).slice(-128); }); else child.stdout.resume();
      child.stderr.resume();
      const exit = once(child, 'exit');
      const run = promisify(execFile); let startSucceeded;
      if (reduced) {
        const [createCode] = await exit; assert.equal(createCode, 0, 'Docker create must succeed');
        const containerID = createOutput.trim(); assert.match(containerID, /^[a-f0-9]{64}$/);
        try { await run(docker, ['--host', proxy.endpoint, 'start', containerID], { timeout: 30000, maxBuffer: 65536 }); startSucceeded = true; }
        catch { startSucceeded = false; }
      }
      for (let i = 0; i < 150 && !diagnostics.some(value => value === 'request:POST:containers/<id>/start'); i++) await delay(100);
      assert.ok(diagnostics.includes('request:POST:containers/<id>/start'), `start not reached: ${diagnostics.join(', ')}`);
      // Give the daemon's start response time to arrive; no container payload is logged.
      await delay(500);
      if (process.env.TURNLINK_VM_REVOKE_ACTIVE === '1') {
        assert.ok(diagnostics.includes('response:204:containers/<id>/start'), 'plugin must start before revocation');
        assert.equal(child.exitCode, null, 'plugin stream must be active');
        lease.close();
        const finished = await Promise.race([exit.then(() => true), delay(5000).then(() => false)]);
        assert.equal(finished, true, 'revocation must close the active Docker stream');
        await assert.rejects(lease.openStream(), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
        proxy.close(); proxy = undefined; lease = undefined; await fixture.close(); stopped = true;
        return;
      }
      let state;
      try {
        const result = await run(docker, ['--host', proxy.endpoint, 'inspect', '--format', '{{json .State}}', name], { timeout: 15000, maxBuffer: 65536 });
        const value = JSON.parse(result.stdout);
        const allowed = new Set('oci runtime runc containerd cgroup permission denied operation not permitted no such file directory executable found invalid argument mount seccomp network failed create start container user read write rootfs device error system process namespace initialize logging driver task shim binary unknown plugin overlay sandbox unix socket image layer readonly read-only capability unsupported apparmor sysctl workdir chdir marked removal removed already running paused exec format architecture stopped started created filesystem dead state was killed during init exit unexpected status code signal terminated eof connection closed deadline timeout'.split(' '));
        const errorCodes = (String(value.Error || '').toLowerCase().match(/[a-z-]+/g) || []).filter(word => allowed.has(word));
        state = { status: value.Status, running: value.Running, dead: value.Dead, exitCode: value.ExitCode, errorCodes };
      } catch { state = { status: 'unavailable' }; }
      const events = await new Promise((resolve, reject) => {
        const request = httpGet({ socketPath: join(root, 'docker.sock'), path: '/turnlink-fixture/events', timeout: 10000 }, response => {
          const chunks = []; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size > 4096) request.destroy(); else chunks.push(chunk); });
          response.once('end', () => { try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200 || !Array.isArray(value) || value.some(event => !['create', 'start', 'die', 'destroy'].includes(event))) throw new Error();
            resolve(value); } catch { reject(new Error('VM event observation unavailable')); } });
        });
        request.once('error', reject); request.once('timeout', () => request.destroy(new Error('VM event observation timeout')));
      });
      let sealStatus;
      if (process.env.TURNLINK_VM_VERIFY_SEAL === '1') {
        const script = "const f=require('node:fs'),c=require('node:crypto');const h=p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex');console.log(JSON.stringify({bundle:h('/sealed/plugin.mjs'),guard:h('/sealed/guard.mjs')}))";
        try {
          const id = (await run(docker, ['--host', proxy.endpoint, 'inspect', '--format', '{{.Id}}', name], { encoding: 'utf8', timeout: 15000 })).stdout.trim();
          if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid container identity');
          const result = await run(docker, ['--host', proxy.endpoint, 'exec', '--user=10001:10001', id, '/usr/local/bin/turnlink-node', '-e', script],
            { timeout: 30000, maxBuffer: 1024, encoding: 'utf8' });
          const text = result.stdout, info = { length: text.length, startsJson: text.trimStart().startsWith('{'),
            controls: [...text].filter(char => char.charCodeAt(0) < 32 && !'\n\r\t'.includes(char)).length, parsed: false, matches: false };
          try { const value = JSON.parse(text), manifest = JSON.parse(readFileSync(process.env.TURNLINK_PLUGIN_SEALED_MANIFEST, 'utf8'));
            info.parsed = true; info.matches = value.bundle === manifest.bundleSha256 && value.guard === manifest.guardSha256; } catch {}
          sealStatus = info;
        } catch { sealStatus = { exec: 'failed' }; }
      }
      t.diagnostic(`VM container state: ${JSON.stringify(state)}; events: ${JSON.stringify(events)}; startSucceeded: ${startSucceeded}; sealStatus: ${JSON.stringify(sealStatus)}; routes: ${diagnostics.join(', ')}`);
      child.stdin.end();
      const finished = await Promise.race([exit.then(() => true), delay(3000).then(() => false)]);
      if (!finished) { child.kill('SIGTERM'); await exit; }
      await run(docker, ['--host', proxy.endpoint, 'rm', '--force', name], { timeout: 15000 }).catch(() => {});
      proxy.close(); proxy = undefined; lease.close(); lease = undefined; await fixture.close(); stopped = true;
      assert.notEqual(state.status, 'unavailable', 'container state must be observed before the fixture closes');
      if (reduced) assert.equal(startSucceeded, true, 'reduced create/start workflow must succeed');
      if (process.env.TURNLINK_VM_VERIFY_SEAL === '1') assert.equal(sealStatus?.matches, true, 'plugin hashes must match the manifest');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      proxy?.close(); lease?.close(); secret.fill(0);
      if (fixture && !stopped) { await fixture.close(); stopped = true; }
      if (stopped) rmSync(root, { recursive: true, force: true });
    }
  });
