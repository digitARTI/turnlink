import { AdmissionLedger, fingerprint } from './admissions.js';
import { digest, identity, render } from './config.js';

// Owner-side admission of uncontrolled peer messages only. Controlled delivery,
// tasks and role notices require their own broker authorization and are not
// accepted here. The durable ledger preserves unknown outcomes across crashes.
export function createOpenCodePluginOwnerPrompt({ broker, context, sessionID, directory, hostId, journalDirectory }) {
  if (!broker?.observeMessage || !context?.session?.get || !context?.session?.context || !context?.session?.prompt || !context?.permission?.list || !context?.storage?.get ||
      !sessionID?.startsWith('ses_') || !directory?.startsWith('/') || !hostId || !journalDirectory) throw new Error('PLUGIN_PROMPT_UNAVAILABLE');
  const agentId = identity('opencode', sessionID), ledger = new AdmissionLedger(hostId, agentId, journalDirectory), active = new Set();
  const unavailable = () => new Error('PLUGIN_PROMPT_UNAVAILABLE');
  const admit = async (input, signal) => {
    const metadata = input?.metadata;
    if (signal?.aborted || input?.sessionID !== sessionID || input.delivery !== 'steer' || input.resume !== true ||
        !metadata || Object.keys(metadata).sort().join(',') !== 'channel,messageID,sender,source' || metadata.source !== 'turnlink' ||
        typeof metadata.messageID !== 'string' || active.has(metadata.messageID)) throw unavailable();
    const id = `msg_turnlink_${digest(`${sessionID}:${metadata.messageID}`)}`;
    const observe = () => {
      if (signal?.aborted) throw unavailable();
      const message = broker.observeMessage(metadata.messageID);
      if (!message || message.id !== metadata.messageID || message.from?.agentId !== metadata.sender || message.channel !== metadata.channel ||
          input.id !== id || input.text !== render(message)) throw unavailable();
      return message;
    };
    active.add(metadata.messageID);
    try {
      const message = observe(), prior = ledger.get(message.id), mark = fingerprint(message);
      if (prior && (prior.fingerprint !== mark || prior.rpcId !== id || prior.method !== 'session.prompt')) throw unavailable();
      if (prior && prior.state !== 'accepted') throw unavailable();
      const [session, permissions, conversation, membership] = await Promise.all([context.session.get({ sessionID }, { signal }),
        context.permission.list({ sessionID }, { signal }), context.session.context({ sessionID }, { signal }), context.storage.get(`memberships/${sessionID}`)]);
      observe();
      if (session?.id !== sessionID || session.location?.directory !== directory || !Array.isArray(permissions) || permissions.length ||
          membership?.sessionID !== sessionID || membership.directory !== directory || membership.channel !== message.channel ||
          !Array.isArray(membership.forms) || membership.forms.length || membership.receiverHandoff ||
          !Array.isArray(conversation) || conversation.some(item => item.type === 'assistant' && item.content?.some(part =>
            part.type === 'tool' && part.name === 'question' && ['running', 'streaming'].includes(part.state?.status)))) throw unavailable();
      if (prior?.state === 'accepted') return { id, sessionID };
      const record = { id: message.id, fingerprint: mark, state: 'inflight', rpcId: id, method: 'session.prompt', updatedAt: Date.now() };
      ledger.set(record);
      try {
        const result = await context.session.prompt(input, { signal });
        if (result?.id !== id || result.sessionID !== sessionID) throw unavailable();
        observe(); ledger.set({ ...record, state: 'accepted', updatedAt: Date.now() }); return result;
      } catch (error) { ledger.set({ ...record, state: 'uncertain', updatedAt: Date.now() }); throw error; }
    } finally { active.delete(metadata.messageID); }
  };
  admit.isClear = () => active.size === 0 && ledger.matchesDisk() && ledger.records.every(record => !['inflight', 'uncertain'].includes(record.state));
  admit.mayAck = id => {
    if (!ledger.matchesDisk() || active.has(id) || !broker.observeMessage(id)) return false;
    return ledger.get(id)?.state === 'accepted';
  };
  return admit;
}
