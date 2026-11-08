import { z } from 'zod';
import { WorktreeTransition } from './control/contracts.js';
import { placementReceiptID, placementReceiptSchema } from './opencode-native-recovery.js';

const identity = ['id', 'agentId', 'channel', 'taskID', 'previewID', 'claimGeneration', 'from', 'to', 'configurationDigest', 'authorityDigest', 'pluginProvenanceDigest', 'nativeAuthorityObservationDigest', 'preparedAt'];
export const samePlacementGrant = (left, right) => identity.every(field => left[field] === right[field]);
export const placementSettlementSchema = z.strictObject({ commandID: z.string().uuid(), receiptID: z.string().uuid(), placement: placementReceiptSchema,
  phase: z.enum(['dispatching', 'uncertain', 'settled']), moved: WorktreeTransition.optional() });
export function validPlacementSettlementChange(before, after) {
  if (!before) return !after || after.phase === 'dispatching';
  if (!after || before.commandID !== after.commandID || before.receiptID !== after.receiptID ||
      JSON.stringify(before.placement) !== JSON.stringify(after.placement)) return false;
  if (JSON.stringify(before) === JSON.stringify(after)) return before.phase !== 'dispatching';
  return (before.phase === 'dispatching' ? ['uncertain', 'settled'] : before.phase === 'uncertain' ? ['settled'] : []).includes(after.phase);
}
export function placementSettlementMatches(settlement, grant, stage) {
  if (!settlement || !stage) return false;
  const placement = settlement.placement, moved = settlement.moved;
  return settlement.receiptID === placementReceiptID(placement) && placement.sessionID === stage.sessionID &&
    placement.transitionID === grant.id && JSON.stringify(placement.source) === JSON.stringify(stage.source) &&
    placement.destination.directory === grant.to && placement.destination.workspaceID === stage.source.workspaceID &&
    placement.archiveNonce === stage.archiveNonce && placement.stageNonce === stage.nonce && placement.receiverHash === stage.receiverHash &&
    ((settlement.phase === 'settled') === !!moved) && (!moved || moved.status === 'moved' && moved.actualLocation === grant.to &&
      moved.receiptID === settlement.receiptID && samePlacementGrant(moved, grant));
}
