import { z } from 'zod';
import { AgentID, Channel } from '../protocol.js';
import { StoredHealthFields, HEALTH_STALE_MS } from './health-contracts.js';

export const StoredHealth = z.strictObject({ ...StoredHealthFields, agentId: AgentID, channel: Channel });
export function projectHealth({ agentId, channel, connected, record, runID, now, uncertainTasks, currentReceiver = true }) {
  const fresh = connected && currentReceiver && !!record && record.runID === runID && record.observedAt <= now && now - record.observedAt < HEALTH_STALE_MS;
  const status = !connected ? 'disconnected' : !record ? 'unreported' : !fresh ? 'stale' :
    record.report.nativeStatus === 'unknown' ? 'unknown' : record.report.nativeStatus === 'blocked' || record.report.uncertainMessages || uncertainTasks ? 'attention' : 'observed';
  return { id: agentId, agentId, channel, connected, status, coverage: 'observational', fresh,
    ...(record ? { observedAt: record.observedAt, report: record.report } : {}), uncertainTasks };
}
