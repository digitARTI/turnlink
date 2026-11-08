import { setTimeout as delay } from 'node:timers/promises';
import { resolve, isAbsolute } from 'node:path';
import { ChannelClient } from '../src/client.js';
import { ToolSession, tools, controlTools } from '../src/tools.js';
import { identity, render, digest } from '../src/config.js';
import { AdmissionLedger, fingerprint } from '../src/admissions.js';
import { diagnosticCode } from '../src/diagnostics.js';
import { makeOpenCodeControl } from './opencode-control.js';
import { makeOpenCodeTasks } from './opencode-tasks.js';
import { retryBrokerPreDispatch } from '../src/broker-rate-limit.js';
import { readPrivate } from '../src/storage.js';
import { validateCredential } from '../src/config.js';
import { TurnlinkAlerts } from './opencode-alerts-rpc.js';
import { makeOpenCodeAlerts } from './opencode-alerts.js';
import { makeDeliveryRecovery } from '../src/delivery-recovery.js';
import { makeOpenCodeHealth } from './opencode-health.js';
import { readOpenCodeSessionContext } from './opencode-session-context.js';

export const admissionID = (sessionID, messageID) => `msg_turnlink_${digest(`${sessionID}:${messageID}`)}`;
const key = sessionID => `memberships/${sessionID}`;
const supported = version => {
  const match = /^2\.(\d+)\.(\d+)$/.exec(version);
  return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 28);
};

