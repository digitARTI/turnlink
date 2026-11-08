import { digest, receiverHandoffKey } from './config.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { observeRestoredCodexSourceShutdown, observeRestoredCodexSourceModelShutdown } from './codex-publication-fixture.js';
import { setTimeout as delay } from 'node:timers/promises';

const unavailable = () => Object.assign(new Error('CODEX_PUBLICATION_RECOVERY_UNAVAILABLE'), { code: 'CODEX_PUBLICATION_RECOVERY_UNAVAILABLE' });

// Correlate historical native evidence under a current held receiver and grant.
// This is observation only: it cannot complete placement or release the hold.
export async function observeCodexPublicationRecovery(args) {
  const { client, agentId } = args;
  if (typeof client?.on !== 'function' || typeof client?.off !== 'function') throw unavailable();
  let invalidated = false;
  const disconnected = () => { invalidated = true; };
  const removed = event => { if (event?.agentId === agentId) invalidated = true; };
  client.on('disconnected', disconnected); client.on('membership_removed', removed);
  try { return await observePublication(args, () => invalidated); }
  finally { client.off('disconnected', disconnected); client.off('membership_removed', removed); }
}

async function observePublication(args, invalidated) {
  const { client, native, journal, agentId, mcpTransitionID, credential, credentialDirectory, signal, guard } = args;
  if (!client?.request || !(client.receiverKeys instanceof Map) || !(client.subscriptions instanceof Set) || typeof credential !== 'function' ||
      !journal?.snapshot || journal.agentId !== agentId || client.hostId !== journal.hostId ||
      !native?.usesClient?.(client) || typeof native.observeRestoredPublicationExact !== 'function' || !signal || typeof guard !== 'function') throw unavailable();
  const key = client.receiverKeys.get(agentId);
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
  let transitionID;
  const socket = client.socket, generation = client.subscriptionGenerations?.get(agentId);
  const local = () => {
    if (invalidated() || signal.aborted || client.hostId !== journal.hostId || client.socket !== socket ||
        client.subscriptionGenerations?.get(agentId) !== generation || !native.usesClient(client) ||
        (!client.subscriptions.has(agentId) || !client.activeSubscriptions?.has(agentId)) || client.receiverKeys.get(agentId) !== key) throw unavailable();
    if (transitionID) {
      let expected;
      try { expected = receiverHandoffKey(client.hostId, agentId, transitionID, credentialDirectory); }
      catch { throw unavailable(); }
      if (key !== expected) throw unavailable();
    }
    guard();
  };
  local();
  const before = journal.snapshot(), record = before.find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement;
  if (movement?.phase !== 'bound' || !movement.publication ||
      !['dispatching', 'uncertain', 'observed'].includes(movement.publication.phase) || !record.step.receipt) throw unavailable();
  const grant = WorktreeTransition.parse(movement.grant);
  if (grant.agentId !== agentId || grant.purpose || !['prepared', 'uncertain'].includes(grant.status)) throw unavailable();
  transitionID = grant.id;
  local();
  let sourceDetached;
  const request = async (method, params) => {
    for (let attempt = 0; ; attempt++) {
      try { return await client.request(method, params); }
      catch (error) {
        if (args.retryRateLimited !== true || error?.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' || attempt >= 30) throw error;
        await delay(100, undefined, { signal }); local();
      }
    }
  };
  const check = async action => {
    local(); const secret = await credential(); local();
    const authorized = await request('control_worktree_authorize', { agentId, channel: grant.channel, credential: secret, grant, action });
    local();
    const hold = await request('control_receiver_observe', { agentId, channel: grant.channel, credential: secret, transitionID: grant.id });
    local();
    if (!Stamp.safeParse(authorized?.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant) ||
        hold?.status !== 'held' || hold.transitionID !== grant.id || typeof hold.sourceDetached !== 'boolean' ||
        sourceDetached !== undefined && hold.sourceDetached !== sourceDetached ||
        JSON.stringify(journal.snapshot()) !== JSON.stringify(before)) throw unavailable();
    sourceDetached = hold.sourceDetached;
  };
  await check('observe-worktree');
  const publication = await native.observeRestoredPublicationExact(agentId.slice(6), record.plan.reservation, {
    operationID: movement.publication.operationID, transitionID: grant.id, stepID: record.step.receipt.stepID,
  });
  local();
  if (publication?.operationID !== movement.publication.operationID || publication.transitionID !== grant.id ||
      publication.stepID !== record.step.receipt.stepID || JSON.stringify(publication.reservation) !== JSON.stringify(record.plan.reservation) ||
      !['pending', 'uncertain', 'installed'].includes(publication.historicalStatus) || typeof publication.snapshotObserved !== 'boolean' ||
      publication.historicalStatus === 'installed' && !publication.snapshotObserved) throw unavailable();
  if (movement.publication.phase === 'observed' && (publication.historicalStatus !== 'installed' || !publication.snapshotObserved)) throw unavailable();
  let mcp = null, model = null;
  if (movement.publication.sourceShutdown) {
    await check('observe-source-mcp-shutdown');
    mcp = await observeRestoredCodexSourceShutdown(args); local();
  }
  if (movement.publication.sourceModelShutdown) {
    await check('observe-source-model-shutdown');
    model = await observeRestoredCodexSourceModelShutdown(args); local();
  }
  if (mcp) await check('observe-source-mcp-shutdown');
  if (model) await check('observe-source-model-shutdown');
  await check('observe-worktree');
  return { transitionID: grant.id, receiverHash: digest(key), sourceDetached, publication, mcp, model,
    unresolved: [...(publication.historicalStatus === 'installed' ? [] : ['PUBLICATION_INDETERMINATE']),
      ...(sourceDetached ? [] : ['SOURCE_DETACHMENT_PENDING']),
      'SOURCE_OWNER_NOT_RECONSTRUCTED', 'REMOTE_WORK_UNRECONCILED', 'DESTINATION_UNVERIFIED', 'RECEIVER_HELD'] };
}
