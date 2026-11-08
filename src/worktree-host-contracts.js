import { z } from 'zod';
import { HostID, Channel } from './protocol.js';
import { DirectoryIdentity } from './control/worktree-lifecycle-contracts.js';

const uuid = z.string().uuid();
export const ManualWorktreeAttestation = z.strictObject({ version: z.literal(1), previewID: uuid, confirmationID: uuid,
  digest: z.string().regex(/^[a-f0-9]{64}$/), confirmedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  scope: z.literal('operator-confirms-no-active-use') });
export const HostCoordination = z.strictObject({ hostId: HostID, channel: Channel, publicationID: uuid,
  publicationAck: z.boolean(), publicationRefused: z.boolean().optional(), beginID: uuid.optional(), beginState: z.enum(['prepared', 'admitted', 'refused']).optional(),
  manualAttestation: ManualWorktreeAttestation.optional(),
  settlements: z.array(z.strictObject({ id: uuid, outcome: z.enum(['created', 'removed', 'failed', 'uncertain']),
    directory: DirectoryIdentity.optional(), acknowledged: z.boolean() })).max(2) }).superRefine((v, ctx) => {
  if (!!v.beginID !== !!v.beginState || (!v.beginID && v.settlements.length) ||
    (!v.publicationAck && v.beginID) || (v.publicationRefused && (v.publicationAck || v.beginID)) || (v.beginState === 'refused' && v.settlements.length) ||
    new Set(v.settlements.map(s => s.id)).size !== v.settlements.length ||
    v.settlements.some(s => (s.outcome === 'created') !== !!s.directory) ||
    (v.settlements.length === 2 && (v.settlements[0].outcome !== 'uncertain' || !v.settlements[0].acknowledged ||
      !['created', 'removed'].includes(v.settlements[1].outcome)))) ctx.addIssue({ code: 'custom', message: 'Invalid host coordination journal' });
});
