#!/usr/bin/env node
// Transparent stdio proxy: the official extension still owns the same Codex process.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChannelClient } from './client.js';
import { digest, identity, render, stateDir, validateCredential } from './config.js';
import { AdmissionLedger, fingerprint } from './admissions.js';
import { diagnosticCode } from './diagnostics.js';
import { resolveExecutable } from './executable.js';
import { makeCodexControl, roleFingerprint } from './codex-control.js';
import { createCodexProxyBoundary } from './codex-proxy-boundary.js';
import { isCodexNativeRead } from './codex-admission-fence.js';
import { ownsCodexReceiver, relinquishCodexReceiver } from './codex-receiver-ownership.js';
import { makeCodexTasks } from './codex-tasks.js';
import { makeHealthPublisher } from './adapter-health.js';
import { retryBrokerPreDispatch } from './broker-rate-limit.js';
import { makeDeliveryRecovery } from './delivery-recovery.js';
import { readPrivate } from './storage.js';
import { checkCodexStoreCandidate } from './codex-store-candidate.js';
import { codexInitializeVersion } from './codex-runtime-version.js';

// Optional metadata preflight; this is not a movement authorization or proof
// about Desktop processes. It never changes users, permissions or stores.
if (process.env.AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID !== undefined) {
  try {
    const value = process.env.AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID;
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error();
    checkCodexStoreCandidate({ codexHome: process.env.CODEX_HOME, sqliteHome: process.env.CODEX_SQLITE_HOME, desktopUid: Number(value) });
  } catch { console.error('Turnlink: Codex store candidate metadata unavailable'); process.exit(1); }
}

