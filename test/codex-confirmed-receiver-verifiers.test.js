import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CodexNativeControl } from '../src/codex-native-control.js';
import { CodexResourceJournal } from '../src/codex-resource-journal.js';
import { recoverRestoredCodexDestinationCancellation } from '../src/codex-movement-coordinator.js';
import { makeCodexCheckpointVerifier } from '../src/codex-checkpoint-verifier.js';
import { makeCodexDestinationCancellationVerifier } from '../src/codex-destination-cancellation-verifier.js';

function fixture() {
  const threadId = randomUUID(), agentId = `codex:${threadId}`, stepID = randomUUID();
  const grant = { id: randomUUID(), channel: 'dev', taskID: randomUUID(), agentId, previewID: randomUUID(), claimGeneration: 1,
    from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64),
    checkpointConfigSha256: 'c'.repeat(64), status: 'prepared', preparedAt: 1,
    destinationOwners: { mcpTransitionID: randomUUID(), providerTransitionID: randomUUID(), mcpResourceID: randomUUID(), providerResourceID: randomUUID(), stepID } };
  const reservation = { generation: randomUUID(), revision: 1 }, client = Object.assign(new EventEmitter(), {
    hostId: 'local', subscriptions: new Set([agentId]), activeSubscriptions: new Set([agentId]), closed: false });
  const native = Object.create(CodexNativeControl.prototype); native.usesClient = value => value === client;
  native.close = () => {}; native.onClose = () => () => {};
  return { threadId, agentId, grant, reservation, client, native, signal: new AbortController().signal };
}

test('checkpoint verifier rejects desired-only receiver before export and after native reply', async () => {
  const f = fixture(); let exports = 0;
  const metadata = { version: 1, threadId: f.threadId, transitionId: f.grant.id, reservation: f.reservation,
    digest: 'd'.repeat(64), rolloutSha256: 'e'.repeat(64), journalSha256: 'f'.repeat(64), rolloutBytes: 1, journalBytes: 1 };
  f.native.exportCheckpoint = async () => { exports++; f.client.activeSubscriptions.clear(); return { ...metadata, rollout: Buffer.from('a'), journal: Buffer.from('b'), releaseAllowed: false }; };
  f.native.watchCheckpointSnapshot = async () => { throw new Error('must not watch'); };
  const verify = makeCodexCheckpointVerifier({ native: f.native, client: f.client, guard() {} });
  f.client.activeSubscriptions.clear();
  await assert.rejects(verify({ grant: f.grant, reservation: f.reservation, hostId: 'local', signal: f.signal }), /CHECKPOINT_OBSERVATION_UNAVAILABLE/);
  assert.equal(exports, 0);
  f.client.activeSubscriptions.add(f.agentId);
  await assert.rejects(verify({ grant: f.grant, reservation: f.reservation, hostId: 'local', signal: f.signal }), /CHECKPOINT_OBSERVATION_UNAVAILABLE/);
  assert.equal(exports, 1);
});

test('cancellation verifier requires an active subscription before native observation', async () => {
  const f = fixture(), journal = Object.create(CodexResourceJournal.prototype);
  Object.defineProperties(journal, { hostId: { value: 'local' }, agentId: { value: f.agentId } });
  const receipt = { cancellationID: randomUUID(), transitionID: f.grant.id, stepID: f.grant.destinationOwners.stepID };
  let calls = 0; f.native.observeDestinationGrantCancellation = async () => { calls++; return receipt; };
  journal.entries = () => [{ transitionID: f.grant.destinationOwners.mcpTransitionID, plan: { reservation: f.reservation },
    step: { receipt: { stepID: receipt.stepID }, movement: { phase: 'settling', grant: f.grant, cancellationReceipt: receipt, settlementID: randomUUID() } } }];
  const verify = makeCodexDestinationCancellationVerifier({ native: f.native, journal, client: f.client, guard() {} });
  f.client.activeSubscriptions.clear();
  await assert.rejects(verify({ grant: f.grant, receipt, hostId: 'local', signal: f.signal }), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
  assert.equal(calls, 0);
});


test('movement recovery refuses desired-only receiver before reading or dispatching', async () => {
  const f = fixture(); let reads = 0, calls = 0;
  f.client.activeSubscriptions.clear(); f.client.request = async () => { calls++; };
  f.native.observeRestoredDestinationCancellation = async () => { calls++; };
  const journal = { hostId: 'local', agentId: f.agentId, exclusive: async fn => fn(), entries() { reads++; return []; } };
  await assert.rejects(recoverRestoredCodexDestinationCancellation({ client: f.client, native: f.native, journal, agentId: f.agentId,
    mcpTransitionID: f.grant.destinationOwners.mcpTransitionID, credential: async () => 'x', signal: f.signal, guard() {},
    verifierService: { register() {} } }), /CODEX_MOVEMENT_COORDINATION_UNAVAILABLE/);
  assert.equal(reads, 0); assert.equal(calls, 0);
});

test('checkpoint verifier rejects receiver reacquired while export is in flight', async () => {
  const f = fixture(); f.client.subscriptionGenerations = new Map([[f.agentId, 1]]); f.client.socket = {};
  let watched = false;
  const metadata = { version: 1, threadId: f.threadId, transitionId: f.grant.id, reservation: f.reservation,
    digest: 'd'.repeat(64), rolloutSha256: 'e'.repeat(64), journalSha256: 'f'.repeat(64), rolloutBytes: 1, journalBytes: 1 };
  f.native.exportCheckpoint = async () => {
    f.client.activeSubscriptions.delete(f.agentId); f.client.subscriptionGenerations.set(f.agentId, 2);
    f.client.activeSubscriptions.add(f.agentId);
    return { ...metadata, rollout: Buffer.from('a'), journal: Buffer.from('b'), releaseAllowed: false };
  };
  f.native.watchCheckpointSnapshot = async () => { watched = true; };
  const verify = makeCodexCheckpointVerifier({ native: f.native, client: f.client, guard() {} });
  await assert.rejects(verify({ grant: f.grant, reservation: f.reservation, hostId: 'local', signal: f.signal }), /CHECKPOINT_OBSERVATION_UNAVAILABLE/);
  assert.equal(watched, false);
});

test('cancellation verifier rejects receiver reacquired during native observation', async () => {
  const f = fixture(), journal = Object.create(CodexResourceJournal.prototype);
  f.client.socket = {}; f.client.subscriptionGenerations = new Map([[f.agentId, 1]]);
  Object.defineProperties(journal, { hostId: { value: 'local' }, agentId: { value: f.agentId } });
  const receipt = { cancellationID: randomUUID(), transitionID: f.grant.id, stepID: f.grant.destinationOwners.stepID };
  const settlementID = randomUUID();
  journal.entries = () => [{ transitionID: f.grant.destinationOwners.mcpTransitionID, plan: { reservation: f.reservation },
    step: { receipt: { stepID: receipt.stepID }, movement: { phase: 'settling', grant: f.grant, cancellationReceipt: receipt, settlementID } } }];
  f.native.observeDestinationGrantCancellation = async () => {
    f.client.activeSubscriptions.delete(f.agentId); f.client.subscriptionGenerations.set(f.agentId, 2);
    f.client.activeSubscriptions.add(f.agentId); return receipt;
  };
  const verify = makeCodexDestinationCancellationVerifier({ native: f.native, journal, client: f.client, guard() {} });
  await assert.rejects(verify({ grant: f.grant, receipt, hostId: 'local', signal: f.signal }), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
});
