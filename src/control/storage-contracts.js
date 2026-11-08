import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const StorageLevel = z.enum(['ok', 'warning', 'critical', 'unavailable']);
export const StorageResource = z.enum(['events', 'commands', 'archived_commands', 'archived_history_rows', 'hydrated_state_bytes',
  'cold_tasks', 'cold_actions', 'cold_incidents', 'cold_evidence', 'cold_previews', 'cold_transitions', 'cold_managedPreviews', 'cold_credential_audit', 'notices', 'credential_audit', 'state_bytes', 'database_pages',
  'evidence', 'tasks', 'actions', 'incidents', 'previews', 'transitions', 'export_count', 'export_bytes', 'disk', 'control_runtime', 'telemetry_rows', 'telemetry_health', 'managedPreviews', 'adapter_health', 'notification_acks', 'checkpoint_observations', 'checkpoint_destinations']);
export const StoragePressure = z.strictObject({ level: StorageLevel, resources: z.array(StorageResource).max(40) });
export const StorageStatus = z.strictObject({ version: z.literal(1), checkedAt: count, controlAvailable: z.boolean(),
  pressure: StoragePressure, quotas: z.array(z.strictObject({ resource: StorageResource, used: count, limit: count,
    level: z.enum(['ok', 'warning', 'critical']) })).max(40),
  unresolved: z.strictObject({ tasks: count, actions: count, incidents: count, transitions: count, managedPreviews: count.optional() }).optional(),
  disk: z.strictObject({ availableBytes: count, totalBytes: count }).optional() });
export const pressureLevel = (used, limit) => used >= Math.ceil(limit * 0.95) ? 'critical' : used >= Math.ceil(limit * 0.8) ? 'warning' : 'ok';
export const combinePressure = quotas => {
  const issues = quotas.filter(q => q.level !== 'ok');
  return { level: issues.some(q => q.level === 'critical') ? 'critical' : issues.length ? 'warning' : 'ok', resources: issues.map(q => q.resource) };
};
export const ExportDescriptor = z.strictObject({ id: z.string().uuid(), format: z.literal('turnlink-control-export-v1'),
  createdAt: count, bytes: count.positive(), digest: z.string().regex(/^[a-f0-9]{64}$/), records: count,
  scope: z.literal('control-only'), includesAuthentication: z.literal(false), includesCollaboration: z.literal(true) });
export const ReclamationRequest = z.strictObject({ id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) });
export const ReclamationResult = ReclamationRequest.extend({ reclaimed: count, replayed: z.boolean() });
export const HistoryReclamationRequest = ReclamationRequest.extend({ before: count });
export const HistoryEntityCounts = z.strictObject({ tasks: count, actions: count, incidents: count, evidence: count, previews: count, transitions: count, managedPreviews: count });
export const HistoryReclamationResult = HistoryReclamationRequest.extend({ events: count, notices: count, notificationAcks: count, credentialAudit: count, taskPayloads: count,
  entities: HistoryEntityCounts, stateBytesFreed: count, replayed: z.boolean() });
