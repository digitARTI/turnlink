import { z } from 'zod';

const count = z.number().int().nonnegative().max(4096);
const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const AdapterHealthReport = z.strictObject({ version: z.literal(1), adapterVersion: z.literal('0.2.0'),
  nativeVersion: z.string().regex(/^\d+\.\d+\.\d+$/).max(32).optional(), nativeStatus: z.enum(['idle', 'busy', 'blocked', 'unknown']),
  queuedMessages: count, blockers: count, uncertainMessages: count.optional(),
  features: z.strictObject({ control: z.boolean(), tasks: z.boolean(), alerts: z.boolean(), managedWorktrees: z.literal(false) }) });
// Identity/channel/run/clock are broker-owned, not fields in an adapter report.
// This record is observational metadata, never native stop/admission evidence.
export const StoredHealthFields = { version: z.literal(1), runID: z.string().uuid(), observedAt: stamp, report: AdapterHealthReport };
export const HEALTH_STALE_MS = 45000;
