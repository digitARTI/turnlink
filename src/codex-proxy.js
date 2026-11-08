#!/usr/bin/env node
// Transparent stdio proxy: the official extension still owns the same Codex process.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ChannelClient } from './client.js';
import { digest, identity, render, stateDir, validateCredential } from './config.js';
import { AdmissionLedger, fingerprint } from './admissions.js';
import { diagnosticCode } from './diagnostics.js';
import { resolveExecutable } from './executable.js';
import { makeCodexControl, roleFingerprint } from './codex-control.js';
import { createCodexProxyBoundary } from './codex-proxy-boundary.js';
import { isCodexNativeRead } from './codex-admission-fence.js';
import { ownsCodexReceiver, relinquishCodexReceiver, isCodexSourceQuiet, makeCodexSourceDetachMonitor, makeCodexSourceOfferMonitor } from './codex-receiver-ownership.js';
import { CodexResourceJournal } from './codex-resource-journal.js';
import { CodexDestinationReceiver } from './codex-destination-receiver.js';
import { observeCodexPublicationRecovery } from './codex-publication-recovery.js';
import { acquireRestoredCapturedRetiredSource, loadContainedRecoveryOwners } from './codex-contained-mcp-recovery.js';
import { recoverRestoredCodexDestinationCancellation } from './codex-movement-coordinator.js';
import { WorktreeTransition } from './control/contracts.js';
import { AgentID, Channel } from './protocol.js';
import { UUID } from './control/contracts.js';
import { withCodexEstablishedDestination } from './codex-native-preparation.js';
import { abortCodexUnstartedProvider, reconcileCodexUnstartedGrant, reconcileRestoredCodexProviderCleanup } from './codex-resource-dispatch.js';
import { makeCodexTasks } from './codex-tasks.js';
import { makeHealthPublisher } from './adapter-health.js';
import { retryBrokerPreDispatch } from './broker-rate-limit.js';
import { makeDeliveryRecovery } from './delivery-recovery.js';
import { acquireStore, readPrivate } from './storage.js';
import { createCodexCancellationVerifierServer } from './codex-cancellation-verifier-transport.js';
import { inspectNativeWorktreePair } from './worktree-snapshot.js';
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
const nativeControlEnabled = process.env.AGENT_CHANNEL_CODEX_NATIVE_CONTROL === '1';
const stdioAppServer = args.includes('app-server') && !args.some(a => /^(?:--listen=)?(?:ws|unix):\/\//.test(a));
const daemonProxy = process.env.AGENT_CHANNEL_CODEX_DAEMON_PROXY === '1';
if (daemonProxy && (nativeControlEnabled || args.length !== 1 || args[0] !== 'app-server')) {
  console.error('Turnlink: shared daemon proxy requires a standard stdio app-server launch.'); process.exit(1);
}
let destinationSpec, sourceSpec;
if (process.env.AGENT_CHANNEL_CODEX_DESTINATION_FILE) {
  try {
    if (!nativeControlEnabled || !stdioAppServer || process.env.AGENT_CHANNEL_CONTROL !== '1' || !process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE) throw new Error();
    const value = JSON.parse(readPrivate(process.env.AGENT_CHANNEL_CODEX_DESTINATION_FILE, 65536));
    if (!value || Object.keys(value).sort().join(',') !== 'grant,mode,version' || value.version !== 1 || !['offer', 'resume'].includes(value.mode)) throw new Error();
    const grant = WorktreeTransition.parse(value.grant);
    if (!grant.agentId.startsWith('codex:') || grant.purpose || !grant.destinationOwners || grant.sourceMcpShutdown !== true ||
        grant.sourceModelShutdown !== true || !['prepared', 'uncertain'].includes(grant.status) || value.mode === 'offer' && grant.status !== 'prepared') throw new Error();
    destinationSpec = { mode: value.mode, grant };
  } catch { console.error('Turnlink: destination receiver configuration unavailable'); process.exit(1); }
}
if (process.env.AGENT_CHANNEL_CODEX_SOURCE_FILE) {
  try {
    if (destinationSpec || !nativeControlEnabled || !stdioAppServer || process.env.AGENT_CHANNEL_CONTROL !== '1' || !process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE) throw new Error();
    const value = JSON.parse(readPrivate(process.env.AGENT_CHANNEL_CODEX_SOURCE_FILE, 65536));
    if (!value || Object.keys(value).sort().join(',') !== 'agentId,channel,claimGeneration,destination,leaseMs,taskID,version' || value.version !== 1 ||
        !AgentID.safeParse(value.agentId).success || !value.agentId.startsWith('codex:') || !Channel.safeParse(value.channel).success ||
        !UUID.safeParse(value.taskID).success || !Number.isSafeInteger(value.claimGeneration) || value.claimGeneration < 1 ||
        typeof value.destination !== 'string' || !isAbsolute(value.destination) || value.destination.includes('\0') ||
        !Number.isSafeInteger(value.leaseMs) || value.leaseMs < 1000 || value.leaseMs > 600000) throw new Error();
    sourceSpec = value;
  } catch { console.error('Turnlink: source preparation configuration unavailable'); process.exit(1); }
}
let containedRecoveryOwners;
if (process.env.AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE !== undefined) {
  try {
    if (destinationSpec?.mode !== 'resume') throw new Error();
    containedRecoveryOwners = loadContainedRecoveryOwners(process.env.AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE);
  } catch { console.error('Turnlink: contained recovery configuration unavailable'); process.exit(1); }
}
const containedRetirement = process.env.AGENT_CHANNEL_CODEX_CONTAINED_RETIRE;
// The experimental fence and verifier are not wired into this proxy. Native
// liveness loss during an already dispatched external effect remains uncertain.
if (containedRetirement !== undefined && containedRetirement !== '0') {
  console.error('Turnlink: contained retirement configuration unavailable'); process.exit(1);
}
const timeoutMs = Number(process.env.AGENT_CHANNEL_RPC_TIMEOUT_MS || 30000);
if (stdioAppServer && (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000)) throw new Error('Invalid RPC timeout');
if (nativeControlEnabled && (process.platform === 'win32' || !stdioAppServer || process.env.AGENT_CHANNEL_CONTROL !== '1' ||
    !process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE || args.some(arg => arg === '--native-continuity-control-fd' || arg.startsWith('--native-continuity-control-fd=')))) {
  console.error('Turnlink: native control requires a Unix stdio app-server and a separate adapter credential'); process.exit(1);
}
if (nativeControlEnabled) {
  try { validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()); }
  catch { console.error('Turnlink: native control adapter credential unavailable'); process.exit(1); }
}
if (process.env.AGENT_CHANNEL_HEALTH === '1' && (process.env.AGENT_CHANNEL_CONTROL !== '1' || !process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE)) {
  console.error('Turnlink: health reports require control and a separate adapter credential file'); process.exit(1);
}
let verifierService;
const verifierSocket = process.env.AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET;
const verifierTokenFile = process.env.AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE;
if (verifierSocket !== undefined || verifierTokenFile !== undefined) {
  try {
    if (!sourceSpec || !verifierSocket || !verifierTokenFile) throw new Error();
    const secret = validateCredential(readPrivate(verifierTokenFile, 128).trim());
    if (secret === validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim())) throw new Error();
    verifierService = await createCodexCancellationVerifierServer({ path: verifierSocket, secret });
  } catch { console.error('Turnlink: cancellation verifier configuration unavailable'); process.exit(1); }
}
for (const key of ['AGENT_CHANNEL_TOKEN', 'AGENT_CHANNEL_ADMIN_TOKEN', 'AGENT_CHANNEL_ADAPTER_TOKEN_FILE', 'AGENT_CHANNEL_HEALTH', 'AGENT_CHANNEL_CODEX_NATIVE_CONTROL', 'AGENT_CHANNEL_CODEX_DAEMON_PROXY', 'AGENT_CHANNEL_CODEX_DESTINATION_FILE', 'AGENT_CHANNEL_CODEX_SOURCE_FILE', 'AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET', 'AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE', 'AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID', 'AGENT_CHANNEL_CODEX_CONTAINED_RECOVERY_FILE', 'AGENT_CHANNEL_CODEX_CONTAINED_RETIRE']) delete childEnv[key];
const child = spawn(daemonProxy ? process.execPath : executable, daemonProxy ? [fileURLToPath(new URL('./codex-daemon-stdio.js', import.meta.url))] : nativeControlEnabled ? [...args, '--native-continuity-control-fd', '3'] : args,
  { stdio: nativeControlEnabled ? ['pipe', 'pipe', 'inherit', 'pipe'] : ['pipe', 'pipe', 'inherit'], env: childEnv, windowsHide: true });
