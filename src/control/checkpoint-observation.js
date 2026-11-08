import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentID, Channel, HostID } from '../protocol.js';
import { Stamp, UUID, WorktreeTransition } from './contracts.js';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const hash = value => createHash('sha256').update(value).digest('hex');
export const CheckpointReservation = z.strictObject({ generation: UUID, revision: Stamp });
export const CheckpointMetadata = z.strictObject({ version: z.literal(1), threadId: UUID, transitionId: UUID,
  reservation: CheckpointReservation, digest: hex, rolloutSha256: hex, journalSha256: hex,
  rolloutBytes: z.number().int().nonnegative().max(4 * 1024 * 1024), journalBytes: z.number().int().nonnegative().max(65536) });
export const CheckpointObservation = z.strictObject({ version: z.literal(1), requestID: UUID, channel: Channel,
  hostId: HostID, agentId: AgentID, transitionID: UUID, grantSha256: hex, metadata: CheckpointMetadata,
  recordedAt: Stamp, status: z.literal('observed_unverified'), releaseAllowed: z.literal(false) }).refine(value =>
  value.agentId === `codex:${value.metadata.threadId}` && value.transitionID === value.metadata.transitionId &&
  value.metadata.digest === hash(`${value.metadata.threadId}:${value.transitionID}:${value.metadata.reservation.generation}:${value.metadata.reservation.revision}:${value.metadata.rolloutSha256}:${value.metadata.journalSha256}:${value.metadata.rolloutBytes}`));

// This identifies an observed source checkpoint only. It is not a policy
// approval, an active lease, or authority to import or release a receiver.
export function checkpointObservation({ requestID, hostId, grant: input, metadata: inputMetadata, recordedAt }) {
  const grant = WorktreeTransition.parse(input), metadata = CheckpointMetadata.parse(inputMetadata);
  const expected = hash(`${metadata.threadId}:${grant.id}:${metadata.reservation.generation}:${metadata.reservation.revision}:${metadata.rolloutSha256}:${metadata.journalSha256}:${metadata.rolloutBytes}`);
  if (!grant.agentId.startsWith('codex:') || !grant.checkpointConfigSha256 || grant.status !== 'prepared' || grant.purpose !== undefined ||
      metadata.threadId !== grant.agentId.slice(6) || metadata.transitionId !== grant.id || metadata.digest !== expected) throw new Error('CHECKPOINT_OBSERVATION_UNAVAILABLE');
  return CheckpointObservation.parse({ version: 1, requestID, channel: grant.channel, hostId, agentId: grant.agentId,
    transitionID: grant.id, grantSha256: hash(JSON.stringify(grant)), metadata, recordedAt, status: 'observed_unverified', releaseAllowed: false });
}
