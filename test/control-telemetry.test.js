import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { ControlGateway } from '../src/control/gateway.js';
import { ControlArchives } from '../src/control/archives.js';
import { RETENTION_MS } from '../src/control/contracts.js';
import { Activity } from '../src/control/telemetry-contracts.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64);
const rootFor = t => { const root = privateTemp(join(tmpdir(), 'turnlink-telemetry-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const observation = (extra = {}) => ({ id: randomUUID(), runID: randomUUID(), at: 1000, channel: 'dev', agentId: 'opencode:a', type: 'member.joined', ...extra });
const storeFor = (t, options) => { const root = rootFor(t), store = new ControlStore(join(root, 'control'), options); t.after(() => store.close()); return { store, root }; };

test('activity is strictly metadata-only and cannot accept payload, credential or exception fields', t => {
  const { store } = storeFor(t);
  for (const key of ['text', 'proof', 'credential', 'headers', 'error', 'project', 'input', 'prompt', 'name'])
    assert.throws(() => store.recordActivity(observation({ [key]: 'sensitive payload' })));
  assert.throws(() => Activity.parse(observation({ type: 'message.queued' })));
  assert.throws(() => Activity.parse(observation({ messageID: randomUUID() })));
  assert.throws(() => Activity.parse(observation({ type: 'member.removed' })));
  assert.equal(store.activityStatus().rows, 0);
  assert.equal(store.recordActivity(observation()), true); assert.equal(store.activityStatus().rows, 1);
});

test('30-day pruning retains protected message records, preserves receipt evidence and uses strict cutoff', t => {
  const { store } = storeFor(t), pinned = randomUUID(), expired = randomUUID();
  const row = messageID => observation({ type: 'message.queued', messageID });
  store.recordActivity(row(pinned)); store.recordActivity(row(expired)); store.recordActivity(observation());
  store.recordActivity(observation({ at: 1001 }));
  store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, { actor: { kind: 'operator' }, now: 1000, members: [] });
  const before = store.snapshot(), receipts = store.db.prepare('SELECT count(*) AS n FROM commands').get().n;
  assert.equal(store.pruneActivity(RETENTION_MS + 1001, [pinned]), 2);
  const remaining = store.activity('dev').entries;
  assert.equal(remaining.length, 2); assert.ok(remaining.some(r => r.messageID === pinned));
  assert.ok(!remaining.some(r => r.messageID === expired));
  assert.deepEqual(store.snapshot(), before); assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n, receipts);
  assert.equal(store.pruneActivity(RETENTION_MS + 1002, []), 2);
});

test('retention and recording reject clock regression or unknown protection sets without deleting data', t => {
  const { store } = storeFor(t); store.recordActivity(observation());
  assert.throws(() => store.pruneActivity(999, []), /CLOCK_REGRESSION/);
  assert.throws(() => store.recordActivity(observation({ at: 999 })), /CLOCK_REGRESSION/);
  assert.throws(() => store.pruneActivity(RETENTION_MS + 1001, undefined), /INVALID_ACTIVITY_PROTECTION/);
  assert.throws(() => store.pruneActivity(RETENTION_MS + 1001, ['not-a-uuid']));
  assert.equal(store.activityStatus().rows, 1);
});

test('retention failures roll back deletion and metadata together without consuming protected history', t => {
  const { store } = storeFor(t); store.recordActivity(observation()); const before = store.activityStatus();
  store.beforeCommit = () => { throw new Error('injected retention commit failure'); };
  assert.throws(() => store.pruneActivity(RETENTION_MS + 1001, [], 2), /injected retention commit failure/);
  assert.deepEqual(store.activityStatus(), before); assert.equal(store.activity('dev').entries.length, 1);
  store.beforeCommit = () => {};
  assert.equal(store.pruneActivity(RETENTION_MS + 1001, []), 1);
});

test('corrupt indexed activity cannot be read or exported as valid evidence', t => {
  const { store, root } = storeFor(t), row = observation(); store.recordActivity(row);
  store.db.prepare('UPDATE activity SET at=? WHERE id=?').run(row.at + 1, row.id);
  assert.throws(() => store.activity('dev'), /INVALID_ACTIVITY_RECORD/);
  const archives = new ControlArchives(join(root, 'exports')), id = randomUUID();
  assert.throws(() => store.exportTo(archives, id, 2000), /INVALID_ACTIVITY_RECORD/);
  assert.throws(() => archives.describe(id), /CONTROL_EXPORT_INCOMPLETE/);
  assert.equal(store.activityStatus().rows, 1, 'an export failure must never repair/delete live records');
});

test('telemetry capacity refuses new records without evicting protected or unexpired history and persists rejection counts', t => {
  const { store, root } = storeFor(t, { telemetryLimit: 2 });
  store.recordActivity(observation()); store.recordActivity(observation());
  assert.equal(store.recordActivity(observation()), false);
  assert.equal(store.activityStatus().rows, 2); assert.equal(store.activityStatus().rejected, 1);
  store.close();
  const reopened = new ControlStore(join(root, 'control'), { telemetryLimit: 2 }); t.after(() => reopened.close());
  assert.equal(reopened.activityStatus().rejected, 1);
  reopened.pruneActivity(RETENTION_MS + 1001, []);
  assert.equal(reopened.recordActivity(observation({ at: RETENTION_MS + 1001 })), true);
  assert.equal(reopened.activityStatus().rejected, 1, 'recovery must not silently erase a known coverage gap');
});

test('activity cursors are monotonic after pruning/restart, channel-scoped and bounded', t => {
  const { store, root } = storeFor(t); store.recordActivity(observation());
  store.recordActivity(observation({ channel: 'other' })); store.recordActivity(observation());
  const first = store.activity('dev', { limit: 1 }); assert.equal(first.entries.length, 1);
  assert.equal(store.activity('dev', { after: first.next }).entries.length, 1);
  const last = store.activity('dev').next;
  store.pruneActivity(RETENTION_MS + 1001, []); store.close();
  const reopened = new ControlStore(join(root, 'control')); t.after(() => reopened.close());
  reopened.recordActivity(observation({ at: RETENTION_MS + 1001 }));
  assert.ok(reopened.activity('dev', { after: last }).next > last);
  assert.throws(() => reopened.activity('dev', { limit: 101 }), /INVALID_EVENT_PAGE/);
  assert.throws(() => reopened.activity('dev', { after: -1 }));
});

test('activity exports include metadata and loss counters and survive archive revalidation', t => {
  const { store, root } = storeFor(t, { telemetryLimit: 1 }); store.recordActivity(observation()); store.recordActivity(observation());
  const archives = new ControlArchives(join(root, 'exports')), id = randomUUID(); store.exportTo(archives, id, 1001);
  const rows = readFileSync(archives.path(id), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 5);
  assert.equal(rows.filter(r => r.kind === 'activity').length, 1);
  assert.equal(rows.find(r => r.kind === 'activity_status').value.rejected, 1);
  assert.deepEqual(new ControlArchives(join(root, 'exports')).describe(id), archives.describe(id));
});

test('schema 4 migration adds telemetry without changing control state, commands or audit', t => {
  const { store, root } = storeFor(t);
  store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, { actor: { kind: 'operator' }, now: 1000, members: [] });
  const before = store.snapshot(), events = store.events('dev'), receipts = store.db.prepare('SELECT * FROM commands').all(); store.close();
  const db = new DatabaseSync(join(root, 'control', 'control.db'));
  db.exec('DROP TABLE activity; DROP TABLE activity_meta; PRAGMA user_version=4;'); db.close();
  const reopened = new ControlStore(join(root, 'control')); t.after(() => reopened.close());
  assert.deepEqual(reopened.snapshot(), before); assert.deepEqual(reopened.events('dev'), events);
  assert.deepEqual(reopened.db.prepare('SELECT * FROM commands').all(), receipts);
  assert.equal(reopened.activityStatus().rows, 0); assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 5);
});

