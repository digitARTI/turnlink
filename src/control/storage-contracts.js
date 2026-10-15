import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const StorageLevel = z.enum(['ok', 'warning', 'critical', 'unavailable']);
export const StorageResource = z.enum(['events', 'commands', 'notices', 'credential_audit', 'state_bytes', 'database_pages',
  'evidence', 'tasks', 'actions', 'incidents', 'previews', 'transitions', 'export_count', 'export_bytes', 'disk', 'control_runtime', 'telemetry_rows', 'telemetry_health']);
export const StoragePressure = z.strictObject({ level: StorageLevel, resources: z.array(StorageResource).max(18) });
export const StorageStatus = z.strictObject({ version: z.literal(1), checkedAt: count, controlAvailable: z.boolean(),
  pressure: StoragePressure, quotas: z.array(z.strictObject({ resource: StorageResource, used: count, limit: count,
    level: z.enum(['ok', 'warning', 'critical']) })).max(18),
  unresolved: z.strictObject({ tasks: count, actions: count, incidents: count, transitions: count }).optional(),
  disk: z.strictObject({ availableBytes: count, totalBytes: count }).optional() });
export const pressureLevel = (used, limit) => used >= Math.ceil(limit * 0.95) ? 'critical' : used >= Math.ceil(limit * 0.8) ? 'warning' : 'ok';
export const combinePressure = quotas => {
  const issues = quotas.filter(q => q.level !== 'ok');
  return { level: issues.some(q => q.level === 'critical') ? 'critical' : issues.length ? 'warning' : 'ok', resources: issues.map(q => q.resource) };
};
export const ExportDescriptor = z.strictObject({ id: z.string().uuid(), format: z.literal('turnlink-control-export-v1'),
  createdAt: count, bytes: count.positive(), digest: z.string().regex(/^[a-f0-9]{64}$/), records: count,
  scope: z.literal('control-only'), includesAuthentication: z.literal(false), includesCollaboration: z.literal(true) });
