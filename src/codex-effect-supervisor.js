import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CodexContainedMcp } from './codex-contained-mcp.js';
import { WorktreeTransition } from './control/contracts.js';
import { codexVerifierLease } from './codex-verifier-lease.js';

const unavailable = () => Object.assign(new Error('CODEX_EFFECT_SUPERVISOR_UNAVAILABLE'), { code: 'CODEX_EFFECT_SUPERVISOR_UNAVAILABLE' });
const hash = value => createHash('sha256').update(value).digest('hex');
const equals = (left, right) => typeof left === 'string' && typeof right === 'string' && /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) &&
  timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

// In-process test/embedding primitive only. A production broker needs a
// separately authenticated transport and durable owner recovery; this object
// cannot reconstruct an in-flight operation after process death.
export function createCodexEffectSupervisor({ grant: input, effectID, kind, resourceID, owner, ownerProof, guard, nativeWitness }) {
  const grant = WorktreeTransition.parse(input);
  z.string().uuid().parse(effectID); z.string().uuid().parse(resourceID); z.string().regex(/^[a-f0-9]{64}$/).parse(ownerProof);
  if (!['stop', 'remove'].includes(kind) || !(owner instanceof CodexContainedMcp) || typeof guard !== 'function' || !grant.sourceRetirement) throw unavailable();
  const planOwner = grant.sourceRetirement.owners.find(value => value.resourceID === resourceID);
  if (!planOwner) throw unavailable();
  const { names: _names, ...identity } = planOwner, grantDigest = hash(JSON.stringify(grant)), ownerProofHash = hash(ownerProof);
  if (nativeWitness && (nativeWitness.transitionID !== grant.id || nativeWitness.grantDigest !== grantDigest ||
      typeof nativeWitness.check !== 'function')) throw unavailable();
  let state = 'prepared', closed = false, inFlight = false, operation;
  const check = () => { if (closed) throw unavailable(); guard(); if (nativeWitness && nativeWitness.check() !== true) throw unavailable(); return true; };
  return Object.freeze({
    async wait() {
      if (!operation) throw unavailable();
      return operation;
    },
    async verify({ phase, fence, ownerProof: supplied, signal }) {
      check();
      if (!signal || signal.aborted || nativeWitness && nativeWitness.receiverHash !== fence?.receiverHash ||
          !equals(hash(supplied), ownerProofHash) || fence?.effectID !== effectID || fence.kind !== kind ||
          fence.resourceID !== resourceID || fence.grantDigest !== grantDigest || fence.ownerProofHash !== ownerProofHash ||
          (phase === 'begin' ? state !== 'prepared' || inFlight : phase !== 'finish' || state !== 'completed' || inFlight)) throw unavailable();
      let released = false;
      const expected = state;
      const lease = { check() { if (released || signal.aborted || state !== expected || inFlight) return false; try { return check(); } catch { return false; } }, release() { released = true; } };
      if (phase === 'begin') lease.commit = () => {
        if (!lease.check()) throw unavailable();
        state = 'dispatched'; inFlight = true;
        // Start the single admitted operation synchronously in the broker turn
        // that commits the durable fence, before another request can queue a
        // revocation. A rejected/lost result is never replayed here.
        operation = (async () => {
          try {
            const result = await (kind === 'stop' ? owner.stopExact(identity) : owner.retireExact(identity));
            check();
            if (kind === 'stop' ? !['stopped_local', 'removed_local'].includes(result?.status) : result?.status !== 'removed_local') throw unavailable();
            state = 'completed'; return result;
          } catch (error) { state = 'uncertain'; throw error; }
          finally { inFlight = false; }
        })();
        operation.catch(() => {});
      };
      const result = { phase, effectID, status: phase === 'begin' ? 'armed' : 'completed', grantDigest, receiverHash: fence.receiverHash };
      Object.defineProperty(result, codexVerifierLease, { value: lease }); return result;
    },
    close() { closed = true; },
  });
}