test('gateway protects pending/exposed messages, control evidence and open incidents without guessing after failure', t => {
  const root = rootFor(t), pending = randomUUID(), exposed = randomUUID(), resolved = randomUUID(), incident = randomUUID(), expired = randomUUID();
  let now = 1000, fail = false;
  const messages = [
    { id: pending, recipients: ['opencode:b'], delivered: [], cancelled: {}, offered: [] },
    { id: exposed, recipients: ['opencode:b'], delivered: [], cancelled: { 'opencode:b': 'explicit_leave' }, offered: ['opencode:b'] },
    { id: resolved, recipients: ['opencode:b'], delivered: ['opencode:b'], cancelled: {}, offered: ['opencode:b'] },
    { id: incident, recipients: ['opencode:b'], delivered: ['opencode:b'], cancelled: {}, offered: ['opencode:b'] },
    { id: expired, recipients: ['opencode:b'], delivered: ['opencode:b'], cancelled: {}, offered: ['opencode:b'] },
  ];
  const gateway = new ControlGateway({ directory: join(root, 'control'), now: () => now, members: () => [],
    messages: () => { if (fail) throw new Error('private protection error'); return messages; } }); t.after(() => gateway.close());
  const member = { agentId: 'opencode:a', channel: 'dev', harness: 'opencode', connected: true };
  gateway.store.apply({ id: randomUUID(), op: 'channel.configure', channel: 'dev' }, { actor: { kind: 'operator' }, now, members: [member] });
  gateway.store.apply({ id: randomUUID(), op: 'evidence.record', channel: 'dev', kind: 'uncertain', entityID: resolved },
    { actor: { kind: 'adapter', agentId: member.agentId }, now, members: [member] });
  gateway.store.apply({ id: randomUUID(), op: 'incident.open', channel: 'dev', category: 'admission', entityID: incident },
    { actor: { kind: 'operator' }, now, members: [member] });
  for (const message of messages) gateway.observeActivity({ type: 'message.queued', channel: 'dev', agentId: 'opencode:a', messageID: message.id });
  now += RETENTION_MS + 1; fail = true; gateway.maintainActivity();
  assert.equal(gateway.store.activityStatus().rows, 5); assert.equal(gateway.activityStatus().pruningAvailable, false);
  now += 60000; fail = false; gateway.maintainActivity();
  assert.deepEqual(gateway.store.activity('dev').entries.map(r => r.messageID), [pending, exposed, resolved, incident]);
  assert.equal(gateway.activityStatus().pruningAvailable, true);
});

