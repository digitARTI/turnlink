import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsCodexReceiver, relinquishCodexReceiver, isCodexSourceQuiet, makeCodexSourceDetachMonitor } from '../src/codex-receiver-ownership.js';
import { CodexAdmissionFence } from '../src/codex-admission-fence.js';
import { AdmissionLedger } from '../src/admissions.js';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
const simulatedLedger = () => ({ async withStableSnapshot(operation) { return operation(() => {}); } });

test('a desired subscription is not receiver ownership before the current connection confirms it', () => {
  const threadId = 'f9d44b91-13a7-4f88-9ed4-3360a0345a4f', agentId = `codex:${threadId}`;
  const client = { subscriptions: new Set([agentId]), activeSubscriptions: new Set() };
  assert.equal(ownsCodexReceiver(client, threadId), false);
  client.activeSubscriptions.add(agentId);
  assert.equal(ownsCodexReceiver(client, threadId), true);
  client.activeSubscriptions.clear();
  assert.equal(ownsCodexReceiver(client, threadId), false);
});

test('loss of the source receiver invalidates in-flight work and buffered delivery', () => {
  const threadId = 'f9d44b91-13a7-4f88-9ed4-3360a0345a4f', agentId = `codex:${threadId}`;
  const state = { generation: 4, queue: [{ id: 'queued' }], roles: [{ id: 'role' }], channel: 'dev', taskPending: true, nativeSelection: {} };
  const other = { generation: 9, queue: [1], roles: [], channel: 'other' };
  const threads = new Map([[threadId, state], ['other', other]]), invalidated = [], forgotten = [];
  const client = { subscriptions: new Set([agentId]), activeSubscriptions: new Set([agentId]) }, fence = { invalidate: value => invalidated.push(value) }, health = { forget: value => forgotten.push(value) };
  assert.equal(ownsCodexReceiver(client, threadId), true);
  client.subscriptions.delete(agentId);
  relinquishCodexReceiver({ agentId, threads, fence, health });
  assert.equal(ownsCodexReceiver(client, threadId), false);
  assert.deepEqual(state, { generation: 5, queue: [], roles: [], channel: null, taskPending: false, nativeSelection: null, receiverDisabled: true });
  client.subscriptions.add(agentId);
  assert.equal(ownsCodexReceiver(client, threadId, state), false, 'a later presence must not restore disabled ownership');
  assert.equal(other.generation, 9); assert.deepEqual(other.queue, [1]);
  assert.deepEqual(invalidated, ['NATIVE_RECEIVER_OWNERSHIP_LOST']); assert.deepEqual(forgotten, [agentId]);
});

