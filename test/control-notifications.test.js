import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';
import { ControlGateway } from '../src/control/gateway.js';
import { parseRequest } from '../src/protocol.js';
import { channelPrecondition } from '../src/control/contracts.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const rootFor = t => { const root = privateTemp(join(tmpdir(), 'turnlink-notifications-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const context = (now = 1000, kind = 'operator') => ({ actor: { kind }, now, members: [] });
function overdue(store, channel = 'dev', now = 1000) {
  if (!store.snapshot().channels.some(c => c.id === channel)) store.apply({ id: randomUUID(), op: 'channel.configure', channel }, context(now));
  const task = { id: randomUUID(), op: 'task.create', channel, title: 'Private title not notification text', instructions: 'sensitive fixture body', criteria: 'Retain evidence', requiresWorktree: false, deadlineAt: now + 1 };
  store.apply(task, context(now));
  store.apply({ id: randomUUID(), op: 'clock.tick', channel }, context(now + 2, 'scheduler'));
  return task;
}

test('event-backed inbox is transactional, master-independent, metadata-only and stable across reads/restarts', t => {
  const root = rootFor(t), directory = join(root, 'control'); let store = new ControlStore(directory); t.after(() => store.close());
  const task = overdue(store), initial = store.notifications('dev');
  assert.equal(initial.entries.length, 1); const notice = initial.entries[0];
  assert.equal(notice.type, 'incident.opened'); assert.equal(notice.acknowledgedAt, null);
  assert.ok(!JSON.stringify(initial).includes(task.instructions)); assert.ok(!JSON.stringify(initial).includes(task.title));
  assert.deepEqual(store.notification('dev', notice.id), notice);
  assert.deepEqual(store.notifications('dev'), initial);
  const state = store.snapshot(), commands = store.db.prepare('SELECT count(*) AS n FROM commands').get().n;
  store.close(); store = new ControlStore(directory);
  assert.deepEqual(store.notifications('dev'), initial);
  const receipt = store.acknowledgeNotification('dev', notice.id, 1003);
  assert.equal(receipt.acknowledgedAt, 1003);
  assert.deepEqual(store.snapshot(), state, 'seen is not incident resolution, task acceptance or effect permission');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n, commands);
  assert.deepEqual(store.notifications('dev', { pendingOnly: true }).entries, []);
  assert.deepEqual(store.notifications('dev').entries, [receipt]);
  store.close(); store = new ControlStore(directory);
  assert.deepEqual(store.acknowledgeNotification('dev', notice.id, 1004), receipt, 'lost reply retry returns first receipt');
  assert.equal(store.snapshot().incidents[0].status, 'open');
  const archives = new ControlArchives(join(root, 'exports')), id = randomUUID(); store.exportTo(archives, id, 1004);
  const rows = readFileSync(archives.path(id), 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(rows.find(r => r.kind === 'notification_ack').value, { id: notice.id, acknowledgedAt: 1003 });
});

test('reads paginate by immutable sequence; new incidents remain pending after earlier acknowledgement', t => {
  const store = new ControlStore(join(rootFor(t), 'control')); t.after(() => store.close());
  overdue(store); const first = store.notifications('dev').entries[0]; store.acknowledgeNotification('dev', first.id, 1003);
  overdue(store, 'dev', 1004); overdue(store, 'private', 1008);
  const page = store.notifications('dev', { limit: 1 }); assert.deepEqual(page.entries.map(n => n.id), [first.id]);
  const next = store.notifications('dev', { after: page.next, limit: 1 }); assert.equal(next.entries.length, 1); assert.ok(next.next > page.next);
  assert.deepEqual(store.notifications('dev', { pendingOnly: true }).entries, next.entries);
  assert.deepEqual(store.notifications('dev', { after: next.next }).entries, []);
  assert.equal(store.notifications('private').entries.length, 1);
  assert.throws(() => store.notification('private', first.id), /NOTIFICATION_NOT_FOUND/);
  assert.throws(() => store.acknowledgeNotification('private', first.id, 1011), /NOTIFICATION_NOT_FOUND/);
  for (const fields of [{ after: -1 }, { limit: 0 }, { limit: 101 }, { pendingOnly: 'true' }]) assert.throws(() => store.notifications('dev', fields));
});

