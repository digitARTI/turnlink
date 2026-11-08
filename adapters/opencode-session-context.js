import { digest } from '../src/config.js';

// This exposes observations to the agent on request; it does not authorize a
// move or assert anything about OS permissions or remote policies.
export async function readOpenCodeSessionContext({ ctx, sessionID, ownSession, signal }) {
  const snapshot = (session, agentID, agent, model) => {
    const rules = { agentID, agent: agent?.permissions ?? null, session: session.permissions ?? null };
    const permissions = agentID && Array.isArray(agent?.permissions) &&
      (session.permissions === undefined || Array.isArray(session.permissions))
      ? `native-rules-sha256:${digest(JSON.stringify(rules))}` : null;
    const version = typeof ctx.app?.version === 'string' && /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(ctx.app.version)
      ? `opencode ${ctx.app.version.replace(/^v/, '')}` : null;
    return { agentID, model: model ? { id: model.id, providerID: model.providerID, variant: model.variant ?? null } : null, permissions, version,
      stamp: JSON.stringify({ rules, location: session.location, model, version }) };
  };
  const read = async () => {
    signal.throwIfAborted();
    const session = await ownSession(sessionID, signal);
    const agentID = typeof session.agent === 'string' && session.agent ? session.agent : null;
    if (!agentID || typeof ctx.agent?.get !== 'function') return snapshot(session, agentID, null, null);
    const response = await ctx.agent.get({ agentID }, { signal });
    const agent = response?.data ?? response;
    if (!agent || agent.id !== agentID) throw new Error('Session agent observation unavailable');
    let model = session.model ?? agent.model;
    if (!model && typeof ctx.model?.default === 'function') {
      const result = await ctx.model.default(undefined, { signal });
      model = result?.data ?? result;
    }
    if (!model || typeof model.id !== 'string' || typeof model.providerID !== 'string') model = null;
    return snapshot(session, agentID, agent, model);
  };
  const first = await read(), second = await read();
  signal.throwIfAborted();
  if (first.stamp !== second.stamp) throw new Error('Session settings changed during observation');
  return { agent: first.agentID, runtime: first.version, model: first.model?.id ?? null, modelVariant: first.model?.variant ?? null, provider: first.model?.providerID ?? null,
    permissions: first.permissions, permissionScope: 'native agent and session rules only; OS and remote policies are not observed' };
}
