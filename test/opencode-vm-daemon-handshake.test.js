import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { authenticateOpenCodeVMDaemonStream, createOpenCodeVMDaemonLease, openCodeVMDaemonScope } from '../src/opencode-vm-daemon-handshake.js';
import { createOpenCodeDaemonUnixProxy } from '../src/opencode-daemon-unix-proxy.js';
import { privateTemp } from '../src/storage.js';

const secret = Buffer.alloc(32, 7), scope = 'a'.repeat(64);
const mac = (key, domain, challenge, nonce) => createHmac('sha256', key)
  .update(`${domain}\0${scope}\0${challenge}\0${nonce}`).digest('hex');

test('VM scope binds grant, image, container, session and directory', () => {
  const fields = { grantScope: 'a'.repeat(64), image: `sha256:${'b'.repeat(64)}`,
    name: 'turnlink-plugin-test-00000000-0000-4000-8000-000000000001', sessionID: 'ses_fixture', directory: '/synthetic' };
  const expected = createHash('sha256').update(`turnlink-vm-docker-scope-v1\0${fields.grantScope}\0${fields.image}\0${fields.name}\0${fields.sessionID}\0${fields.directory}`).digest('hex');
  assert.equal(openCodeVMDaemonScope(fields), expected);
  for (const [key, value] of Object.entries({ grantScope: 'A'.repeat(64), image: 'sha256:invalid', name: 'other', sessionID: 'other', directory: '/x\0y' }))
    assert.throws(() => openCodeVMDaemonScope({ ...fields, [key]: value }), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
  assert.notEqual(openCodeVMDaemonScope({ ...fields, directory: '/other' }), expected);
});

async function fixture(t, mode, onPeer) {
  const server = createServer(socket => {
    onPeer?.(socket);
    const challenge = randomBytes(32).toString('hex');
    if (mode === 'oversized') { socket.write('x'.repeat(513) + '\n'); return; }
    socket.write(JSON.stringify({ version: 1, type: 'challenge', scope: mode === 'scope' ? 'wrong' : scope, challenge }) + '\n');
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      if (buffer === null) { socket.write(data); return; }
      buffer = Buffer.concat([buffer, data]); const newline = buffer.indexOf(10); if (newline < 0) return;
      const message = JSON.parse(buffer.subarray(0, newline));
      const requestDomain = mode === 'lease' ? 'turnlink-vm-docker-lease-v1' : 'turnlink-vm-docker-v1';
      const readyDomain = mode === 'lease' ? 'turnlink-vm-docker-lease-ready-v1' : 'turnlink-vm-docker-ready-v1';
      assert.equal(message.tag, mac(secret, requestDomain, challenge, message.nonce));
      const tag = mac(mode === 'bad-ready' ? Buffer.alloc(32) : secret, readyDomain, challenge, message.nonce);
      socket.write(JSON.stringify({ version: 1, type: 'ready', scope, tag }) + '\n'); buffer = null;
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return createConnection(server.address().port, '127.0.0.1');
}

test('VM daemon handshake authenticates both peers and preserves the raw stream', async t => {
  const stream = await fixture(t), controller = new AbortController(); t.after(() => stream.destroy());
  assert.equal(await authenticateOpenCodeVMDaemonStream({ stream, secret, scope, signal: controller.signal }), stream);
  const response = once(stream, 'data'); stream.write('synthetic'); assert.equal((await response)[0].toString(), 'synthetic');
  const closed = once(stream, 'close'); controller.abort(); await closed;
});

test('VM control lease revokes all API streams on unexpected control traffic', async t => {
  let controlPeer;
  const controlStream = await fixture(t, 'lease', peer => { controlPeer = peer; });
  const lease = await createOpenCodeVMDaemonLease({ controlStream, secret, scope, connectAPI: () => fixture(t) });
  const first = await lease.openStream(), second = await lease.openStream();
  const firstClosed = once(first, 'close'), secondClosed = once(second, 'close');
  controlPeer.write('unexpected'); await Promise.all([firstClosed, secondClosed]);
  assert.equal(lease.check(), false); await assert.rejects(lease.openStream(), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
  lease.close();
});

test('VM lease bounds pending connections and revocation rejects them and destroys late streams', async t => {
  const controlStream = await fixture(t, 'lease'), pending = [];
  const lease = await createOpenCodeVMDaemonLease({ controlStream, secret, scope, connectAPI: () => new Promise(resolve => pending.push(resolve)) });
  const attempts = Array.from({ length: 64 }, () => lease.openStream().catch(error => error));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 64);
  await assert.rejects(lease.openStream(), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
  lease.close();
  const results = await Promise.all(attempts);
  assert.ok(results.every(error => /VM_DAEMON_HANDSHAKE_UNAVAILABLE/.test(error.message)));
  let destroyed = 0;
  for (const resolve of pending) resolve({ destroy() { destroyed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyed, 64);
});

test('VM lease does not start a deferred connection after revocation', async t => {
  const controlStream = await fixture(t, 'lease'); let calls = 0;
  const lease = await createOpenCodeVMDaemonLease({ controlStream, secret, scope, connectAPI: () => { calls++; } });
  const result = lease.openStream(); lease.close();
  await assert.rejects(result, /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 0);
});

test('VM daemon handshake rejects wrong scope, bad ready MAC, oversized frames and revocation', async t => {
  for (const mode of ['scope', 'bad-ready', 'oversized']) {
    const stream = await fixture(t, mode); await assert.rejects(authenticateOpenCodeVMDaemonStream({ stream, secret, scope }), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
    assert.equal(stream.destroyed, true);
  }
  const stream = await fixture(t, 'scope'), controller = new AbortController(); controller.abort();
  await assert.rejects(authenticateOpenCodeVMDaemonStream({ stream, secret, scope, signal: controller.signal }), /VM_DAEMON_HANDSHAKE_UNAVAILABLE/);
  stream.destroy();
});

test('revocation interrupts a handshake waiting for the guest', async t => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const accepted = once(server, 'connection'), stream = createConnection(server.address().port, '127.0.0.1');
  const [peer] = await accepted; t.after(() => peer.destroy());
  const controller = new AbortController(), pending = authenticateOpenCodeVMDaemonStream({ stream, secret, scope, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /VM_DAEMON_HANDSHAKE_UNAVAILABLE/); assert.equal(stream.destroyed, true);
});

test('authenticated VM stream can back the revocable Unix proxy', async t => {
  const root = privateTemp('/private/tmp/tlvh-'), controller = new AbortController();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const proxy = await createOpenCodeDaemonUnixProxy({ path: join(root, 'daemon.sock'), signal: controller.signal,
    openStream: async () => authenticateOpenCodeVMDaemonStream({ stream: await fixture(t), secret, scope, signal: controller.signal }) });
  t.after(() => proxy.close());
  const client = createConnection(join(root, 'daemon.sock')), second = createConnection(join(root, 'daemon.sock'));
  await Promise.all([once(client, 'connect'), once(second, 'connect')]);
  const response = once(client, 'data'); client.write('synthetic Docker bytes');
  assert.equal((await response)[0].toString(), 'synthetic Docker bytes');
  const closed = once(client, 'close'); client.destroy(); await closed;
  const otherResponse = once(second, 'data'); second.write('second connection');
  assert.equal((await otherResponse)[0].toString(), 'second connection');
  const otherClosed = once(second, 'close'); controller.abort(); await otherClosed; assert.equal(proxy.check(), false);
});
