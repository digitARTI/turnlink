import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { atomicWrite, privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { digest, sessionProof } from '../src/config.js';
import { validateState } from '../src/protocol.js';
import { placementReceiptID } from '../src/opencode-native-recovery.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64), ADAPTER = '3'.repeat(64);

async function fixture(t, receiverHandoff = true, worktreeTaskDispatch = false, extra = {}, sourceID = 'source') {
  const root = privateTemp(join(tmpdir(), 'turnlink-receiver-handoff-'));
  let now = 1000, failure;
  const write = (file, value) => {
    const mode = failure; failure = undefined;
    if (mode === 'before') throw new Error('injected pre-write failure');
    atomicWrite(file, value);
    if (mode === 'after') throw new Error('injected post-write failure');
  };
  let broker = createBroker({ directory: root, port: 0, secret: HOST, adminSecret: ADMIN,
    controlPlane: true, worktreeGrants: true, taskDispatch: true, receiverHandoff, worktreeTaskDispatch, now: () => now, write, ...extra });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const clients = [];
  const client = token => { const value = new ChannelClient({ ...options, token }); clients.push(value); return value; };
  const admin = client(ADMIN), source = client(HOST), target = client(HOST), peer = client(HOST);
  t.after(async () => { clients.forEach(value => value.close()); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const joinAgent = async (connection, sessionId) => {
    await connection.request('join', { harness: 'opencode', sessionId, name: sessionId, role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/project' } });
    await connection.subscribe(`opencode:${sessionId}`);
  };
  await joinAgent(source, sourceID); await joinAgent(peer, 'peer');
  await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'channel.configure' } });
  await admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  const task = await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'task.create', title: 'Move', instructions: 'fixture', criteria: 'fixture', requiresWorktree: true } });
  await source.request('control_command', { agentId: `opencode:${sourceID}`, command: { id: randomUUID(), channel: 'dev', op: 'task.claim', taskID: task.commandID } });
  const digest = 'a'.repeat(64), previewID = randomUUID();
  const adapter = command => source.request('control_adapter', { agentId: `opencode:${sourceID}`, credential: ADAPTER, command: { channel: 'dev', ...command } });
  await adapter({ id: previewID, op: 'worktree.preview', taskID: task.commandID, from: '/project', to: '/worktree', configurationDigest: digest,
    binding: { harness: 'opencode', projectID: 'fixture', sourceAuthorityDigest: digest, destinationAuthorityDigest: digest, sources: [{ path: '/project/AGENTS.md', digest }] } });
  await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'worktree.approve', taskID: task.commandID, previewID } });
  for (const kind of ['capability', 'idle']) await adapter({ id: randomUUID(), op: 'evidence.record', entityID: task.commandID, kind, ...(kind === 'capability' ? { sameConversationWorktree: true } : {}) });
  const transitionID = randomUUID();
  await adapter({ id: transitionID, op: 'worktree.begin', taskID: task.commandID, previewID, claimGeneration: 1, configurationDigest: digest, authorityDigest: digest });
  const page = await source.request('control_query', { agentId: `opencode:${sourceID}`, channel: 'dev', view: 'transitions' });
  const restart = async () => {
    clients.forEach(value => value.close());
    await broker.close();
    broker = createBroker({ directory: root, port: 0, secret: HOST, adminSecret: ADMIN,
      controlPlane: true, worktreeGrants: true, taskDispatch: true, receiverHandoff, worktreeTaskDispatch, now: () => now, write, ...extra });
    await once(broker.server, 'listening');
    options.url = `ws://127.0.0.1:${broker.server.address().port}`;
    return client(HOST);
  };
  return { get broker() { return broker; }, source, target, peer, admin, client, restart, options, failNextWrite: mode => { failure = mode || 'before'; }, advance: ms => { now += ms; }, grant: page.entries.find(value => value.id === transitionID) };
}

async function completedCandidate(f) {
  const agentId = 'opencode:ses_source';
  const handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff(agentId, ADAPTER, f.grant);
  await f.source.commitReceiverHandoff(agentId, ADAPTER, offer.offerID, 'dev'); await handoff;
  await f.source.ackReceiverHandoff(agentId, offer.offerID);
  const receipt = { version: 1, sessionID: 'ses_source', transitionID: f.grant.id, source: { directory: f.grant.from },
    destination: { directory: f.grant.to }, projectID: 'fixture', eventID: 'evt_completion', eventSeq: 1,
    archiveNonce: randomUUID(), stageNonce: randomUUID(), receiverHash: digest(f.target.receiverKeys.get(agentId)), leaseIncarnation: randomUUID() };
  await f.target.request('control_adapter', { agentId, credential: ADAPTER, command: { id: randomUUID(), channel: 'dev', op: 'worktree.settle',
    transitionID: f.grant.id, outcome: 'moved', actualLocation: f.grant.to, configurationDigest: f.grant.configurationDigest,
    authorityDigest: f.grant.authorityDigest, receiptID: placementReceiptID(receipt) } });
  return { agentId, receipt, completion: { version: 1, placement: receipt, leaseIncarnation: randomUUID() } };
}

test('receiver observation requires the actual subscribed socket even with the correct key', async t => {
  const f = await fixture(t), agentId = 'opencode:source';
  const handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff(agentId, ADAPTER, f.grant);
  await f.source.commitReceiverHandoff(agentId, ADAPTER, offer.offerID, 'dev');
  await handoff;
  const observer = f.client(HOST); await observer.connect();
  observer.receiverKeys.set(agentId, f.target.receiverKeys.get(agentId));
  assert.equal(observer.subscriptions.has(agentId), false);
  await assert.rejects(observer.observeReceiverHandoff(agentId, ADAPTER, f.grant.id, 'dev'), /ADAPTER_RECEIVER_REQUIRED/);
  const result = await f.target.observeReceiverHandoff(agentId, ADAPTER, f.grant.id, 'dev');
  assert.equal(result.status, 'held');
  assert.equal(result.transitionID, f.grant.id);
  assert.equal(f.target.subscriptions.has(agentId), true);
});