test('acknowledgement rollback, quota and clock failures never lose or silently acknowledge an event', t => {
  let fail = false;
  const store = new ControlStore(join(rootFor(t), 'control'), { notificationAckLimit: 1, beforeCommit: () => { if (fail) throw new Error('commit fault'); } }); t.after(() => store.close());
  overdue(store); const first = store.notifications('dev').entries[0];
  fail = true; assert.throws(() => store.acknowledgeNotification('dev', first.id, 1003), /commit fault/); fail = false;
  assert.equal(store.notification('dev', first.id).acknowledgedAt, null);
  assert.throws(() => store.acknowledgeNotification('dev', first.id, 1001), /CLOCK_REGRESSION/);
  const receipt = store.acknowledgeNotification('dev', first.id, 1003); overdue(store, 'dev', 1004);
  const second = store.notifications('dev', { pendingOnly: true }).entries[0];
  assert.throws(() => store.acknowledgeNotification('dev', second.id, 1007), /NOTIFICATION_ACKS_FULL/);
  assert.equal(store.storageStatus().quotas.find(q => q.resource === 'notification_acks').level, 'critical');
  assert.deepEqual(store.acknowledgeNotification('dev', first.id, 1000), receipt);
  assert.equal(store.notification('dev', second.id).acknowledgedAt, null);
  assert.throws(() => store.acknowledgeNotification('dev', randomUUID(), 1007), /NOTIFICATION_NOT_FOUND/);
});

test('schema-7 migration preserves old pending events and existing state; a failed event commit creates no notification', t => {
  const directory = join(rootFor(t), 'control'); let fail = false;
  let store = new ControlStore(directory, { beforeCommit: () => { if (fail) throw new Error('event fault'); } }); t.after(() => store.close());
  overdue(store); const state = store.snapshot(), notices = store.notifications('dev');
  store.db.exec('DROP TABLE notification_acks; PRAGMA user_version=7;'); store.close();
  store = new ControlStore(directory, { beforeCommit: () => { if (fail) throw new Error('event fault'); } });
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(store.snapshot(), state); assert.deepEqual(store.notifications('dev'), notices);
  const task = { id: randomUUID(), op: 'task.create', channel: 'dev', title: 'Rollback', instructions: 'Stay private', criteria: 'Rollback', requiresWorktree: false, deadlineAt: 1005 };
  store.apply(task, context(1004)); fail = true;
  assert.throws(() => store.apply({ id: randomUUID(), op: 'clock.tick', channel: 'dev' }, context(1006, 'scheduler')), /event fault/); fail = false;
  assert.deepEqual(store.notifications('dev'), notices);
  store.apply({ id: randomUUID(), op: 'clock.tick', channel: 'dev' }, context(1006, 'scheduler'));
  assert.equal(store.notifications('dev').entries.length, 2);
});

