import { z } from 'zod';
import { AgentID, Channel, SessionID } from '../protocol.js';
import { StoragePressure } from './storage-contracts.js';
import { taskNeedsStopAttention } from './contracts.js';

const count = z.number().int().nonnegative().max(4096);
const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ChannelAlerts = z.strictObject({ version: z.literal(1), agentId: AgentID, channel: Channel, checkedAt: stamp,
  controlAvailable: z.boolean(), pressure: StoragePressure, incidents: z.strictObject({ open: count }),
  tasks: z.strictObject({ uncertain: count, overdue: count, awaitingReview: count, reviewForYou: count }),
  role: z.strictObject({ proposalForYou: z.boolean() }) });
export const AlertRequest = z.strictObject({ sessionID: SessionID });
export const AlertSnapshot = z.strictObject({ version: z.literal(1), sessionID: SessionID, available: z.boolean(), registered: z.boolean(),
  checkedAt: stamp, summary: ChannelAlerts.optional() }).refine(v => !!v.summary === (v.available && v.registered));

// Metadata hints only. This projection cannot create evidence, accept results,
// renew roles, replay deliveries, answer blockers or change native permissions.
export function projectChannelAlerts(state, channel, agentId, now, reviewAuthority = false) {
  const own = state.tasks.filter(t => t.channel === channel.id && t.claimant === agentId);
  return {
    incidents: { open: state.incidents.filter(i => i.channel === channel.id && i.status === 'open').length },
    tasks: {
      uncertain: own.filter(taskNeedsStopAttention).length,
      overdue: own.filter(t => !['completed', 'cancelled'].includes(t.status) &&
        ((t.deadlineAt !== undefined && t.deadlineAt <= now) || (t.status === 'running' && t.lastProgressAt + t.progressTimeoutMs <= now))).length,
      awaitingReview: own.filter(t => t.status === 'review').length,
      reviewForYou: reviewAuthority ? state.tasks.filter(t => t.channel === channel.id && t.status === 'review' && t.stoppedEvidence).length : 0,
    },
    role: { proposalForYou: channel.proposal?.agentId === agentId && channel.proposal.acceptBy > now },
  };
}
