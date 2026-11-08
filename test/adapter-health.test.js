import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';
import { AdapterHealthReport, HEALTH_STALE_MS } from '../src/control/health-contracts.js';
import { projectHealth } from '../src/control/health.js';
import { RETENTION_MS } from '../src/control/contracts.js';
import { makeHealthPublisher } from '../src/adapter-health.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateTemp } from '../src/storage.js';
import { makeOpenCodeHealth } from '../adapters/opencode-health.js';

const report = (extra = {}) => ({ version: 1, adapterVersion: '0.2.0', nativeStatus: 'idle', queuedMessages: 0, blockers: 0,
  features: { control: true, tasks: false, alerts: false, managedWorktrees: false }, ...extra });
const record = (extra = {}) => ({ version: 1, agentId: 'opencode:a', channel: 'dev', runID: randomUUID(), observedAt: 1000, report: report(), ...extra });
const storeFor = t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-health-')), store = new ControlStore(join(root, 'control'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); }); return { root, store };
};

test('health input is bounded metadata: no credentials, native text, actor identity or caller-selected clocks', () => {
  assert.deepEqual(AdapterHealthReport.parse(report()), report());
  for (const field of ['token', 'authorization', 'prompt', 'sessionTitle', 'instructions', 'agentId', 'observedAt'])
    assert.throws(() => AdapterHealthReport.parse(report({ [field]: 'private body' })));
  assert.throws(() => AdapterHealthReport.parse(report({ nativeVersion: 'private-provider-response' })));
  assert.throws(() => AdapterHealthReport.parse(report({ queuedMessages: 4097 })));
  assert.throws(() => AdapterHealthReport.parse(report({ features: { ...report().features, managedWorktrees: true } })));
});

test('latest snapshots replace only observations, never control state/evidence/audit or command receipts', t => {
  const { store } = storeFor(t), before = store.snapshot(), first = record();
  store.recordHealth(first); store.recordHealth({ ...first, observedAt: 2000, report: report({ nativeStatus: 'blocked', blockers: 1 }) });
  assert.equal(store.health('dev').length, 1); assert.equal(store.health('dev')[0].report.blockers, 1);
  assert.deepEqual(store.snapshot(), before); assert.equal(store.events('dev').entries.length, 0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 0);
  assert.throws(() => store.recordHealth({ ...first, observedAt: 1999 }), /CLOCK_REGRESSION/);
  assert.equal(store.health('dev')[0].observedAt, 2000); assert.deepEqual(store.health('other'), []);
});

test('stale, disconnected, missing and prior-run observations cannot appear as healthy or supply stop proof', () => {
  const r = record(), input = { agentId: r.agentId, channel: r.channel, connected: true, record: r, runID: r.runID, now: 1000, uncertainTasks: 0 };
  assert.equal(projectHealth(input).status, 'observed');
  assert.equal(projectHealth({ ...input, now: 1000 + HEALTH_STALE_MS }).status, 'stale');
  assert.equal(projectHealth({ ...input, runID: randomUUID() }).status, 'stale');
  assert.equal(projectHealth({ ...input, now: 999 }).status, 'stale');
  assert.equal(projectHealth({ ...input, connected: false }).status, 'disconnected');
  assert.equal(projectHealth({ ...input, record: undefined }).status, 'unreported');
  assert.equal(projectHealth({ ...input, record: { ...r, report: report({ nativeStatus: 'unknown' }) } }).status, 'unknown');
  assert.equal(projectHealth({ ...input, uncertainTasks: 1 }).status, 'attention');
  assert.equal(projectHealth(input).coverage, 'observational');
});

test('30-day pruning respects the exact cutoff and unresolved-agent pins, and fails closed on unknown protection/clock regression', t => {
  const { store } = storeFor(t), now = RETENTION_MS + 2000;
  store.recordHealth(record({ observedAt: 1000 }));
  store.recordHealth(record({ agentId: 'opencode:b', observedAt: 1000 }));
  store.recordHealth(record({ agentId: 'opencode:c', observedAt: 2000 }));
  assert.throws(() => store.pruneHealth(now, undefined), /INVALID_ADAPTER_HEALTH/);
  store.pruneHealth(now, ['opencode:a']); assert.deepEqual(store.health('dev').map(h => h.agentId), ['opencode:a', 'opencode:c']);
  assert.throws(() => store.pruneHealth(1999, []), /CLOCK_REGRESSION/);
});

test('exports retain typed snapshots without authentication and indexed corruption cannot be exported as valid health', t => {
  const { root, store } = storeFor(t); store.recordHealth(record());
  const archives = new ControlArchives(join(root, 'exports')), id = randomUUID(); store.exportTo(archives, id, 2000);
  assert.equal(archives.describe(id).includesAuthentication, false);
  store.db.prepare('UPDATE adapter_health SET observed_at=999').run();
  assert.throws(() => store.health('dev'), /INVALID_ADAPTER_HEALTH/);
  assert.throws(() => store.exportTo(archives, randomUUID(), 3000), /INVALID_ADAPTER_HEALTH/);
});