child.stdin.on('error', () => child.kill());
if (!stdioAppServer) {
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout);
} else {
  const client = new ChannelClient();
  let destinationReceiver, destinationClient, destinationReady;
  if (destinationSpec) {
    const candidate = destinationClient = new ChannelClient();
    try {
      destinationReceiver = new CodexDestinationReceiver({ client: candidate,
        credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()), grant: destinationSpec.grant });
      let started;
      candidate.on('receiver_handoff', event => {
        if (event.role !== 'target' || event.agentId !== destinationSpec.grant.agentId) return;
        void started.then(async offer => {
          if (offer?.offerID !== event.offerID) throw new Error('Destination offer changed');
          await destinationReceiver.observe();
          await candidate.checkSourceReceiverHandoff(event.agentId,
            validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()), event.offerID, destinationSpec.grant.channel);
          console.error('Turnlink: destination receiver held');
        }).catch(error => console.error(`Turnlink: destination receiver blocked (${diagnosticCode(error)})`));
      });
      started = destinationSpec.mode === 'offer' ? destinationReceiver.offer() : destinationReceiver.resume();
      destinationReady = started;
      if (destinationSpec.mode === 'resume') void started.then(() => console.error('Turnlink: destination receiver held')).catch(() => {});
      void started.catch(error => console.error(`Turnlink: destination receiver blocked (${diagnosticCode(error)})`));
    } catch (error) { candidate.close(); throw error; }
  }
  const recovery = makeDeliveryRecovery({ client, enabled: process.env.AGENT_CHANNEL_CONTROL === '1' && !!process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE,
    credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()) });
  const threads = new Map();
  const requests = new Map();
  const own = new Map();
  const approvals = new Map();
  const taskRequests = new Map();
  const healthSignal = new AbortController();
  const recoveryThreads = new Set();
  let sourceStopRequested = false, wakeSourceStop, nativeVersion, nativeInitialized = false, selectionRevision = 0;
  if (sourceSpec) process.on('SIGUSR2', () => {
    if (!wakeSourceStop) { console.error('Turnlink: source stop unavailable until destination owners are retained'); return; }
    sourceStopRequested = true; wakeSourceStop();
  });
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
  const boundary = createCodexProxyBoundary({ child, client: destinationClient ?? client, timeoutMs, nativeControlEnabled,
    experimentalPublicationFixture: !!sourceSpec, fenceTimeoutMs: sourceSpec?.leaseMs ?? 30000,
    credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()),
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
  const { fence, nativeControl } = boundary;
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
  let sourceStarted = false;
  const startSourcePreparation = (threadId, state) => {
    if (!sourceSpec || sourceStarted || sourceSpec.agentId !== identity('codex', threadId)) return;
    sourceStarted = true;
    void (async () => {
      if (threads.get(threadId) !== state || !ownsCodexReceiver(client, threadId, state) || state.channel !== sourceSpec.channel) throw new Error('Source preparation unavailable');
      const journal = new CodexResourceJournal(client.hostId, sourceSpec.agentId);
      let compromised = false;
      const root = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys');
      const sourceHost = client.hostId, deadline = Date.now() + 75000;
      let announced = false;
      const waitForLock = async acquire => {
        for (;;) {
          if (healthSignal.signal.aborted || compromised || threads.get(threadId) !== state || client.hostId !== sourceHost ||
              !ownsCodexReceiver(client, threadId, state) || !nativeControl.usesClient(client)) throw new Error('Source recovery unavailable');
          try { return await acquire(); }
          catch (error) {
            if (error?.code !== 'ELOCKED' || Date.now() >= deadline) throw error;
            if (!announced) { announced = true; console.error('Turnlink: waiting for previous source owner'); }
            await delay(500, undefined, { signal: healthSignal.signal });
          }
        }
      };
      const unlock = await waitForLock(() => acquireStore(join(root, digest(sourceHost), `${digest(sourceSpec.agentId)}.source-driver`), () => {
        compromised = true; fence.invalidate('NATIVE_SOURCE_DRIVER_LOCK_LOST');
      }));
      try {
        const pending = journal.snapshot().filter(record => !['abandoned', 'aborted'].includes(record.phase));
        if (pending.length === 1 && ['previewing', 'previewed', 'prepared', 'aborting'].includes(pending[0].phase)) {
          // A killed predecessor can leave the cooperative journal lock until
          // its stale timeout. Probe before taking the admission fence; a race
          // with a new writer still fails closed inside reconciliation.
          await waitForLock(() => journal.exclusive(async () => {}));
          await fence.exclusive(threadId, async ({ signal, guard, markExternalPending, markExternalReleased }) => {
            const stop = nativeControl.onClose(() => fence.invalidate('NATIVE_OWNER_CLOSED'));
            try {
              markExternalPending();
              const current = () => {
                guard();
                if (compromised || threads.get(threadId) !== state || !ownsCodexReceiver(client, threadId, state) ||
                    state.channel !== sourceSpec.channel || !nativeControl.usesClient(client)) throw new Error('Source recovery unavailable');
              };
              await reconcileCodexUnstartedGrant({ client, native: nativeControl, journal, agentId: sourceSpec.agentId,
                taskID: sourceSpec.taskID, claimGeneration: sourceSpec.claimGeneration, destination: sourceSpec.destination,
                credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()),
                signal, guard: current });
              current(); markExternalReleased();
            } finally { stop(); }
          });
          console.error('Turnlink: unstarted source grant recovered');
        }
        // A previous owner must be reconciled explicitly. Only records whose
        // effect-free abandonment was durably completed permit a fresh attempt.
        if (compromised || journal.snapshot().some(record => !['abandoned', 'aborted'].includes(record.phase))) throw new Error('Source preparation requires recovery');
        const sourceCwd = state.nativeSelection?.cwd;
        const project = inspectNativeWorktreePair(sourceCwd, sourceSpec.destination);
        const validateProject = () => {
          if (state.nativeSelection?.cwd !== sourceCwd || JSON.stringify(inspectNativeWorktreePair(sourceCwd, sourceSpec.destination)) !== JSON.stringify(project))
            throw new Error('Source worktree project changed');
        };
        await withCodexEstablishedDestination({ fence, native: nativeControl, threadId, destination: sourceSpec.destination,
          client, credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()),
          journal, channel: sourceSpec.channel, taskID: sourceSpec.taskID, claimGeneration: sourceSpec.claimGeneration,
          modelContext: true, stepPreparation: true, validateProject, requireDeclaredCredentialPreflight: true,
          ...(verifierService ? { verifierService } : {}) }, async ({ signal, guard, stopPreparedDestination }) => {
          if (compromised) throw new Error('Source preparation unavailable');
          validateProject(); guard();
          console.error('Turnlink: destination resources retained; movement authority pending');
          if (signal.aborted) throw new Error('Source preparation interrupted');
          await new Promise((resolve, reject) => {
            const stopped = () => { wakeSourceStop = undefined; signal.removeEventListener('abort', aborted); resolve(); };
            const aborted = () => { wakeSourceStop = undefined; reject(new Error('Source preparation interrupted')); };
            wakeSourceStop = stopped;
            if (sourceStopRequested) stopped();
            else { signal.addEventListener('abort', aborted, { once: true }); if (signal.aborted) aborted(); }
          });
          guard(); await stopPreparedDestination(); guard();
          console.error('Turnlink: destination owners stopped locally; MCP quarantine retained');
          throw new Error('Source preparation stopped; MCP quarantine retained');
        });
      } finally { unlock(); }
    })().catch(error => console.error(`Turnlink: source preparation blocked (${diagnosticCode(error)})`));
  };
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
      startSourcePreparation(threadId, state);
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
  const sourceQuiet = (_threadId, state) => isCodexSourceQuiet({ state, threads, fence, own, taskRequests, requests, approvals });
  const sourceOffer = makeCodexSourceOfferMonitor({ client, threads, fence, native: nativeControl,
    journalFor: agentId => new CodexResourceJournal(client.hostId, agentId),
    credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()), quiet: sourceQuiet,
    log: error => console.error(`Turnlink: source handoff blocked (${diagnosticCode(error)})`) });
  const sourceDetach = makeCodexSourceDetachMonitor({ client, threads, fence, health, quiet: sourceQuiet,
    log: error => console.error(`Turnlink: source detachment blocked (${diagnosticCode(error)})`) });
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
  client.on('receiver_handoff', ({ agentId, offerID, role }) => {
    if (role === 'source') sourceDetach.source({ agentId, offerID });
  });
  client.on('receiver_handoff_offer', value => sourceOffer.offer(value));
  client.on('receiver_handoff_check_source', value => sourceDetach.check(value));
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
  }).on('close', () => { healthSignal.abort(); destinationReceiver?.close(); sourceOffer.close(); sourceDetach.close(); nativeControl?.close(); fence.close(); control.close(); tasks.close(); client.close(); child.stdin.end(); });
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
        if (request.method === 'thread/resume' && data.error && sourceSpec &&
            `codex:${request.params?.threadId}` === sourceSpec.agentId && !recoveryThreads.has(request.params.threadId)) {
          const threadId = request.params.threadId; recoveryThreads.add(threadId);
          void (async () => {
            await client.connect();
            const sourceHost = client.hostId, root = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys');
            const deadline = Date.now() + 75000;
            let compromised = false, unlock, subscribed = false;
            const check = () => {
              if (healthSignal.signal.aborted || compromised || client.hostId !== sourceHost || !nativeControl?.usesClient(client))
                throw new Error('Source cleanup recovery unavailable');
            };
            try {
              for (;;) {
                check();
                try { unlock = await acquireStore(join(root, digest(sourceHost), `${digest(sourceSpec.agentId)}.source-driver`), () => {
                  compromised = true; fence.invalidate('NATIVE_SOURCE_DRIVER_LOCK_LOST');
                }); break; }
                catch (error) { if (error?.code !== 'ELOCKED' || Date.now() >= deadline) throw error; await delay(500, undefined, { signal: healthSignal.signal }); }
              }
              check(); if (client.subscriptions.has(sourceSpec.agentId)) throw new Error('Source cleanup recovery unavailable');
              const subscription = await client.subscribe(sourceSpec.agentId); subscribed = true; check();
              if (subscription.channel !== sourceSpec.channel || !ownsCodexReceiver(client, threadId)) throw new Error('Source cleanup recovery unavailable');
              const journal = new CodexResourceJournal(sourceHost, sourceSpec.agentId);
              const all = journal.snapshot();
              const cancellations = all.filter(record => record.plan.kind === 'mcp_runtime' && record.phase === 'settled' &&
                record.channel === sourceSpec.channel && record.taskID === sourceSpec.taskID && record.claimGeneration === sourceSpec.claimGeneration &&
                record.plan.to === sourceSpec.destination && ['cancelling', 'cancel_uncertain', 'cancelled', 'settling', 'settlement_uncertain'].includes(record.step?.movement?.phase));
              if (cancellations.length) {
                if (cancellations.length !== 1 || !verifierService) throw new Error('Source cancellation recovery unavailable');
                const guard = () => { check(); if (!ownsCodexReceiver(client, threadId)) throw new Error('Source cancellation recovery unavailable'); };
                for (;;) {
                  try {
                    await recoverRestoredCodexDestinationCancellation({ client, native: nativeControl, journal, agentId: sourceSpec.agentId,
                      mcpTransitionID: cancellations[0].transitionID, credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()),
                      signal: healthSignal.signal, guard, verifierService });
                    break;
                  } catch (error) {
                    guard(); if (error?.code !== 'ELOCKED' || Date.now() >= deadline) throw error;
                    await delay(500, undefined, { signal: healthSignal.signal });
                  }
                }
                guard(); console.error('Turnlink: destination cancellation reconciled; resource quarantine retained');
                return;
              }
              const records = all.filter(record => record.plan.kind !== 'mcp_runtime' &&
                (record.cleanup || ['previewing', 'previewed', 'authorizing', 'prepared', 'aborting'].includes(record.phase)) &&
                record.channel === sourceSpec.channel && record.taskID === sourceSpec.taskID && record.claimGeneration === sourceSpec.claimGeneration && record.plan.to === sourceSpec.destination);
              if (records.length !== 1) throw new Error('Source cleanup recovery unavailable');
              const provider = records[0], mcp = all.filter(record => record.plan.kind === 'mcp_runtime' && record.phase === 'settled' &&
                record.channel === provider.channel && record.taskID === provider.taskID && record.claimGeneration === provider.claimGeneration &&
                JSON.stringify(record.plan.reservation) === JSON.stringify(provider.plan.reservation));
              if (!provider.cleanup && mcp.length !== 1) throw new Error('Source cleanup recovery unavailable');
              const guard = () => { check(); if (!ownsCodexReceiver(client, threadId)) throw new Error('Source cleanup recovery unavailable'); };
              for (;;) {
                try {
                  const credential = () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim());
                  if (provider.cleanup) await reconcileRestoredCodexProviderCleanup({ client, native: nativeControl, journal, agentId: sourceSpec.agentId,
                    transitionID: provider.transitionID, credential, signal: healthSignal.signal, guard });
                  else await abortCodexUnstartedProvider({ client, native: nativeControl, journal, agentId: sourceSpec.agentId,
                    mcpTransitionID: mcp[0].transitionID, plan: provider.plan, reservation: provider.plan.reservation,
                    credential, signal: healthSignal.signal, guard, restored: true });
                  break;
                } catch (error) {
                  guard(); if (error?.code !== 'ELOCKED' || Date.now() >= deadline) throw error;
                  await delay(500, undefined, { signal: healthSignal.signal });
                }
              }
              guard(); console.error(provider.cleanup ? 'Turnlink: provider cleanup reconciled; MCP quarantine retained' :
                'Turnlink: unstarted provider grant reconciled; MCP quarantine retained');
            } finally { if (subscribed) await client.unsubscribe(sourceSpec.agentId).catch(() => {}); unlock?.(); }
          })().catch(error => console.error(`Turnlink: source cleanup recovery blocked (${diagnosticCode(error)})`)).finally(() => recoveryThreads.delete(threadId));
        }
        if (request.method === 'thread/resume' && data.error && destinationSpec?.mode === 'resume' &&
            `codex:${request.params?.threadId}` === destinationSpec.grant.agentId && !recoveryThreads.has(request.params.threadId)) {
          const threadId = request.params.threadId; recoveryThreads.add(threadId);
          void (async () => {
            await destinationReady;
            if (healthSignal.signal.aborted || !nativeControl?.usesClient(destinationClient)) throw new Error('Destination recovery unavailable');
            const journal = new CodexResourceJournal(destinationClient.hostId, destinationSpec.grant.agentId);
            const records = journal.snapshot().filter(record => record.step?.movement?.grant?.id === destinationSpec.grant.id);
            if (records.length !== 1) throw new Error('Destination recovery unavailable');
            const recoveryArgs = { client: destinationClient, native: nativeControl, journal,
              agentId: destinationSpec.grant.agentId, mcpTransitionID: records[0].transitionID,
              credential: () => validateCredential(readPrivate(process.env.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, 128).trim()),
              signal: healthSignal.signal, guard() { if (healthSignal.signal.aborted) throw new Error('Destination recovery unavailable'); } };
            await observeCodexPublicationRecovery(recoveryArgs);
            console.error('Turnlink: destination recovery observed; receiver held');
            if (containedRecoveryOwners && records[0].step?.movement?.publication?.contained?.length) {
              try {
                const observation = await acquireRestoredCapturedRetiredSource({ ...recoveryArgs, owners: containedRecoveryOwners });
                observation.release();
                console.error('Turnlink: contained source retirement observed; receiver held');
              } catch (error) { console.error(`Turnlink: contained source retirement unverified (${diagnosticCode(error)})`); }
            }
          })().catch(error => console.error(`Turnlink: destination recovery blocked (${diagnosticCode(error)})`)).finally(() => recoveryThreads.delete(threadId));
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
  child.on('exit', () => { healthSignal.abort(); void verifierService?.close(); destinationReceiver?.close(); nativeControl?.close(); fence.close(); control.close(); tasks.close(); clearInterval(controlTimer); clearInterval(retry); client.close(); for (const p of own.values()) clearTimeout(p.timer);
    for (const p of taskRequests.values()) { clearTimeout(p.timer); p.reject(new Error('Native task process stopped')); } taskRequests.clear(); });
}
child.on('error', error => {
  console.error(`Turnlink: executable launch failed (${diagnosticCode(error)})`);
  void Promise.resolve(verifierService?.close()).finally(() => process.exit(1));
});
child.on('exit', code => { process.stdin.destroy(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