test('source detachment acknowledges only a quiet receiver under its original held publication fence', async () => {
  const threadId = 'f9d44b91-13a7-4f88-9ed4-3360a0345a4f', agentId = `codex:${threadId}`, offerID = '4ff6dd5a-9350-4cb3-a288-c5fe756cc29f';
  const state = { generation: 0, queue: [], roles: [], channel: 'dev', taskPending: false, ledger: simulatedLedger() }, threads = new Map([[threadId, state]]);
  const owner = { threadID: threadId, publication: true, publicationReady: true }, acks = [];
  const fence = { owner, closed: false, invalidate: code => { owner.invalid = code; } };
  const client = { subscriptions: new Set(), async ackReceiverHandoff(id, offer) { acks.push([id, offer]); } };
  const monitor = makeCodexSourceDetachMonitor({ client, threads, fence, health: { forget() {} }, quiet: () => true, log: error => { throw error; } });
  monitor.source({ agentId, offerID });
  monitor.check({ agentId, offerID: 'wrong' }); assert.deepEqual(acks, []);
  monitor.check({ agentId, offerID }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(acks, [[agentId, offerID]]);
  monitor.check({ agentId, offerID }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(acks.length, 1); monitor.close();
});

test('source detachment refuses active work or a changed owner', async () => {
  for (const changedOwner of [false, true]) {
    const threadId = 'f9d44b91-13a7-4f88-9ed4-3360a0345a4f', agentId = `codex:${threadId}`, offerID = '4ff6dd5a-9350-4cb3-a288-c5fe756cc29f';
    const state = { generation: 0, queue: [], roles: [], channel: 'dev', ledger: simulatedLedger() }, owner = { threadID: threadId, publication: true, publicationReady: true }, acks = [];
    const fence = { owner, closed: false, invalidate: code => { owner.invalid = code; } };
    const monitor = makeCodexSourceDetachMonitor({ client: { subscriptions: new Set(), async ackReceiverHandoff(...args) { acks.push(args); } },
      threads: new Map([[threadId, state]]), fence, health: { forget() {} }, quiet: () => changedOwner, log() {} });
    monitor.source({ agentId, offerID });
    if (changedOwner) fence.owner = { ...owner };
    monitor.check({ agentId, offerID }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(acks.length, 0); monitor.close();
  }
});

test('source detachment keeps the actual publication fence quarantined', async t => {
  const threadId = 'f9d44b91-13a7-4f88-9ed4-3360a0345a4f', agentId = `codex:${threadId}`, offerID = '4ff6dd5a-9350-4cb3-a288-c5fe756cc29f';
  const state = { generation: 0, queue: [], roles: [], channel: 'dev', ledger: simulatedLedger() }, acks = [];
  const fence = new CodexAdmissionFence({ write() {}, reply() {}, activity: () => ({ known: true, idle: true, blocked: false, flushing: false }) });
  t.after(() => fence.close());
  const monitor = makeCodexSourceDetachMonitor({ client: { subscriptions: new Set(), async ackReceiverHandoff(...args) { acks.push(args); } },
    threads: new Map([[threadId, state]]), fence, health: { forget() {} }, quiet: () => true, log() {} });
  await assert.rejects(fence.exclusive(threadId, async ({ beginPublication }) => {
    await beginPublication(); monitor.source({ agentId, offerID }); monitor.check({ agentId, offerID });
    await new Promise(resolve => setImmediate(resolve));
  }), /NATIVE_FENCE_UNCERTAIN/);
  assert.deepEqual(acks, [[agentId, offerID]]); assert.equal(fence.quarantined, true);
  monitor.close();
});

test('source quiet check refuses unobserved or in-flight work', () => {
  const state = { lifecycleKnown: true, ledger: { records: [], matchesDisk: () => true }, queue: [], roles: [] };
  const fence = { queue: [], pending: new Map(), nativeTurns: new Map(), serverRequests: new Set(), unknownNativeActivity: false };
  const context = { state, threads: new Map([['source', state]]), fence, own: new Map(), taskRequests: new Map(), requests: new Map(), approvals: new Map() };
  assert.equal(isCodexSourceQuiet(context), true);
  state.ledger.records.push({ state: 'uncertain' }); assert.equal(isCodexSourceQuiet(context), false); state.ledger.records = [];
  state.ledger.matchesDisk = () => false; assert.equal(isCodexSourceQuiet(context), false); state.ledger.matchesDisk = () => true;
  fence.queue.push({}); assert.equal(isCodexSourceQuiet(context), false); fence.queue = [];
  context.approvals.set('x', 'source'); assert.equal(isCodexSourceQuiet(context), false); context.approvals.clear();
  context.threads.set('other', { lifecycleKnown: false }); assert.equal(isCodexSourceQuiet(context), false); context.threads.delete('other');
  state.ledger = undefined; assert.equal(isCodexSourceQuiet(context), false);
});

test('source admission ledger refuses stale, malformed or missing persisted state', t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-admission-consistency-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = new AdmissionLedger('local', 'codex:test', root);
  assert.equal(ledger.matchesDisk(), true);
  ledger.set({ id: randomUUID(), fingerprint: 'fixture', state: 'accepted', updatedAt: 1 });
  assert.equal(ledger.matchesDisk(), true);
  ledger.set({ updatedAt: 1, state: 'accepted', fingerprint: 'order', id: randomUUID(), rpcId: 'rpc' });
  assert.equal(ledger.matchesDisk(), true, 'receipt field order must not cause a false stale-writer refusal');
  const other = new AdmissionLedger('local', 'codex:test', root);
  other.set({ id: randomUUID(), fingerprint: 'other', state: 'uncertain', updatedAt: 2 });
  assert.equal(ledger.matchesDisk(), false);
  assert.throws(() => ledger.set({ id: randomUUID(), fingerprint: 'stale', state: 'inflight', updatedAt: 3 }), /Admission ledger changed/);
  assert.equal(new AdmissionLedger('local', 'codex:test', root).records.some(record => record.state === 'uncertain'), true);
  writeFileSync(ledger.path, '{invalid', { mode: 0o600 }); assert.equal(ledger.matchesDisk(), false);
  unlinkSync(ledger.path); assert.equal(ledger.matchesDisk(), false);
});

test('a stale writer in another process cannot overwrite an admission intent', async t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-admission-writers-'));
  const agentId = 'codex:test', child = fork(resolve('test/fixtures/admission-writer.js'), [root, agentId, randomUUID()], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); rmSync(root, { recursive: true, force: true }); });
  assert.deepEqual((await once(child, 'message'))[0], { ready: true });
  const ledger = new AdmissionLedger('local', agentId, root), id = randomUUID();
  ledger.set({ id, fingerprint: 'parent', state: 'inflight', updatedAt: 1 });
  child.send('write');
  const [result] = await once(child, 'message');
  assert.equal(result.written, false); assert.match(result.message, /Admission ledger changed/);
  await exited;
  assert.deepEqual(new AdmissionLedger('local', agentId, root).records.map(record => record.id), [id]);
});

test('source acknowledgement holds the admission writer lock across the broker call', async t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-admission-detach-'));
  const threadId = 'f9d44b91-13a7-4f88-9ed4-3360a0345a4f', agentId = `codex:${threadId}`, offerID = randomUUID();
  const child = fork(resolve('test/fixtures/admission-writer.js'), [root, agentId, randomUUID()], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); rmSync(root, { recursive: true, force: true }); });
  assert.deepEqual((await once(child, 'message'))[0], { ready: true });
  const ledger = new AdmissionLedger('local', agentId, root), state = { generation: 0, queue: [], roles: [], channel: 'dev', ledger };
  const owner = { threadID: threadId, publication: true, publicationReady: true }, fence = { owner, closed: false, invalidate(code) { owner.invalid = code; } };
  let begin, finish; const started = new Promise(resolve => { begin = resolve; }), waiting = new Promise(resolve => { finish = resolve; });
  const errors = [];
  const monitor = makeCodexSourceDetachMonitor({ client: { subscriptions: new Set(), async ackReceiverHandoff() { begin(); await waiting; } },
    threads: new Map([[threadId, state]]), fence, health: { forget() {} }, quiet: () => true, log: error => errors.push(error) });
  monitor.source({ agentId, offerID }); monitor.check({ agentId, offerID }); await started;
  child.send('write'); const [result] = await once(child, 'message');
  assert.equal(result.written, false); assert.match(result.message, /lock/i); await exited;
  finish(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(errors, []);
  assert.equal(ledger.matchesDisk(), true); monitor.close();
});