test('failed observation writes are visible and flush a durable loss counter after recovery, never a replay', t => {
  const root = rootFor(t); let fail = false;
  const gateway = new ControlGateway({ directory: join(root, 'control'), now: () => 1000, members: () => [], messages: () => [],
    options: { beforeCommit: () => { if (fail) throw new Error('sensitive SQL/disk failure body'); } } }); t.after(() => gateway.close());
  fail = true; gateway.observeActivity({ type: 'member.joined', channel: 'dev', agentId: 'opencode:a' });
  assert.equal(gateway.activityStatus().unpersisted, 1); assert.equal(gateway.store.activityStatus().rows, 0);
  assert.ok(!JSON.stringify(gateway.activityStatus()).includes('sensitive'));
  assert.ok(gateway.storageStatus().pressure.resources.includes('telemetry_health'));
  fail = false; gateway.observeActivity({ type: 'member.joined', channel: 'dev', agentId: 'opencode:b' });
  assert.equal(gateway.activityStatus().unpersisted, 0); assert.equal(gateway.activityStatus().rejected, 1);
  assert.deepEqual(gateway.store.activity('dev').entries.map(r => r.agentId), ['opencode:b']);
  fail = true; gateway.observeActivity({ type: 'member.joined', channel: 'dev', agentId: 'opencode:c' });
  fail = false; gateway.maintainActivity();
  assert.equal(gateway.activityStatus().unpersisted, 0); assert.equal(gateway.activityStatus().rejected, 2);
});

async function fixture(t, extra = {}) {
  const root = rootFor(t), clients = [];
  const broker = createBroker({ port: 0, directory: join(root, 'broker'), secret: HOST, adminSecret: ADMIN,
    controlPlane: true, sweepIntervalMs: 20, ...extra }); await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const client = token => { const c = new ChannelClient({ ...options, token }); clients.push(c); return c; };
  const admin = client(ADMIN), a = client(HOST), b = client(HOST);
  t.after(async () => { clients.forEach(c => c.close()); await broker.close(); });
  const joinAgent = (c, id, channel = 'dev') => c.request('join', { harness: 'opencode', sessionId: id, name: id, channel,
    role: 'sensitive-role-content', project: { name: 'private-project-name', root: '/private/project/path' } });
  return { root, broker, admin, a, b, joinAgent };
}

test('real broker observes queue/offer/ack once, excludes payloads, enforces operator-only access and channel isolation', async t => {
  const f = await fixture(t); await f.joinAgent(f.a, 'a'); await f.joinAgent(f.b, 'b'); await f.b.subscribe('opencode:b');
  const secret = 'sensitive message and Authorization: Bearer ' + HOST;
  const input = { agentId: 'opencode:a', to: 'opencode:b', messageId: 'private-client-message-key', text: secret };
  const message = await f.a.request('send', input); await f.a.request('send', input);
  await f.b.request('ack', { agentId: 'opencode:b', id: message.id }); await f.b.request('ack', { agentId: 'opencode:b', id: message.id });
  await assert.rejects(f.a.request('control_activity', { channel: 'dev' }), /OPERATOR_REQUIRED/);
  await assert.rejects(f.a.request('control_activity_status'), /OPERATOR_REQUIRED/);
  const page = await f.admin.request('control_activity', { channel: 'dev' });
  assert.deepEqual(page.entries.filter(r => r.messageID === message.id).map(r => r.type), ['message.queued', 'message.offered', 'message.acknowledged']);
  const text = JSON.stringify(page);
  for (const sensitive of [secret, HOST, ADMIN, input.messageId, 'sensitive-role-content', 'private-project-name', '/private/project/path']) assert.ok(!text.includes(sensitive));
  assert.equal(page.status.coverage, 'observational'); assert.equal(page.status.unpersisted, 0);
  assert.equal((await f.admin.request('control_activity', { channel: 'other' })).entries.length, 0);
  assert.equal(f.b.pending.size, 0);
});