test('publisher is default-off, coalesces/throttles snapshots, discards stale scope and never resends an old failed report', async () => {
  let time = 1000, valid = true, failure = false; const calls = [], errors = [], controller = new AbortController();
  const client = { connect: async () => {}, authorize: (method, p) => p, rpc: async (method, p) => { calls.push({ method, p }); if (failure) throw new Error('fixture'); } };
  const options = { client, credential: async () => '3'.repeat(64), signal: controller.signal, log: e => errors.push(e), now: () => time };
  const sample = async () => ({ valid: () => valid, report: report() });
  await makeHealthPublisher(options).poll('opencode:a', sample); assert.equal(calls.length, 0);
  const publisher = makeHealthPublisher({ ...options, enabled: true });
  await publisher.poll('opencode:a', sample); await publisher.poll('opencode:a', sample); assert.equal(calls.length, 1);
  time += 15000; valid = false; await publisher.poll('opencode:a', sample); assert.equal(calls.length, 1);
  valid = true; time += 15000; failure = true; await publisher.poll('opencode:a', sample); assert.equal(errors.length, 1);
  await publisher.poll('opencode:a', sample); assert.equal(calls.length, 2, 'failed snapshots are not automatically resent');
  failure = false; publisher.reset(); await publisher.poll('opencode:a', sample); assert.equal(calls.length, 3);
  controller.abort(); time += 15000; await publisher.poll('opencode:a', sample); assert.equal(calls.length, 3);
  assert.equal(calls[0].method, 'control_health_report'); assert.equal(calls[0].p.report.version, 1);
});

test('scope changes during credential/connection waits are checked at the actual RPC send boundary', async () => {
  let release, valid = true; const calls = [], signal = new AbortController().signal;
  const publisher = makeHealthPublisher({ enabled: true, signal, log: () => {}, credential: async () => '3'.repeat(64),
    client: { connect: () => new Promise(resolve => { release = resolve; }), authorize: (m, p) => p, rpc: async p => calls.push(p) } });
  const polling = publisher.poll('opencode:a', async () => ({ valid: () => valid, report: report() }));
  await Promise.resolve(); await Promise.resolve(); valid = false; release(); await polling; assert.equal(calls.length, 0);
});

