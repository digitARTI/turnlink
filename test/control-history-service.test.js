import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateDirectory, privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';

const RETENTION = 30 * 86400000;
async function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-history-service-')); let time = 1000;
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, now: () => time, sweepIntervalMs: 10000, controlOptions: { eventLimit: 1 } });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`;
  const admin = new ChannelClient({ url, token: '2'.repeat(64) }), host = new ChannelClient({ url, token: '1'.repeat(64) });
  t.after(async () => { admin.close(); host.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const command = { id: randomUUID(), channel: 'dev', op: 'channel.configure' };
  const original = await admin.request('control_command', { command });
  const archive = await admin.request('control_export', { id: randomUUID() });
  time += RETENTION + 1000;
  return { root, url, admin, host, command, original, archive, params: { id: archive.id, digest: archive.digest, before: 1001 } };
}

test('verified history reclamation is operator-only, strictly typed and preserves original command receipts', async t => {
  const f = await fixture(t);
  const next = { id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'storage' };
  await assert.rejects(f.admin.request('control_command', { command: next }), /CONTROL_EVENT_STORE_FULL/);
  await assert.rejects(f.host.request('control_storage_reclaim_history', f.params), /OPERATOR_REQUIRED/);
  await assert.rejects(f.admin.request('control_storage_reclaim_history', { ...f.params, actor: { kind: 'operator' } }));
  await assert.rejects(f.admin.request('control_storage_reclaim_history', { ...f.params, digest: '0'.repeat(64) }));
  await assert.rejects(f.admin.request('control_storage_reclaim_history', { ...f.params, before: f.params.before + RETENTION }), /CONTROL_HISTORY_RETENTION/);
  const result = await f.admin.request('control_storage_reclaim_history', f.params);
  assert.equal(result.id, f.archive.id); assert.equal(result.replayed, false); assert.ok(result.events > 0);
  const repeated = await f.admin.request('control_storage_reclaim_history', f.params);
  assert.deepEqual(repeated, { ...result, replayed: true });
  await assert.rejects(f.admin.request('control_storage_reclaim_history', { ...f.params, before: 1000 }), /CONTROL_HISTORY_IDEMPOTENCY_CONFLICT/);
  const receipt = await f.admin.request('control_command', { command: f.command });
  assert.equal(receipt.commandID, f.original.commandID); assert.deepEqual(receipt.eventIDs, f.original.eventIDs);
  const state = (await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel;
  assert.equal(state.id, 'dev');
  const admitted = await f.admin.request('control_command', { command: next });
  assert.equal(admitted.commandID, next.id);
});

test('history CLI uses an explicit verified digest and millisecond cutoff with repeatable outcome', async t => {
  const f = await fixture(t), directory = join(f.root, 'operator'); privateDirectory(directory);
  writeFileSync(join(directory, 'admin-token'), '2'.repeat(64), { mode: 0o600 });
  const run = (before = String(f.params.before)) => promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('../src/control-admin.js', import.meta.url)), 'storage-reclaim-history', f.archive.id, f.archive.digest, before], {
      env: { ...process.env, AGENT_CHANNEL_STATE_DIR: directory, AGENT_CHANNEL_URL: f.url }, timeout: 10000,
    });
  const first = JSON.parse((await run()).stdout); assert.ok(first.events > 0); assert.equal(first.replayed, false);
  const repeated = JSON.parse((await run()).stdout); assert.deepEqual(repeated, { ...first, replayed: true });
  await assert.rejects(run('1.5'), error => { assert.equal(error.stdout, ''); return true; });
  await assert.rejects(run('-1'), error => { assert.equal(error.stdout, ''); return true; });
  await assert.rejects(run(String(RETENTION + 1001)), error => { assert.equal(error.stdout, ''); assert.match(error.stderr, /CONTROL_HISTORY_RETENTION/); return true; });
});


test('late uncertainty on a cold task blocks actual receiver dispatch until its current stop receipt', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-cold-dispatch-')), directory = join(root, 'broker'), taskID = randomUUID();
  const repository = new ControlStore(join(directory, 'control')), archives = new ControlArchives(join(directory, 'control', 'exports'));
  let broker, admin, receiver;
  t.after(async () => { admin?.close(); receiver?.close(); repository.close(); await broker?.close(); rmSync(root, { recursive: true, force: true }); });
  const context = { actor: { kind: 'operator' }, now: 1000, members: [] };
  repository.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, context);
  repository.apply({ id: taskID, channel: 'dev', op: 'task.create', title: 'Cold terminal task', instructions: 'Preserve exact text', criteria: 'Stop proof', requiresWorktree: false }, context);
  const state = repository.snapshot();
  Object.assign(state.tasks[0], { status: 'cancelled', claimant: 'opencode:cold', attempt: 1, dispatchIntentID: randomUUID() });
  repository.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const terminal = { id: randomUUID(), channel: 'dev', type: 'task.missed', actor: context.actor, at: 1000, entityID: taskID, durable: true };
  repository.db.prepare('INSERT INTO events(id,channel,at,durable,body) VALUES(?,?,?,?,?)').run(terminal.id, 'dev', 1000, 1, JSON.stringify(terminal));
  const archive = repository.exportTo(archives, randomUUID(), RETENTION + 2000);
  const result = repository.reclaimHistory(archives, { id: archive.id, digest: archive.digest, before: 1001 }, RETENTION + 2000);
  assert.equal(result.entities.tasks, 1); repository.close();
  broker = createBroker({ directory, port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true, taskDispatch: true,
    now: () => RETENTION + 2000, sweepIntervalMs: 10000 });
  await once(broker.server, 'listening'); const url = `ws://127.0.0.1:${broker.server.address().port}`;
  admin = new ChannelClient({ url, token: '2'.repeat(64) });
  receiver = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') });
  const agentId = 'opencode:cold', credential = '3'.repeat(64);
  await receiver.request('join', { harness: 'opencode', sessionId: 'cold', name: 'cold', channel: 'dev', role: 'Existing participant', project: { name: 'Fixture', root: '/fixture' } });
  await receiver.subscribe(agentId);
  await admin.request('control_enroll_adapter', { hostId: receiver.hostId, credential });
  const next = randomUUID();
  await admin.request('control_command', { command: { id: next, op: 'task.create', channel: 'dev', title: 'Hot task', instructions: 'Wait for stop', criteria: 'Receipt', requiresWorktree: false } });
  await receiver.request('control_command', { agentId, command: { id: randomUUID(), op: 'task.claim', channel: 'dev', taskID: next } });
  const report = (op, fields = {}) => receiver.request('control_adapter', { agentId, credential,
    command: { id: randomUUID(), op, channel: 'dev', taskID, attempt: 1, ...fields } });
  await report('task.uncertain');
  const pull = () => receiver.request('control_task_pull', { agentId, credential, channel: 'dev', cwd: '/fixture', scopeDigest: 'a'.repeat(64) });
  assert.deepEqual(await pull(), { task: null, held: true });
  await assert.rejects(report('task.stopped', { holdGeneration: 0, evidenceID: randomUUID() }), /STALE_TERMINAL_HOLD/);
  assert.deepEqual(await pull(), { task: null, held: true });
  await report('task.stopped', { holdGeneration: 1, evidenceID: randomUUID() });
  const granted = await pull(); assert.equal(granted.task.id, next); assert.equal(granted.prepared, true);
  const cold = (await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0];
  assert.equal(cold.status, 'cancelled'); assert.equal(cold.terminalHold, false); assert.equal(cold.instructions, 'Preserve exact text');
});
