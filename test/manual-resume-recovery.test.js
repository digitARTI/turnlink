import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { validateState } from '../src/protocol.js';

for (const [prior, expected] of [['armed', 'uncertain'], ['detached', 'detached'], ['confirmed', 'confirmed']]) {
  test(`manual receiver observation after broker restart: ${prior}`, async t => {
    const root = privateTemp(join(tmpdir(), 'turnlink-manual-recovery-')), agentId = 'opencode:worker';
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manualResume = { version: 1, taskID: randomUUID(), previewID: randomUUID(), channel: 'dev', claimGeneration: 1,
      from: '/source', to: '/destination', coordinator: 'codex:manager', recordID: randomUUID(), status: prior,
      ...(prior === 'confirmed' ? { requestID: randomUUID(), receiptID: randomUUID(), sourceStopped: true } : {}) };
    const state = { version: 3, agents: { [agentId]: { agentId, hostId: 'local', harness: 'opencode', sessionId: 'worker',
      channel: 'dev', name: 'worker', role: 'fixture', project: { name: 'fixture', root: '/source' } } },
      bindings: { [agentId]: { hostId: 'local', proofHash: '4'.repeat(64), revoked: false, manualResume } }, messages: [] };
    writeFileSync(join(root, 'store.json'), JSON.stringify(state), { mode: 0o600 });
    const broker = createBroker({ directory: root, port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64) });
    await once(broker.server, 'listening');
    try {
      assert.equal(broker.store.bindings[agentId].manualResume.status, expected);
      assert.equal(JSON.parse(readFileSync(join(root, 'store.json'), 'utf8')).bindings[agentId].manualResume.status, expected);
    } finally { await broker.close(); }
  });
}

test('a host transfer cannot be hidden inside a version 1 manual observation', () => {
  const agentId = 'opencode:worker', transfer = { id: randomUUID(), from: 'source', to: 'destination', sourceStopped: true, status: 'pending' };
  const observation = { version: 1, taskID: randomUUID(), previewID: randomUUID(), channel: 'dev', claimGeneration: 1,
    from: '/source', to: '/destination', coordinator: 'codex:manager', recordID: randomUUID(), status: 'detached', hostTransfer: transfer };
  const state = { version: 3, agents: {}, bindings: { [agentId]: { hostId: 'source', proofHash: '4'.repeat(64), revoked: false, manualResume: observation } }, messages: [] };
  assert.throws(() => validateState(state));
  observation.version = 2;
  assert.equal(validateState(state).bindings[agentId].manualResume.hostTransfer.status, 'pending');
  state.bindings[agentId].hostId = 'destination';
  assert.throws(() => validateState(state), /host transfer binding/);
});

test('retired host transfer IDs are bounded, unique and cannot equal the current transfer', () => {
  const agentId = 'opencode:worker', transferID = randomUUID(), retired = randomUUID();
  const observation = { version: 2, taskID: randomUUID(), previewID: randomUUID(), channel: 'dev', claimGeneration: 1,
    from: '/source', to: '/destination', coordinator: 'codex:manager', recordID: randomUUID(), status: 'detached',
    hostTransfer: { id: transferID, from: 'source', to: 'destination', sourceStopped: true, status: 'pending' }, hostTransferCancellations: [retired] };
  const state = { version: 3, agents: {}, bindings: { [agentId]: { hostId: 'source', proofHash: '4'.repeat(64), revoked: false, manualResume: observation } }, messages: [] };
  assert.ok(validateState(state));
  observation.hostTransferCancellations = [retired, retired]; assert.throws(() => validateState(state));
  observation.hostTransferCancellations = [transferID]; assert.throws(() => validateState(state));
  observation.hostTransferCancellations = Array.from({ length: 33 }, () => randomUUID()); assert.throws(() => validateState(state));
});

