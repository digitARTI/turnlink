import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { sessionProof } from '../src/config.js';
import { readPrivate } from '../src/storage.js';

const A = '1'.repeat(64), B = '3'.repeat(64), C = '4'.repeat(64), ADMIN = '2'.repeat(64), WRONG = 'f'.repeat(64);
const reg = (id, channel = 'development') => ({ harness: 'opencode', sessionId: id, name: id,
  role: 'test worker', project: { name: 'test', root: '/test' }, channel });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function setup(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'turnlink-security-'));
  const broker = createBroker({ port: 0, directory, secret: A, adminSecret: ADMIN, hosts: [
    { hostId: 'alpha', credential: A, channels: ['development'], broadcast: true },
    { hostId: 'beta', credential: B, channels: ['development', 'private'], broadcast: true },
    { hostId: 'viewer', credential: C, channels: ['development'], broadcast: false },
  ], ...extra });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`;
  const clients = [], sockets = [];
  const client = credential => {
    const options = { url, token: credential, credentialDirectory: join(directory, `keys-${credential[0]}`) };
    const c = new ChannelClient(options); clients.push(c); return c;
  };
  const raw = async (credential = A, headers = {}) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${credential}`, ...headers } });
    sockets.push(socket); socket.on('error', () => {}); await once(socket, 'open');
    let id = 0;
    const call = (method, params = {}, v = 2) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error('Raw RPC timed out')); }, 2000);
      const listener = data => { clearTimeout(timeout); resolve(JSON.parse(data.toString())); };
      socket.once('message', listener); socket.send(JSON.stringify({ v, id: ++id, method, params }));
    });
    return { socket, call };
  };
  t.after(async () => { clients.forEach(c => c.close()); sockets.forEach(s => s.terminate()); await broker.close(); rmSync(directory, { recursive: true, force: true }); });
  return { broker, directory, client, raw, url };
}

test('host token alone cannot impersonate a sender, receiver, acknowledgement or leave', async t => {
  const s = await setup(t), a = s.client(A), b = s.client(B);
  await a.request('join', reg('a')); await b.request('join', reg('b'));
  const attacker = await s.raw(A);
  for (const [method, params] of [
    ['send', { agentId: 'opencode:a', proof: WRONG, to: 'opencode:b', text: 'forged', messageId: 'forged' }],
    ['subscribe', { agentId: 'opencode:a', proof: WRONG }],
    ['leave', { agentId: 'opencode:a', proof: WRONG }],
    ['ack', { agentId: 'opencode:a', proof: WRONG, id: '00000000-0000-4000-8000-000000000000' }],
  ]) assert.match((await attacker.call(method, params)).error, /ownership/);
  assert.equal(s.broker.store.messages.length, 0);
  assert.ok(s.broker.store.agents['opencode:a']);
});

test('a stolen session proof from another host is rejected and cannot reclaim a reserved name', async t => {
  const s = await setup(t), a = s.client(A);
  await a.request('join', reg('a')); await a.subscribe('opencode:a'); await a.unsubscribe('opencode:a');
  const deadline = s.broker.store.agents['opencode:a'].reservationExpiresAt;
  const proof = sessionProof('alpha', 'opencode:a', a.options.credentialDirectory, false);
  const attacker = await s.raw(B);
  assert.match((await attacker.call('subscribe', { agentId: 'opencode:a', proof })).error, /ownership/);
  assert.match((await attacker.call('join', { ...reg('a'), proof })).error, /ownership/);
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, deadline);
});

test('channel scope and membership are required for discovery, history and registration', async t => {
  const s = await setup(t), a = s.client(A), b = s.client(B);
  await a.request('join', reg('a')); await b.request('join', reg('private-agent', 'private'));
  await assert.rejects(a.request('members', { channel: 'private' }), /Channel access/);
  await assert.rejects(a.request('history', { channel: 'private' }), /Channel access/);
  await assert.rejects(a.request('join', reg('a', 'private')), /Channel access/);
  const outsider = await s.raw(A);
  assert.match((await outsider.call('members', { channel: 'development' })).error, /ownership/);
  assert.match((await outsider.call('history', { channel: 'development' })).error, /ownership/);
});

test('direct-message history is private to participants; broadcasts are visible to recipients', async t => {
  const s = await setup(t), a = s.client(A), b = s.client(B), c = s.client(C);
  await a.request('join', reg('a')); await b.request('join', reg('b')); await c.request('join', reg('c'));
  await a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'private answer', messageId: 'private' });
  assert.equal((await c.request('history', { channel: 'development' })).length, 0);
  await a.request('send', { agentId: 'opencode:a', to: '*', text: 'shared update', messageId: 'shared' });
  assert.equal((await c.request('history', { channel: 'development' })).length, 1);
  await assert.rejects(c.request('send', { agentId: 'opencode:c', to: '*', text: 'not allowed', messageId: 'denied' }), /Broadcast permission/);
});

