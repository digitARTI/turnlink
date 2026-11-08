import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startBrokerVMFixture } from './fixtures/codex-vm-xpc/broker-vm-fixture.js';
import { connectOpenCodeVMSupervisorFixture } from '../src/opencode-vm-supervisor-fixture-client.js';
import { authenticateOpenCodeVMDaemonStream, createOpenCodeVMDaemonLease } from '../src/opencode-vm-daemon-handshake.js';

test('fixture VM authenticates a scoped Docker stream, rejects an unlisted API and closes on revocation',
  { skip: process.env.TURNLINK_OPENCODE_VM_RELAY_TEST !== '1', timeout: 180000 }, async () => {
    const root = mkdtempSync('/private/tmp/tl-vm-'), socket = join(root, 'vm.sock');
    const secret = readFileSync(process.env.TURNLINK_DOCKER_VM_KEY);
    const scope = 'aed0f36e9cbab5f3d63f076fc93fd2675966abb59dcd6390e736c94915f6c090';
    let fixture, lease, stopped = false;
    const connect = kind => connectOpenCodeVMSupervisorFixture({ path: socket, kind });
    const request = async path => {
      let stream;
      // No HTTP request is sent during this bounded listener-readiness retry.
      for (let i = 0; i < 30 && !stream; i++) {
        try { stream = await lease.openStream(); }
        catch (error) { if (i === 29 || !lease.check()) throw error; await delay(100); }
      }
      const chunks = [];
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { stream.destroy(); reject(new Error('fixture API timeout')); }, 10000);
        stream.on('data', chunk => chunks.push(chunk));
        stream.once('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
        stream.once('error', error => { clearTimeout(timer); reject(error); });
      });
      stream.write(`GET ${path} HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n`);
      return completed;
    };
    try {
      fixture = await startBrokerVMFixture(root, { streamSocket: socket, diskBytes: 2 * 1024 ** 3 });
      const control = await connect('control');
      lease = await createOpenCodeVMDaemonLease({ controlStream: control, connectAPI: () => connect('api'), secret, scope });
      assert.match(await request('/_ping'), /^HTTP\/1\.[01] 200 /);
      assert.match(await request('/containers/json'), /^HTTP\/1\.[01] 403 /);
      lease.close();
      await assert.rejects(lease.openStream(), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
      await delay(250);
      const afterRevocation = await connect('api');
      await assert.rejects(authenticateOpenCodeVMDaemonStream({ stream: afterRevocation, secret, scope, timeoutMs: 2000 }), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
      await fixture.close(); stopped = true;
    } finally {
      lease?.close(); secret.fill(0);
      if (fixture && !stopped) { await fixture.close(); stopped = true; }
      if (stopped) rmSync(root, { recursive: true, force: true });
    }
  });
