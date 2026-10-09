import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { privateTemp as mkdtempSync } from '../src/storage.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createBroker, NAME_RESERVATION_MS } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TOKEN = '1'.repeat(64), ADMIN = '2'.repeat(64);
async function eventually(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await delay(5); }
  throw new Error('Condition not reached');
}
const registration = (id, name = 'builder', channel = 'development') => ({ harness: 'opencode', sessionId: id,
  name, channel, role: 'implementation', project: { name: 'same-project', root: '/projects/same-project' } });
async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'channel-names-'));
  let time = 100000;
  const now = () => time;
  const options = { port: 0, secret: TOKEN, adminSecret: ADMIN, directory, now, sweepIntervalMs: 5 };
  let broker = createBroker(options);
  await once(broker.server, 'listening');
  const clients = [];
  const make = (admin = false) => {
    const c = new ChannelClient({ url: `ws://127.0.0.1:${broker.server.address().port}`, token: admin ? ADMIN : TOKEN, credentialDirectory: join(directory, 'credentials') });
    clients.push(c); return c;
  };
  t.after(async () => { clients.forEach(c => c.close()); await broker.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get broker() { return broker; }, make, get time() { return time; }, advance: ms => { time += ms; },
    restart: async () => {
      clients.forEach(c => c.close());
      await broker.close();
      broker = createBroker(options); await once(broker.server, 'listening');
    }, directory,
  };
}

test('unique channel names reject another session even in same project; normalization and channel scope', async t => {
  const s = await setup(t), a = s.make(), b = s.make();
  await a.request('join', registration('a', 'Builder'));
  await assert.rejects(b.request('join', registration('b', 'builder')), /claimed or reserved/);
  await assert.rejects(b.request('join', registration('b', 'Ｂｕｉｌｄｅｒ')), /claimed or reserved/);
  await b.request('join', registration('b', 'builder', 'other'));
  assert.equal((await a.request('members', { channel: 'development', agentId: 'opencode:a' })).length, 1);
  await a.request('join', { ...registration('a', 'Builder'), role: 'reviewer' });
  assert.equal(s.broker.store.agents['opencode:a'].role, 'reviewer');
  await assert.rejects(b.request('handoff', {}), /verified window/);
});

test('simultaneous name claims are atomic', async t => {
  const s = await setup(t), a = s.make(), b = s.make();
  const results = await Promise.allSettled([a.request('join', registration('a')), b.request('join', registration('b'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(Object.keys(s.broker.store.agents).length, 1);
});

test('idle connected agent does not expire; disconnect reserves exactly five minutes; reconnect cancels it', async t => {
  const s = await setup(t), a = s.make(), b = s.make();
  await a.request('join', registration('a'));
  await a.subscribe('opencode:a');
  s.advance(NAME_RESERVATION_MS * 3);
  assert.equal((await a.request('members', { channel: 'development' }))[0].nameState, 'claimed');
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, null);
  await a.unsubscribe('opencode:a');
  const deadline = s.time + NAME_RESERVATION_MS;
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, deadline);
  s.advance(NAME_RESERVATION_MS - 1);
  await assert.rejects(b.request('join', registration('b')), /reserved/);
  await a.subscribe('opencode:a');
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, null);
  s.advance(NAME_RESERVATION_MS * 2);
  assert.equal((await a.request('members', { channel: 'development' }))[0].connected, true);
});

test('socket loss starts reservation; disconnected joins cannot keep extending deadline', async t => {
  const s = await setup(t), a = s.make();
  await a.request('join', registration('a')); await a.subscribe('opencode:a');
  a.close();
  await eventually(() => s.broker.store.agents['opencode:a'].reservationExpiresAt != null);
  const deadline = s.broker.store.agents['opencode:a'].reservationExpiresAt;
  s.advance(100000);
  const c = s.make(); await c.request('join', registration('a'));
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, deadline);
});

