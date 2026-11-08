import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, rmSync, readdirSync, linkSync, symlinkSync, chmodSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';
import { ControlGateway } from '../src/control/gateway.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { downloadControlExport } from '../src/control-export-client.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const rootFor = t => { const root = privateTemp(join(tmpdir(), 'turnlink-control-storage-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const context = { actor: { kind: 'operator' }, now: 1000000, members: [] };
const configure = (store, id = randomUUID()) => store.apply({ id, channel: 'dev', op: 'channel.configure' }, context);
const records = () => function* () { yield { kind: 'state', value: { version: 1, lastNow: 0, channels: [], tasks: [], actions: [], incidents: [], evidence: [], previews: [], transitions: [] } }; };

test('storage pressure is metadata-only, warns before full receipts, and reads remain usable at capacity', t => {
  const root = rootFor(t), store = new ControlStore(join(root, 'control'), { commandLimit: 5 }); t.after(() => store.close());
  for (let i = 0; i < 4; i++) configure(store);
  assert.equal(store.storageStatus().quotas.find(q => q.resource === 'commands').level, 'warning');
  const last = randomUUID(); configure(store, last);
  const before = store.snapshot(), receipts = store.db.prepare('SELECT count(*) AS n FROM commands').get().n;
  assert.equal(store.storageStatus().quotas.find(q => q.resource === 'commands').level, 'critical');
  assert.throws(() => configure(store), /COMMAND_RECEIPTS_FULL/); assert.equal(configure(store, last).replayed, true);
  const archives = new ControlArchives(join(root, 'exports'));
  const descriptor = store.exportTo(archives, randomUUID(), context.now);
  assert.ok(descriptor.bytes > 0); assert.deepEqual(store.snapshot(), before);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n, receipts);
});

test('receipt inspection stays bounded and available at capacity without disclosing private fingerprints', t => {
  const root = rootFor(t), store = new ControlStore(join(root, 'control'), { commandLimit: 1 }); t.after(() => store.close());
  const commandID = randomUUID(), eventIDs = Array.from({ length: 200 }, () => randomUUID());
  store.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(commandID, 'f'.repeat(64), JSON.stringify({ commandID, channel: 'dev', eventIDs }));
  const receipt = store.commandReceipt('dev', commandID);
  assert.equal(receipt.known, true); assert.equal(receipt.eventCount, 200); assert.equal(receipt.eventIDs.length, 100);
  assert.equal(receipt.fingerprint, undefined); assert.equal(store.commandReceipt('other', commandID).known, false);
  assert.throws(() => configure(store), /COMMAND_RECEIPTS_FULL/);
  assert.deepEqual(store.commandReceipt('dev', commandID), receipt);
});

test('consistent private control exports retain unresolved work and receipts but exclude authentication registries', t => {
  const root = rootFor(t), store = new ControlStore(join(root, 'control')); t.after(() => store.close()); configure(store);
  const taskID = randomUUID();
  store.apply({ id: taskID, channel: 'dev', op: 'task.create', title: 'Pending', instructions: 'Collaboration payload π', criteria: 'Keep evidence', requiresWorktree: false }, context);
  const credentialDigest = digest('3'.repeat(64)); store.enrollAdapter('local', credentialDigest, context.now);
  const archives = new ControlArchives(join(root, 'exports')), id = randomUUID(), before = store.snapshot();
  const descriptor = store.exportTo(archives, id, context.now), contents = readFileSync(archives.path(id), 'utf8');
  assert.equal(digest(contents), descriptor.digest); assert.equal(Buffer.byteLength(contents), descriptor.bytes);
  const rows = contents.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.ok(rows.some(r => r.kind === 'state' && r.value.tasks.some(t => t.id === taskID && t.status === 'open')));
  assert.ok(rows.some(r => r.kind === 'command' && r.value.id === taskID));
  assert.ok(rows.some(r => r.kind === 'credential_audit' && r.value.action === 'enrolled'));
  assert.ok(!contents.includes(credentialDigest)); assert.ok(!contents.includes('3'.repeat(64)));
  assert.ok(!rows.some(r => ['adapter_credentials', 'security', 'bindings', 'authentication'].includes(r.kind)));
  assert.deepEqual(store.snapshot(), before); assert.equal(store.storageStatus().unresolved.tasks, 1);
  configure(store);
  assert.deepEqual(store.exportTo(new ControlArchives(join(root, 'exports')), id, context.now + 1), descriptor, 'retry/restart must return the original immutable snapshot');
});

test('interrupted exports remain incomplete, count against bounded storage, and are never overwritten on retry', t => {
  const root = rootFor(t), archives = new ControlArchives(join(root, 'exports'), { countLimit: 2 }), id = randomUUID();
  assert.throws(() => archives.create(id, 1, function* () { yield* records()(); throw new Error('injected export failure'); }), /injected export failure/);
  const partial = readFileSync(archives.path(id));
  assert.throws(() => new ControlArchives(join(root, 'exports')).create(id, 2, records()), /CONTROL_EXPORT_INCOMPLETE/);
  assert.deepEqual(readFileSync(archives.path(id)), partial);
  archives.create(randomUUID(), 2, records());
  assert.equal(archives.usage().count, 2);
  assert.throws(() => archives.create(randomUUID(), 3, records()), /CONTROL_EXPORT_STORE_FULL/);
  assert.equal(readdirSync(join(root, 'exports')).length, 2);
});

test('corrupt, linked and symlinked export files fail closed rather than reading external/private data', t => {
  const root = rootFor(t), archives = new ControlArchives(join(root, 'exports')), id = randomUUID(); archives.create(id, 1, records());
  const content = readFileSync(archives.path(id), 'utf8'); writeFileSync(archives.path(id), content.replace('control-only', 'control-evil'));
  assert.throws(() => archives.describe(id));
  const linked = randomUUID(), external = join(root, 'external'); writeFileSync(external, 'outside-data', { mode: 0o600 });
  linkSync(external, archives.path(linked)); assert.throws(() => archives.describe(linked), /CONTROL_EXPORT_INSECURE/);
  const sym = randomUUID(); symlinkSync(external, archives.path(sym)); assert.throws(() => archives.describe(sym));
  assert.equal(readFileSync(external, 'utf8'), 'outside-data');
});

test('oversized exports refuse before exceeding their configured byte limit and preserve partial evidence', t => {
  const root = rootFor(t), archives = new ControlArchives(join(root, 'exports'), { fileByteLimit: 100, byteLimit: 100 });
  assert.throws(() => archives.create(randomUUID(), 1, records()), /CONTROL_EXPORT_STORE_FULL/);
  assert.ok(archives.usage().bytes <= 100); assert.equal(archives.usage().count, 1);
});

test('disk pressure is reported without changing authority or removing unresolved evidence', t => {
  const root = rootFor(t), store = new ControlStore(join(root, 'control'), {
    diskStats: () => ({ bsize: 4096, blocks: 262144, bavail: 128 }),
  }); t.after(() => store.close()); configure(store);
  const before = store.snapshot(); assert.equal(store.storageStatus().quotas.find(q => q.resource === 'disk').level, 'critical');
  assert.deepEqual(store.snapshot(), before);
});

test('quarantined scheduling still permits operator diagnostics and exports without clearing the fault', t => {
  const root = rootFor(t), gateway = new ControlGateway({ directory: join(root, 'control'), now: () => context.now,
    members: () => [], runtimeAvailable: () => false }); t.after(() => gateway.close());
  configure(gateway.store);
  const operator = { principal: { admin: true } }, status = gateway.handle(operator, 'control_storage_status', {});
  assert.equal(status.controlAvailable, false); assert.equal(status.pressure.level, 'critical');
  assert.ok(status.pressure.resources.includes('control_runtime'));
  const id = randomUUID(), descriptor = gateway.handle(operator, 'control_export', { id });
  assert.ok(descriptor.bytes > 0); assert.equal(gateway.runtimeAvailable(), false);
  gateway.store.fault = true;
  assert.equal(gateway.handle(operator, 'control_storage_status', {}).pressure.level, 'unavailable');
  assert.deepEqual(gateway.handle(operator, 'control_export', { id }), descriptor, 'a completed export remains retrievable without a writable/live store');
  assert.throws(() => gateway.handle(operator, 'control_export', { id: randomUUID() }), /CONTROL_STORE_UNAVAILABLE/);
  assert.ok(gateway.handle(operator, 'control_export_read', { id, offset: 0 }).data);
});

test('disk-stat failures expose no exception bodies and never prevent an independent consistent export', t => {
  const root = rootFor(t), secret = 'sensitive diagnostic must not leak';
  const gateway = new ControlGateway({ directory: join(root, 'control'), now: () => context.now, members: () => [],
    options: { diskStats: () => { throw new Error(secret); } } }); t.after(() => gateway.close());
  configure(gateway.store);
  const status = gateway.storageStatus(); assert.equal(status.pressure.level, 'unavailable');
  assert.ok(!JSON.stringify(status).includes(secret));
  assert.ok(gateway.handle({ principal: { admin: true } }, 'control_export', { id: randomUUID() }).bytes > 0);
});

test('reopened exports verify all chunks, reject changed content, and validate byte offsets', t => {
  const root = rootFor(t), store = new ControlStore(join(root, 'control')); t.after(() => store.close()); configure(store);
  for (let i = 0; i < 6; i++) store.apply({ id: randomUUID(), channel: 'dev', op: 'task.create', title: `Task ${i}`,
    instructions: 'π'.repeat(6000), criteria: 'Keep evidence', requiresWorktree: false }, context);
  const directory = join(root, 'exports'), original = new ControlArchives(directory), id = randomUUID();
  const descriptor = store.exportTo(original, id, context.now), reopened = new ControlArchives(directory);
  assert.ok(descriptor.bytes > 65536); assert.deepEqual(reopened.describe(id), descriptor);
  const chunks = []; let offset = 0;
  while (offset < descriptor.bytes) {
    const page = reopened.read(id, offset); chunks.push(Buffer.from(page.data, 'base64')); offset = page.next;
  }
  assert.equal(digest(Buffer.concat(chunks)), descriptor.digest);
  assert.equal(reopened.read(id, descriptor.bytes).data, '');
  for (const bad of [-1, 0.5, descriptor.bytes + 1]) assert.throws(() => reopened.read(id, bad), /CONTROL_EXPORT_OFFSET/);
  const content = readFileSync(reopened.path(id), 'utf8');
  writeFileSync(reopened.path(id), content.replace('Task 0', 'Task X'));
  assert.throws(() => reopened.read(id, 0), /CONTROL_EXPORT_INVALID/);
});

async function brokerFixture(t, controlOptions = {}, now = Date.now) {
  const root = rootFor(t), broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, controlOptions, sweepIntervalMs: 20, now }); await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const host = new ChannelClient(options), admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  t.after(async () => { host.close(); admin.close(); await broker.close(); });
  const configure = () => admin.request('control_command', { command: { id: randomUUID(), op: 'channel.configure', channel: 'dev' } });
  return { root, host, admin, configure };
}