test('same-UID process with private fixture credentials can resume a disconnected held receiver', { skip: typeof process.geteuid !== 'function' }, async t => {
  const f = await fixture(t), agentId = 'opencode:source';
  const handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff(agentId, ADAPTER, f.grant);
  await f.source.commitReceiverHandoff(agentId, ADAPTER, offer.offerID, 'dev'); await handoff;
  const configPath = join(f.options.credentialDirectory, 'same-uid-probe.json');
  writeFileSync(configPath, JSON.stringify({ url: f.options.url, hostToken: HOST, adapterToken: ADAPTER,
    uid: process.geteuid(), agentId, transitionID: f.grant.id, credentialDirectory: f.options.credentialDirectory }), { mode: 0o600 });
  const disconnected = once(f.target.socket, 'close'); f.target.close(); await disconnected;
  const child = spawn(process.execPath, ['test/fixtures/same-uid-receiver-probe.js', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr); assert.match(stdout, /^same-uid receiver resumed with exact held grant\s*$/);
});

test('rate-limited requests receive a correlated failure instead of a timeout', async t => {
  const f = await fixture(t);
  let limited = false;
  for (let index = 0; index < 60; index++) {
    try { await f.target.request('control_info'); }
    catch (error) { assert.equal(error.code, 'BROKER_RATE_LIMITED_BEFORE_DISPATCH'); limited = true; break; }
  }
  assert.equal(limited, true);
});

test('a rate-limited receiver offer is rejected before any handoff is recorded', async t => {
  const f = await fixture(t);
  let limited = false;
  for (let index = 0; index < 60; index++) {
    try { await f.target.request('control_info'); }
    catch (error) { assert.equal(error.code, 'BROKER_RATE_LIMITED_BEFORE_DISPATCH'); limited = true; break; }
  }
  assert.equal(limited, true);
  await assert.rejects(f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant),
    error => error.code === 'BROKER_RATE_LIMITED_BEFORE_DISPATCH');
  assert.equal(f.broker.store.bindings['opencode:source'].receiverHandoff, undefined);
  f.advance(1000);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  assert.ok(offer.offerID);
});

test('native completion verification cannot be configured without receiver handoff', () => {
  assert.throws(() => createBroker({ secret: HOST, adminSecret: ADMIN, completionVerifier: async () => null }),
    /Native completion requires a trusted verifier and receiver handoff/);
});