test('real broker restricts inbox/ack to operator, validates exact IDs and replays acknowledgement after reconnect', async t => {
  const root = rootFor(t), HOST = '1'.repeat(64), ADMIN = '2'.repeat(64);
  let now = 10000;
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true, now: () => now, sweepIntervalMs: 20 });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`;
  const admin = new ChannelClient({ url, token: ADMIN }), peer = new ChannelClient({ url, token: HOST });
  t.after(async () => { admin.close(); peer.close(); await broker.close(); });
  const command = async (op, fields = {}) => admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  await command('channel.configure'); await command('task.create', { title: 'Overdue', instructions: 'private', criteria: 'metadata only', requiresWorktree: false, deadlineAt: 10001 });
  now = 10002; await command('channel.configure');
  // A broker scheduler tick produces the authoritative deadline incident.
  let pending;
  const deadline = Date.now() + 5000;
  do { pending = await admin.request('control_notifications', { channel: 'dev' }); if (pending.entries.length) break; await delay(20); } while (Date.now() < deadline);
  assert.equal(pending.entries.length, 1); const id = pending.entries[0].id;
  for (const method of ['control_notifications', 'control_notification_ack']) await assert.rejects(peer.request(method, { channel: 'dev', ...(method.endsWith('_ack') ? { id } : {}) }), /OPERATOR_REQUIRED/);
  await assert.rejects(admin.request('control_notification_ack', { channel: 'other', id }), /NOTIFICATION_NOT_FOUND/);
  const receipt = await admin.request('control_notification_ack', { channel: 'dev', id }); assert.equal(receipt.acknowledgedAt, 10002);
  const next = new ChannelClient({ url, token: ADMIN }); t.after(() => next.close());
  assert.deepEqual(await next.request('control_notification_ack', { channel: 'dev', id }), receipt);
  assert.deepEqual((await next.request('control_notifications', { channel: 'dev', pendingOnly: true })).entries, []);
  assert.deepEqual(await next.request('control_notifications', { channel: 'dev', id }), receipt);
});

test('pending and seen notices survive rolling event retention; acknowledgement still works at full command capacity', t => {
  const store = new ControlStore(join(rootFor(t), 'control'), { commandLimit: 3 }); t.after(() => store.close());
  overdue(store); const notification = store.notifications('dev').entries[0];
  assert.throws(() => store.apply({ id: randomUUID(), op: 'channel.configure', channel: 'dev' }, context(1003)), /COMMAND_RECEIPTS_FULL/);
  const receipt = store.acknowledgeNotification('dev', notification.id, 1003); assert.equal(receipt.acknowledgedAt, 1003);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 3);
  // Only non-durable events participate in the existing 30-day rolling prune.
  // Simulate recovered command capacity in this isolated fixture, not production reclamation.
  store.commandLimit = 10;
  overdue(store, 'dev', 1004);
  store.apply({ id: randomUUID(), op: 'channel.configure', channel: 'dev' }, context(40 * 24 * 60 * 60 * 1000));
  assert.deepEqual(store.notification('dev', receipt.id), receipt);
  assert.equal(store.notifications('dev', { pendingOnly: true }).entries.length, 1);
  assert.equal(store.snapshot().incidents.filter(i => i.status === 'open').length, 2);
});

test('corrupt event identity or acknowledgement data refuses reads/ack without altering evidence', t => {
  const store = new ControlStore(join(rootFor(t), 'control')); t.after(() => store.close());
  overdue(store); const notice = store.notifications('dev').entries[0];
  const row = store.db.prepare('SELECT body FROM events WHERE id=?').get(notice.id), original = JSON.parse(row.body);
  store.db.prepare('UPDATE events SET body=? WHERE id=?').run(JSON.stringify({ ...original, id: randomUUID() }), notice.id);
  assert.throws(() => store.notifications('dev'), /INVALID_NOTIFICATION_RECORD/);
  assert.throws(() => store.acknowledgeNotification('dev', notice.id, 1003), /INVALID_NOTIFICATION_RECORD/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM notification_acks').get().n, 0);
  store.db.prepare('UPDATE events SET body=? WHERE id=?').run(row.body, notice.id);
  store.acknowledgeNotification('dev', notice.id, 1003);
  store.db.prepare('UPDATE notification_acks SET acknowledged_at=? WHERE event_id=?').run(Number.MAX_SAFE_INTEGER + 1, notice.id);
  assert.throws(() => store.notification('dev', notice.id));
  assert.equal(store.snapshot().incidents[0].status, 'open');
});

test('operator inbox/ack remain diagnostic under scheduler quarantine, never clear faults, and reject caller authority/schema injection', t => {
  const gateway = new ControlGateway({ directory: join(rootFor(t), 'control'), now: () => 1003, members: () => [], messages: () => [], runtimeAvailable: () => false }); t.after(() => gateway.close());
  overdue(gateway.store); const operator = { principal: { admin: true } };
  const notice = gateway.handle(operator, 'control_notifications', { channel: 'dev' }).entries[0];
  assert.equal(gateway.handle(operator, 'control_notification_ack', { channel: 'dev', id: notice.id }).acknowledgedAt, 1003);
  assert.equal(gateway.runtimeAvailable(), false); assert.equal(gateway.store.snapshot().incidents[0].status, 'open');
  for (const [method, params] of [
    ['control_notification_ack', { channel: 'dev', id: notice.id, actor: 'operator' }],
    ['control_notifications', { channel: 'dev', id: notice.id, after: 0 }],
    ['control_notifications', { channel: 'dev', limit: 101 }],
  ]) assert.throws(() => parseRequest(JSON.stringify({ v: 2, id: 1, method, params })));
  gateway.store.fault = true;
  assert.throws(() => gateway.handle(operator, 'control_notification_ack', { channel: 'dev', id: notice.id }), /CONTROL_STORE_UNAVAILABLE/);
});

test('acknowledgement revalidates preview policy inside its transaction while preserving an exact committed receipt', t => {
  const store = new ControlStore(join(rootFor(t), 'control')); t.after(() => store.close());
  overdue(store); const notice = store.notifications('dev').entries[0];
  const stale = channelPrecondition(store.snapshot().channels[0]);
  store.apply({ id: randomUUID(), op: 'channel.configure', channel: 'dev', mode: 'approval' }, context(1003));
  assert.throws(() => store.acknowledgeNotification('dev', notice.id, 1004, stale), /PRECONDITION_FAILED/);
  assert.equal(store.notification('dev', notice.id).acknowledgedAt, null);
  const receipt = store.acknowledgeNotification('dev', notice.id, 1004, channelPrecondition(store.snapshot().channels[0]));
  assert.deepEqual(store.acknowledgeNotification('dev', notice.id, 1005, stale), receipt);
});