test('only the operator can inspect detailed storage, subscribe to alerts or create/download exports', async t => {
  const f = await brokerFixture(t), id = randomUUID(); await f.configure();
  for (const [method, params] of [['control_storage_status', {}], ['control_storage_watch', {}], ['control_export', { id }], ['control_export_read', { id, offset: 0 }]])
    await assert.rejects(f.host.request(method, params), /OPERATOR_REQUIRED/);
  const info = await f.host.request('control_info'); assert.ok(info.storagePressure); assert.equal(info.quotas, undefined); assert.equal(info.unresolved, undefined);
  const status = await f.admin.request('control_storage_status'); assert.equal(status.version, 1); assert.ok(status.quotas.length);
  const exported = await f.admin.request('control_export', { id }); assert.equal(exported.includesAuthentication, false);
  await assert.rejects(f.admin.request('control_export_read', { id, offset: 0, limit: 50000 }));
  const result = await downloadControlExport({ client: f.admin, id, file: join(f.root, 'download.jsonl'), paceMs: 0 });
  assert.equal(result.verified, true); assert.equal(digest(readFileSync(result.file)), exported.digest);
  await assert.rejects(downloadControlExport({ client: f.admin, id, file: result.file, paceMs: 0 }), /EEXIST/);
});

test('operator storage watches alert only on severity changes, work without a master, and never wake participants', async t => {
  // This case tests command-quota severity transitions. Real machine disk
  // pressure has its own test and can legitimately dominate overall severity.
  const f = await brokerFixture(t, { commandLimit: 5,
    diskStats: () => ({ bsize: 4096, blocks: 262144, bavail: 131072 }),
  }); const alerts = [], hostAlerts = [];
  f.admin.on('control_storage', frame => alerts.push(frame.status)); f.host.on('control_storage', frame => hostAlerts.push(frame));
  await f.admin.request('control_storage_watch'); await f.host.connect();
  for (let i = 0; i < 4; i++) await f.configure();
  for (let i = 0; i < 100 && !alerts.some(a => a.pressure.level === 'warning'); i++) await delay(20);
  assert.ok(alerts.some(a => a.pressure.level === 'warning' && a.pressure.resources.includes('commands')));
  const count = alerts.length; await delay(100); assert.equal(alerts.length, count, 'unchanged pressure must not spam or wake anything');
  await f.configure();
  for (let i = 0; i < 100 && !alerts.some(a => a.pressure.level === 'critical'); i++) await delay(20);
  assert.ok(alerts.some(a => a.pressure.level === 'critical')); assert.equal(hostAlerts.length, 0);
  await assert.rejects(f.configure(), /COMMAND_RECEIPTS_FULL/);
  assert.equal((await f.admin.request('control_storage_status')).pressure.level, 'critical');
  assert.ok((await f.admin.request('control_export', { id: randomUUID() })).bytes > 0);
});

