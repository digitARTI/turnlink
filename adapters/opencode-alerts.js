import { identity } from '../src/config.js';
import { AlertRequest, AlertSnapshot } from '../src/control/alert-contracts.js';

// This reader uses only native identity/location observations and a broker read.
// It never joins, subscribes, touches an admission journal or prompts a model.
export function makeOpenCodeAlerts({ channel, sessions, signal, ownSession, now = Date.now }) {
  return async input => {
    const { sessionID } = AlertRequest.parse(input), checkedAt = now();
    const empty = (available, registered = false) => AlertSnapshot.parse({ version: 1, sessionID, checkedAt, available, registered });
    try {
      signal.throwIfAborted(); await ownSession(sessionID);
      const state = sessions.get(sessionID), agentId = identity('opencode', sessionID);
      if (!state?.tools.agentId || state.tools.agentId !== agentId || !state.controlChannel) return empty(true);
      const generation = state.generation, controlChannel = state.controlChannel, membership = state.alertRevision || 0;
      const valid = () => !signal.aborted && sessions.get(sessionID) === state && state.generation === generation &&
        state.tools.agentId === agentId && state.controlChannel === controlChannel && (state.alertRevision || 0) === membership;
      const cache = state.alertSnapshot;
      if (!cache || cache.generation !== generation || cache.membership !== membership || cache.channel !== controlChannel || checkedAt < cache.at || checkedAt - cache.at >= 15000) {
        state.alertSnapshot = { generation, membership, channel: controlChannel, at: checkedAt,
          promise: channel.request('control_alerts', { agentId, channel: controlChannel }) };
      }
      const summary = await state.alertSnapshot.promise;
      await ownSession(sessionID); if (!valid()) return empty(false);
      if (summary.agentId !== agentId || summary.channel !== controlChannel) return empty(false, true);
      return AlertSnapshot.parse({ version: 1, sessionID, checkedAt: now(), available: true, registered: true, summary });
    } catch { return empty(false); } // Never expose native errors, credentials or filesystem paths through an alert RPC.
  };
}
