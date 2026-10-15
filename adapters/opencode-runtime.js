import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { ChannelClient } from '../src/client.js';
import { ToolSession, tools, controlTools } from '../src/tools.js';
import { identity, render, digest } from '../src/config.js';
import { AdmissionLedger, fingerprint } from '../src/admissions.js';
import { diagnosticCode } from '../src/diagnostics.js';
import { makeOpenCodeControl } from './opencode-control.js';
import { makeOpenCodeTasks } from './opencode-tasks.js';
import { readPrivate } from '../src/storage.js';
import { validateCredential } from '../src/config.js';

export const admissionID = (sessionID, messageID) => `msg_turnlink_${digest(`${sessionID}:${messageID}`)}`;
const key = sessionID => `memberships/${sessionID}`;
const supported = version => {
  const match = /^2\.(\d+)\.(\d+)$/.exec(version);
  return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 28);
};

export async function setupOpenCode(ctx) {
  if (!supported(ctx.app.version.replace(/^v/, ''))) throw new Error('Turnlink requires OpenCode >=2.0.28 and <3; V1 is not supported');
  const options = ctx.options;
  if (options.tasks === true && (options.control !== true || !options.adapterTokenFile)) throw new Error('Task execution requires control and a separate adapter credential file');
  const channel = new ChannelClient({ url: options.url, tokenFile: options.tokenFile, credentialDirectory: options.credentialDirectory });
  const controller = new AbortController();
  const sessions = new Map();
  let closed = false;
  let recovering = false;
  const log = error => console.error(`Turnlink delivery blocked or uncertain (${diagnosticCode(error)}); inspect private receipts`);
  const ownSession = async (sessionID, signal = controller.signal) => {
    const session = await ctx.session.get({ sessionID }, { signal });
    if (resolve(session.location.directory) !== resolve(ctx.location.directory) || session.location.workspaceID !== ctx.location.workspaceID) {
      throw new Error('Session belongs to another plugin location');
    }
    return session;
  };
  const get = sessionID => {
    if (!sessions.has(sessionID)) sessions.set(sessionID, {
      tools: new ToolSession(channel, { harness: 'opencode', sessionId: sessionID,
        onJoin: async agent => {
          const state = sessions.get(sessionID);
          state.controlChannel = agent.channel;
          await state.saving;
          await ctx.storage.set(key(sessionID), { sessionID, directory: ctx.location.directory, channel: agent.channel, forms: [...state.forms], taskWatch: state.taskWatch === true });
          await channel.subscribe(agent.agentId);
          void control.poll(sessionID);
          if (state.taskWatch) void tasks.watch(sessionID);
        } }),
      queue: [], flushing: false, generation: 0, revision: 0, blocked: new Set(), forms: new Set(),
    });
    return sessions.get(sessionID);
  };
  const invalidate = state => { state.generation++; state.queue = []; state.tools.agentId = null; };
  const refreshBlockers = async (sessionID, state, valid) => {
    const revision = state.revision;
    const [permissions, context] = await Promise.all([
      ctx.permission.list({ sessionID }, { signal: controller.signal }),
      ctx.session.context({ sessionID }, { signal: controller.signal }),
    ]);
    if (!valid() || revision !== state.revision) return false;
    const questions = context.flatMap(m => m.type === 'assistant' ? m.content : [])
      .filter(part => part.type === 'tool' && part.name === 'question' && ['running', 'streaming'].includes(part.state.status));
    state.blocked = new Set([...permissions.map(p => `permission:${p.id}`), ...state.forms].concat(questions.map(p => `question:${p.id}`)));
    return !state.blocked.size;
  };
  const control = makeOpenCodeControl({ ctx, channel, sessions, options, signal: controller.signal, ownSession, refreshBlockers, log });
  const tasks = makeOpenCodeTasks({ ctx, channel, sessions, options, signal: controller.signal, ownSession, refreshBlockers, log,
    credential: () => validateCredential(readPrivate(options.adapterTokenFile, 128).trim()) });
  channel.on('connected', () => { for (const [id, state] of sessions) if (state.taskWatch) void tasks.watch(id); });
  channel.on('task_available', ({ agentId }) => {
    for (const [id, state] of sessions) if (state.tools.agentId === agentId && state.taskWatch) { state.taskPending = true; void tasks.poll(id); }
  });
  const flush = async sessionID => {
    const state = sessions.get(sessionID);
    if (closed || !state || state.flushing || state.taskBusy || !state.tools.agentId || !state.queue.length) return;
    state.flushing = true;
    const generation = state.generation;
    const valid = () => !closed && state.generation === generation && !!state.tools.agentId;
    try {
      await ownSession(sessionID);
      const revision = state.revision;
      if (!await refreshBlockers(sessionID, state, valid) || revision !== state.revision) return;
      state.ledger ??= new AdmissionLedger(channel.hostId, identity('opencode', sessionID), options.credentialDirectory);
      for (const message of state.queue.slice(0, 8)) {
        if (!valid() || state.blocked.size || revision !== state.revision) return;
        const previous = state.ledger.get(message.id);
        if (previous && previous.fingerprint !== fingerprint(message)) throw new Error('Admission fingerprint mismatch');
        const id = admissionID(sessionID, message.id);
        // Legacy/externally reconciled uncertain receipts lack a V2 idempotency key. Never guess.
        if (previous && ['inflight', 'uncertain'].includes(previous.state) &&
          (previous.method !== 'session.prompt' || previous.rpcId !== id)) return;
        if (previous?.state !== 'accepted') {
          const receipt = { id: message.id, fingerprint: fingerprint(message), state: 'inflight',
            rpcId: id, method: 'session.prompt', updatedAt: Date.now() };
          state.ledger.set(receipt);
          try {
            const admitted = await ctx.session.prompt({ sessionID, id, text: render(message), delivery: 'steer', resume: true,
              metadata: { source: 'turnlink', messageID: message.id, sender: message.from.agentId, channel: message.channel } },
            { signal: controller.signal });
            if (admitted.id !== id || admitted.sessionID !== sessionID) throw new Error('Unexpected admission receipt');
            state.ledger.set({ ...receipt, state: 'accepted', updatedAt: Date.now() });
          } catch (error) {
            state.ledger.set({ ...receipt, state: 'uncertain', updatedAt: Date.now() });
            throw error;
          }
        }
        if (!valid()) return;
        await channel.request('ack', { agentId: identity('opencode', sessionID), id: message.id });
        state.queue = state.queue.filter(m => m.id !== message.id);
      }
    } catch (error) { if (!closed) log(error); }
    finally { state.flushing = false; }
  };
  channel.on('message', message => {
    if (closed) return;
    for (const [sessionID, state] of sessions) {
      if (!state.tools.agentId || !message.recipients.includes(identity('opencode', sessionID))) continue;
      if (!state.queue.some(m => m.id === message.id)) state.queue.push(message);
      void flush(sessionID);
    }
  });
  channel.on('membership_removed', ({ agentId }) => {
    for (const [sessionID, state] of sessions) if (identity('opencode', sessionID) === agentId) {
      invalidate(state);
      const generation = state.generation;
      void (async () => {
        await state.saving;
        if (state.generation === generation && !state.tools.agentId) await ctx.storage.remove(key(sessionID));
      })().catch(log);
    }
  });
  const handleEvent = async event => {
    if (closed) return;
    const p = event.data;
    const sessionID = p?.sessionID || p?.form?.sessionID;
    const state = sessions.get(sessionID);
    if (!state) return;
    if (event.type === 'session.deleted' || event.type === 'session.moved') {
      invalidate(state); sessions.delete(sessionID);
      await channel.unsubscribe(identity('opencode', sessionID));
      await state.saving;
      await ctx.storage.remove(key(sessionID));
      return;
    }
    if (event.type === 'permission.asked') state.blocked.add(`permission:${p.id}`);
    if (event.type === 'permission.replied') state.blocked.delete(`permission:${p.requestID}`);
    if (event.type === 'form.created') state.forms.add(`form:${p.form.id}`);
    if (['form.replied', 'form.cancelled'].includes(event.type)) state.forms.delete(`form:${p.id}`);
    if (event.type.startsWith('permission.') || event.type.startsWith('form.')) state.revision++;
    if (event.type.startsWith('form.') && state.tools.agentId) {
      const value = { sessionID, directory: ctx.location.directory, forms: [...state.forms], taskWatch: state.taskWatch === true, ...(state.controlChannel ? { channel: state.controlChannel } : {}) };
      state.saving = (state.saving || Promise.resolve()).catch(log).then(() => {
        if (!closed) return ctx.storage.set(key(sessionID), value);
      });
      await state.saving;
    }
    void flush(sessionID);
  };
  const recover = async () => {
    if (closed || recovering) return;
    recovering = true;
    try {
      let after;
      do {
        const page = await ctx.storage.scan({ prefix: 'memberships/', limit: 100, ...(after ? { after } : {}) });
        for (const entry of page.entries) {
          if (closed) return;
          const sessionID = entry.value?.sessionID;
          if (typeof sessionID !== 'string' || entry.key !== key(sessionID) || sessions.get(sessionID)?.tools.agentId) continue;
          if (entry.value.directory !== ctx.location.directory) continue; // A session move is not an authorized membership handoff.
          try {
            await ownSession(sessionID);
            const resumed = await channel.request('resume', { agentId: identity('opencode', sessionID) });
            if (closed) return;
            if (!resumed.registered) { await ctx.storage.remove(entry.key); continue; }
            get(sessionID).tools.agentId = identity('opencode', sessionID);
            get(sessionID).forms = new Set(Array.isArray(entry.value.forms) ? entry.value.forms : []);
            get(sessionID).controlChannel = typeof entry.value.channel === 'string' ? entry.value.channel : undefined;
            get(sessionID).taskWatch = entry.value.taskWatch === true;
            channel.registrations.set(identity('opencode', sessionID), {});
            await channel.subscribe(identity('opencode', sessionID));
            void control.poll(sessionID);
            if (get(sessionID).taskWatch) void tasks.watch(sessionID);
          } catch (error) {
            const state = sessions.get(sessionID);
            if (state) state.tools.agentId = null;
            if (error._tag === 'SessionNotFoundError') await ctx.storage.remove(entry.key);
            if (!closed) log(error);
          }
        }
        after = page.next;
      } while (after && !closed);
    } finally { recovering = false; }
  };
  const timer = setInterval(() => {
    void recover().catch(log);
    for (const id of sessions.keys()) { void tasks.poll(id); void flush(id); }
  }, 2000);
  timer.unref();
  const controlTimer = options.control === true && options.adapterTokenFile ? setInterval(() => {
    for (const id of sessions.keys()) void control.poll(id);
  }, 30000) : undefined;
  controlTimer?.unref();
  const cleanup = () => {
    closed = true; controller.abort(); clearInterval(timer); clearInterval(controlTimer);
    for (const state of sessions.values()) invalidate(state);
    channel.close();
  };
  try {
    await ctx.tool.transform(editor => {
      for (const definition of [...tools, ...(options.control === true ? controlTools : [])].filter(t => t.name !== 'channel_ack')) {
        const input = structuredClone(definition.inputSchema);
        if (definition.name === 'channel_join') {
          delete input.properties.harness; delete input.properties.sessionId;
          input.required = input.required.filter(k => !['harness', 'sessionId'].includes(k));
          input.properties.project.required = ['name'];
        }
        editor.add({ name: definition.name, description: definition.name === 'channel_join'
          ? 'Join the shared agent channel; declare your role and project. Identity is supplied by the actual OpenCode session.'
          : definition.description, input, options: { codemode: false },
          async execute(args, context) {
            if (closed) throw new Error('Turnlink plugin is closed');
            const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
            signal.throwIfAborted();
            const session = await ownSession(context.sessionID, signal);
            const state = get(context.sessionID);
            if (definition.name === 'channel_join') args = { ...args, harness: 'opencode', sessionId: context.sessionID,
              project: { ...args.project, root: args.project.root || session.location.directory } };
            const result = await state.tools.call(definition.name, args);
            if (options.tasks === true && definition.name === 'channel_control' && args.command?.op === 'task.claim') {
              state.taskWatch = true; state.taskPending = true;
              await state.saving;
              await ctx.storage.set(key(context.sessionID), { sessionID: context.sessionID, directory: ctx.location.directory,
                channel: state.controlChannel, forms: [...state.forms], taskWatch: true });
              void tasks.watch(context.sessionID);
            }
            if (['channel_control', 'channel_status'].includes(definition.name)) void control.poll(context.sessionID);
            if (definition.name === 'channel_leave') { invalidate(state); await state.saving; await ctx.storage.remove(key(context.sessionID)); }
            return { content: JSON.stringify(result) };
          },
        });
      }
    });
    // Live-only streams must be re-established. Snapshot permissions/questions; retain uncertain external form blockers.
    void (async () => {
      while (!closed) {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            // Buffer slow work so this subscriber does not stall the shared event stream.
            void handleEvent(event).catch(log);
          }
        } catch (error) { if (!closed) log(error); }
        if (!closed) {
          for (const state of sessions.values()) { state.blocked.clear(); state.revision++; }
          await delay(1000, undefined, { signal: controller.signal });
        }
      }
    })().catch(error => { if (!closed) log(error); });
    await recover();
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
