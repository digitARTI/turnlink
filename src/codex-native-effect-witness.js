import { digest, receiverHandoffKey } from './config.js';
import { WorktreeTransition } from './control/contracts.js';
import { observeCodexPublicationRecovery } from './codex-publication-recovery.js';
import { createCodexEffectVerifierServer } from './codex-effect-verifier-transport.js';
import { codexVerifierLease } from './codex-verifier-lease.js';
import { z } from 'zod';

const unavailable = () => new Error('CODEX_NATIVE_EFFECT_WITNESS_UNAVAILABLE');

// Process-local retained witness. It proves that the native control connection
// and exact receiver remain attached after a real native observation; it is not
// a transferable lease and does not establish remote-work or store isolation.
export async function acquireCodexNativeEffectWitness(args) {
  const { client, native, journal, agentId, mcpTransitionID, signal, guard, credentialDirectory } = args;
  if (!agentId?.startsWith('codex:') || !client?.on || !client?.off || !native?.onClose || !native?.usesClient ||
      !journal?.snapshot || journal.agentId !== agentId || journal.hostId !== client.hostId ||
      !signal || signal.aborted || typeof guard !== 'function') throw unavailable();
  const socket = client.socket, generation = client.subscriptionGenerations?.get(agentId);
  let closed = false, detach = () => {}, baseline, receiverKey, transitionID; const listeners = new Set();
  const invalidate = () => release();
  const removed = event => { if (event?.agentId === agentId) release(); };
  const release = () => {
    if (closed) return;
    closed = true; signal.removeEventListener('abort', invalidate); client.off('disconnected', invalidate);
    client.off('membership_removed', removed); detach();
    for (const listener of listeners) { try { listener(); } catch { /* invalidation remains final */ } }
    listeners.clear();
  };
  const check = () => {
    try {
      if (closed || signal.aborted || journal.hostId !== client.hostId || client.socket !== socket ||
          client.subscriptionGenerations?.get(agentId) !== generation || !native.usesClient(client) ||
          (!client.subscriptions?.has(agentId) || !client.activeSubscriptions?.has(agentId)) || client.receiverKeys?.get(agentId) !== receiverKey ||
          receiverHandoffKey(client.hostId, agentId, transitionID, credentialDirectory) !== receiverKey ||
          JSON.stringify(journal.snapshot()) !== baseline) throw unavailable();
      guard(); return true;
    } catch { release(); throw unavailable(); }
  };
  try {
    const records = journal.snapshot(), record = records.find(value => value.transitionID === mcpTransitionID);
    const grant = WorktreeTransition.parse(record?.step?.movement?.grant);
    const movement = record?.step?.movement, publication = movement?.publication, captured = publication?.contained;
    if (!grant.sourceRetirement || grant.agentId !== agentId || movement.phase !== 'bound' || publication?.phase !== 'observed' ||
        publication.sourceShutdown?.phase !== 'observed' || publication.sourceModelShutdown?.phase !== 'observed' ||
        !Array.isArray(captured) || captured.length !== grant.sourceRetirement.owners.length) throw unavailable();
    for (const expected of grant.sourceRetirement.owners) {
      const saved = captured.find(item => item.resourceID === expected.resourceID), { daemonID: _daemon, ...identity } = expected;
      if (!saved || JSON.stringify({ ...saved, names: [...saved.names].sort() }) !== JSON.stringify(identity)) throw unavailable();
    }
    baseline = JSON.stringify(records); transitionID = grant.id; receiverKey = client.receiverKeys?.get(agentId);
    if (!/^[a-f0-9]{64}$/.test(receiverKey || '')) throw unavailable();
    signal.addEventListener('abort', invalidate, { once: true }); client.on('disconnected', invalidate);
    client.on('membership_removed', removed); detach = native.onClose(invalidate); check();
    const evidence = await observeCodexPublicationRecovery({ ...args, retryRateLimited: true }); check();
    if (evidence.transitionID !== transitionID || !evidence.sourceDetached ||
        evidence.publication?.historicalStatus !== 'installed' || !evidence.publication.snapshotObserved ||
        evidence.mcp?.historicalStatus !== 'closed' || !['closed', 'absent'].includes(evidence.model?.historicalStatus)) throw unavailable();
    return Object.freeze({ transitionID, receiverHash: evidence.receiverHash, grantDigest: digest(JSON.stringify(grant)), check, release,
      onInvalidate(listener) { if (typeof listener !== 'function') throw unavailable(); if (closed) { listener(); return () => {}; }
        listeners.add(listener); return () => listeners.delete(listener); } });
  } catch (error) { release(); throw Object.assign(unavailable(), { cause: error }); }
}

// Local authenticated bridge for one exact effect. Socket lifetime carries
// invalidation to the remote supervisor; it does not make Docker calls atomic
// with native liveness or prove safety of a disconnected native process.
export async function serveCodexNativeEffectWitness({ path, secret, witness, effectID, kind, resourceID, ownerProof }) {
  z.string().uuid().parse(effectID); z.string().uuid().parse(resourceID); z.string().regex(/^[a-f0-9]{64}$/).parse(ownerProof);
  if (!['stop', 'remove'].includes(kind) || typeof witness?.check !== 'function' || typeof witness?.onInvalidate !== 'function') throw unavailable();
  const ownerProofHash = digest(ownerProof); witness.check();
  const supervisor = { async verify({ phase, fence, ownerProof: supplied, signal }) {
    witness.check();
    if (phase !== 'begin' || !signal || signal.aborted || digest(supplied) !== ownerProofHash ||
        fence?.effectID !== effectID || fence.kind !== kind || fence.resourceID !== resourceID || fence.transitionID !== witness.transitionID ||
        fence.ownerProofHash !== ownerProofHash || fence.grantDigest !== witness.grantDigest || fence.receiverHash !== witness.receiverHash) throw unavailable();
    let released = false;
    const result = { phase, effectID, status: 'armed', grantDigest: witness.grantDigest, receiverHash: witness.receiverHash };
    Object.defineProperty(result, codexVerifierLease, { value: { check() { if (released || signal.aborted) return false;
      try { return witness.check(); } catch { return false; } }, commit() { witness.check(); }, release() { released = true; } } });
    return result;
  } };
  const server = await createCodexEffectVerifierServer({ path, secret, supervisor });
  const detach = witness.onInvalidate(() => { void server.close(); });
  return Object.freeze({ async close() { detach(); await server.close(); } });
}