test('coordinator takeover journal rejects inconsistent ownership and duplicate receipts', () => {
  const agentId = 'opencode:worker', original = randomUUID(), copied = randomUUID();
  const transition = { id: randomUUID(), previousCoordinator: 'codex:old', nextCoordinator: 'codex:new', previousRecordID: original, nextRecordID: copied, generation: 1 };
  const observation = { version: 2, taskID: randomUUID(), previewID: randomUUID(), channel: 'dev', claimGeneration: 1,
    from: '/source', to: '/destination', coordinator: 'codex:old', recordID: original, status: 'detached',
    hostTransfer: { id: randomUUID(), from: 'source', to: 'destination', sourceStopped: true, status: 'completed' }, pendingTakeover: transition };
  const state = { version: 3, agents: {}, bindings: { [agentId]: { hostId: 'destination', proofHash: '4'.repeat(64), revoked: false, manualResume: observation } }, messages: [] };
  assert.ok(validateState(state));
  observation.pendingTakeover = { ...transition, previousRecordID: randomUUID() }; assert.throws(() => validateState(state));
  delete observation.pendingTakeover; observation.coordinator = 'codex:new'; observation.recordID = copied; observation.takeovers = [transition];
  assert.ok(validateState(state));
  observation.takeoverCancellations = [transition.id]; assert.throws(() => validateState(state));
  delete observation.takeoverCancellations; observation.recordID = original; assert.throws(() => validateState(state));
});

test('an expired pending host transfer survives broker startup until explicitly resolved', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-expired-transfer-')), agentId = 'opencode:worker';
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manualResume = { version: 2, taskID: randomUUID(), previewID: randomUUID(), channel: 'dev', claimGeneration: 1,
    from: '/source', to: '/destination', coordinator: 'codex:manager', recordID: randomUUID(), status: 'detached',
    hostTransfer: { id: randomUUID(), from: 'local', to: 'destination', sourceStopped: true, status: 'pending' } };
  const state = { version: 3, agents: { [agentId]: { agentId, hostId: 'local', harness: 'opencode', sessionId: 'worker', channel: 'dev',
    name: 'worker', role: 'fixture', project: { name: 'fixture', root: '/source' }, lastSeenAt: 1, disconnectedAt: 1, reservationExpiresAt: 2 } },
    bindings: { [agentId]: { hostId: 'local', proofHash: '4'.repeat(64), revoked: false, manualResume } }, messages: [] };
  writeFileSync(join(root, 'store.json'), JSON.stringify(state), { mode: 0o600 });
  const broker = createBroker({ directory: root, port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), now: () => 1000000 });
  await once(broker.server, 'listening');
  try {
    assert.ok(broker.store.agents[agentId]);
    broker.sweep();
    assert.ok(broker.store.agents[agentId]);
    assert.ok(broker.store.agents[agentId].reservationExpiresAt > 1000000);
  } finally { await broker.close(); }
});

test('normal broker startup supports manual-only worktree tasks without native handoff configuration', { timeout: 15000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-manual-start-'));
  writeFileSync(join(root, 'admin-token'), '2'.repeat(64), { mode: 0o600 });
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const url = `ws://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/broker.js'], { stdio: ['ignore', 'ignore', 'pipe'], env: {
    PATH: process.env.PATH, AGENT_CHANNEL_STATE_DIR: root, AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: '1'.repeat(64),
    AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_WORKTREE_GRANTS: '1', AGENT_CHANNEL_TASKS: '1', AGENT_CHANNEL_CODEX_TASKS: '1',
    AGENT_CHANNEL_WORKTREE_TASKS: '1', AGENT_CHANNEL_MANUAL_WORKTREE_ONLY: '1', AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS: '1',
  } });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'exit');
  const admin = new ChannelClient({ url, token: '2'.repeat(64), credentialDirectory: join(root, 'proofs') });
  t.after(async () => { admin.close(); if (child.exitCode === null) child.kill('SIGTERM'); await exited; rmSync(root, { recursive: true, force: true }); });
  for (let index = 0; index < 200 && !stderr.includes('Turnlink protocol v2 listening') && child.exitCode === null; index++) await delay(20);
  assert.match(stderr, /Turnlink protocol v2 listening/);
  const info = await admin.request('control_info');
  assert.equal(info.manualResumeEnabled, true); assert.equal(info.manualWorktreeOnlyEnabled, true);
  assert.equal(info.managedWorktreeRecordsEnabled, true); assert.equal(info.managedWorktreeExecutionEnabled, false);
  assert.deepEqual(info.receiverHandoffHarnesses, []);
});