export async function setupOpenCode(ctx, dependencies = {}) {
  if (!supported(ctx.app.version.replace(/^v/, ''))) throw new Error('Turnlink requires OpenCode >=2.0.28 and <3; V1 is not supported');
  const options = ctx.options;
  if (options.receiverHandoff === true || options.initialMovement === true || options.movementTokenFile !== undefined) throw new Error('Automatic native transfer is not supported');
  if (options.alerts === true && options.control !== true) throw new Error('Passive alerts require explicit control opt-in');
  if (options.health === true && (options.control !== true || !options.adapterTokenFile)) throw new Error('Health reports require control and a separate adapter credential file');
  if (options.tasks === true && (options.control !== true || !options.adapterTokenFile)) throw new Error('Task execution requires control and a separate adapter credential file');
  if (options.worktreeTasks === true && options.tasks !== true) throw new Error('Worktree task execution requires task execution');
  if (options.receiverHandoff === true && (options.control !== true || !options.adapterTokenFile)) throw new Error('Receiver handoff requires control and a separate adapter credential file');
  if (options.movementTokenFile !== undefined && (options.receiverHandoff !== true || !isAbsolute(options.movementTokenFile) ||
    !options.tokenFile || !isAbsolute(options.tokenFile) || !isAbsolute(options.adapterTokenFile)))
    throw new Error('Movement RPC requires receiver handoff and absolute private credential files');
  if (options.initialMovement === true && options.movementTokenFile === undefined)
    throw new Error('Initial movement requires the private movement RPC');
  if (dependencies.channel && ((options.control === true && dependencies.allowParticipantControl !== true) || options.adapterTokenFile !== undefined ||
      options.tasks === true || options.health === true || options.alerts === true ||
      options.receiverHandoff === true || options.movementTokenFile !== undefined || options.initialMovement === true))
    throw new Error('Isolated participant channel does not cover control or movement');
  const channel = dependencies.channel ?? new ChannelClient({ url: options.url, tokenFile: options.tokenFile, credentialDirectory: options.credentialDirectory });
  const recovery = makeDeliveryRecovery({ client: channel, enabled: options.control === true && !!options.adapterTokenFile,
    credential: () => validateCredential(readPrivate(options.adapterTokenFile, 128).trim()) });
  const controller = new AbortController();
  const sessions = new Map();
  const relinquished = new Set();
  let closed = false;
  let recovering = false;
  let alertRegistration;
  const log = error => console.error(`Turnlink delivery blocked or uncertain (${diagnosticCode(error)}); inspect private receipts`);
  const ownSession = async (sessionID, signal = controller.signal) => {
    const session = await ctx.session.get({ sessionID }, { signal });
    if (resolve(session.location.directory) !== resolve(ctx.location.directory) || session.location.workspaceID !== ctx.location.workspaceID) {
      throw new Error('Session belongs to another plugin location');
    }
    return session;
  };
  const saveMembership = (sessionID, state, value) => {
    const generation = state.generation;
    state.saving = (state.saving || Promise.resolve()).catch(log).then(() => {
      if (!closed && !relinquished.has(sessionID) && state.generation === generation)
        return ctx.storage.set(key(sessionID), state.receiverHandoff ? { ...value, receiverHandoff: state.receiverHandoff } : value);
    });
    return state.saving;
  };
  const get = sessionID => {
    if (!sessions.has(sessionID)) sessions.set(sessionID, {
      tools: new ToolSession(channel, { harness: 'opencode', sessionId: sessionID, restoreWatchesOnJoin: options.control === true,
        onJoin: async agent => {
          const state = sessions.get(sessionID);
          state.alertRevision = (state.alertRevision || 0) + 1; delete state.alertSnapshot;
          state.controlChannel = agent.channel;
          const generation = state.generation;
          await saveMembership(sessionID, state, { sessionID, directory: ctx.location.directory, channel: agent.channel, forms: [...state.forms], taskWatch: state.taskWatch === true });
          if (closed || relinquished.has(sessionID) || state.generation !== generation) return;
          await channel.subscribe(agent.agentId);
          if (options.tasks === true && !state.taskWatch) await restoreClaimedTaskWatch(sessionID, state, generation);
          void control.poll(sessionID);
          if (state.taskWatch) void tasks.watch(sessionID);
        } }),
      queue: [], flushing: false, generation: 0, revision: 0, blocked: new Set(), forms: new Set(),
    });
    return sessions.get(sessionID);
  };
  const invalidate = state => { state.generation++; state.queue = []; state.tools.clearSessionWatches(); state.tools.stopSessionRecovery(); state.tools.agentId = null; delete state.alertSnapshot; };
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
  const restoreClaimedTaskWatch = async (sessionID, state, generation) => {
    const agentId = identity('opencode', sessionID), channelName = state.controlChannel;
    const guard = () => {
      if (closed || relinquished.has(sessionID) || sessions.get(sessionID) !== state || state.generation !== generation ||
          state.tools.agentId !== agentId || state.controlChannel !== channelName) throw new Error('Session task watch changed');
    };
    for (let offset = 0, pageCount = 0; pageCount < 4096; pageCount++) {
      let page;
      try {
        page = await retryBrokerPreDispatch(() => channel.request('control_query', { agentId, channel: channelName, view: 'tasks', offset, limit: 100 }),
          { signal: controller.signal, check: guard });
      } catch (error) {
        if (['CHANNEL_NOT_CONFIGURED', 'CONTROL_DISABLED'].includes(error?.code)) return;
        throw error;
      }
      if (!Array.isArray(page.entries) || !Number.isSafeInteger(page.next)) throw new Error('Task watch recovery unavailable');
      if (page.entries.some(task => task.claimant === agentId && ['claimed', 'dispatching', 'running', 'uncertain'].includes(task.status))) {
        guard(); state.taskWatch = true; tasks.wake(sessionID);
        await saveMembership(sessionID, state, { sessionID, directory: ctx.location.directory, channel: channelName, forms: [...state.forms], taskWatch: true });
        guard(); return;
      }
      if (!page.entries.length || page.next <= offset) return;
      offset = page.next;
    }
    throw new Error('Task watch recovery query budget exhausted');
  };
  const health = makeOpenCodeHealth({ ctx, channel, sessions, options, signal: controller.signal, ownSession, refreshBlockers,
    log: error => console.error(`Turnlink health observation unavailable (${diagnosticCode(error)}); no recovery attempted`) });
  let maintenancePaused = false;
  const healthTimer = options.health === true ? setInterval(() => {
    if (maintenancePaused) return;
    for (const id of sessions.keys()) void health.poll(id);
  }, 2000) : undefined;
  healthTimer?.unref();
  channel.on('connected', () => { for (const [id, state] of sessions) if (state.taskWatch) void tasks.watch(id); });
  channel.on('task_available', ({ agentId }) => {
    for (const [id, state] of sessions) if (state.tools.agentId === agentId && state.taskWatch) { tasks.wake(id); void tasks.poll(id); }
  });
  const flush = async sessionID => {
    const state = sessions.get(sessionID);
    if (closed || !state || state.handoffPending || state.flushing || state.taskBusy || !state.tools.agentId || !state.queue.length) return;
    state.flushing = true;
    const generation = state.generation;
    const valid = () => !closed && state.generation === generation && !!state.tools.agentId;
    try {
      await ownSession(sessionID);
      const revision = state.revision;
      if (!await refreshBlockers(sessionID, state, valid) || revision !== state.revision) return;
      state.ledger ??= dependencies.createAdmissionLedger?.(channel.hostId, identity('opencode', sessionID)) ??
        new AdmissionLedger(channel.hostId, identity('opencode', sessionID), options.credentialDirectory);
      for (const message of state.queue.slice(0, 8)) {
        if (!valid() || state.blocked.size || revision !== state.revision) return;
        const previous = await state.ledger.get(message.id);
        if (!valid() || revision !== state.revision || state.blocked.size) return;
        if (previous && previous.fingerprint !== fingerprint(message)) throw new Error('Admission fingerprint mismatch');
        const id = admissionID(sessionID, message.id);
        const delivery = await recovery.pull(identity('opencode', sessionID), message.id);
        if (!valid() || revision !== state.revision || state.blocked.size || delivery.policy === 'paused') return;
        const retry = delivery.retry;
        if (retry?.evidence === 'native_idempotent' && retry.admissionID !== id) return;
        // Legacy/externally reconciled uncertain receipts lack a V2 idempotency key. Never guess.
        if (previous && ['inflight', 'uncertain'].includes(previous.state) &&
          (previous.method !== 'session.prompt' || previous.rpcId !== id)) return;
        if (delivery.controlled && previous && ['inflight', 'uncertain'].includes(previous.state) && !retry) {
          await recovery.observe(identity('opencode', sessionID), message, 'native_idempotent', id, `ledger:${previous.updatedAt}`);
          return;
        }
        if (previous?.state !== 'accepted') {
          const receipt = { id: message.id, fingerprint: fingerprint(message), state: 'inflight',
            rpcId: id, method: 'session.prompt', updatedAt: Date.now() };
          await state.ledger.set(receipt);
          try {
            if (!valid() || revision !== state.revision || state.blocked.size) throw new Error('Native admission is no longer valid');
            const admitted = await ctx.session.prompt({ sessionID, id, text: render(message), delivery: delivery.policy, resume: true,
              metadata: { source: 'turnlink', messageID: message.id, sender: message.from.agentId, channel: message.channel } },
            { signal: controller.signal });
            if (admitted.id !== id || admitted.sessionID !== sessionID) throw new Error('Unexpected admission receipt');
            await state.ledger.set({ ...receipt, state: 'accepted', updatedAt: Date.now() });
          } catch (error) {
            const uncertain = { ...receipt, state: 'uncertain', updatedAt: Date.now() };
            await state.ledger.set(uncertain);
            if (delivery.controlled) {
              try { await recovery.finish(identity('opencode', sessionID), retry, 'uncertain', id); }
              finally { await recovery.observe(identity('opencode', sessionID), message, 'native_idempotent', id, `ledger:${uncertain.updatedAt}`); }
            }
            throw error;
          }
        }
        if (!valid()) return;
        await recovery.finish(identity('opencode', sessionID), retry, 'admitted', id);
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
      health.forget(sessionID);
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
    state.healthRevision = (state.healthRevision || 0) + 1;
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
    if (state.awaitingReceiver && event.type.startsWith('form.')) {
      state.receiverFormChanges ??= new Map();
      if (event.type === 'form.created') state.receiverFormChanges.set(`form:${p.form.id}`, true);
      if (['form.replied', 'form.cancelled'].includes(event.type)) state.receiverFormChanges.set(`form:${p.id}`, false);
    }
    if (event.type.startsWith('permission.') || event.type.startsWith('form.')) state.revision++;
    if (event.type.startsWith('form.') && state.tools.agentId && !state.awaitingReceiver) {
      const value = { sessionID, directory: ctx.location.directory, forms: [...state.forms], taskWatch: state.taskWatch === true, ...(state.controlChannel ? { channel: state.controlChannel } : {}) };
      await saveMembership(sessionID, state, value);
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
          const existing = sessions.get(sessionID);
          if (typeof sessionID !== 'string' || relinquished.has(sessionID) || entry.key !== key(sessionID) ||
            (existing?.tools.agentId && !existing.awaitingReceiver)) continue;
          if (entry.value.directory !== ctx.location.directory) continue; // A session move is not an authorized membership handoff.
          // Legacy automatic-transfer memberships stay fenced.
          if (Object.hasOwn(entry.value, 'receiverHandoff')) continue;
          if (existing?.awaitingReceiver) continue;
          try {
            await ownSession(sessionID);
            const resumed = await channel.request('resume', { agentId: identity('opencode', sessionID) });
            if (closed) return;
            if (!resumed.registered) { await ctx.storage.remove(entry.key); continue; }
            get(sessionID).tools.agentId = identity('opencode', sessionID);
            get(sessionID).forms = new Set(Array.isArray(entry.value.forms) ? entry.value.forms : []);
            get(sessionID).controlChannel = typeof entry.value.channel === 'string' ? entry.value.channel : undefined;
            get(sessionID).tools.channel = get(sessionID).controlChannel;
            get(sessionID).taskWatch = entry.value.taskWatch === true;
            channel.registrations.set(identity('opencode', sessionID), {});
            await channel.subscribe(identity('opencode', sessionID));
            if (options.control === true) get(sessionID).tools.startSessionRecovery();
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
  ctx.maintenance?.register({ pause: () => { if (maintenancePaused) throw new Error('Already paused'); maintenancePaused = true; },
    resume: () => { if (!maintenancePaused) throw new Error('Not paused'); maintenancePaused = false; } });
  const timer = setInterval(() => {
    if (maintenancePaused) return;
    void recover().catch(log);
    for (const id of sessions.keys()) { void tasks.poll(id); void flush(id); }
  }, 2000);
  timer.unref();
  const controlTimer = options.control === true && options.adapterTokenFile ? setInterval(() => {
    if (maintenancePaused) return;
    for (const id of sessions.keys()) void control.poll(id);
  }, 30000) : undefined;
  controlTimer?.unref();
  const cleanup = () => {
    clearInterval(healthTimer);
    closed = true; controller.abort(); clearInterval(timer); clearInterval(controlTimer);
    for (const state of sessions.values()) invalidate(state);
    channel.close();
    return Promise.all([alertRegistration?.dispose()]);
  };
  try {
    if (options.alerts === true) {
      const snapshot = makeOpenCodeAlerts({ channel, sessions, signal: controller.signal, ownSession });
      alertRegistration = await ctx.rpc.register(TurnlinkAlerts, { snapshot });
    }
    await ctx.tool.transform(editor => {
      // The isolated participant bridge does not expose native agent/model
      // observations, so it cannot safely provide this tool.
      if (options.control === true && !dependencies.channel) editor.add({ name: 'channel_session_context',
        description: 'Observe this OpenCode session’s hosting runtime version, selected agent, model and fingerprint of native agent/session permission rules. It does not observe OS or remote policies.',
        input: { type: 'object', properties: {}, additionalProperties: false }, options: { codemode: false },
        async execute(_args, context) {
          if (closed || relinquished.has(context.sessionID) || sessions.get(context.sessionID)?.handoffPending) throw new Error('Session receiver is unavailable');
          const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
          return { content: JSON.stringify(await readOpenCodeSessionContext({ ctx, sessionID: context.sessionID, ownSession, signal })) };
        } });
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
            if (relinquished.has(context.sessionID) || sessions.get(context.sessionID)?.handoffPending) throw new Error('Session receiver has been relinquished or is transferring');
            const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
            signal.throwIfAborted();
            const session = await ownSession(context.sessionID, signal);
            if (closed || relinquished.has(context.sessionID) || sessions.get(context.sessionID)?.handoffPending) throw new Error('Session receiver has been relinquished or is transferring');
            const state = get(context.sessionID);
            state.toolBusy = (state.toolBusy || 0) + 1;
            try {
              if (definition.name === 'channel_join') args = { ...args, harness: 'opencode', sessionId: context.sessionID,
                project: { ...args.project, root: args.project.root || session.location.directory } };
              const result = await state.tools.call(definition.name, args);
              if (options.tasks === true && definition.name === 'channel_control' && args.command?.op === 'task.claim') {
                state.taskWatch = true; tasks.wake(context.sessionID);
                await saveMembership(context.sessionID, state, { sessionID: context.sessionID, directory: ctx.location.directory,
                  channel: state.controlChannel, forms: [...state.forms], taskWatch: true });
                void tasks.watch(context.sessionID);
              }
              if (['channel_control', 'channel_status'].includes(definition.name)) void control.poll(context.sessionID);
              if (definition.name === 'channel_leave') { invalidate(state); await state.saving; await ctx.storage.remove(key(context.sessionID)); }
              return { content: JSON.stringify(result) };
            } finally {
              state.toolBusy--;
            }
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