test('real broker authenticates enrolled receiver health, protects peer/channel scopes and never treats it as control evidence', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-health-broker-')); let now = 1000;
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true, now: () => now }); await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), a = new ChannelClient({ ...options, token: '1'.repeat(64) }), b = new ChannelClient({ ...options, token: '1'.repeat(64) });
  t.after(async () => { admin.close(); a.close(); b.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  for (const channel of ['dev', 'private']) await admin.request('control_command', { command: { id: randomUUID(), channel, op: 'channel.configure' } });
  for (const [client, id] of [[a, 'a'], [b, 'b']]) {
    await client.request('join', { harness: 'opencode', sessionId: id, name: id, role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/fixture' } });
    await client.subscribe(`opencode:${id}`);
  }
  await admin.request('control_enroll_adapter', { hostId: a.hostId, credential: '3'.repeat(64) });
  const params = { agentId: 'opencode:a', credential: '3'.repeat(64), report: report() };
  await assert.rejects(a.request('control_health_report', { ...params, credential: '0'.repeat(64) }), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(b.request('control_health_report', params), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(admin.request('control_health_report', { ...params, proof: '0'.repeat(64) }), /ADAPTER_HOST_REQUIRED/);
  await a.request('control_health_report', params);
  const query = (client, channel = 'dev') => client.request('control_query', { channel, view: 'health', ...(client === admin ? {} : { agentId: client === a ? 'opencode:a' : 'opencode:b' }) });
  const own = await query(a); assert.equal(own.entries.length, 1); assert.equal(own.entries[0].status, 'observed');
  await a.unsubscribe('opencode:a');
  assert.equal((await query(admin)).entries.find(entry => entry.agentId === 'opencode:a').status, 'disconnected');
  await a.subscribe('opencode:a');
  assert.equal((await query(a)).entries[0].status, 'stale', 'a resubscription cannot reuse the previous receiver observation');
  await a.request('control_health_report', params);
  assert.equal((await query(a)).entries[0].status, 'observed');
  await a.unsubscribe('opencode:a');
  const replacement = new ChannelClient({ ...options, token: '1'.repeat(64) });
  t.after(() => replacement.close());
  await replacement.request('resume', { agentId: 'opencode:a' }); await replacement.subscribe('opencode:a');
  assert.equal((await query(admin)).entries.find(entry => entry.agentId === 'opencode:a').status, 'stale', 'a new receiver cannot inherit the old observation');
  await replacement.request('control_health_report', params);
  assert.equal((await query(admin)).entries.find(entry => entry.agentId === 'opencode:a').status, 'observed');
  const peer = await query(b); assert.equal(peer.entries.length, 1); assert.equal(peer.entries[0].status, 'unreported');
  assert.equal((await query(admin)).entries.length, 2); await assert.rejects(query(a, 'private'), /CONTROL_ACCESS_DENIED/);
  now += HEALTH_STALE_MS; assert.equal((await query(a)).entries[0].status, 'stale');
  assert.equal(broker.store.messages.length, 0);
  assert.equal((await admin.request('control_query', { channel: 'dev', view: 'evidence' })).entries.length, 0);
  assert.ok(!JSON.stringify(own).includes('3'.repeat(64)));
});

test('health row capacity refuses a new identity without evicting existing snapshots or consuming durable receipts', t => {
  const { store } = storeFor(t), insert = store.db.prepare('INSERT INTO adapter_health VALUES(?,?,?,?)');
  store.transaction(() => {
    for (let i = 0; i < 4096; i++) {
      const r = record({ agentId: `opencode:a${i}` }); insert.run(r.agentId, r.channel, r.observedAt, JSON.stringify(r));
    }
  });
  assert.throws(() => store.recordHealth(record({ agentId: 'opencode:new' })), /ADAPTER_HEALTH_FULL/);
  store.recordHealth(record({ agentId: 'opencode:a0', observedAt: 2000 }));
  assert.equal(store.health('dev').length, 4096); assert.equal(store.health('dev').find(r => r.agentId === 'opencode:a0').observedAt, 2000);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 0);
});

test('schema 6 migration adds snapshots without rewriting raw control state, commands or audit', t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-health-migrate-')); let store = new ControlStore(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.apply({ id: randomUUID(), op: 'channel.configure', channel: 'dev' }, { actor: { kind: 'operator' }, now: 1000, members: [] });
  const raw = store.db.prepare('SELECT body FROM control_state').get().body, commands = store.db.prepare('SELECT * FROM commands').all(), events = store.events('dev');
  store.db.exec('DROP TABLE notification_acks; DROP TABLE adapter_health; PRAGMA user_version=6'); store.close(); store = new ControlStore(root);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(store.db.prepare('SELECT body FROM control_state').get().body, raw);
  assert.deepEqual(store.db.prepare('SELECT * FROM commands').all(), commands); assert.deepEqual(store.events('dev'), events); assert.deepEqual(store.health('dev'), []);
});

test('corrupt pruning candidates roll back all health deletion rather than guessing from indexed timestamps', t => {
  const { store } = storeFor(t); store.recordHealth(record()); store.recordHealth(record({ agentId: 'opencode:b' }));
  store.db.prepare("UPDATE adapter_health SET body='{}' WHERE agent_id='opencode:b'").run();
  assert.throws(() => store.pruneHealth(RETENTION_MS + 2000, []));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM adapter_health').get().n, 2);
});

test('OpenCode health sampling cannot mutate live delivery blockers/forms or clear native admission holds', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-health-native-')), tokenFile = join(root, 'adapter.token');
  writeFileSync(tokenFile, '3'.repeat(64), { mode: 0o600 }); t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = { tools: { agentId: 'opencode:a' }, controlChannel: 'dev', generation: 0, revision: 0,
    blocked: new Set(['permission:held']), forms: new Set(['form:held']), queue: [] }, calls = [];
  const health = makeOpenCodeHealth({ ctx: { app: { version: '2.0.28' }, session: { wait: async () => {} } },
    channel: { on: () => {}, connect: async () => {}, authorize: (m, p) => p, rpc: async (m, p) => calls.push({ m, p }) },
    sessions: new Map([['a', state]]), options: { health: true, control: true, adapterTokenFile: tokenFile }, signal: new AbortController().signal,
    ownSession: async () => {}, log: error => { throw error; }, refreshBlockers: async (id, observed) => { observed.blocked.clear(); observed.forms.clear(); return true; } });
  await health.poll('a'); assert.equal(calls.length, 1);
  assert.deepEqual([...state.blocked], ['permission:held']); assert.deepEqual([...state.forms], ['form:held']);
  assert.equal(calls[0].m, 'control_health_report');
});

test('a failed health write is visible but never rejects an already-durable peer message or fabricates a health row', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-health-fault-')); let fail = false;
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true,
    controlOptions: { beforeCommit: () => { if (fail) throw new Error('sensitive simulated disk/provider body'); } } }); await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), a = new ChannelClient({ ...options, token: '1'.repeat(64) });
  t.after(async () => { admin.close(); a.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'channel.configure' } });
  for (const id of ['a', 'b']) await a.request('join', { harness: 'opencode', sessionId: id, name: id, channel: 'dev', role: 'fixture', project: { name: 'fixture', root: '/fixture' } });
  await a.subscribe('opencode:a'); await admin.request('control_enroll_adapter', { hostId: a.hostId, credential: '3'.repeat(64) });
  fail = true;
  await assert.rejects(a.request('control_health_report', { agentId: 'opencode:a', credential: '3'.repeat(64), report: report() }), /CONTROL_UNAVAILABLE/);
  const sent = await a.request('send', { agentId: 'opencode:a', to: 'opencode:b', messageId: 'health-fault', text: 'durable fixture' });
  assert.ok(broker.store.messages.some(m => m.id === sent.id));
  const health = await admin.request('control_query', { channel: 'dev', view: 'health' });
  assert.equal(health.entries.find(h => h.agentId === 'opencode:a').status, 'unreported');
  assert.ok((await admin.request('control_activity_status')).unpersisted >= 1);
});
