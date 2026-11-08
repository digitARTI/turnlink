import { z } from 'zod';
import { Channel } from '../protocol.js';

const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Fixed event classes only. No caller-selected text, transcript, error body or
// authority is carried by a notification. Reading and acknowledging are not resolution.
export const NotificationType = z.enum(['incident.opened', 'action.requested', 'action.failed', 'action.uncertain',
  'task.reported', 'task.uncertain', 'election.inconclusive', 'worktree.uncertain']);
export const OperatorNotification = z.strictObject({ id: z.string().uuid(), channel: Channel, sequence: stamp.positive(),
  type: NotificationType, at: stamp, entityID: z.string().uuid().optional(), acknowledgedAt: stamp.nullable() })
  .refine(value => value.acknowledgedAt === null || value.acknowledgedAt >= value.at);
export const NotificationAck = z.strictObject({ op: z.literal('notification.ack'), channel: Channel, id: z.string().uuid() });
