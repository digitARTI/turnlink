import { z } from 'zod';
import { Stamp, UUID } from './contracts.js';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const codexCheckpointDestination = Symbol('codexCheckpointDestination');
export const CheckpointGuestReceipt = z.strictObject({ version: z.literal(1), type: z.literal('receipt'), vmInstance: hex,
  challenge: hex, envelopeSha256: hex, checkpointDigest: hex, status: z.literal('quarantined'), tag: hex, releaseAllowed: z.literal(false) });
export const CheckpointDestination = z.strictObject({ version: z.literal(1), requestID: UUID, transitionID: UUID,
  vmInstance: hex, checkpointDigest: hex, status: z.enum(['pending', 'uncertain', 'quarantined']), startedAt: Stamp,
  receipt: CheckpointGuestReceipt.optional(), finishedAt: Stamp.optional() }).refine(value =>
  (value.status === 'quarantined') === !!value.receipt && (value.status === 'pending') === (value.finishedAt === undefined) &&
  (!value.receipt || (value.receipt.vmInstance === value.vmInstance && value.receipt.checkpointDigest === value.checkpointDigest)));
