import { randomUUID } from 'node:crypto';
import { digest, identity, validateCredential } from './config.js';
import { readPrivate } from './storage.js';

export const roleFingerprint = notice => digest(JSON.stringify({ id: notice.id, channel: notice.channel,
  assignmentID: notice.assignmentID, generation: notice.generation, kind: notice.kind, text: notice.text }));

// Adapter maintenance only: no model polling, instruction replacement, permission override or task effect.
export function makeCodexControl({ client, threads, flush, enabled, tokenFile, log }) {
  let closed = false;
  const credential = () => validateCredential(readPrivate(tokenFile, 128).trim());
  const poll = async threadId => {
    const state = threads.get(threadId);
    if (closed || !enabled || !tokenFile || !state?.channel || state.controlPolling || !state.ledger) return;
    state.controlPolling = true;
    const generation = state.generation, agentId = identity('codex', threadId);
    const valid = () => !closed && threads.get(threadId) === state && state.generation === generation;
    try {
      const status = await client.request('control_query', { agentId, channel: state.channel, view: 'channel' });
      if (!valid()) return;
      if (status.channel.active?.agentId === agentId) await client.request('control_adapter', { agentId, credential: credential(),
        command: { id: randomUUID(), op: 'master.renew', channel: state.channel, generation: status.channel.active.generation } });
      const result = await client.request('control_query', { agentId, channel: state.channel, view: 'notices', limit: 100 });
      if (!valid()) return;
      // Replace the pending page, dropping cancelled/superseded offers. Accepted receipts remain in the ledger.
      state.roles = result.entries;
      void flush(threadId);
    } catch (error) { if (!closed) log(error); }
    finally { state.controlPolling = false; }
  };
  const acknowledge = (threadId, notice, receiptID) => client.request('control_notice_ack', {
    agentId: identity('codex', threadId), credential: credential(), id: notice.id, receiptID,
  });
  const pending = async (threadId, notice) => {
    if (closed) return false;
    const result = await client.request('control_query', { agentId: identity('codex', threadId), channel: notice.channel, view: 'notices', limit: 100 });
    return result.entries.some(n => n.id === notice.id && roleFingerprint(n) === roleFingerprint(notice));
  };
  return { poll, acknowledge, pending, close: () => { closed = true; } };
}