test('real scheduler exhaustion quarantines control while operator exports and diagnostics stay available', async t => {
  let time = 1000000;
  const f = await brokerFixture(t, { commandLimit: 2 }, () => time); await f.configure();
  await f.admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'task.create', title: 'Deadline',
    instructions: 'Do not discard', criteria: 'Preserve unresolved work', requiresWorktree: false, deadlineAt: time + 1000 } });
  time += 2000;
  let status;
  for (let i = 0; i < 100; i++) {
    status = await f.admin.request('control_storage_status');
    if (!status.controlAvailable) break;
    await delay(20);
  }
  assert.equal(status.controlAvailable, false); assert.ok(status.pressure.resources.includes('control_runtime'));
  assert.equal(status.unresolved.tasks, 1);
  await assert.rejects(f.configure(), /CONTROL_UNAVAILABLE/);
  const id = randomUUID(), result = await downloadControlExport({ client: f.admin, id, file: join(f.root, 'quarantined.jsonl'), paceMs: 0 });
  assert.equal(result.verified, true);
  const rows = readFileSync(result.file, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.find(r => r.kind === 'state').value.tasks[0].status, 'open');
  assert.equal((await f.admin.request('control_storage_status')).controlAvailable, false, 'export must not clear quarantine');
});

test('download integrity and offsets are verified; corrupted downloads are never reported as complete', async t => {
  const root = rootFor(t), id = randomUUID(), expected = Buffer.from('expected contents');
  const descriptor = { id, format: 'turnlink-control-export-v1', scope: 'control-only', includesAuthentication: false,
    includesCollaboration: true, bytes: expected.length, createdAt: 1, digest: digest(expected), records: 1 };
  const client = { request: async method => method === 'control_export' ? descriptor : { id, offset: 0, next: expected.length,
    totalBytes: expected.length, digest: descriptor.digest, data: Buffer.from('wrong___contents_').toString('base64') } };
  await assert.rejects(downloadControlExport({ client, id, file: join(root, 'bad.jsonl'), paceMs: 0 }));
  if (process.platform !== 'win32') {
    const directory = join(root, 'exports'), archives = new ControlArchives(directory); archives.create(id, 1, records()); chmodSync(directory, 0o755);
    assert.throws(() => archives.describe(id), /mode 0700/);
  }
});