test('credential revocation closes active sockets and rejects reconnect', async t => {
  const s = await setup(t), a = s.client(A), operator = s.client(ADMIN);
  await a.request('join', reg('a')); await a.subscribe('opencode:a');
  a.closed = true; // Disable automatic retry so the test can examine revocation.
  const disconnected = once(a, 'disconnected');
  await operator.request('revoke', { hostId: 'alpha' }); await disconnected;
  const fresh = s.client(A); await assert.rejects(fresh.connect(), /401/);
  const b = s.client(B); await assert.rejects(b.request('revoke', { hostId: 'alpha' }), /Administrative/);
});

test('host enrollment is administrative, hides credentials and enforces its channel scope', async t => {
  const s = await setup(t), operator = s.client(ADMIN), a = s.client(A);
  const params = { hostId: 'new-host', credential: WRONG, channels: ['private'], broadcast: false };
  await assert.rejects(a.request('enroll', params), /Administrative/);
  const result = await operator.request('enroll', params);
  assert.ok(!JSON.stringify(result).includes(WRONG));
  const enrolled = s.client(WRONG); await enrolled.request('join', reg('new', 'private'));
  await assert.rejects(enrolled.request('join', reg('new', 'development')), /Channel access/);
});

test('schema rejects unexpected fields, invalid identifiers and protocol downgrade without echoing secrets', async t => {
  const s = await setup(t), attacker = await s.raw();
  const echoedSecret = 'secret-that-must-not-appear';
  const response = await attacker.call('hello', { credential: echoedSecret });
  assert.match(response.error, /Invalid request/); assert.ok(!JSON.stringify(response).includes(echoedSecret));
  assert.match((await attacker.call('join', { ...reg('a:b'), proof: WRONG })).error, /Invalid request/);
  assert.match((await attacker.call('hello', {}, 1)).error, /Invalid request/);
});

test('oversized WebSocket frame closes only that connection, not the broker', async t => {
  const s = await setup(t), attacker = await s.raw();
  const closed = once(attacker.socket, 'close');
  attacker.socket.send('x'.repeat(70000)); await closed;
  const valid = s.client(B); await valid.request('join', reg('b'));
  assert.equal(s.broker.fault, null);
});

test('request rate limits contain a flood and another host can still operate', async t => {
  const s = await setup(t, { now: () => 100000 }), attacker = await s.raw();
  let limited = false;
  for (let i = 0; i < 45; i++) {
    const response = await attacker.call('hello');
    if (response.error?.includes('Rate limit')) { limited = true; break; }
  }
  assert.ok(limited);
  const b = s.client(B); await b.request('join', reg('b'));
});

test('pending queue and active-session budgets reject excess without crashing', async t => {
  const s = await setup(t, { limits: { pendingPerSession: 1, sessionsPerHost: 1 } });
  const a = s.client(A), b = s.client(B);
  await a.request('join', reg('a')); await b.request('join', reg('b'));
  await assert.rejects(a.request('join', reg('a2')), /session limit/);
  await a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'one', messageId: 'one' });
  await assert.rejects(a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'two', messageId: 'two' }), /queue limit/);
  assert.equal(s.broker.store.messages.length, 1); assert.equal(s.broker.fault, null);
});

test('idempotency mismatch is rejected; retry succeeds even after original recipient leaves', async t => {
  const s = await setup(t), a = s.client(A), b = s.client(B);
  await a.request('join', reg('a')); await b.request('join', reg('b'));
  const request = { agentId: 'opencode:a', to: 'opencode:b', text: 'one task', messageId: 'stable-key' };
  const accepted = await a.request('send', request);
  await b.request('leave', { agentId: 'opencode:b' });
  assert.equal((await a.request('send', request)).id, accepted.id);
  await assert.rejects(a.request('send', { ...request, text: 'different task' }), /different payload/);
});

test('second writer is rejected before changing state', async t => {
  const s = await setup(t), a = s.client(A); await a.request('join', reg('a'));
  const before = readFileSync(join(s.directory, 'store.json'), 'utf8');
  assert.throws(() => createBroker({ port: 0, directory: s.directory, secret: A, adminSecret: ADMIN }), error => error.code === 'ELOCKED');
  assert.equal(readFileSync(join(s.directory, 'store.json'), 'utf8'), before);
});