let executable;
try { executable = resolveExecutable(process.env.AGENT_CHANNEL_CODEX_EXECUTABLE || ''); }
catch { console.error('Set AGENT_CHANNEL_CODEX_EXECUTABLE to an available real Codex executable (not this proxy).'); process.exit(1); }
const args = process.argv.slice(2);
try {
  const target = statSync(executable), self = statSync(process.argv[1]);
  if (realpathSync(executable) === realpathSync(process.argv[1]) ||
      (target.ino !== 0 && target.ino === self.ino && target.dev === self.dev)) {
    console.error('Turnlink: recursive Codex executable'); process.exit(1);
  }
} catch { /* spawn reports an unavailable executable without exposing the path */ }
const childEnv = { ...process.env };
if (process.env.AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID !== undefined) {
  // The staged native runtime understands these expectations. A stock binary
  // may ignore them; they are not a capability or executable attestation.
  childEnv.TURNLINK_CODEX_EXPECTED_CODEX_HOME = process.env.CODEX_HOME;
  childEnv.TURNLINK_CODEX_EXPECTED_SQLITE_HOME = process.env.CODEX_SQLITE_HOME;
}
if (['AGENT_CHANNEL_CODEX_NATIVE_CONTROL', 'AGENT_CHANNEL_CODEX_SOURCE_FILE', 'AGENT_CHANNEL_CODEX_DESTINATION_FILE', 'AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE', 'AGENT_CHANNEL_CODEX_CONTAINED_RETIRE'].some(key => process.env[key] && process.env[key] !== '0')) { console.error('Turnlink: automatic native transfer is not supported'); process.exit(1); }
const stdioAppServer = args.includes('app-server') && !args.some(a => /^(?:--listen=)?(?:ws|unix):\/\//.test(a));
const daemonProxy = process.env.AGENT_CHANNEL_CODEX_DAEMON_PROXY === '1';
if (daemonProxy && (args.length !== 1 || args[0] !== 'app-server')) {
  console.error('Turnlink: shared daemon proxy requires a standard stdio app-server launch.'); process.exit(1);
}
const timeoutMs = Number(process.env.AGENT_CHANNEL_RPC_TIMEOUT_MS || 30000);
if (stdioAppServer && (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000)) throw new Error('Invalid RPC timeout');
if (process.env.AGENT_CHANNEL_HEALTH === '1' && (process.env.AGENT_CHANNEL_CONTROL !== '1' || !process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE)) {
  console.error('Turnlink: health reports require control and a separate adapter credential file'); process.exit(1);
}
for (const key of ['AGENT_CHANNEL_TOKEN', 'AGENT_CHANNEL_ADMIN_TOKEN', 'AGENT_CHANNEL_ADAPTER_TOKEN_FILE', 'AGENT_CHANNEL_HEALTH', 'AGENT_CHANNEL_CODEX_NATIVE_CONTROL', 'AGENT_CHANNEL_CODEX_DAEMON_PROXY', 'AGENT_CHANNEL_CODEX_DESTINATION_FILE', 'AGENT_CHANNEL_CODEX_SOURCE_FILE', 'AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET', 'AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE', 'AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID', 'AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE', 'AGENT_CHANNEL_CODEX_CONTAINED_RETIRE']) delete childEnv[key];
const child = spawn(daemonProxy ? process.execPath : executable, daemonProxy ? [fileURLToPath(new URL('./codex-daemon-stdio.js', import.meta.url))] : args,
  { stdio: ['pipe', 'pipe', 'inherit'], env: childEnv, windowsHide: true });
child.stdin.on('error', () => child.kill());
if (!stdioAppServer) {
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout);
} else {
  const client = new ChannelClient();
  const recovery = makeDeliveryRecovery({ client, enabled: process.env.AGENT_CHANNEL_CONTROL === '1' && !!process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE,
    credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()) });
  const threads = new Map();
  const requests = new Map();
  const own = new Map();
  const approvals = new Map();
  const taskRequests = new Map();
  const healthSignal = new AbortController();
  let nativeVersion, nativeInitialized = false, selectionRevision = 0;
  const health = makeHealthPublisher({ client, enabled: process.env.AGENT_CHANNEL_HEALTH === '1', signal: healthSignal.signal,
    credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()),
    log: error => console.error(`Turnlink: health observation unavailable (${diagnosticCode(error)})`) });
  client.on('connected', () => health.reset());
  const pollHealth = (threadId, state) => {
    if (!state.channel) return;
    const generation = state.generation, selection = state.nativeSelection, channel = state.channel, observedVersion = nativeVersion;
    return health.poll(identity('codex', threadId), async () => {
      const nativeRevision = fence.revision;
      const blockers = [...approvals.values()].filter(id => id === threadId).length;
      const known = state.lifecycleKnown && !fence.closed && !fence.held && !fence.unknownNativeActivity &&
        !fence.pending.size && !fence.serverRequests.size;
      return { valid: () => !healthSignal.signal.aborted && threads.get(threadId) === state && state.generation === generation &&
        state.nativeSelection === selection && state.channel === channel && nativeVersion === observedVersion && fence.revision === nativeRevision,
      report: { version: 1, adapterVersion: '0.2.0', nativeStatus: blockers ? 'blocked' : !known ? 'unknown' : state.turnId ? 'busy' : 'idle',
        ...(observedVersion ? { nativeVersion: observedVersion } : {}),
        queuedMessages: state.queue.length, blockers,
        ...(state.ledger ? { uncertainMessages: state.ledger.records.filter(r => ['inflight', 'uncertain'].includes(r.state)).length } : {}),
        features: { control: process.env.AGENT_CHANNEL_CONTROL === '1', tasks: process.env.AGENT_CHANNEL_CODEX_TASKS === '1', alerts: false, managedWorktrees: false } } };
    });
  };
  const invalidateSelection = scope => {
    selectionRevision++;
    if (scope === true) for (const entry of threads.values()) entry.nativeSelection = null;
    else { const entry = threads.get(scope); if (entry) entry.nativeSelection = null; }
  };
  const beforeWrite = (data, internal = false) => {
    let selectionInvalidation;
    if (!internal && data?.method) {
      // A new explicit native selection requires a fresh thread/resume response
      // before managed task admission. Never infer effective override policy.
      const threadId = data.params?.threadId;
      const changed = !(isCodexNativeRead(data.method) || ['turn/start', 'turn/steer', 'turn/interrupt'].includes(data.method)) ||
        (data.method === 'turn/start' && Object.keys(data.params || {}).some(k => !['threadId', 'input'].includes(k)));
      if (changed && threadId) { selectionInvalidation = threadId; invalidateSelection(threadId); }
      else if (changed && !['thread/start', 'initialize', 'initialized'].includes(data.method)) {
        selectionInvalidation = true; invalidateSelection(true);
      }
    }
    if (!internal && data?.id !== undefined && data.method) requests.set(data.id, { method: data.method, params: data.params,
      ...(!['thread/start', 'thread/resume'].includes(data.method) && selectionInvalidation ? { selectionInvalidation } : {}),
      ...(['thread/start', 'thread/resume'].includes(data.method) ? { selectionRevision } : {}),
      ...(data.method === 'turn/start' ? { turnRevision: threads.get(data.params?.threadId)?.turnRevision } : {}) });
    if (data?.id !== undefined && !data.method && approvals.has(data.id)) {
      const threadId = approvals.get(data.id); approvals.delete(data.id);
      return threadId;
    }
  };
  const boundary = createCodexProxyBoundary({ child,
    beforeWrite, afterWrite: threadId => { if (threadId !== undefined) void flush(threadId); },
    reply: data => process.stdout.write(`${JSON.stringify(data)}\n`),
    activity: threadID => {
      const state = threads.get(threadID);
      const all = [...threads.values()];
      return { known: !!state && all.every(s => s.lifecycleKnown === true), idle: !!state && all.every(s => !s.turnId),
        blocked: approvals.size > 0, flushing: all.some(s => s.flushing === true) };
    },
    onRelease: () => { for (const threadID of threads.keys()) setImmediate(() => { void tasks.poll(threadID); void flush(threadID); }); },
    onFatal: () => child.kill() });
  const { fence } = boundary;
  const write = data => fence.internal(data);
  const taskIdle = threadID => {
    const state = threads.get(threadID);
    return !!state?.lifecycleKnown && ownsCodexReceiver(client, threadID, state) && !state.turnId && !state.flushing && !fence.held && !fence.closed && approvals.size === 0 &&
      !fence.nativeTurns.size && !fence.unknownNativeActivity && !fence.serverRequests.size &&
      ![...fence.pending.values()].some(p => !isCodexNativeRead(p.method));
  };
  const taskRPC = (method, params, revision) => new Promise((resolve, reject) => {
    if (fence.closed || taskRequests.size >= 128) { reject(new Error('Native task RPC unavailable')); return; }
    if (method === 'turn/start' && (!taskIdle(params.threadId) || fence.revision !== revision)) {
      const error = new Error('Native task scope changed'); error.code = 'NATIVE_SNAPSHOT_CHANGED'; reject(error); return;
    }
    const id = `turnlink-task-rpc-${randomUUID()}`;
    const timer = setTimeout(() => {
      taskRequests.delete(id); const error = new Error('Native task RPC uncertain'); error.code = 'ADMISSION_UNCERTAIN'; reject(error);
    }, timeoutMs);
    taskRequests.set(id, { resolve, reject, timer });
    try { write({ id, method, params }); }
    catch (error) { clearTimeout(timer); taskRequests.delete(id); reject(error); }
  });
  const admissionFingerprint = (message, role) => role ? roleFingerprint(message) : fingerprint(message);
  const receipt = (state, message, status, extra = {}, role = false) => state.ledger.set({
    id: message.id, fingerprint: admissionFingerprint(message, role), state: status, updatedAt: Date.now(), ...extra,
  });
  const accepted = async (threadId, state, message, generation, response, role = false, retry = null, turnRevision) => {
    const receiptID = role ? `msg_turnlink_role_${message.id.replaceAll('-', '')}` : undefined;
    const recoveryActionID = state.ledger.get(message.id)?.recoveryActionID || retry?.id;
    // Persist known native success before a fallible broker outcome RPC. Keep its exact action across restart.
    receipt(state, message, 'accepted', role ? { rpcId: receiptID, method: 'role.accepted' } :
      recoveryActionID ? { recoveryActionID } : {}, role);
    if (state.generation !== generation) return;
    if (threads.get(threadId) !== state) return;
    // A native completion can arrive before the admission RPC resolves. Do
    // not replace that newer lifecycle observation with an older reply.
    if (response?.turn?.id && state.turnRevision === turnRevision) state.turnId = response.turn.id;
    if (!role && recoveryActionID) {
      await recovery.finish(identity('codex', threadId), { id: recoveryActionID }, 'admitted');
      if (state.generation !== generation || threads.get(threadId) !== state) return;
    }
    if (role) {
      await control.acknowledge(threadId, message, receiptID);
      state.roles = state.roles.filter(m => m.id !== message.id);
    } else {
      state.queue = state.queue.filter(m => m.id !== message.id); state.seen.add(message.id);
      await client.request('ack', { agentId: identity('codex', threadId), id: message.id });
    }
  };
  const rpc = (method, params, context) => new Promise((resolve, reject) => {
    if (fence.held || fence.closed || fence.unknownNativeActivity || threads.get(context.threadId) !== context.state ||
        context.state.generation !== context.generation || !ownsCodexReceiver(client, context.threadId, context.state)) {
      reject(new Error('Native admission is fenced or unavailable')); return;
    }
    if (own.size >= 128) { reject(new Error('Internal RPC limit reached')); return; }
    const id = `turnlink-internal-${randomUUID()}`;
    const pending = { resolve, reject, context, expired: false };
    receipt(context.state, context.message, 'inflight', { rpcId: id, method }, context.role);
    pending.timer = setTimeout(() => {
      pending.expired = true;
      try { receipt(context.state, context.message, 'uncertain', { rpcId: id, method }, context.role); }
      catch { /* prior inflight receipt remains conservative evidence */ }
      const error = new Error('Codex admission uncertain; inspect receipt before retry'); error.code = 'ADMISSION_UNCERTAIN'; reject(error);
    }, timeoutMs);
    own.set(id, pending);
    write({ id, method, params });
  });
  const flush = async threadId => {
    const state = threads.get(threadId);
    if (!state || !ownsCodexReceiver(client, threadId, state) || state.flushing || state.taskBusy || fence.held || fence.unknownNativeActivity || [...approvals.values()].includes(threadId)) return;
    state.flushing = true;
    try {
      while ((state.queue.length || state.roles.length) && ownsCodexReceiver(client, threadId, state) && !fence.held && !fence.unknownNativeActivity && ![...approvals.values()].includes(threadId)) {
        // Lifecycle notices never wake an idle thread. An already-accepted receipt can still be acknowledged while idle.
        const notice = state.roles.find(n => ['offer', 'task_review'].includes(n.kind) || state.turnId || state.ledger.get(n.id)?.state === 'accepted');
        const role = !!notice, message = notice || state.queue[0];
        if (!message) break;
        if (role && !state.lifecycleKnown) break;
        if (role && [...requests.values()].some(r => r.method === 'turn/start' && r.params?.threadId === threadId)) break;
        const generation = state.generation;
        const input = [{ type: 'text', text: role ? message.text : render(message) }];
        try {
          if (role) {
            if (!await control.pending(threadId, message)) { state.roles = state.roles.filter(n => n.id !== message.id); continue; }
            if (threads.get(threadId) !== state || state.generation !== generation || !ownsCodexReceiver(client, threadId, state) || fence.held || [...approvals.values()].includes(threadId)) break;
          }
          const delivery = role ? { policy: 'steer', retry: null } : await recovery.pull(identity('codex', threadId), message.id);
          if (threads.get(threadId) !== state || state.generation !== generation || !ownsCodexReceiver(client, threadId, state) || fence.held || [...approvals.values()].includes(threadId)) break;
          if (delivery.policy === 'paused' || (delivery.policy === 'queue' && state.turnId)) break;
          const previous = state.ledger.get(message.id);
          if (previous && previous.fingerprint !== admissionFingerprint(message, role)) throw new Error('Admission fingerprint mismatch');
          if (previous?.state === 'accepted') {
            await accepted(threadId, state, message, generation, undefined, role, delivery.retry); continue;
          }
          if (role && ((!state.turnId && !['offer', 'task_review'].includes(message.kind)) ||
            [...requests.values()].some(r => r.method === 'turn/start' && r.params?.threadId === threadId))) break;
          if (previous && ['inflight', 'uncertain'].includes(previous.state)) {
            if (delivery.controlled) await recovery.observe(identity('codex', threadId), message, 'uncertain', undefined, delivery.retry?.id);
            break;
          }
          const context = { threadId, state, message, generation, role, retry: delivery.retry, turnRevision: state.turnRevision };
          let response;
          if (state.turnId) response = await rpc('turn/steer', { threadId, expectedTurnId: state.turnId, input }, context);
          else {
            response = await rpc('turn/start', { threadId, input }, context);
          }
          await accepted(threadId, state, message, generation, response, role, delivery.retry, context.turnRevision);
        } catch (error) {
          console.error(`Turnlink: admission unresolved (${diagnosticCode(error)}), message=${message.id}; inspect private receipt`);
          break;
        }
        if (state.generation !== generation) break;
      }
    } catch (error) { console.error(`Turnlink: delivery blocked (${diagnosticCode(error)})`); }
    finally { state.flushing = false; }
  };
  const control = makeCodexControl({ client, threads, flush,
    enabled: process.env.AGENT_CHANNEL_CONTROL === '1', tokenFile: process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE,
    log: error => console.error(`Turnlink: control maintenance blocked (${diagnosticCode(error)})`) });
  const tasks = makeCodexTasks({ client, threads,
    enabled: process.env.AGENT_CHANNEL_CODEX_TASKS === '1' && process.env.AGENT_CHANNEL_CONTROL === '1',
    worktreeTasks: process.env.AGENT_CHANNEL_CODEX_WORKTREE_TASKS === '1',
    tokenFile: process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE,
    native: { held: () => fence.held, idle: taskIdle, revision: () => fence.revision,
      start: (threadId, text, revision) => taskRPC('turn/start', { threadId, input: [{ type: 'text', text }] }, revision),
      read: async threadId => {
        const revision = fence.revision, state = threads.get(threadId), selection = state?.nativeSelection;
        const [result, config] = await Promise.all([taskRPC('thread/read', { threadId, includeTurns: true }), taskRPC('config/read', { includeLayers: true })]);
        if (threads.get(threadId) !== state || state?.nativeSelection !== selection) {
          const error = new Error('Native task selection changed'); error.code = 'NATIVE_SNAPSHOT_REQUIRED'; throw error;
        }
        if (fence.revision !== revision) {
          const error = new Error('Native task snapshot changed'); error.code = 'NATIVE_SNAPSHOT_CHANGED'; throw error;
        }
        return { thread: result.thread, selection, configuration: config.config, revision };
      } }, log: error => console.error(`Turnlink: task execution blocked (${diagnosticCode(error)})`) });
  const bind = async (threadId, thread, newlyStarted = false, nativeResult) => {
    if (!threads.has(threadId)) {
      const active = thread?.turns?.find(turn => ['inProgress', 'in_progress'].includes(turn.status));
      const known = newlyStarted || (Array.isArray(thread?.turns) && thread.turns.every(turn => ['completed', 'interrupted', 'failed', 'inProgress', 'in_progress'].includes(turn.status)));
      threads.set(threadId, { queue: [], roles: [], seen: new Set(), turnId: active?.id || null, turnRevision: 0, lifecycleKnown: known, flushing: false, generation: 0 });
    }
    const bound = threads.get(threadId);
    if (nativeResult) bound.nativeSelection = { cwd: nativeResult.cwd, model: nativeResult.model, modelProvider: nativeResult.modelProvider,
      sandbox: nativeResult.sandbox, approvalPolicy: nativeResult.approvalPolicy };
    try {
      await client.connect();
      const state = threads.get(threadId);
      if (!state) return;
      state.ledger = new AdmissionLedger(client.hostId, identity('codex', threadId));
      const generation = state.generation;
      const wasDisabled = state.receiverDisabled;
      state.receiverDisabled = false;
      let subscription;
      const cwd = state.nativeSelection?.cwd;
      const observedCwd = typeof cwd === 'string' && cwd.length > 0 && Buffer.byteLength(cwd) <= 2048 && cwd.trim() === cwd &&
        !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(cwd) ? cwd : undefined;
      try { subscription = await retryBrokerPreDispatch(() => client.subscribe(identity('codex', threadId), { observedCwd }), {
        signal: healthSignal.signal, check: () => {
          if (threads.get(threadId) !== state || state.generation !== generation) throw new Error('Receiver binding changed');
        },
      }); }
      catch (error) {
        if (threads.get(threadId) === state && state.generation === generation) {
          state.receiverDisabled = wasDisabled;
          if (error?.code === 'MANUAL_RESUME_JOIN_REQUIRED' && !healthSignal.signal.aborted && (state.manualJoinRetries || 0) < 300) {
            if (!state.manualJoinRetryTimer) {
              state.manualJoinRetries = (state.manualJoinRetries || 0) + 1;
              state.manualJoinRetryTimer = setTimeout(() => {
                delete state.manualJoinRetryTimer;
                if (!healthSignal.signal.aborted && threads.get(threadId) === state && state.generation === generation) void bind(threadId);
              }, 1000);
              state.manualJoinRetryTimer.unref?.();
            }
            return;
          }
          if (error?.code === 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' && !healthSignal.signal.aborted) {
            const timer = setTimeout(() => {
              if (!healthSignal.signal.aborted && threads.get(threadId) === state && state.generation === generation) void bind(threadId);
            }, 1000);
            timer.unref?.();
          }
        }
        throw error;
      }
      if (threads.get(threadId) !== state || state.generation !== generation || !ownsCodexReceiver(client, threadId)) return;
      if (state.manualJoinRetryTimer) clearTimeout(state.manualJoinRetryTimer);
      delete state.manualJoinRetryTimer;
      delete state.manualJoinRetries;
      state.receiverDisabled = false;
      if (subscription.channel) state.channel = subscription.channel;
      void control.poll(threadId);
      void tasks.watch(threadId);
    } catch (error) { console.error(`Turnlink: receiver connection blocked (${diagnosticCode(error)})`); }
  };
  client.on('message', message => {
    for (const [threadId, state] of threads) {
      if (!ownsCodexReceiver(client, threadId, state) || !message.recipients.includes(identity('codex', threadId))) continue;
      if (state.seen.has(message.id)) {
        void client.request('ack', { agentId: identity('codex', threadId), id: message.id }).catch(() => {});
        continue;
      }
      if (state.queue.some(m => m.id === message.id)) continue;
      state.queue.push(message);
      void flush(threadId);
    }
  });
  client.on('membership_removed', ({ agentId, reason }) => {
    const threadId = agentId.startsWith('codex:') ? agentId.slice(6) : '';
    const state = threads.get(threadId);
    const rejoin = reason === 'channel_changed' && state && !state.receiverDisabled;
    relinquishCodexReceiver({ agentId, threads, fence, health });
    // A channel change cancels old-channel deliveries but does not transfer
    // the native thread. Re-subscribe only after the broker has committed the
    // new membership; other removal reasons must stay detached.
    if (rejoin) void bind(threadId);
  });
  client.on('disconnected', () => {
    // Desired subscriptions survive reconnect, but they are not receiver
    // authority on a closed socket. Invalidate pending asynchronous work.
    for (const [threadId, state] of threads) {
      state.generation++; state.nativeSelection = null;
      health.forget(identity('codex', threadId));
    }
    fence.invalidate('NATIVE_RECEIVER_OWNERSHIP_LOST');
  });
  client.on('presence', ({ agent }) => {
    for (const [threadId, state] of threads) if (ownsCodexReceiver(client, threadId, state) && identity('codex', threadId) === agent.agentId) {
      state.channel = agent.channel; void control.poll(threadId); void tasks.watch(threadId);
    }
  });
  client.on('connected', () => { for (const threadId of threads.keys()) { void tasks.watch(threadId); void flush(threadId); } });
  client.on('task_available', ({ agentId }) => {
    for (const [threadId, state] of threads) if (ownsCodexReceiver(client, threadId, state) && identity('codex', threadId) === agentId) {
      tasks.notify(threadId); void control.poll(threadId); void tasks.poll(threadId);
    }
  });
  createInterface({ input: process.stdin }).on('line', line => {
    try { fence.editor(line); } catch { child.kill(); }
  }).on('close', () => { healthSignal.abort(); fence.close(); control.close(); tasks.close(); client.close(); child.stdin.end(); });
  boundary.startOutput((line, data) => {
    try {
      if (data === undefined) throw new Error('Invalid native frame');
      if (taskRequests.has(data.id) && !data.method) {
        const pending = taskRequests.get(data.id); taskRequests.delete(data.id); clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error('Native task RPC rejected'));
        else pending.resolve(data.result);
        return;
      }
      if (typeof data.id === 'string' && data.id.startsWith('turnlink-task-rpc-')) return;
      if (own.has(data.id)) {
        const pending = own.get(data.id); own.delete(data.id); clearTimeout(pending.timer);
        const { threadId, state, message, generation, role } = pending.context;
        try { if (data.error) {
          // A definitive rejection permits retry. Error bodies are not logged.
          receipt(state, message, 'not_admitted', {}, role);
          pending.reject(new Error('Codex rejected admission'));
          if (pending.expired) void flush(threadId);
        } else if (pending.expired) {
          void accepted(threadId, state, message, generation, data.result, role, pending.context.retry, pending.context.turnRevision).then(() => flush(threadId)).catch(error => console.error(`Turnlink: late receipt blocked (${diagnosticCode(error)})`));
        } else pending.resolve(data.result); }
        catch { pending.reject(new Error('Admission receipt could not be persisted; reconciliation required')); }
        return;
      }
      // Never leak a late/internal response into the editor's RPC namespace.
      if (typeof data.id === 'string' && data.id.startsWith('turnlink-internal-')) return;
      const request = requests.get(data.id);
      if (request && !data.method) {
        requests.delete(data.id);
        // A mutation may complete after a concurrent resume was observed.
        // Invalidate again before allowing a fresh selection to admit work.
        if (request.selectionInvalidation) invalidateSelection(request.selectionInvalidation);
        if (request.method === 'initialize' && !data.error && !nativeInitialized) {
          nativeInitialized = true;
          nativeVersion = codexInitializeVersion(request.params, data.result);
          health.reset();
        }
        if (['thread/start', 'thread/resume'].includes(request.method) && data.result?.thread?.id) bind(data.result.thread.id, data.result.thread,
          request.method === 'thread/start', request.selectionRevision === selectionRevision ? data.result : undefined);
        if (request.method === 'turn/start' && data.result?.turn?.id) {
          const state = threads.get(request.params.threadId);
          if (state && state.turnRevision === request.turnRevision) { state.turnId = data.result.turn.id; state.turnRevision++; state.lifecycleKnown = true; }
        }
      }
      if (data.method === 'turn/started') {
        const state = threads.get(data.params.threadId);
        if (state) { state.turnId = data.params.turn.id; state.turnRevision++; state.lifecycleKnown = true; setImmediate(() => void flush(data.params.threadId)); }
        tasks.notify(data.params.threadId);
      }
      if (data.method === 'turn/completed') {
        const state = threads.get(data.params.threadId);
        if (state) { if (state.turnId === data.params.turn.id) state.turnId = null; state.turnRevision++; state.lifecycleKnown = true; setImmediate(() => void flush(data.params.threadId)); }
        tasks.notify(data.params.threadId);
      }
      if (data.method === 'thread/closed' || data.method === 'thread/archived') {
        health.forget(identity('codex', data.params.threadId));
        threads.delete(data.params.threadId);
        void client.unsubscribe(identity('codex', data.params.threadId)).catch(() => {});
      }
      if (data.method && data.id !== undefined && data.params?.threadId) approvals.set(data.id, data.params.threadId);
    } catch { /* forward diagnostic lines unchanged */ }
    process.stdout.write(`${line}\n`);
  });
  const retry = setInterval(() => { for (const [threadId, state] of threads) { if (state.taskWatchNeeded) void tasks.watch(threadId); void tasks.poll(threadId); void flush(threadId); void pollHealth(threadId, state); } }, 2000);
  retry.unref();
  const controlTimer = process.env.AGENT_CHANNEL_CONTROL === '1' && process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE ?
    setInterval(() => { for (const threadId of threads.keys()) void control.poll(threadId); }, 30000) : undefined;
  controlTimer?.unref();
  child.on('exit', () => { healthSignal.abort(); fence.close(); control.close(); tasks.close(); clearInterval(controlTimer); clearInterval(retry); client.close(); for (const p of own.values()) clearTimeout(p.timer);
    for (const p of taskRequests.values()) { clearTimeout(p.timer); p.reject(new Error('Native task process stopped')); } taskRequests.clear(); });
}
child.on('error', error => {
  console.error(`Turnlink: executable launch failed (${diagnosticCode(error)})`);
  process.exit(1);
});
child.on('exit', code => { process.stdin.destroy(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