test('telemetry exhaustion raises pressure but never rejects messaging, wakes a model or deletes receipts', async t => {
  const f = await fixture(t, { controlOptions: { telemetryLimit: 2 } }); await f.joinAgent(f.a, 'a'); await f.joinAgent(f.b, 'b');
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', messageId: 'capacity', text: 'still queues' });
  assert.ok(message.id); assert.equal(f.b.subscriptions.size, 0);
  const status = await f.admin.request('control_activity_status'); assert.equal(status.rows, 2); assert.equal(status.rejected, 1);
  const pressure = (await f.admin.request('control_storage_status')).pressure;
  assert.ok(pressure.resources.includes('telemetry_rows')); assert.ok(pressure.resources.includes('telemetry_health'));
  assert.equal(f.broker.store.messages[0].text, 'still queues');
  await assert.rejects(f.a.request('control_activity', { channel: 'dev', after: 0, body: secretForTest }), /Invalid request schema/);
});
const secretForTest = 'must-not-be-recorded';

test('actual telemetry write failure does not turn a durably queued message into an unsuccessful send', async t => {
  let fail = false;
  const f = await fixture(t, { controlOptions: { beforeCommit: () => { if (fail) throw new Error('private injected telemetry write failure'); } } });
  await f.joinAgent(f.a, 'a'); await f.joinAgent(f.b, 'b'); fail = true;
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', messageId: 'write-fault', text: 'still durable' });
  assert.equal(f.broker.store.messages[0].id, message.id);
  const status = await f.admin.request('control_activity_status'); assert.equal(status.unpersisted, 1);
  assert.ok(!JSON.stringify(status).includes('private injected'));
  fail = false; await f.b.subscribe('opencode:b');
  assert.equal((await f.admin.request('control_activity_status')).rejected, 1);
});

test('disconnect, reconnect and member cancellation are observations, never native stop evidence', async t => {
  const f = await fixture(t); await f.joinAgent(f.a, 'a'); await f.joinAgent(f.b, 'b'); await f.b.subscribe('opencode:b');
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', messageId: 'disconnect', text: 'do not replay blindly' });
  await f.b.request('unsubscribe', { agentId: 'opencode:b' }); await f.b.subscribe('opencode:b');
  await f.b.request('leave', { agentId: 'opencode:b' });
  const page = await f.admin.request('control_activity', { channel: 'dev' });
  assert.ok(page.entries.some(r => r.type === 'receiver.unsubscribed'));
  assert.equal(page.entries.filter(r => r.type === 'receiver.connected').length, 2);
  assert.ok(page.entries.some(r => r.type === 'message.cancelled' && r.messageID === message.id));
  assert.ok(page.entries.some(r => r.type === 'member.removed' && r.reason === 'explicit_leave'));
  assert.ok(!page.entries.some(r => r.type.includes('stopped') || r.type.includes('admitted')));
});

test('socket loss is recorded only after durable reservation and never as message acknowledgement', async t => {
  const f = await fixture(t); await f.joinAgent(f.a, 'a'); await f.joinAgent(f.b, 'b'); await f.b.subscribe('opencode:b');
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', messageId: 'socket-loss', text: 'still pending' });
  f.b.close(); let entries;
  for (let i = 0; i < 30; i++) {
    entries = (await f.admin.request('control_activity', { channel: 'dev' })).entries;
    if (entries.some(r => r.type === 'receiver.disconnected')) break;
    await delay(20);
  }
  assert.ok(entries.some(r => r.type === 'receiver.disconnected' && r.agentId === 'opencode:b'));
  assert.ok(!entries.some(r => r.type === 'message.acknowledged' && r.messageID === message.id));
  assert.ok(f.broker.store.agents['opencode:b'].reservationExpiresAt);
});

test('telemetry survives actual broker restart with a new observation run and no duplicate queued record', async t => {
  const f = await fixture(t); await f.joinAgent(f.a, 'a'); await f.joinAgent(f.b, 'b');
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', messageId: 'restart', text: 'private' });
  const first = await f.admin.request('control_activity', { channel: 'dev' }); f.a.close(); f.b.close(); f.admin.close(); await f.broker.close();
  const broker = createBroker({ port: 0, directory: join(f.root, 'broker'), secret: HOST, adminSecret: ADMIN, controlPlane: true });
  await once(broker.server, 'listening');
  const admin = new ChannelClient({ url: `ws://127.0.0.1:${broker.server.address().port}`, token: ADMIN });
  t.after(async () => { admin.close(); await broker.close(); });
  const next = await admin.request('control_activity', { channel: 'dev' });
  assert.notEqual(next.status.runID, first.status.runID);
  assert.equal(next.entries.filter(r => r.messageID === message.id && r.type === 'message.queued').length, 1);
  assert.equal(next.status.coverage, 'observational');
});
