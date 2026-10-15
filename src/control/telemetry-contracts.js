import { z } from 'zod';
import { AgentID, Channel } from '../protocol.js';

export const TelemetryStamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Activity = z.strictObject({ id: z.string().uuid(), runID: z.string().uuid(), at: TelemetryStamp, channel: Channel,
  type: z.enum(['member.joined', 'member.removed', 'receiver.connected', 'receiver.disconnected', 'receiver.unsubscribed',
    'message.queued', 'message.offered', 'message.acknowledged', 'message.cancelled', 'delivery.paused', 'delivery.resumed']),
  agentId: AgentID, messageID: z.string().uuid().optional(),
  reason: z.enum(['reservation_expired', 'channel_changed', 'explicit_leave', 'authorized_release', 'session_revoked', 'control_cancelled_unoffered']).optional(),
}).superRefine((row, context) => {
  if (row.type.startsWith('message.') !== !!row.messageID ||
      (['member.removed', 'message.cancelled'].includes(row.type) !== !!row.reason))
    context.addIssue({ code: 'custom', message: 'Invalid activity shape' });
});

// No arbitrary request fields, names, paths, payloads, credentials or exception text.
// These observations never serve as native admission/stop evidence or replay authority.
export const ActivityStatus = z.strictObject({ rows: TelemetryStamp, limit: TelemetryStamp.positive(),
  oldestAt: TelemetryStamp.nullable(), newestAt: TelemetryStamp.nullable(), lastPrunedAt: TelemetryStamp, rejected: TelemetryStamp });