test('persistence failure produces no successful acknowledgement or receiver wake', async t => {
  let failWrites = false;
  const { atomicWrite } = await import('../src/storage.js');
  const s = await setup(t, { write: (path, data) => { if (failWrites) throw new Error('simulated disk full'); atomicWrite(path, data); } });
  const a = s.client(A), b = s.client(B);
  await a.request('join', reg('a')); await b.request('join', reg('b')); await b.subscribe('opencode:b');
  let received = 0; b.on('message', () => received++);
  failWrites = true;
  const sending = a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'uncommitted', messageId: 'disk-failure' });
  a.closed = true; b.closed = true; // In-flight request proceeds; reconnect is disabled.
  await assert.rejects(sending);
  await delay(20); assert.equal(received, 0); assert.ok(s.broker.fault);
  assert.equal(JSON.parse(readFileSync(join(s.directory, 'store.json'), 'utf8')).messages.length, 0);
});

test('insecure/symlink credential files and non-loopback plaintext endpoints are rejected', async t => {
  const s = await setup(t);
  const invalid = new ChannelClient({ url: 'ws://192.0.2.1:47321', token: A });
  await assert.rejects(invalid.connect(), /loopback/); invalid.close();
  const inUrl = new ChannelClient({ url: 'ws://127.0.0.1:47321?token=do-not-transmit', token: A });
  await assert.rejects(inUrl.connect(), /credentials, query/); inUrl.close();
  if (process.platform === 'win32') return;
  const file = join(s.directory, 'unsafe-token'); writeFileSync(file, A, { mode: 0o644 });
  assert.throws(() => readPrivate(file), /0600/);
  const link = join(s.directory, 'token-link'); symlinkSync(file, link);
  assert.throws(() => readPrivate(link), /regular file/);
});

test('released membership is not automatically rejoined after a control reconnect', async t => {
  const s = await setup(t), a = s.client(A), operator = s.client(ADMIN);
  await a.request('join', reg('a')); await a.subscribe('opencode:a');
  await operator.request('release', { channel: 'development', name: 'a' });
  await delay(20); assert.equal(a.registrations.size, 0);
  const disconnected = once(a, 'disconnected'); a.socket.terminate(); await disconnected;
  await delay(1000);
  assert.equal(s.broker.store.agents['opencode:a'], undefined);
});

test('session revocation invalidates a capability without disabling other sessions on the same host', async t => {
  const s = await setup(t), a = s.client(A), operator = s.client(ADMIN);
  await a.request('join', reg('a')); await a.request('join', reg('a2')); await a.subscribe('opencode:a');
  await operator.request('revoke_session', { agentId: 'opencode:a' });
  await assert.rejects(a.request('join', reg('a')), /revoked/);
  const peers = await a.request('members', { channel: 'development', agentId: 'opencode:a2' });
  assert.equal(peers.length, 1); assert.equal(peers[0].agentId, 'opencode:a2');
});

test('malformed input corpus cannot mutate registrations or crash the broker', async t => {
  const s = await setup(t);
  for (const payload of ['null', '[]', '42', '{', '{"v":2,"id":1,"method":"__proto__","params":{}}',
    '{"v":2,"id":1,"method":"join","params":{"harness":"codex","sessionId":"../victim","proof":"bad"}}']) {
    const attacker = await s.raw();
    const response = once(attacker.socket, 'message'); attacker.socket.send(payload);
    assert.match(JSON.parse((await response)[0].toString()).error, /Invalid request/);
    attacker.socket.close();
  }
  assert.equal(Object.keys(s.broker.store.agents).length, 0); assert.equal(s.broker.fault, null);
});

test('browser-origin connections are rejected even with a valid host credential', async t => {
  const s = await setup(t);
  await assert.rejects(s.raw(A, { Origin: 'https://untrusted.example' }), /401/);
});

test('delivery window bounds unacknowledged pushes and drains after acknowledgement', async t => {
  const s = await setup(t, { limits: { deliveryWindow: 2 } });
  const a = s.client(A), b = s.client(B);
  await a.request('join', reg('a')); await b.request('join', reg('b'));
  const received = []; b.on('message', message => received.push(message)); await b.subscribe('opencode:b');
  for (let i = 0; i < 5; i++) await a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: `task ${i}`, messageId: `window-${i}` });
  await delay(20); assert.equal(received.length, 2);
  await b.request('ack', { agentId: 'opencode:b', id: received[0].id });
  await delay(20); assert.equal(received.length, 3);
});
