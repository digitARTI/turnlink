import { randomUUID } from 'node:crypto';
import { AdmissionLedger } from '../src/admissions.js';
import { readPrivate } from '../src/storage.js';
import { digest, identity, validateCredential } from '../src/config.js';

// Broker-authenticated role notices are separate from peer-message rendering. This never switches agents/models or rewrites configuration.
export function makeOpenCodeControl({ ctx, channel, sessions, options, signal, ownSession, refreshBlockers, log }) {
  const poll = async sessionID => {
    const state = sessions.get(sessionID);
    if (signal.aborted || options.control !== true || !options.adapterTokenFile || !state?.tools.agentId || !state.controlChannel || state.controlPolling) return;
    state.controlPolling = true;
    const generation = state.generation;
    const valid = () => !signal.aborted && state.generation === generation && !!state.tools.agentId;
    try {
      const credential = validateCredential(readPrivate(options.adapterTokenFile, 128).trim());
      await ownSession(sessionID);
      const status = await channel.request('control_query', { agentId: state.tools.agentId, channel: state.controlChannel, view: 'channel' });
      if (!valid()) return;
      if (status.channel.active?.agentId === state.tools.agentId) {
        await channel.request('control_adapter', { agentId: state.tools.agentId, credential, command: { id: randomUUID(),
          op: 'master.renew', channel: state.controlChannel, generation: status.channel.active.generation } });
      }
      const notices = await channel.request('control_query', { agentId: state.tools.agentId, channel: state.controlChannel, view: 'notices', limit: 8 });
      if (!valid() || state.taskBusy || !notices.entries.length || !await refreshBlockers(sessionID, state, valid)) return;
      state.ledger ??= new AdmissionLedger(channel.hostId, identity('opencode', sessionID), options.credentialDirectory);
      for (const notice of notices.entries) {
        if (!valid() || !await refreshBlockers(sessionID, state, valid)) return;
        const id = `msg_turnlink_role_${digest(`${sessionID}:${notice.id}`)}`;
        const fingerprint = digest(JSON.stringify({ id: notice.id, channel: notice.channel, assignmentID: notice.assignmentID,
          generation: notice.generation, kind: notice.kind, text: notice.text }));
        const previous = state.ledger.get(notice.id);
        if (previous && previous.fingerprint !== fingerprint) throw new Error('Role admission fingerprint mismatch');
        if (previous && ['inflight', 'uncertain'].includes(previous.state) && (previous.method !== 'session.prompt.role' || previous.rpcId !== id)) return;
        if (previous?.state !== 'accepted') {
          const receipt = { id: notice.id, fingerprint, state: 'inflight', method: 'session.prompt.role', rpcId: id, updatedAt: Date.now() };
          state.ledger.set(receipt);
          try {
            const admitted = await ctx.session.prompt({ sessionID, id, text: notice.text, delivery: 'steer', resume: ['offer', 'task_review'].includes(notice.kind),
              metadata: { source: 'turnlink-role', channel: notice.channel, assignmentID: notice.assignmentID,
                generation: notice.generation, promptVersion: notice.promptVersion, kind: notice.kind } }, { signal });
            if (admitted.id !== id || admitted.sessionID !== sessionID) throw new Error('Unexpected role admission receipt');
            state.ledger.set({ ...receipt, state: 'accepted', updatedAt: Date.now() });
          } catch (error) { state.ledger.set({ ...receipt, state: 'uncertain', updatedAt: Date.now() }); throw error; }
        }
        if (!valid()) return;
        await channel.request('control_notice_ack', { agentId: state.tools.agentId, credential, id: notice.id, receiptID: id });
      }
    } catch (error) { if (!signal.aborted) log(error); }
    finally { state.controlPolling = false; }
  };
  return { poll };
}
