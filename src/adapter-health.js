import { AdapterHealthReport } from './control/health-contracts.js';
import { AgentID } from './protocol.js';

// Passive latest-snapshot publisher. No models/native writes, authority changes,
// receipt retries or recovery operations. Failure only ages the prior observation.
export function makeHealthPublisher({ client, credential, enabled, signal, log, now = Date.now }) {
  const times = new Map(), busy = new Set(); let epoch = 0;
  return {
    reset() { epoch++; times.clear(); },
    forget(id) { times.delete(id); },
    async poll(agentId, sample) {
      if (!enabled || signal.aborted || busy.has(agentId)) return;
      AgentID.parse(agentId); const time = now(), previous = times.get(agentId);
      if (previous !== undefined && time >= previous && time - previous < 15000) return;
      if (!times.has(agentId) && times.size >= 4096) return;
      times.set(agentId, time); busy.add(agentId); const generation = epoch;
      try {
        const result = await sample(); if (!result) return;
        const valid = () => !signal.aborted && epoch === generation && result.valid();
        const report = AdapterHealthReport.parse(result.report), token = await credential();
        await client.connect(); if (!valid()) return;
        const params = client.authorize('control_health_report', { agentId, credential: token, report });
        if (!valid()) return;
        await client.rpc('control_health_report', params); // No await between the last scope check and the send.
      } catch (error) { if (!signal.aborted) log(error); }
      finally { busy.delete(agentId); }
    },
  };
}
