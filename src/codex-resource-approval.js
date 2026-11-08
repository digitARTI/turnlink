import { setTimeout as delay } from 'node:timers/promises';
import { AgentID } from './protocol.js';
import { Task, WorktreePreview, UUID } from './control/contracts.js';
import { ProviderEstablishmentPlan, sameProviderPlan } from './control/provider-establishment-contracts.js';
import { McpEstablishmentPlan, sameMcpPlan } from './control/mcp-establishment-contracts.js';

const unavailable = () => Object.assign(new Error('NATIVE_RESOURCE_APPROVAL_UNAVAILABLE'), { code: 'NATIVE_RESOURCE_APPROVAL_UNAVAILABLE' });

// Observe an operator decision while the caller retains the actual native
// reservation and admission fence. This never issues a grant or an effect.
export async function waitForCodexResourceApproval({ client, agentId, channel, taskID, claimGeneration, previewID, plan, signal, guard, pollMs = 500 }) {
  AgentID.parse(agentId); UUID.parse(taskID); UUID.parse(previewID);
  if (!agentId.startsWith('codex:') || typeof channel !== 'string' || !channel || !client?.request || typeof guard !== 'function' ||
      !signal || typeof signal.aborted !== 'boolean' || !Number.isSafeInteger(claimGeneration) || claimGeneration < 0 ||
      !Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 30000) throw unavailable();
  const isMcp = plan?.kind === 'mcp_runtime';
  const expected = isMcp ? McpEstablishmentPlan.parse(plan) : ProviderEstablishmentPlan.parse(plan);
  if (expected.agentId !== agentId) throw unavailable();
  const purpose = isMcp ? 'establish-mcp' : 'establish-provider';
  const check = () => { if (signal.aborted) throw unavailable(); guard(); };
  const entries = async (view, entityID) => {
    const values = [];
    for (let offset = 0, page = 0; page < 4096; page++) {
      check();
      const result = await client.request('control_query', { agentId, channel, view, offset, limit: 100, ...(entityID ? { entityID } : {}) });
      check();
      if (!Array.isArray(result?.entries) || result.entries.length > 100 || result.next !== offset + result.entries.length) throw unavailable();
      values.push(...result.entries);
      if (!result.entries.length || result.next <= offset) return values;
      offset = result.next;
    }
    throw unavailable();
  };
  const checkTask = async () => {
    const tasks = await entries('tasks', taskID);
    if (tasks.length !== 1) throw unavailable();
    const task = Task.parse(tasks[0]);
    if (task.id !== taskID || task.channel !== channel || task.claimant !== agentId || task.claimGeneration !== claimGeneration ||
        task.status !== 'claimed' || task.terminalHold) throw unavailable();
  };
  for (;;) {
    await checkTask();
    const previews = (await entries('previews')).map(value => WorktreePreview.parse(value));
    const latest = previews.filter(value => value.taskID === taskID && value.agentId === agentId).at(-1);
    if (!latest || latest.id !== previewID || latest.channel !== channel || latest.claimGeneration !== claimGeneration || latest.purpose !== purpose ||
        latest.from !== expected.from || latest.to !== expected.to || latest.configurationDigest !== expected.digest ||
        !(isMcp ? sameMcpPlan(latest.mcpPlan, expected) : sameProviderPlan(latest.providerPlan, expected))) throw unavailable();
    if (latest.approved) { await checkTask(); check(); return latest; }
    try { await delay(pollMs, undefined, { signal }); } catch { throw unavailable(); }
  }
}
