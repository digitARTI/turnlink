import { identity } from './config.js';
import { Stamp, UUID, WorktreeTransition } from './control/contracts.js';

// ChannelClient removes the source subscription before emitting handoff.
// A notification alone is never authority to re-enable a lost receiver.
export function ownsCodexReceiver(client, threadId, state) {
  return !state?.receiverDisabled && client?.subscriptions instanceof Set && client?.activeSubscriptions instanceof Set &&
    client.subscriptions.has(identity('codex', threadId)) && client.activeSubscriptions.has(identity('codex', threadId));
}

// Invalidate asynchronous work before clearing locally buffered deliveries.
// This does not acknowledge native or remote resource detachment.
export function relinquishCodexReceiver({ agentId, threads, fence, health }) {
  health.forget(agentId);
  for (const [threadId, state] of threads) {
    if (identity('codex', threadId) !== agentId) continue;
    state.generation++;
    state.queue = []; state.roles = []; state.channel = null;
    state.taskPending = false; state.nativeSelection = null; state.receiverDisabled = true;
    fence.invalidate('NATIVE_RECEIVER_OWNERSHIP_LOST');
  }
}

export function isCodexSourceQuiet({ state, threads, fence, own, taskRequests, requests, approvals }) {
  return state.lifecycleKnown === true && Array.isArray(state.ledger?.records) && typeof state.ledger.matchesDisk === 'function' &&
    state.ledger.matchesDisk() === true && !state.turnId && !state.flushing && !state.taskBusy &&
    !state.controlPolling && !state.queue.length && !state.roles.length &&
    [...threads.values()].every(value => value.lifecycleKnown === true && !value.turnId && !value.flushing && !value.taskBusy && !value.controlPolling) &&
    !state.ledger.records.some(record => ['inflight', 'uncertain'].includes(record.state)) &&
    !own.size && !taskRequests.size && !requests.size && !approvals.size && !fence.queue.length && !fence.pending.size &&
    !fence.nativeTurns.size && !fence.serverRequests.size && !fence.unknownNativeActivity;
}

