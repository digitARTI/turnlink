import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ControlGateway } from '../src/control/gateway.js';
import { digest } from '../src/config.js';
import { OpenCodeContainedOwner } from '../src/opencode-contained-owner.js';
import { makeContainedOwnerTakeoverVerifier } from '../src/opencode-container-takeover-verifier.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { createOpenCodeTakeoverVerifierServer, makeRemoteOpenCodeTakeoverVerifier } from '../src/opencode-takeover-verifier-transport.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('held owner recovery rejects a changed or revoked task claim before authorizing a grant', () => {
  const agent = { agentId: 'opencode:ses_test', channel: 'dev', harness: 'opencode' }, taskID = randomUUID();
  const grant = { id: randomUUID(), channel: 'dev', agentId: agent.agentId, taskID, previewID: randomUUID(), claimGeneration: 3,
    from: '/old', to: '/next', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64), preparedAt: 1, status: 'prepared' };
  const token = '3'.repeat(64), gateway = Object.create(ControlGateway.prototype);
  Object.assign(gateway, { worktreeGrants: true, now: () => 100, boundMember: () => agent, receiver: () => undefined,
    members: () => [{ ...agent, connected: false }], store: { adapterDigest: () => digest(token), snapshot: () => ({ tasks: [] }) } });
  const socket = { principal: { hostId: 'local', admin: false } }, params = { agentId: agent.agentId, channel: 'dev', credential: token, grant };
  for (const task of [undefined, { id: taskID, channel: 'dev', status: 'open', claimant: null, claimGeneration: 3 },
    { id: taskID, channel: 'dev', status: 'claimed', claimant: agent.agentId, claimGeneration: 4 },
    { id: taskID, channel: 'dev', status: 'claimed', claimant: 'opencode:other', claimGeneration: 3 },
    { id: taskID, channel: 'dev', status: 'claimed', claimant: agent.agentId, claimGeneration: 3, terminalHold: true }]) {
    gateway.store.snapshot = () => ({ tasks: task ? [task] : [] });
    assert.throws(() => gateway.receiverRecoveryCandidate(socket, params), /STALE_TASK_CLAIM/);
  }
});

test('authenticated takeover verifier retains and revokes the native lease', async () => {
  const agentId = 'opencode:ses_test', grant = { id: randomUUID(), channel: 'dev', agentId, taskID: randomUUID(), previewID: randomUUID(), claimGeneration: 1,
    from: '/old', to: '/next', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64), preparedAt: 1, status: 'prepared' };
  const previous = { version: 1, generation: randomUUID(), containerID: 'f'.repeat(64), daemonID: 'daemon', operationID: randomUUID(),
    volume: { name: `turnlink-opencode-volume-${randomUUID()}`, createdAt: 'fixture-date', destination: '/var/lib/turnlink' } };
  const successor = { ...previous, generation: randomUUID(), containerID: 'e'.repeat(64), operationID: randomUUID() };
  const oldLease = randomUUID(), newLease = randomUUID(); let onClose;
  const intent = { sessionID: 'ses_test', transitionID: grant.id, leaseIncarnation: oldLease, source: { directory: grant.from }, directory: grant.to };
  const claim = { previousLeaseIncarnation: oldLease, leaseIncarnation: newLease };
  const native = { inspect: async () => intent, inspectRecovery: async () => ({ recovery: claim }),
    observeRecoveryTransport: async () => ({ intent, recovery: claim, release: { family: 'session-model-websocket' } }),
    onClose: callback => { onClose = callback; return () => {}; } };
  const root = mkdtempSync('/private/tmp/ttv-'), path = join(root, 'v.sock'), controller = new AbortController();
  const server = await createOpenCodeTakeoverVerifierServer({ path, secret: '7'.repeat(64), native, grant, hostId: 'local', successor, signal: controller.signal });
  try {
    const verify = makeRemoteOpenCodeTakeoverVerifier({ path, secret: '7'.repeat(64) });
    const normalInspect = native.inspect;
    native.inspect = async () => { await delay(80); return intent; };
    const cancelled = new AbortController(), pending = verify({ grant, hostId: 'local', previous, oldReceiverHash: '1'.repeat(64),
      targetReceiverHash: '2'.repeat(64), signal: cancelled.signal });
    setTimeout(() => cancelled.abort(), 20);
    await assert.rejects(pending, /NATIVE_TAKEOVER_VERIFICATION_UNAVAILABLE/);
    await assert.rejects(verify({ grant, hostId: 'local', previous, oldReceiverHash: '1'.repeat(64),
      targetReceiverHash: '2'.repeat(64), signal: controller.signal }), /NATIVE_TAKEOVER_VERIFICATION_UNAVAILABLE/);
    await delay(200); native.inspect = normalInspect;
    const proof = await verify({ grant, hostId: 'local', previous, oldReceiverHash: '1'.repeat(64), targetReceiverHash: '2'.repeat(64), signal: controller.signal });
    assert.equal(proof.currentLease, newLease); assert.equal(proof[codexVerifierLease].check(), true);
    onClose(); await delay(20); assert.throws(() => proof[codexVerifierLease].check());
  } finally { controller.abort(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test('contained takeover rejects a revoked lease or changed successor observation', async () => {
  const agentId = 'opencode:ses_test', grant = { id: randomUUID(), channel: 'dev', agentId, taskID: randomUUID(), previewID: randomUUID(), claimGeneration: 1,
    from: '/old', to: '/next', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64), preparedAt: 1, status: 'prepared' };
  const previous = { version: 1, generation: randomUUID(), containerID: 'f'.repeat(64), daemonID: 'daemon', operationID: randomUUID(),
    volume: { name: `turnlink-opencode-volume-${randomUUID()}`, createdAt: 'fixture-date', destination: '/var/lib/turnlink' } };
  const successor = { ...previous, generation: randomUUID(), containerID: 'e'.repeat(64), operationID: randomUUID() };
  const identity = { daemonID: successor.daemonID, operationID: successor.operationID, containerID: successor.containerID,
    previous: { daemonID: previous.daemonID, operationID: previous.operationID, containerID: previous.containerID, volume: previous.volume } };
  for (const failure of ['revoked', 'changed']) {
    let observations = 0, checks = 0, released = 0;
    const owner = Object.create(OpenCodeContainedOwner.prototype);
    owner.observeVolumeSuccessor = async () => { observations++; return failure === 'changed' && observations === 2 ? { ...identity, containerID: 'd'.repeat(64) } : identity; };
    const nativeVerifier = async input => {
      const proof = { version: 1, hostId: input.hostId, agentId, channel: 'dev', transitionID: grant.id,
        oldReceiverHash: input.oldReceiverHash, targetReceiverHash: input.targetReceiverHash, previous, successor,
        previousLease: randomUUID(), currentLease: randomUUID() };
      Object.defineProperty(proof, codexVerifierLease, { value: { check: () => ++checks === 1 || failure !== 'revoked', release: () => { released++; } } });
      return proof;
    };
    Object.defineProperty(nativeVerifier, 'requiresLease', { value: true });
    const verify = makeContainedOwnerTakeoverVerifier({ owner, nativeVerifier });
    await assert.rejects(verify({ grant, hostId: 'local', previous, oldReceiverHash: '1'.repeat(64), targetReceiverHash: '2'.repeat(64),
      signal: new AbortController().signal }), /CONTAINED_TAKEOVER_UNAVAILABLE/);
    assert.equal(released, 1);
  }
});
