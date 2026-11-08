import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CodexContainedMcp } from './codex-contained-mcp.js';
import { WorktreeTransition } from './control/contracts.js';
import { codexVerifierLease } from './codex-verifier-lease.js';

const unavailable = () => new Error('CODEX_RETIRED_EFFECT_UNAVAILABLE');
const hash = value => createHash('sha256').update(value).digest('hex');
const equals = (left, right) => typeof left === 'string' && typeof right === 'string' && /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) &&
  timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

// Successor only observes an existing tombstone and the exact daemon. It never
// dispatches stop/remove and its retained lease fails on any native loss.
export function createCodexRetiredEffectVerifier({ grant: input, effectID, resourceID, owner, ownerProof, guard }) {
  const grant = WorktreeTransition.parse(input);
  z.string().uuid().parse(effectID); z.string().uuid().parse(resourceID); z.string().regex(/^[a-f0-9]{64}$/).parse(ownerProof);
  if (!(owner instanceof CodexContainedMcp) || typeof guard !== 'function' || !grant.sourceRetirement) throw unavailable();
  const entry = grant.sourceRetirement.owners.find(value => value.resourceID === resourceID);
  if (!entry?.daemonID) throw unavailable();
  const { names: _names, ...identity } = entry, grantDigest = hash(JSON.stringify(grant)), ownerProofHash = hash(ownerProof);
  return Object.freeze({ async verify({ phase, fence, ownerProof: supplied, signal }) {
    if (phase !== 'finish' || !signal || signal.aborted || !equals(hash(supplied), ownerProofHash) ||
        fence?.effectID !== effectID || fence.kind !== 'remove' || fence.resourceID !== resourceID ||
        fence.transitionID !== grant.id || fence.grantDigest !== grantDigest || fence.ownerProofHash !== ownerProofHash) throw unavailable();
    guard(); const observation = await owner.acquireRetiredObservation({ signal, expected: identity });
    let released = false;
    const release = () => { if (!released) { released = true; observation.release(); } };
    try {
      guard(); await observation.revalidate(); guard(); observation.check();
      const proof = { phase, effectID, status: 'completed', grantDigest, receiverHash: fence.receiverHash };
      Object.defineProperty(proof, codexVerifierLease, { value: { check() {
        try { if (released || signal.aborted) return false; guard(); return observation.check() === true; } catch { return false; }
      }, release } });
      return proof;
    } catch (error) { release(); throw Object.assign(unavailable(), { cause: error }); }
  } });
}
