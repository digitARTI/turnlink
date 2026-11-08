import { CodexNativeControl } from './codex-native-control.js';
import { CodexResourceJournal, CodexMovementCancellationReceipt } from './codex-resource-journal.js';
import { WorktreeTransition } from './control/contracts.js';
import { codexVerifierLease } from './codex-verifier-lease.js';

const unavailable = () => new Error('DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');

// The creator must own the actual native control and admission fence in the
// trusted owner process. The journal is held exclusively by the settlement
// coordinator throughout this callback; a remote adapter assertion is not a
// substitute for either this native owner or that fence.
export function makeCodexDestinationCancellationVerifier({ native, journal, client, guard, restored = false }) {
  if (!(native instanceof CodexNativeControl) || !(journal instanceof CodexResourceJournal) ||
      !client || !(client.subscriptions instanceof Set) || typeof guard !== 'function' || typeof restored !== 'boolean' || !native.usesClient(client)) throw unavailable();
  return async ({ grant: input, receipt: inputReceipt, hostId, signal }) => {
    const grant = WorktreeTransition.parse(input), receipt = CodexMovementCancellationReceipt.parse(inputReceipt);
    const socket = client.socket, generation = client.subscriptionGenerations?.get(grant.agentId);
    const check = () => {
      if (!signal || signal.aborted || client.closed || client.hostId !== hostId || journal.hostId !== hostId ||
          client.socket !== socket || client.subscriptionGenerations?.get(grant.agentId) !== generation ||
          journal.agentId !== grant.agentId || (!client.subscriptions.has(grant.agentId) || !client.activeSubscriptions?.has(grant.agentId)) || !native.usesClient(client)) throw unavailable();
      guard();
    };
    const snapshot = () => {
      check();
      const record = journal.entries().find(row => row.transitionID === grant.destinationOwners?.mcpTransitionID);
      const movement = record?.step?.movement;
      if (!record || !movement || !['settling', 'settlement_uncertain'].includes(movement.phase) ||
          JSON.stringify(movement.grant) !== JSON.stringify(grant) ||
          JSON.stringify(movement.cancellationReceipt) !== JSON.stringify(receipt) ||
          receipt.transitionID !== grant.id || receipt.stepID !== grant.destinationOwners?.stepID ||
          record.step.receipt?.stepID !== receipt.stepID || !movement.settlementID) throw unavailable();
      return { reservation: record.plan.reservation, retained: record.step.receipt, movement };
    };
    const before = snapshot();
    const observe = restored ? native.observeRestoredDestinationCancellation.bind(native) : native.observeDestinationGrantCancellation.bind(native);
    const observed = CodexMovementCancellationReceipt.parse(await observe(grant, before.reservation, before.retained, receipt.cancellationID));
    const after = snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(observed) !== JSON.stringify(receipt)) throw unavailable();
    let released = false;
    Object.defineProperty(observed, codexVerifierLease, { value: {
      check() {
        if (released || JSON.stringify(snapshot()) !== JSON.stringify(after)) throw unavailable();
      },
      release() { released = true; },
    } });
    return observed;
  };
}
