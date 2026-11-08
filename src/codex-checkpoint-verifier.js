import { CodexNativeControl } from './codex-native-control.js';
import { CheckpointMetadata, CheckpointReservation } from './control/checkpoint-observation.js';
import { WorktreeTransition } from './control/contracts.js';
import { codexVerifierLease } from './codex-verifier-lease.js';
import { codexCheckpointDestination, CheckpointGuestReceipt } from './control/checkpoint-destination.js';

const unavailable = () => new Error('CHECKPOINT_OBSERVATION_UNAVAILABLE');

// Fixture owner only: caller must own the native descriptor and guard. The
// observation is not a policy approval or an OS isolation assertion.
export function makeCodexCheckpointVerifier({ native, client, guard, stage }) {
  if (!(native instanceof CodexNativeControl) || !client || !(client.subscriptions instanceof Set) ||
      typeof guard !== 'function' || !native.usesClient(client) || (stage !== undefined &&
      (typeof stage?.check !== 'function' || typeof stage?.transfer !== 'function' || !/^[a-f0-9]{64}$/.test(stage.vmInstance || '')))) throw unavailable();
  return async ({ grant: input, reservation: inputReservation, hostId, signal }) => {
    const grant = WorktreeTransition.parse(input), reservation = CheckpointReservation.parse(inputReservation);
    const socket = client.socket, generation = client.subscriptionGenerations?.get(grant.agentId);
    const check = () => {
      if (!signal || signal.aborted || client.closed || client.hostId !== hostId || client.socket !== socket ||
          client.subscriptionGenerations?.get(grant.agentId) !== generation ||
          (!client.subscriptions.has(grant.agentId) || !client.activeSubscriptions?.has(grant.agentId)) || !native.usesClient(client)) throw unavailable();
      guard();
      if (stage) { const valid = stage.check(); if (valid && typeof valid.then === 'function' || valid === false) throw unavailable(); }
    };
    try {
      check();
      const { rollout, journal, releaseAllowed, ...raw } = await native.exportCheckpoint(grant, reservation);
      const metadata = CheckpointMetadata.parse(raw);
      check();
      await native.watchCheckpointSnapshot(grant, reservation, metadata);
      check();
      let released = false, closed = false;
      const stageAbort = new AbortController(), abort = () => stageAbort.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) stageAbort.abort();
      const unlisten = native.onClose(() => { closed = true; stageAbort.abort(); });
      const proof = { ...metadata };
      if (stage) Object.defineProperty(proof, codexCheckpointDestination, { value: {
        vmInstance: stage.vmInstance,
        async dispatch() {
          if (released || closed) throw unavailable(); check();
          const receipt = CheckpointGuestReceipt.parse(await stage.transfer({ checkpoint: { ...metadata, rollout, journal, releaseAllowed }, grant, signal: stageAbort.signal }));
          if (receipt.vmInstance !== stage.vmInstance || receipt.checkpointDigest !== metadata.digest) throw unavailable();
          check(); return receipt;
        },
      } });
      Object.defineProperty(proof, codexVerifierLease, { value: {
        check() { if (released || closed) throw unavailable(); check(); },
        release() { if (!released) { released = true; signal.removeEventListener('abort', abort); stageAbort.abort(); unlisten(); native.close(); } },
      } });
      return proof;
    } catch { native.close(); throw unavailable(); }
  };
}