test('broker-owned completion verification binds release to the actual receipt and survives retry', async t => {
  let proof, calls = 0;
  const f = await fixture(t, true, false, { completionVerifier: async () => { calls++; return proof; } }, 'ses_source');
  const candidate = await completedCandidate(f);
  proof = { ...candidate.completion, placement: { ...candidate.receipt, receiverHash: 'f'.repeat(64) } };
  await assert.rejects(f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal((await f.target.observeReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'held');
  proof = candidate.completion;
  assert.equal((await f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'released');
  const saved = f.broker.store.bindings[candidate.agentId].receiverHandoff.nativeCompletion;
  const expectedReceiptID = saved.receiptID;
  assert.equal(saved.receiptID, placementReceiptID(candidate.receipt));
  assert.equal(saved.receiverHash, candidate.receipt.receiverHash);
  assert.equal((await f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'released');
  assert.equal(calls, 2);
  f.advance(2000);
  const statusParams = { agentId: candidate.agentId, channel: 'dev', credential: ADAPTER, transitionID: f.grant.id };
  assert.equal((await f.target.request('control_receiver_observe_verified', statusParams)).receiptID, expectedReceiptID);
  f.broker.store.bindings[candidate.agentId].receiverHandoff.nativeCompletion.receiptID = randomUUID();
  await assert.rejects(f.target.request('control_receiver_observe_verified', statusParams), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  f.broker.store.bindings[candidate.agentId].receiverHandoff.nativeCompletion.receiptID = expectedReceiptID;
  const hold = f.broker.store.bindings[candidate.agentId].receiverHandoff, destination = hold.to;
  hold.to = '/different';
  await assert.rejects(f.target.request('control_receiver_observe_verified', statusParams), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  hold.to = destination;
  const corrupted = structuredClone(f.broker.store);
  corrupted.bindings[candidate.agentId].receiverHandoff.nativeCompletion.receiverHash = 'f'.repeat(64);
  assert.throws(() => validateState(corrupted), /Invalid stored receiver handoff/);
});

test('verified release delivers a held message and its acknowledgement survives broker restart', async t => {
  let proof;
  const f = await fixture(t, true, true, { completionVerifier: async () => proof }, 'ses_source');
  const candidate = await completedCandidate(f); proof = candidate.completion;
  const deliveries = [];
  f.target.on('message', message => deliveries.push(message));
  const queued = await f.peer.request('send', { agentId: 'opencode:peer', to: candidate.agentId,
    text: 'held until verified release', messageId: 'held-then-acknowledged' });
  assert.deepEqual(f.broker.store.messages.find(message => message.id === queued.id).offered, []);
  await delay(100);
  assert.equal(deliveries.length, 0, 'the held receiver must not receive the queued message');

  const delivered = once(f.target, 'message', { signal: AbortSignal.timeout(5000) });
  assert.deepEqual(await f.target.request('control_receiver_release_verified', { agentId: candidate.agentId, channel: 'dev',
    credential: ADAPTER, transitionID: f.grant.id }), { status: 'released', transitionID: f.grant.id });
  const [message] = await delivered;
  assert.equal(message.id, queued.id);
  assert.equal(message.messageId, 'held-then-acknowledged');
  assert.deepEqual(await f.target.request('ack', { agentId: candidate.agentId, id: message.id }), { delivered: true });
  assert.ok(f.broker.store.messages.find(value => value.id === message.id).delivered.includes(candidate.agentId));

  const resumed = await f.restart(), afterRestart = [];
  resumed.on('message', value => afterRestart.push(value));
  await resumed.resumeReceiverHandoff(candidate.agentId, f.grant.id);
  assert.equal((await resumed.observeReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'released');
  assert.ok(f.broker.store.messages.find(value => value.id === message.id).delivered.includes(candidate.agentId),
    'the acknowledgement must be present in the reloaded store');
  await resumed.request('control_info');
  await delay(200);
  assert.equal(afterRestart.some(value => value.id === message.id), false,
    'an acknowledged message must not be redelivered after restart');
});

for (const mode of ['before', 'after']) test(`acknowledgement ${mode} durable write recovers after verified receiver release`, async t => {
  let proof;
  const f = await fixture(t, true, true, { completionVerifier: async () => proof }, 'ses_source');
  const candidate = await completedCandidate(f); proof = candidate.completion;
  const queued = await f.peer.request('send', { agentId: 'opencode:peer', to: candidate.agentId,
    text: 'ack persistence recovery', messageId: `ack-recovery-${mode}` });
  const delivery = once(f.target, 'message', { signal: AbortSignal.timeout(5000) });
  await f.target.request('control_receiver_release_verified', { agentId: candidate.agentId, channel: 'dev',
    credential: ADAPTER, transitionID: f.grant.id });
  assert.equal((await delivery)[0].id, queued.id);
  f.failNextWrite(mode);
  await assert.rejects(f.target.request('ack', { agentId: candidate.agentId, id: queued.id }));

  const resumed = await f.restart(), received = [];
  resumed.on('message', message => received.push(message));
  await resumed.resumeReceiverHandoff(candidate.agentId, f.grant.id);
  const saved = f.broker.store.messages.find(message => message.id === queued.id);
  assert.equal(saved.delivered.includes(candidate.agentId), mode === 'after');
  if (mode === 'before') {
    for (let attempt = 0; attempt < 100 && !received.some(message => message.id === queued.id); attempt++) await delay(20);
    assert.ok(received.some(message => message.id === queued.id), 'an unacknowledged message must be redelivered');
    assert.deepEqual(await resumed.request('ack', { agentId: candidate.agentId, id: queued.id }), { delivered: true });
  } else {
    await resumed.request('control_info');
    await delay(200);
    assert.equal(received.some(message => message.id === queued.id), false, 'a durably acknowledged message must not be redelivered');
    assert.deepEqual(await resumed.request('ack', { agentId: candidate.agentId, id: queued.id }), { delivered: true });
  }
});

test('enabling the completion verifier fences a legacy unverified release after restart', async t => {
  const options = {};
  const f = await fixture(t, true, false, options, 'ses_source');
  const candidate = await completedCandidate(f);
  await f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev');
  const offered = once(f.target, 'message');
  await f.peer.request('send', { agentId: 'opencode:peer', to: candidate.agentId, text: 'must remain held', messageId: 'legacy-upgrade-message' });
  await offered;
  options.completionVerifier = async () => candidate.completion;
  const resumed = await f.restart();
  let delivered = 0;
  resumed.on('message', () => { delivered++; });
  await resumed.resumeReceiverHandoff(candidate.agentId, f.grant.id);
  assert.equal((await resumed.observeReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'held');
  await assert.rejects(resumed.request('send', { agentId: candidate.agentId, to: '*', text: 'blocked', messageId: 'legacy-blocked' }), /RECEIVER_HANDOFF_HELD/);
  const pull = await resumed.request('control_task_pull', { agentId: candidate.agentId, credential: ADAPTER,
    channel: 'dev', cwd: f.grant.to, scopeDigest: 'a'.repeat(64) });
  assert.equal(pull.held, true);
  await assert.rejects(resumed.request('control_receiver_release_verified', { agentId: candidate.agentId, channel: 'dev',
    credential: ADAPTER, transitionID: f.grant.id }), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await delay(50);
  assert.equal(delivered, 0);
});

test('broker rechecks adapter enrollment after completion observation before release', async t => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  let proof;
  const f = await fixture(t, true, false, { completionVerifier: async () => { entered(); await wait; return proof; } }, 'ses_source');
  const candidate = await completedCandidate(f); proof = candidate.completion;
  const pending = f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev');
  await ready;
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  release();
  await assert.rejects(pending, /RECEIVER_HANDOFF_UNAVAILABLE/);
  await f.admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  assert.equal((await f.target.observeReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'held');
  assert.equal((await f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'released');
});

test('broker does not release a receiver that disconnects during completion observation', async t => {
  let release, entered, proof;
  const ready = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, true, false, { completionVerifier: async () => { entered(); await wait; return proof; } }, 'ses_source');
  const candidate = await completedCandidate(f); proof = candidate.completion;
  const pending = f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev');
  const rejected = assert.rejects(pending);
  await ready;
  const closed = once(f.target.socket, 'close');
  f.target.close(); await closed; release();
  await rejected;
  const resumed = f.client(HOST);
  await resumed.resumeReceiverHandoff(candidate.agentId, f.grant.id);
  assert.equal((await resumed.observeReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'held');
  for (let attempt = 0; attempt < 50; attempt++) {
    try { assert.equal((await resumed.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'released'); return; }
    catch (error) { if (!/RECEIVER_HANDOFF_UNAVAILABLE/.test(error.message)) throw error; await delay(20); }
  }
  assert.fail('Native completion verification remained in flight');
});

for (const mode of ['before', 'after']) test(`verified completion release reconciles broker persistence failure ${mode} the write`, async t => {
  let proof, calls = 0;
  const f = await fixture(t, true, false, { completionVerifier: async () => { calls++; return proof; } }, 'ses_source');
  const candidate = await completedCandidate(f); proof = candidate.completion;
  f.failNextWrite(mode);
  await assert.rejects(f.target.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev'));
  const resumed = await f.restart();
  await resumed.resumeReceiverHandoff(candidate.agentId, f.grant.id);
  assert.equal((await resumed.releaseReceiverHandoff(candidate.agentId, ADAPTER, f.grant.id, 'dev')).status, 'released');
  assert.equal(calls, mode === 'before' ? 2 : 1);
});

test('source recovery requires a broker-owned verifier and refuses a live source socket', async t => {
  let calls = 0, valid = false;
  const f = await fixture(t, true, false, { sourceRecoveryVerifier: async ({ grant, hostId, receiverHash }) => {
    calls++;
    if (!valid) return null;
    return { version: 1, hostId, agentId: grant.agentId, channel: grant.channel, transitionID: grant.id,
      from: grant.from, to: grant.to, receiverHash, previousLease: randomUUID(), currentLease: randomUUID(), sealLease: randomUUID(), sealNonce: randomUUID() };
  } });
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
  const params = { agentId: 'opencode:source', channel: 'dev', credential: ADAPTER, transitionID: f.grant.id };
  await assert.rejects(f.target.request('control_receiver_recover_source', params), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal(calls, 0);
  const closed = once(f.source.socket, 'close'); f.source.close(); await closed;
  await assert.rejects(f.peer.request('control_receiver_recover_source', params), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.request('control_receiver_recover_source', { ...params, credential: 'f'.repeat(64) }), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.request('control_receiver_recover_source', { ...params, evidence: { detached: true } }), /Invalid request schema/);
  assert.equal(calls, 0);
  await assert.rejects(f.target.request('control_receiver_recover_source', params), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal(calls, 1);
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, false);
  valid = true;
  assert.deepEqual(await f.target.request('control_receiver_recover_source', params), { detached: true });
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, true);
  const evidence = f.broker.store.bindings['opencode:source'].receiverHandoff.sourceRecovery;
  assert.ok(evidence && evidence.previousLease !== evidence.currentLease);
  const corrupt = structuredClone(f.broker.store);
  corrupt.bindings['opencode:source'].receiverHandoff.sourceRecovery.currentLease = evidence.previousLease;
  assert.throws(() => validateState(corrupt), /Invalid stored receiver handoff/);
  const restarted = await f.restart();
  await restarted.resumeReceiverHandoff('opencode:source', f.grant.id);
  assert.deepEqual(await restarted.request('control_receiver_recover_source', params), { detached: true });
  assert.deepEqual(f.broker.store.bindings['opencode:source'].receiverHandoff.sourceRecovery, evidence);
  assert.equal(calls, 2);
});

test('source recovery rechecks enrollment after native verification before acknowledging', async t => {
  let reached, release;
  const started = new Promise(resolve => { reached = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, true, false, { sourceRecoveryVerifier: async ({ grant, hostId, receiverHash }) => {
    reached(); await delayed;
    return { version: 1, hostId, agentId: grant.agentId, channel: grant.channel, transitionID: grant.id,
      from: grant.from, to: grant.to, receiverHash, previousLease: randomUUID(), currentLease: randomUUID(), sealLease: randomUUID(), sealNonce: randomUUID() };
  } });
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
  const closed = once(f.source.socket, 'close'); f.source.close(); await closed;
  const params = { agentId: 'opencode:source', channel: 'dev', credential: ADAPTER, transitionID: f.grant.id };
  const pending = f.target.request('control_receiver_recover_source', params);
  await started;
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  release();
  await assert.rejects(pending, /RECEIVER_HANDOFF_UNAVAILABLE/);
  await f.admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, false);
});

test('source recovery requires a live verifier lease when configured and releases it after use', async t => {
  let mode = 'missing', releases = 0, checks = 0;
  const verifier = async ({ grant, hostId, receiverHash }) => {
    const proof = { version: 1, hostId, agentId: grant.agentId, channel: grant.channel, transitionID: grant.id,
      from: grant.from, to: grant.to, receiverHash, previousLease: randomUUID(), currentLease: randomUUID(), sealLease: randomUUID(), sealNonce: randomUUID() };
    if (mode !== 'missing') Object.defineProperty(proof, codexVerifierLease, { value: {
      check() { checks++; if (mode === 'dead') throw new Error('owner closed'); return true; },
      release() { releases++; },
    } });
    return proof;
  };
  Object.defineProperty(verifier, 'requiresLease', { value: true });
  const f = await fixture(t, true, false, { sourceRecoveryVerifier: verifier });
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
  const closed = once(f.source.socket, 'close'); f.source.close(); await closed;
  const params = { agentId: 'opencode:source', channel: 'dev', credential: ADAPTER, transitionID: f.grant.id };
  await assert.rejects(f.target.request('control_receiver_recover_source', params), /RECEIVER_HANDOFF_UNAVAILABLE/);
  mode = 'dead';
  await assert.rejects(f.target.request('control_receiver_recover_source', params), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal(releases, 1);
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, false);
  mode = 'live';
  assert.deepEqual(await f.target.request('control_receiver_recover_source', params), { detached: true });
  assert.equal(checks, 2); assert.equal(releases, 2);
});

test('source recovery is disabled without a broker-owned verifier', async t => {
  const f = await fixture(t);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
  const closed = once(f.source.socket, 'close'); f.source.close(); await closed;
  await assert.rejects(f.target.request('control_receiver_recover_source', { agentId: 'opencode:source', channel: 'dev',
    credential: ADAPTER, transitionID: f.grant.id }), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, false);
});

test('source recovery rejects mismatched native verifier evidence', async t => {
  let mismatch = 'receiver';
  const f = await fixture(t, true, false, { sourceRecoveryVerifier: async ({ grant, hostId, receiverHash }) => {
    const previousLease = randomUUID();
    return { version: 1, hostId, agentId: grant.agentId, channel: grant.channel,
      transitionID: mismatch === 'transition' ? randomUUID() : grant.id, from: grant.from, to: grant.to,
      receiverHash: mismatch === 'receiver' ? 'f'.repeat(64) : receiverHash, previousLease,
      currentLease: mismatch === 'lease' ? previousLease : randomUUID(), sealLease: randomUUID(), sealNonce: randomUUID() };
  } });
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
  const closed = once(f.source.socket, 'close'); f.source.close(); await closed;
  const params = { agentId: 'opencode:source', channel: 'dev', credential: ADAPTER, transitionID: f.grant.id };
  for (mismatch of ['receiver', 'transition', 'lease'])
    await assert.rejects(f.target.request('control_receiver_recover_source', params), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, false);
});

for (const mode of ['before', 'after']) test(`source recovery reconciles broker persistence failure ${mode} the write`, async t => {
  let calls = 0;
  const f = await fixture(t, true, false, { sourceRecoveryVerifier: async ({ grant, hostId, receiverHash }) => {
    calls++;
    return { version: 1, hostId, agentId: grant.agentId, channel: grant.channel, transitionID: grant.id,
      from: grant.from, to: grant.to, receiverHash, previousLease: randomUUID(), currentLease: randomUUID(), sealLease: randomUUID(), sealNonce: randomUUID() };
  } });
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
  const closed = once(f.source.socket, 'close'); f.source.close(); await closed;
  const params = { agentId: 'opencode:source', channel: 'dev', credential: ADAPTER, transitionID: f.grant.id };
  f.failNextWrite(mode);
  await assert.rejects(f.target.request('control_receiver_recover_source', params));
  const restarted = await f.restart();
  await restarted.resumeReceiverHandoff('opencode:source', f.grant.id);
  const observed = await restarted.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev');
  assert.equal(observed.sourceDetached, mode === 'after');
  assert.deepEqual(await restarted.request('control_receiver_recover_source', params), { detached: true });
  assert.equal(calls, mode === 'after' ? 1 : 2);
});

test('exact approved receiver handoff changes the live socket and fences old reconnection', async t => {
  let proof;
  const f = await fixture(t, true, true, { completionVerifier: async () => proof }, 'ses_source');
  const offer = await f.target.offerReceiverHandoff('opencode:ses_source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:ses_source', ADAPTER, offer.offerID, 'dev');
  await handed;
  const corrupt = structuredClone(f.broker.store);
  corrupt.bindings['opencode:ses_source'].receiverHash = 'f'.repeat(64);
  assert.throws(() => validateState(corrupt), /Invalid stored receiver handoff/);
  await assert.rejects(f.source.request('control_task_watch', { agentId: 'opencode:ses_source', credential: ADAPTER }), /CONTROL_ACCESS_DENIED/);
  await assert.rejects(f.source.request('send', { agentId: 'opencode:ses_source', to: 'opencode:peer', messageId: 'old-owner', text: 'old' }), /Session ownership denied/);
  assert.equal((await f.target.request('control_task_watch', { agentId: 'opencode:ses_source', credential: ADAPTER })).watching, true);
  const taskNotices = []; f.target.on('task_available', event => taskNotices.push(event));
  assert.deepEqual((await f.target.request('control_worktree_authorize', { agentId: 'opencode:ses_source', credential: ADAPTER, channel: 'dev', grant: f.grant })).grant, f.grant);
  await assert.rejects(f.target.request('send', { agentId: 'opencode:ses_source', to: 'opencode:peer', messageId: 'held-owner', text: 'held' }), /RECEIVER_HANDOFF_HELD/);
  assert.deepEqual(await f.target.request('control_task_pull', { agentId: 'opencode:ses_source', credential: ADAPTER, channel: 'dev', cwd: '/worktree', scopeDigest: 'a'.repeat(64) }), { task: null, held: true });
  await assert.rejects(f.target.releaseReceiverHandoff('opencode:ses_source', ADAPTER, f.grant.id, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  const incoming = once(f.target, 'message');
  await f.peer.request('send', { agentId: 'opencode:peer', to: 'opencode:ses_source', messageId: 'new-owner', text: 'fixture' });
  assert.deepEqual(f.broker.store.messages.find(message => message.messageId === 'new-owner').offered, []);
  const receipt = { version: 1, sessionID: 'ses_source', transitionID: f.grant.id, source: { directory: f.grant.from },
    destination: { directory: f.grant.to }, projectID: 'fixture', eventID: 'evt_fixture', eventSeq: 1,
    archiveNonce: randomUUID(), stageNonce: randomUUID(), receiverHash: digest(f.target.receiverKeys.get('opencode:ses_source')), leaseIncarnation: randomUUID() };
  proof = { version: 1, placement: receipt, leaseIncarnation: randomUUID() };
  await f.target.request('control_adapter', { agentId: 'opencode:ses_source', credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: f.grant.id, outcome: 'moved',
      actualLocation: f.grant.to, configurationDigest: f.grant.configurationDigest, authorityDigest: f.grant.authorityDigest, receiptID: placementReceiptID(receipt) } });
  await delay(1100); assert.equal(taskNotices.length, 0, 'a held receiver must not receive task wakeups');
  await assert.rejects(f.target.releaseReceiverHandoff('opencode:ses_source', ADAPTER, f.grant.id, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.ackReceiverHandoff('opencode:ses_source', offer.offerID), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await f.source.ackReceiverHandoff('opencode:ses_source', offer.offerID);
  assert.deepEqual(await f.target.releaseReceiverHandoff('opencode:ses_source', ADAPTER, f.grant.id, 'dev'), { status: 'released', transitionID: f.grant.id });
  for (let i = 0; i < 30 && taskNotices.length === 0; i++) await delay(100);
  assert.equal(taskNotices.length, 1, 'release must restore the pending task wakeup');
  assert.deepEqual(await f.target.releaseReceiverHandoff('opencode:ses_source', ADAPTER, f.grant.id, 'dev'), { status: 'released', transitionID: f.grant.id });
  const [message] = await incoming;
  await f.target.request('ack', { agentId: 'opencode:ses_source', id: message.id });
  await f.target.unsubscribe('opencode:ses_source');
  await assert.rejects(f.source.subscribe('opencode:ses_source'), /Session ownership denied/);
  await f.target.resumeReceiverHandoff('opencode:ses_source', f.grant.id);
  assert.equal((await f.target.request('control_task_watch', { agentId: 'opencode:ses_source', credential: ADAPTER })).watching, true);
});

test('only the exact candidate can notify the source after its receiver key is ready', async t => {
  const f = await fixture(t);
  let notifications = 0;
  f.source.on('receiver_handoff_offer', () => notifications++);
  const offer = await f.target.request('control_receiver_offer', { agentId: 'opencode:source', credential: ADAPTER,
    channel: 'dev', grant: f.grant, receiverKeyHash: 'f'.repeat(64) });
  await delay(30);
  assert.equal(notifications, 0);
  await assert.rejects(f.peer.request('control_receiver_ready', { agentId: 'opencode:source', credential: ADAPTER,
    channel: 'dev', offerID: offer.offerID }), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal(notifications, 0);
  const notified = once(f.source, 'receiver_handoff_offer');
  await f.target.request('control_receiver_ready', { agentId: 'opencode:source', credential: ADAPTER,
    channel: 'dev', offerID: offer.offerID });
  const [event] = await notified;
  assert.equal(event.offerID, offer.offerID);
  assert.deepEqual(event.grant, f.grant);
});

test('only the held receiver with the enrolled credential can request a source detachment recheck', async t => {
  const f = await fixture(t);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev');
  await handed;
  let checks = 0;
  f.source.on('receiver_handoff_check_source', () => checks++);
  await assert.rejects(f.peer.checkSourceReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.checkSourceReceiverHandoff('opencode:source', 'f'.repeat(64), offer.offerID, 'dev'), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(f.target.checkSourceReceiverHandoff('opencode:source', ADAPTER, randomUUID(), 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.equal(checks, 0);
  const notified = once(f.source, 'receiver_handoff_check_source');
  assert.deepEqual(await f.target.checkSourceReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'), { requested: true });
  assert.equal((await notified)[0].offerID, offer.offerID);
  assert.equal((await f.target.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).sourceDetached, false);
});

test('receiver handoff remains disabled unless explicitly staged', async t => {
  const f = await fixture(t, false);
  await assert.rejects(f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant), /RECEIVER_HANDOFF_DISABLED/);
});

test('staged worktree task pull requires the released exact receiver and destination scope', async t => {
  let proof;
  const f = await fixture(t, true, true, { completionVerifier: async () => proof }, 'ses_source');
  const agentId = 'opencode:ses_source';
  const offer = await f.target.offerReceiverHandoff(agentId, ADAPTER, f.grant);
  const handed = once(f.target, 'receiver_handoff');
  await f.source.commitReceiverHandoff(agentId, ADAPTER, offer.offerID, 'dev'); await handed;
  await f.source.ackReceiverHandoff(agentId, offer.offerID);
  const pull = cwd => f.target.request('control_task_pull', { agentId, credential: ADAPTER, channel: 'dev', cwd, scopeDigest: 'c'.repeat(64) });
  assert.deepEqual(await pull('/worktree'), { task: null, held: true });
  const receipt = { version: 1, sessionID: 'ses_source', transitionID: f.grant.id, source: { directory: f.grant.from },
    destination: { directory: f.grant.to }, projectID: 'fixture', eventID: 'evt_fixture', eventSeq: 1,
    archiveNonce: randomUUID(), stageNonce: randomUUID(), receiverHash: digest(f.target.receiverKeys.get(agentId)), leaseIncarnation: randomUUID() };
  proof = { version: 1, placement: receipt, leaseIncarnation: randomUUID() };
  await f.target.request('control_adapter', { agentId, credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: f.grant.id, outcome: 'moved',
      actualLocation: f.grant.to, configurationDigest: f.grant.configurationDigest, authorityDigest: f.grant.authorityDigest, receiptID: placementReceiptID(receipt) } });
  await f.target.releaseReceiverHandoff(agentId, ADAPTER, f.grant.id, 'dev');
  assert.equal((await pull('/project')).task, null);
  const result = await pull('/worktree');
  assert.equal(result.prepared, true);
  assert.equal(result.task.id, f.grant.taskID);
  assert.equal(result.task.executionScope.cwd, '/worktree');
  assert.deepEqual(await pull('/project'), { task: null, held: true });
  assert.deepEqual(await f.target.request('control_task_pull', { agentId, credential: ADAPTER, channel: 'dev', cwd: '/worktree', scopeDigest: 'd'.repeat(64) }), { task: null, held: true });
  assert.equal((await pull('/worktree')).prepared, false);
});

test('a candidate cannot reuse the current session proof as its new receiver key', async t => {
  const f = await fixture(t);
  await f.target.connect();
  const existing = sessionProof(f.target.hostId, 'opencode:source', f.options.credentialDirectory, false);
  await assert.rejects(f.target.request('control_receiver_offer', { agentId: 'opencode:source', credential: ADAPTER, channel: 'dev',
    grant: f.grant, receiverKeyHash: digest(existing) }), /RECEIVER_HANDOFF_UNAVAILABLE/);
});

test('both candidate enrollment and the actual current receiver are required for handoff', async t => {
  const f = await fixture(t);
  await assert.rejects(f.target.offerReceiverHandoff('opencode:source', '5'.repeat(64), f.grant), /ADAPTER_CREDENTIAL_REQUIRED/);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await assert.rejects(f.target.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  await assert.rejects(f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await assert.rejects(f.target.subscribe('opencode:source'), /Session already has a receiver/);
});

test('transferring one receiver preserves reconnect for unrelated Sessions on the old client', async t => {
  const f = await fixture(t);
  await f.source.request('join', { harness: 'opencode', sessionId: 'spare', name: 'spare', role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/project' } });
  await f.source.subscribe('opencode:spare');
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev');
  const closed = once(f.source.socket, 'close'); f.source.socket.terminate(); await closed;
  await f.source.connect();
  assert.equal(f.source.subscriptions.has('opencode:spare'), true);
  assert.equal(f.source.subscriptions.has('opencode:source'), false);
  const members = await f.source.request('members', { agentId: 'opencode:spare', channel: 'dev' });
  assert.ok(members.some(member => member.agentId === 'opencode:spare'));
});

test('broker restart preserves the new receiver key and rejects the old session proof alone', async t => {
  const f = await fixture(t);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev');
  const restarted = await f.restart();
  await assert.rejects(restarted.subscribe('opencode:source'), /Session ownership denied/);
  await restarted.resumeReceiverHandoff('opencode:source', f.grant.id);
  assert.equal((await restarted.request('control_task_watch', { agentId: 'opencode:source', credential: ADAPTER })).watching, true);
});

for (const mode of ['lost reply', 'broker error after effect']) test(`${mode} clears the exact destination receiver before recovery`, async t => {
  const f = await fixture(t);
  const handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handoff;
  await f.target.unsubscribe('opencode:source');
  const uncertain = f.client(HOST), request = uncertain.request.bind(uncertain);
  uncertain.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'subscribe') {
      const error = new Error('injected subscribe failure');
      if (mode === 'broker error after effect') error.definitiveBrokerReply = true;
      throw error;
    }
    return result;
  };
  await assert.rejects(uncertain.resumeReceiverHandoff('opencode:source', f.grant.id), /injected subscribe failure/);
  assert.equal(uncertain.subscriptions.has('opencode:source'), false);
  const successor = f.client(HOST);
  await successor.resumeReceiverHandoff('opencode:source', f.grant.id);
  assert.equal((await successor.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).status, 'held');
});

test('uncertain receiver cleanup closes the socket before a successor resumes', async t => {
  const f = await fixture(t);
  const handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handoff;
  await f.target.unsubscribe('opencode:source');
  const uncertain = f.client(HOST), request = uncertain.request.bind(uncertain), rpc = uncertain.rpc.bind(uncertain);
  uncertain.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'subscribe') throw new Error('injected lost subscribe reply');
    return result;
  };
  uncertain.rpc = (method, params) => method === 'unsubscribe' ? Promise.reject(new Error('injected lost cleanup')) : rpc(method, params);
  await assert.rejects(uncertain.resumeReceiverHandoff('opencode:source', f.grant.id), /injected lost/);
  if (uncertain.socket?.readyState !== 3) await once(uncertain, 'disconnected');
  const successor = f.client(HOST);
  await successor.resumeReceiverHandoff('opencode:source', f.grant.id);
  assert.equal((await successor.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).status, 'held');
});

test('overlapping receiver recovery on one client does not disturb the successful subscription', async t => {
  const f = await fixture(t), handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handoff;
  await f.target.unsubscribe('opencode:source');
  const resumed = f.client(HOST), request = resumed.request.bind(resumed);
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  resumed.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'subscribe') { entered(); await waiting; }
    return result;
  };
  const first = resumed.resumeReceiverHandoff('opencode:source', f.grant.id);
  await started;
  await assert.rejects(resumed.resumeReceiverHandoff('opencode:source', f.grant.id), /already in progress/);
  release(); await first;
  assert.equal((await resumed.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).status, 'held');
});

test('a dropped broker subscribe frame is cleaned up before a successor resumes', { timeout: 20000 }, async t => {
  const f = await fixture(t), handoff = once(f.target, 'receiver_handoff');
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handoff;
  await f.target.unsubscribe('opencode:source');
  let dropped = false;
  f.broker.server.once('connection', socket => {
    let subscribeID; const send = socket.send.bind(socket);
    socket.prependListener('message', raw => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === 'subscribe' && frame.params.agentId === 'opencode:source') subscribeID = frame.id;
    });
    socket.send = (data, ...args) => {
      const frame = JSON.parse(data.toString());
      if (!dropped && subscribeID !== undefined && frame.id === subscribeID) { dropped = true; return; }
      return send(data, ...args);
    };
  });
  const uncertain = f.client(HOST);
  await assert.rejects(uncertain.resumeReceiverHandoff('opencode:source', f.grant.id), /Timeout: subscribe/);
  assert.equal(dropped, true);
  const successor = f.client(HOST);
  await successor.resumeReceiverHandoff('opencode:source', f.grant.id);
  assert.equal((await successor.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev')).status, 'held');
});

test('failed broker persistence never installs the new receiver on restart', async t => {
  const f = await fixture(t);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  f.failNextWrite();
  await assert.rejects(f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'));
  const restarted = await f.restart();
  await assert.rejects(restarted.resumeReceiverHandoff('opencode:source', f.grant.id), /Session ownership denied/);
  await restarted.subscribe('opencode:source');
  assert.equal((await restarted.request('control_task_watch', { agentId: 'opencode:source', credential: ADAPTER })).watching, true);
});

test('a lost reply after durable receiver rotation recovers only with the prepared destination key', async t => {
  const f = await fixture(t);
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  f.failNextWrite('after');
  await assert.rejects(f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'));
  const restarted = await f.restart();
  await assert.rejects(restarted.subscribe('opencode:source'), /Session ownership denied/);
  await restarted.resumeReceiverHandoff('opencode:source', f.grant.id);
  assert.equal((await restarted.request('control_task_watch', { agentId: 'opencode:source', credential: ADAPTER })).watching, true);
  assert.deepEqual(await restarted.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev'), { status: 'held', transitionID: f.grant.id, sourceDetached: false });
  assert.deepEqual(await restarted.request('control_task_pull', { agentId: 'opencode:source', credential: ADAPTER, channel: 'dev', cwd: '/worktree', scopeDigest: 'a'.repeat(64) }), { task: null, held: true });
});

test('receiver release re-observes both sides of a lost durable-write reply without replaying the move', async t => {
  for (const mode of ['before', 'after']) await t.test(mode, async t => {
    const f = await fixture(t);
    const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
    const handed = once(f.target, 'receiver_handoff');
    await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
    await f.source.ackReceiverHandoff('opencode:source', offer.offerID);
    await f.target.request('control_adapter', { agentId: 'opencode:source', credential: ADAPTER,
      command: { id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: f.grant.id, outcome: 'moved',
        actualLocation: f.grant.to, configurationDigest: f.grant.configurationDigest, authorityDigest: f.grant.authorityDigest, receiptID: randomUUID() } });
    f.failNextWrite(mode);
    await assert.rejects(f.target.releaseReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev'));
    const restarted = await f.restart();
    await restarted.resumeReceiverHandoff('opencode:source', f.grant.id);
    assert.deepEqual(await restarted.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev'),
      { status: mode === 'before' ? 'held' : 'released', transitionID: f.grant.id, sourceDetached: true });
    assert.deepEqual(await restarted.releaseReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev'),
      { status: 'released', transitionID: f.grant.id });
  });
});

test('source detach acknowledgement remains exact across ambiguous persistence', async t => {
  for (const mode of ['before', 'after']) await t.test(mode, async t => {
    const f = await fixture(t);
    const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
    const handed = once(f.target, 'receiver_handoff');
    await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'); await handed;
    f.failNextWrite(mode);
    await assert.rejects(f.source.ackReceiverHandoff('opencode:source', offer.offerID));
    const restarted = await f.restart();
    await restarted.resumeReceiverHandoff('opencode:source', f.grant.id);
    assert.deepEqual(await restarted.observeReceiverHandoff('opencode:source', ADAPTER, f.grant.id, 'dev'),
      { status: 'held', transitionID: f.grant.id, sourceDetached: mode === 'after' });
  });
});

test('an exposed, unacknowledged delivery prevents transfer until the current receiver acknowledges it', async t => {
  const f = await fixture(t);
  const incoming = once(f.source, 'message');
  await f.peer.request('send', { agentId: 'opencode:peer', to: 'opencode:source', messageId: 'handoff-test', text: 'fixture' });
  const [message] = await incoming;
  const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  await assert.rejects(f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'), /RECEIVER_DELIVERY_UNRESOLVED/);
  await f.source.request('ack', { agentId: 'opencode:source', id: message.id });
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev');
});

test('receiver offer cannot survive changed grant, expired time, or lost candidate connection', async t => {
  for (const mode of ['grant', 'expired', 'disconnected']) await t.test(mode, async t => {
    const f = await fixture(t);
    const offer = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
    if (mode === 'grant') await f.source.request('control_adapter', { agentId: 'opencode:source', credential: ADAPTER,
      command: { id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: f.grant.id, outcome: 'uncertain',
        actualLocation: f.grant.from, configurationDigest: f.grant.configurationDigest, authorityDigest: f.grant.authorityDigest, receiptID: randomUUID() } });
    if (mode === 'expired') f.advance(30001);
    if (mode === 'disconnected') { const closed = once(f.target.socket, 'close'); f.target.close(); await closed; }
    await assert.rejects(f.source.commitReceiverHandoff('opencode:source', ADAPTER, offer.offerID, 'dev'));
    assert.equal((await f.source.request('control_task_watch', { agentId: 'opencode:source', credential: ADAPTER })).watching, true);
  });
});

test('a replacement offer discards the expired candidate without retaining an unbounded key list', async t => {
  const f = await fixture(t);
  const first = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  f.advance(30001);
  await f.source.request('control_adapter', { agentId: 'opencode:source', credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op: 'evidence.record', entityID: f.grant.taskID, kind: 'idle' } });
  const second = await f.target.offerReceiverHandoff('opencode:source', ADAPTER, f.grant);
  assert.notEqual(second.offerID, first.offerID);
  assert.equal(f.target.handoffCandidates.size, 1);
  await assert.rejects(f.source.commitReceiverHandoff('opencode:source', ADAPTER, first.offerID, 'dev'), /RECEIVER_HANDOFF_UNAVAILABLE/);
  await f.source.commitReceiverHandoff('opencode:source', ADAPTER, second.offerID, 'dev');
});