test('expiry frees name and old owner cannot reclaim after another agent claims it', async t => {
  const s = await setup(t), a = s.make(), b = s.make();
  await a.request('join', registration('a'));
  s.advance(NAME_RESERVATION_MS);
  await eventually(() => !s.broker.store.agents['opencode:a']);
  await b.request('join', registration('b'));
  await assert.rejects(a.request('join', registration('a')), /claimed or reserved/);
  await assert.rejects(a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'old sender', messageId: 'expired' }), /Join before/);
});

test('explicit leave and authorized release free names immediately; release requires separate admin credential', async t => {
  const s = await setup(t), a = s.make(), b = s.make();
  await a.request('join', registration('a')); await a.subscribe('opencode:a');
  await a.request('leave', { agentId: 'opencode:a' });
  await b.request('join', registration('b'));
  await assert.rejects(a.request('release', { channel: 'development', name: 'builder' }), /authorization/);
  await assert.rejects(a.request('release', { channel: 'development', name: 'builder', adminToken: TOKEN }), /Invalid request/);
  const admin = s.make(true);
  await admin.request('release', { channel: 'development', name: 'BUILDER' });
  await a.request('join', registration('a'));
});

test('pending messages are cancelled on leave/expiry and cannot wake a rejoined session', async t => {
  const s = await setup(t), sender = s.make(), receiver = s.make();
  await sender.request('join', registration('sender', 'sender')); await sender.subscribe('opencode:sender');
  await receiver.request('join', registration('receiver'));
  const message = await sender.request('send', { agentId: 'opencode:sender', to: 'opencode:receiver', text: 'old task', messageId: 'old-task' });
  s.advance(NAME_RESERVATION_MS);
  await sender.request('members', { channel: 'development' });
  assert.equal(s.broker.store.messages[0].cancelled['opencode:receiver'], 'reservation_expired');
  await receiver.request('join', registration('receiver'));
  let received = 0; receiver.on('message', () => received++);
  await receiver.subscribe('opencode:receiver');
  await delay(20);
  assert.equal(received, 0);
  await assert.rejects(receiver.request('ack', { agentId: 'opencode:receiver', id: message.id }), /cancelled/);
});

test('reservation deadline survives restart without being extended', async t => {
  const s = await setup(t), a = s.make();
  await a.request('join', registration('a')); await a.subscribe('opencode:a');
  await a.unsubscribe('opencode:a');
  const deadline = s.broker.store.agents['opencode:a'].reservationExpiresAt;
  s.advance(120000); await s.restart();
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, deadline);
  s.advance(180000);
  const b = s.make(); await b.request('join', registration('b'));
  assert.equal(s.broker.store.agents['opencode:a'], undefined);
});

test('clean broker shutdown reserves active claims and a reconnect preserves them', async t => {
  const s = await setup(t), a = s.make();
  await a.request('join', registration('a')); await a.subscribe('opencode:a');
  await s.restart();
  const deadline = s.time + NAME_RESERVATION_MS;
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, deadline);
  const reconnect = s.make(); await reconnect.subscribe('opencode:a');
  assert.equal(s.broker.store.agents['opencode:a'].reservationExpiresAt, null);
});

test('startup after a crash expires a stale active snapshot using its persisted last heartbeat', async t => {
  const s = await setup(t), a = s.make();
  await a.request('join', registration('a')); await a.subscribe('opencode:a');
  const snapshot = JSON.parse(readFileSync(join(s.directory, 'store.json'), 'utf8'));
  assert.equal(snapshot.agents['opencode:a'].reservationExpiresAt, null);
  // Simulate an abrupt crash snapshot in a separate directory; no live writer shares it.
  const directory = mkdtempSync(join(tmpdir(), 'channel-crash-'));
  writeFileSync(join(directory, 'store.json'), JSON.stringify(snapshot), { mode: 0o600 });
  const broker = createBroker({ port: 0, secret: TOKEN, adminSecret: ADMIN, directory,
    now: () => s.time + NAME_RESERVATION_MS + 1 });
  await once(broker.server, 'listening');
  t.after(async () => { await broker.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(broker.store.agents['opencode:a'], undefined);
});
