import { z } from 'zod';
import { placementReceiptSchema } from './opencode-native-recovery.js';

// A dispatch record is durable before crossing the native process boundary.
export const placementCommitSchema = z.strictObject({ phase: z.enum(['dispatching', 'uncertain', 'committed']), placement: placementReceiptSchema.optional(),
  leases: z.array(z.string().uuid()).min(1).max(32).optional() })
  .refine(value => (value.phase === 'committed') === !!value.placement && (!value.leases || new Set(value.leases).size === value.leases.length));
export function placementCommitMatches(commit, grant, stage) {
  if (!commit || !stage) return false;
  if (!commit.placement) return commit.phase !== 'committed';
  const p = commit.placement;
  return commit.phase === 'committed' && p.sessionID === stage.sessionID && p.transitionID === grant.id &&
    JSON.stringify(p.source) === JSON.stringify(stage.source) && p.destination.directory === grant.to &&
    p.destination.workspaceID === stage.source.workspaceID && p.archiveNonce === stage.archiveNonce &&
    p.stageNonce === stage.nonce && p.receiverHash === stage.receiverHash &&
    (!commit.leases || p.leaseIncarnation === commit.leases.at(-1));
}
export function validPlacementCommitChange(before, after) {
  if (!before) return !after || after.phase === 'dispatching';
  if (!after) return false;
  if (JSON.stringify(before) === JSON.stringify(after)) return before.phase !== 'dispatching';
  if (['dispatching', 'uncertain'].includes(before.phase) && after.phase === 'dispatching')
    return !!before.leases && !!after.leases && after.leases.length === before.leases.length + 1 &&
      before.leases.every((lease, i) => after.leases[i] === lease) && !before.leases.includes(after.leases.at(-1));
  if (JSON.stringify(before.leases) !== JSON.stringify(after.leases)) return false;
  return (before.phase === 'dispatching' ? ['uncertain', 'committed'] : before.phase === 'uncertain' ? ['committed'] : []).includes(after.phase);
}