// The source commits only an offer for the exact already-staged live owner.
// Once dispatched, an ambiguous reply is never retried by this monitor.
export function makeCodexSourceOfferMonitor({ client, threads, fence, native, journalFor, credential, quiet, log }) {
  const attempted = new Set(), attemptedAgents = new Set(), inflight = new Set(), inflightAgents = new Set(); let closed = false;
  const offer = ({ agentId, offerID, grant: offered }) => {
    const parsed = WorktreeTransition.safeParse(offered);
    if (closed || !parsed.success || !UUID.safeParse(offerID).success || attempted.has(offerID) || inflight.has(offerID) ||
        attemptedAgents.has(agentId) || inflightAgents.has(agentId) || attempted.size + inflight.size >= 128 ||
        !agentId?.startsWith('codex:') || parsed.data.agentId !== agentId || parsed.data.status !== 'prepared') return;
    const threadId = agentId.slice(6), state = threads.get(threadId), grant = parsed.data, owner = fence.owner;
    if (!state || !owner || !native?.usesClient?.(client) || !native?.usesPublicationFence?.(fence)) return;
    const current = () => {
      if (closed || threads.get(threadId) !== state || fence.owner !== owner || !ownsCodexReceiver(client, threadId, state) ||
          state.channel !== grant.channel || !quiet(threadId, state)) throw new Error('CODEX_HANDOFF_SOURCE_UNAVAILABLE');
      fence.assertCurrentPublication(threadId);
      const journal = journalFor(agentId);
      if (client.hostId !== journal.hostId || journal.agentId !== agentId) throw new Error('CODEX_HANDOFF_SOURCE_UNAVAILABLE');
      const matches = journal.snapshot().filter(record => JSON.stringify(record.step?.movement?.grant) === JSON.stringify(grant));
      if (matches.length !== 1) throw new Error('CODEX_HANDOFF_SOURCE_UNAVAILABLE');
      const record = matches[0], movement = record.step.movement, publication = movement.publication;
      if (movement.phase !== 'bound' || publication?.phase !== 'observed' || publication.sourceShutdown?.phase !== 'observed' ||
          publication.sourceModelShutdown?.phase !== 'observed') throw new Error('CODEX_HANDOFF_SOURCE_UNAVAILABLE');
      native.assertHandoffSourceOwner(grant, record.plan.reservation, record.step.receipt, publication.operationID,
        publication.sourceShutdown.shutdownID, publication.sourceModelShutdown.shutdownID, fence);
    };
    inflight.add(offerID); inflightAgents.add(agentId); let dispatched = false;
    void (async () => {
      current(); const secret = await credential(); current();
      const checked = await client.request('control_worktree_authorize', { agentId, channel: grant.channel, credential: secret, grant, action: 'handoff-receiver' });
      current();
      if (!Stamp.safeParse(checked?.checkedAt).success || checked.checkedAt < grant.preparedAt ||
          JSON.stringify(WorktreeTransition.parse(checked.grant)) !== JSON.stringify(grant)) throw new Error('CODEX_HANDOFF_SOURCE_UNAVAILABLE');
      attempted.add(offerID); attemptedAgents.add(agentId);
      dispatched = true;
      await client.commitReceiverHandoff(agentId, secret, offerID, grant.channel);
      // A successful rotation without a source event is still ownership loss.
      if (fence.owner === owner && !owner.invalid) fence.invalidate('NATIVE_RECEIVER_OWNERSHIP_LOST');
    })().catch(error => {
      if (dispatched && fence.owner === owner) fence.invalidate('NATIVE_RECEIVER_HANDOFF_UNCERTAIN');
      log(error);
    }).finally(() => { inflight.delete(offerID); inflightAgents.delete(agentId); });
  };
  return { offer, close() { closed = true; } };
}

// Detachment acknowledges only the source receiver. Publication, physical
// resource cleanup and remote completion remain separate requirements.
export function makeCodexSourceDetachMonitor({ client, threads, fence, health, quiet, log }) {
  const entries = new Map();
  const held = (threadId, owner) => !fence.closed && fence.owner === owner && owner.threadID === threadId &&
    owner.publication === true && owner.publicationReady === true;
  const source = ({ agentId, offerID }) => {
    const found = [...threads].find(([threadId]) => identity('codex', threadId) === agentId);
    const [threadId, state] = found || [], owner = fence.owner;
    const safe = !!state && !!owner && held(threadId, owner) && !owner.invalid && quiet(threadId, state);
    relinquishCodexReceiver({ agentId, threads, fence, health });
    if (safe) entries.set(offerID, { agentId, threadId, state, owner, generation: state.generation, running: false });
  };
  const check = ({ agentId, offerID }) => {
    const entry = entries.get(offerID);
    if (!entry || entry.agentId !== agentId || entry.running) return;
    const current = () => entries.get(offerID) === entry && threads.get(entry.threadId) === entry.state &&
      entry.state.generation === entry.generation && entry.state.receiverDisabled === true &&
      !ownsCodexReceiver(client, entry.threadId) && held(entry.threadId, entry.owner) && !!entry.owner.invalid && quiet(entry.threadId, entry.state);
    if (!current() || typeof entry.state.ledger?.withStableSnapshot !== 'function') { entries.delete(offerID); return; }
    entry.running = true;
    void entry.state.ledger.withStableSnapshot(async guard => {
      guard(); if (!current()) throw new Error('CODEX_SOURCE_DETACH_UNAVAILABLE');
      await client.ackReceiverHandoff(agentId, offerID);
      guard(); if (!current()) throw new Error('CODEX_SOURCE_DETACH_UNAVAILABLE');
      entries.delete(offerID);
    }).catch(log).finally(() => { entry.running = false; });
  };
  return { source, check, close() { entries.clear(); } };
}
