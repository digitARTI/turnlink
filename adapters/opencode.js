import { tool } from '@opencode-ai/plugin';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';
import { identity, render } from '../src/config.js';
import { AdmissionLedger, fingerprint } from '../src/admissions.js';
import { diagnosticCode } from '../src/diagnostics.js';

export default async function AgentChannel({ client, directory }, options = {}) {
  const channel = new ChannelClient({ url: options.url, tokenFile: options.tokenFile, credentialDirectory: options.credentialDirectory });
  const sessions = new Map();
  const get = sessionID => {
    if (!sessions.has(sessionID)) sessions.set(sessionID, {
      tools: new ToolSession(channel, { harness: 'opencode', sessionId: sessionID,
        onJoin: agent => channel.subscribe(agent.agentId) }),
      queue: [], seen: new Set(), flushing: false, generation: 0, blocked: new Set(), agent: undefined, model: undefined,
    });
    return sessions.get(sessionID);
  };
  const flush = async sessionID => {
    const state = get(sessionID);
    if (state.flushing || state.blocked.size || !state.queue.length) return;
    state.flushing = true;
    const generation = state.generation;
    try {
      const status = await client.session.status({ throwOnError: true });
      if (state.generation !== generation || !state.tools.agentId) return;
      if (!state.agent || !state.model) {
        const history = await client.session.messages({ path: { id: sessionID }, query: { limit: 20 }, throwOnError: true });
        const lastUser = [...(history.data || [])].reverse().find(m => m.info?.role === 'user')?.info;
        if (!lastUser?.agent || !lastUser?.model) throw new Error('Cannot determine current harness agent/model; peer wake remains queued');
        state.agent = lastUser.agent; state.model = lastUser.model; state.toolsPolicy = lastUser.tools;
      }
      if (state.generation !== generation || !state.tools.agentId || state.blocked.size) return;
      const busy = status.data?.[sessionID]?.type !== undefined && status.data[sessionID].type !== 'idle';
      const messages = state.queue.slice(0, 8);
      state.ledger ??= new AdmissionLedger(channel.hostId, identity('opencode', sessionID), options.credentialDirectory);
      const pending = [];
      for (const message of messages) {
        const previous = state.ledger.get(message.id);
        if (previous && previous.fingerprint !== fingerprint(message)) throw new Error('Admission fingerprint mismatch');
        if (previous?.state === 'accepted') {
          state.seen.add(message.id);
          await channel.request('ack', { agentId: identity('opencode', sessionID), id: message.id });
          state.queue = state.queue.filter(m => m.id !== message.id);
        } else if (previous && ['inflight', 'uncertain'].includes(previous.state)) return;
        else pending.push(message);
      }
      if (!pending.length) return;
      if (state.generation !== generation || !state.tools.agentId || state.blocked.size) return;
      const body = { parts: [{ type: 'text', text: pending.map(render).join('\n\n') }],
        agent: state.agent, model: state.model, ...(state.toolsPolicy ? { tools: state.toolsPolicy } : {}) };
      // Context-only insertion for a running loop; async prompt wakes an idle loop.
      for (const message of pending) state.ledger.set({ id: message.id, fingerprint: fingerprint(message), state: 'inflight', updatedAt: Date.now() });
      if (busy) await client.session.prompt({ path: { id: sessionID }, body: { ...body, noReply: true }, throwOnError: true });
      else await client.session.promptAsync({ path: { id: sessionID }, body, throwOnError: true });
      for (const message of pending) state.ledger.set({ id: message.id, fingerprint: fingerprint(message), state: 'accepted', updatedAt: Date.now() });
      if (state.generation !== generation) return;
      state.queue = state.queue.filter(m => !pending.some(p => p.id === m.id));
      for (const message of pending) {
        state.seen.add(message.id);
        await channel.request('ack', { agentId: identity('opencode', sessionID), id: message.id });
      }
    } catch (error) {
      await client.app.log({ body: { service: 'turnlink', level: 'error', message: `Peer admission blocked or uncertain (${diagnosticCode(error)}); inspect private receipts` } }).catch(() => {});
    } finally { state.flushing = false; }
  };
  channel.on('message', message => {
    for (const [sessionID, state] of sessions) {
      if (!message.recipients.includes(identity('opencode', sessionID))) continue;
      if (state.seen.has(message.id)) {
        void channel.request('ack', { agentId: identity('opencode', sessionID), id: message.id }).catch(() => {});
      } else if (!state.queue.some(m => m.id === message.id)) {
        state.queue.push(message);
        void flush(sessionID);
      }
    }
  });
  channel.on('membership_removed', ({ agentId }) => {
    for (const [sessionID, state] of sessions) {
      if (identity('opencode', sessionID) === agentId) {
        state.queue = [];
        state.generation++;
        state.tools.agentId = null;
      }
    }
  });
  const make = (name, description, args, prepare = a => a) => tool({ description, args,
    async execute(args, context) {
      const state = get(context.sessionID);
      return JSON.stringify(await state.tools.call(name, prepare(args, context)));
    },
  });
  const s = tool.schema.string().min(1);
  const timer = setInterval(() => { for (const id of sessions.keys()) void flush(id); }, 2000);
  timer.unref();
  return {
    dispose: async () => { clearInterval(timer); channel.close(); },
    'chat.message': async (input, output) => {
      const state = get(input.sessionID);
      if (input.agent || output?.message?.agent) state.agent = input.agent || output.message.agent;
      if (input.model || output?.message?.model) state.model = input.model || output.message.model;
      if (output?.message?.tools) state.toolsPolicy = output.message.tools;
    },
    event: async ({ event }) => {
      const p = event.properties;
      if (event.type === 'session.deleted') {
        const state = sessions.get(p.info.id);
        if (state) { state.generation++; state.queue = []; state.tools.agentId = null; }
        sessions.delete(p.info.id);
        await channel.unsubscribe(identity('opencode', p.info.id));
        return;
      }
      if (!p?.sessionID) return;
      const state = sessions.get(p.sessionID);
      if (!state) return;
      if (event.type === 'session.next.agent.switched') state.agent = p.agent;
      if (event.type === 'session.next.model.switched') state.model = p.model;
      if (['permission.asked', 'permission.updated', 'question.asked', 'permission.v2.asked', 'question.v2.asked'].includes(event.type)) state.blocked.add(p.id);
      if (['permission.replied', 'question.replied', 'question.rejected', 'permission.v2.replied', 'question.v2.replied', 'question.v2.rejected'].includes(event.type)) state.blocked.delete(p.id || p.requestID);
      if (event.type === 'session.idle' || event.type === 'session.status') void flush(p.sessionID);
    },
    tool: {
      channel_join: make('channel_join', 'Join the shared agent channel; declare your role and project.', {
        channel: s, name: s, role: s, project: tool.schema.object({ name: s, root: s.optional() }),
      }, (args, context) => ({ ...args, harness: 'opencode', sessionId: context.sessionID,
        project: { ...args.project, root: args.project.root || directory } })),
      channel_members: make('channel_members', 'Discover agents, roles and projects.', { channel: s }),
      channel_send: make('channel_send', 'Send a task or reply to an agentId, or * for broadcast. Can wake idle peers.', { to: s, text: s, messageId: s.optional() }),
      channel_history: make('channel_history', 'Read channel messages and delivery state.', { channel: s, limit: tool.schema.number().int().min(1).max(100).optional() }),
      channel_leave: make('channel_leave', 'Leave the channel.', {}),
    },
  };
}
