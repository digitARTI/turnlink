import { identity, validateCredential } from '../src/config.js';
import { readPrivate } from '../src/storage.js';
import { makeHealthPublisher } from '../src/adapter-health.js';

export function makeOpenCodeHealth({ ctx, channel, sessions, options, signal, ownSession, refreshBlockers, log }) {
  const publisher = makeHealthPublisher({ client: channel, enabled: options.health === true, signal, log,
    credential: () => validateCredential(readPrivate(options.adapterTokenFile, 128).trim()) });
  channel.on('connected', () => publisher.reset());
  const poll = sessionID => {
    const state = sessions.get(sessionID);
    if (!state?.tools.agentId || !state.controlChannel) return;
    const agentId = identity('opencode', sessionID), generation = state.generation, membership = state.alertRevision || 0;
    const nativeRevision = state.healthRevision || 0;
    const valid = () => !signal.aborted && sessions.get(sessionID) === state && state.tools.agentId === agentId &&
      state.generation === generation && (state.alertRevision || 0) === membership && (state.healthRevision || 0) === nativeRevision;
    return publisher.poll(agentId, async () => {
      await ownSession(sessionID); if (!valid()) return;
      let nativeStatus = 'unknown', blockers = state.blocked.size;
      try {
        const revision = state.revision;
        // Health observes its own snapshot, never edits the delivery admission
        // blocker's live set or uses an old health sample to authorize a wake.
        const observation = { ...state, blocked: new Set(state.blocked), forms: new Set(state.forms) };
        await refreshBlockers(sessionID, observation, () => valid() && revision === state.revision);
        if (valid() && revision === state.revision) {
          blockers = observation.blocked.size;
          if (blockers) nativeStatus = 'blocked';
          else {
            await ctx.session.wait({ sessionID }, { signal: AbortSignal.any([signal, AbortSignal.timeout(100)]) });
            if (valid() && revision === state.revision) nativeStatus = 'idle';
          }
        }
      } catch { /* Timeout/read failure means unknown, not idle or native stop proof. */ }
      await ownSession(sessionID); if (!valid()) return;
      return { valid, report: { version: 1, adapterVersion: '0.2.0', nativeVersion: ctx.app.version.replace(/^v/, ''), nativeStatus,
        queuedMessages: state.queue.length, blockers,
        ...(state.ledger ? { uncertainMessages: state.ledger.records.filter(r => ['inflight', 'uncertain'].includes(r.state)).length } : {}),
        features: { control: options.control === true, tasks: options.tasks === true, alerts: options.alerts === true, managedWorktrees: false } } };
    });
  };
  return { poll, forget: id => publisher.forget(identity('opencode', id)) };
}
