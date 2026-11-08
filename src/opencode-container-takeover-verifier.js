import { z } from 'zod';
import { OpenCodeContainedOwner } from './opencode-contained-owner.js';
import { observeContainedOwner } from './opencode-contained-observations.js';
import { OpenCodeContainment } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { codexVerifierLease, releaseCodexVerifierLease } from './codex-verifier-lease.js';

const unavailable = () => new Error('CONTAINED_TAKEOVER_UNAVAILABLE');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidence = z.strictObject({ version: z.literal(1), hostId: z.string(), agentId: z.string(), channel: z.string(),
  transitionID: z.string().uuid(), oldReceiverHash: hash, targetReceiverHash: hash, previous: OpenCodeContainment,
  successor: OpenCodeContainment, previousLease: z.string().uuid(), currentLease: z.string().uuid() });

// `nativeVerifier` is configured by the broker host, not the candidate. It
// authenticates the successor's native recovery observation and retains its
// connection. The host independently brackets it with Docker observations.
export function makeContainedOwnerTakeoverVerifier({ owner, nativeVerifier }) {
  if (!(owner instanceof OpenCodeContainedOwner) || typeof nativeVerifier !== 'function' || nativeVerifier.requiresLease !== true) throw unavailable();
  const verify = async ({ grant: value, hostId, previous: old, oldReceiverHash, targetReceiverHash, signal }) => {
    const grant = WorktreeTransition.parse(value), previous = OpenCodeContainment.parse(old);
    if (!signal || signal.aborted || !grant.agentId.startsWith('opencode:') || grant.status !== 'prepared' || grant.purpose ||
        !hash.safeParse(oldReceiverHash).success || !hash.safeParse(targetReceiverHash).success) throw unavailable();
    const identity = { daemonID: previous.daemonID, operationID: previous.operationID, containerID: previous.containerID, volume: previous.volume };
    const before = await observeContainedOwner(owner, () => owner.observeVolumeSuccessor(identity));
    if (signal.aborted) throw unavailable();
    let raw;
    try {
      raw = await nativeVerifier({ grant, hostId, previous, oldReceiverHash, targetReceiverHash, signal });
      const lease = raw?.[codexVerifierLease];
      if (typeof lease?.check !== 'function' || typeof lease?.release !== 'function' || lease.check() !== true || signal.aborted) throw unavailable();
      const proof = evidence.parse(raw);
      if (proof.hostId !== hostId || proof.agentId !== grant.agentId || proof.channel !== grant.channel || proof.transitionID !== grant.id ||
          proof.oldReceiverHash !== oldReceiverHash || proof.targetReceiverHash !== targetReceiverHash ||
          JSON.stringify(proof.previous) !== JSON.stringify(previous) || proof.previousLease === proof.currentLease ||
          proof.successor.containerID !== before.containerID || proof.successor.operationID !== before.operationID ||
          proof.successor.daemonID !== before.daemonID || JSON.stringify(proof.successor.volume) !== JSON.stringify(previous.volume) ||
          proof.successor.generation === previous.generation) throw unavailable();
      const after = await observeContainedOwner(owner, () => owner.observeVolumeSuccessor(identity));
      if (signal.aborted || JSON.stringify(before) !== JSON.stringify(after) || lease.check() !== true) throw unavailable();
      Object.defineProperty(proof, codexVerifierLease, { value: lease });
      return proof;
    } catch { releaseCodexVerifierLease(raw); throw unavailable(); }
  };
  Object.defineProperty(verify, 'requiresLease', { value: true });
  return verify;
}
