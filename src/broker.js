import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stateDir, token, adminToken, identity, url, digest, matches, validateCredential } from './config.js';
import { acquireStore, readPrivate, atomicWrite, assertPrivateFile, privateDirectory } from './storage.js';
import { parseRequest, validateState, Security, OpenCodeContainment, MAX_FRAME_BYTES, MAX_RESPONSE_BYTES, MAX_MANUAL_HOST_CANCELLATIONS } from './protocol.js';
import { ControlGateway } from './control/gateway.js';
import { WorktreeTransition } from './control/contracts.js';
import { BrokerEffectExecutor, stableID } from './control/effects.js';
import { requireControl as check, ControlError } from './control/policy.js';
import { applyBrokerEffect } from './broker-effects.js';
import { codexVerifierLease, releaseCodexVerifierLease } from './codex-verifier-lease.js';

export const NAME_RESERVATION_MS = 300000;
const nameKey = value => value.normalize('NFKC').toLowerCase();
const fresh = () => ({ version: 3, agents: {}, bindings: {}, messages: [] });
const OwnerTakeoverEvidence = z.strictObject({ version: z.literal(1), hostId: z.string(), agentId: z.string(), channel: z.string(),
  transitionID: z.string().uuid(), oldReceiverHash: z.string().regex(/^[a-f0-9]{64}$/), targetReceiverHash: z.string().regex(/^[a-f0-9]{64}$/),
  previous: OpenCodeContainment, successor: OpenCodeContainment, previousLease: z.string().uuid(), currentLease: z.string().uuid() });

// The command-line broker can explicitly enable movement and resource grants.
// This does not enable execution or verified receiver-release authority.
export function brokerEnvironmentOptions(env = process.env) {
  const flags = { controlPlane: 'AGENT_CHANNEL_CONTROL', controlEffects: 'AGENT_CHANNEL_CONTROL_EFFECTS',
    taskDispatch: 'AGENT_CHANNEL_TASKS', codexTasks: 'AGENT_CHANNEL_CODEX_TASKS', worktreeGrants: 'AGENT_CHANNEL_WORKTREE_GRANTS', managedRecords: 'AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS',
    receiverHandoff: 'AGENT_CHANNEL_RECEIVER_HANDOFF', codexHandoffOnly: 'AGENT_CHANNEL_CODEX_HANDOFF_ONLY', worktreeTaskDispatch: 'AGENT_CHANNEL_WORKTREE_TASKS', manualWorktreeOnly: 'AGENT_CHANNEL_MANUAL_WORKTREE_ONLY', ownerLeaseRequired: 'AGENT_CHANNEL_OPENCODE_OWNER_LEASE' };
  return Object.fromEntries(Object.entries(flags).map(([option, name]) => {
    const value = env[name];
    if (['AGENT_CHANNEL_WORKTREE_GRANTS', 'AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS', 'AGENT_CHANNEL_RECEIVER_HANDOFF', 'AGENT_CHANNEL_CODEX_HANDOFF_ONLY', 'AGENT_CHANNEL_WORKTREE_TASKS', 'AGENT_CHANNEL_MANUAL_WORKTREE_ONLY', 'AGENT_CHANNEL_OPENCODE_OWNER_LEASE'].includes(name) && value !== undefined && value !== '0' && value !== '1') throw new Error(`${name} must be 0 or 1`);
    return [option, value === '1'];
  }));
}

function rejectExperimentalEnvironment(env, names) {
  if (names.some(name => env[name] !== undefined)) throw new Error('Automatic native transfer is not supported');
  return undefined;
}
export function brokerEnvironmentOpenCodeCompletionVerifier(env) {
  return rejectExperimentalEnvironment(env, ['AGENT_CHANNEL_OPENCODE_COMPLETION_SOCKET', 'AGENT_CHANNEL_OPENCODE_VERIFIER_DIRECTORY', 'AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE']);
}
export function brokerEnvironmentOwnerEndpointDirectory(env) {
  return rejectExperimentalEnvironment(env, ['AGENT_CHANNEL_OPENCODE_ENDPOINT_DIRECTORY']);
}
export function brokerEnvironmentCancellationVerifier(env) {
  return rejectExperimentalEnvironment(env, ['AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET', 'AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE']);
}
export function brokerEnvironmentOpenCodeSourceRecoveryVerifier(env) {
  return rejectExperimentalEnvironment(env, ['AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_SOCKET', 'AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_TOKEN_FILE']);
}
export function createBroker({ port = 47321, secret = token(true), adminSecret = adminToken(true), hosts,
  directory = stateDir, now = Date.now, sweepIntervalMs = 1000, write = atomicWrite,
  limits = {}, controlPlane = false, controlOptions = {}, controlEffects = false, effectHooks = {}, worktreeGrants = false, managedRecords = false, taskDispatch = false, codexTasks = false, receiverHandoff = false, codexHandoffOnly = false, worktreeTaskDispatch = false, manualWorktreeOnly = false, sourceRecoveryVerifier, completionVerifier, mcpCleanupVerifier, destinationCancellationVerifier, checkpointVerifier, ownerLeaseRequired = false, ownerEndpointDirectory, ownerContainmentVerifier, ownerEndpointResolver, ownerTakeoverVerifier, ownerTakeoverDiagnostic, codexEffectVerifier, codexEffectArbiter } = {}) {
  if (receiverHandoff || codexHandoffOnly || sourceRecoveryVerifier || completionVerifier || destinationCancellationVerifier || checkpointVerifier || ownerLeaseRequired || ownerContainmentVerifier || ownerEndpointResolver || ownerTakeoverVerifier || codexEffectVerifier || codexEffectArbiter) throw new Error('Automatic native transfer is not supported');
  if (controlEffects && !controlPlane) throw new Error('Control effects require the control plane');
  if (worktreeGrants && !controlPlane) throw new Error('Worktree grants require the control plane');
  if (managedRecords && !controlPlane) throw new Error('Managed worktree records require the control plane');
  if (taskDispatch && !controlPlane) throw new Error('Task dispatch requires the control plane');
  if (codexTasks && (!controlPlane || !taskDispatch)) throw new Error('Codex task dispatch requires the control plane and task dispatch');
  if (receiverHandoff && (!controlPlane || !worktreeGrants)) throw new Error('Receiver handoff requires the control plane and worktree grants');
  if (typeof codexHandoffOnly !== 'boolean' || codexHandoffOnly && (!receiverHandoff || worktreeTaskDispatch || controlEffects || ownerLeaseRequired || completionVerifier || sourceRecoveryVerifier || mcpCleanupVerifier || destinationCancellationVerifier || codexEffectVerifier || codexEffectArbiter))
    throw new Error('Codex-only handoff requires receiver handoff without execution or OpenCode verifier modes');
  if (typeof manualWorktreeOnly !== 'boolean' || manualWorktreeOnly && (!worktreeTaskDispatch || !worktreeGrants || receiverHandoff || ownerLeaseRequired || codexHandoffOnly || completionVerifier))
    throw new Error('Manual worktree mode requires task dispatch and grants without native receiver handoff');
  if (worktreeTaskDispatch && (!(receiverHandoff || manualWorktreeOnly) || !taskDispatch)) throw new Error('Worktree task dispatch requires task dispatch and a receiver handoff or manual-only mode');
  if (sourceRecoveryVerifier !== undefined && (!receiverHandoff || typeof sourceRecoveryVerifier !== 'function')) throw new Error('Source recovery requires a trusted verifier and receiver handoff');
  if (completionVerifier !== undefined && (!receiverHandoff || typeof completionVerifier !== 'function')) throw new Error('Native completion requires a trusted verifier and receiver handoff');
  if (ownerLeaseRequired && (!completionVerifier || !receiverHandoff)) throw new Error('Owner preparation requires a completion verifier and receiver handoff');
  if (ownerContainmentVerifier !== undefined && (!ownerLeaseRequired || typeof ownerContainmentVerifier !== 'function')) throw new Error('Owner containment requires a trusted verifier and owner lease');
  if (ownerEndpointResolver !== undefined && (!ownerContainmentVerifier || typeof ownerEndpointResolver !== 'function')) throw new Error('Host endpoint resolution requires trusted containment');
  if (ownerTakeoverVerifier !== undefined && (!ownerContainmentVerifier || typeof ownerTakeoverVerifier !== 'function' || ownerTakeoverVerifier.requiresLease !== true)) throw new Error('Owner takeover requires a trusted retained containment verifier');
  if (ownerTakeoverDiagnostic !== undefined && (!ownerTakeoverVerifier || typeof ownerTakeoverDiagnostic !== 'function')) throw new Error('Owner takeover diagnostics require a verifier');
  if (ownerLeaseRequired && (!ownerEndpointDirectory || !isAbsolute(ownerEndpointDirectory))) throw new Error('Owner preparation requires a private endpoint directory');
  if (ownerEndpointDirectory !== undefined) { if (!ownerLeaseRequired || !isAbsolute(ownerEndpointDirectory)) throw new Error('Owner endpoint directory requires owner preparation'); privateDirectory(ownerEndpointDirectory); }
  if (mcpCleanupVerifier !== undefined && (!worktreeGrants || typeof mcpCleanupVerifier !== 'function')) throw new Error('MCP cleanup requires a trusted verifier and worktree grants');
  if (destinationCancellationVerifier !== undefined && (!worktreeGrants || typeof destinationCancellationVerifier !== 'function')) throw new Error('Destination cancellation requires a trusted verifier and worktree grants');
  if (checkpointVerifier !== undefined && (!worktreeGrants || typeof checkpointVerifier !== 'function')) throw new Error('Checkpoint observation requires a verifier and worktree grants');
  // Experimental only: no asynchronous broker effects may already be in
  // flight when a durable Codex effect fence is created.
  if (codexEffectVerifier !== undefined && (typeof codexEffectVerifier !== 'function' || !receiverHandoff || !worktreeGrants ||
      controlEffects || completionVerifier || sourceRecoveryVerifier || mcpCleanupVerifier || destinationCancellationVerifier || ownerLeaseRequired))
    throw new Error('Codex effect fence requires an exclusive verifier configuration');
  validateCredential(secret); validateCredential(adminSecret);
  if (secret === adminSecret) throw new Error('Host and administrator credentials must differ');
  const budget = { connections: 64, hostConnections: 16, sessionsPerHost: 64, channelMembers: 32,
    pendingPerSession: 128, deliveryWindow: 4, history: 10000, storeBytes: 64 * 1024 * 1024, ...limits };
  let fault = null, closing = false, server, heartbeat, expiryTimer, closePromise;
  const subscriptions = new Map();
  // Socket identity is intentionally process-local. After a broker restart an
  // armed observation is uncertain rather than treated as a stopped process.
  const manualResumeSources = new Map();
  // Opt-in observers are closed on authority changes; older clients never
  // receive an unfamiliar protocol event.
  const authorityWatches = new Map();
  const invalidateAuthorityWatches = (method, params) => {
    for (const [watched, watch] of authorityWatches) {
      const credentialChanged = ['control_revoke_adapter', 'control_enroll_adapter'].includes(method) && params.hostId === watch.hostId;
      const sessionChanged = ['revoke_session', 'leave', 'unsubscribe', 'control_receiver_commit'].includes(method) && params.agentId === watch.agentId;
      const grantMayHaveChanged = !!watch.grantID && (['control_command', 'control_adapter'].includes(method) && params.command?.channel === watch.channel ||
        method === 'control_task_pull' && params.agentId === watch.agentId);
      if (credentialChanged || sessionChanged || grantMayHaveChanged) { authorityWatches.delete(watched); watched.terminate(); }
    }
  };
  // Offers are connection-bound and deliberately do not survive restart.
  const receiverOffers = new Map();
  const receiverDetachAcks = new Map();
  const sourceRecoveryInFlight = new Set();
  const completionReleaseInFlight = new Set();
  // In-memory leases never survive a restart, even if activation was persisted.
  const ownerPreparations = new Map();
  const ownerEndpoint = lease => ownerEndpointResolver ? ownerEndpointResolver({ generation: lease.ownerGeneration, lease }) : lease.endpoint();
  const ownerEndpointMatches = (lease, saved) => {
    if (!ownerEndpointDirectory) return false;
    try {
      const endpoint = ownerEndpoint(lease);
      if (!endpoint || !/^turnlink-[0-9a-f-]{36}\.json$/.test(endpoint.name || '') || !/^\d+$/.test(endpoint.device || '') ||
          !/^\d+$/.test(endpoint.inode || '') || !/^[a-f0-9]{64}$/.test(endpoint.digest || '') ||
          (saved && JSON.stringify(saved) !== JSON.stringify(endpoint))) return false;
      privateDirectory(ownerEndpointDirectory);
      const stat = assertPrivateFile(join(ownerEndpointDirectory, endpoint.name));
      return String(stat.dev) === endpoint.device && String(stat.ino) === endpoint.inode && stat.nlink === 1;
    } catch { return false; }
  };
  const mcpCleanupInFlight = new Set();
  const checkpointInFlight = new Set();
  const destinationCancellationInFlight = new Set();
  let codexEffectBeginInFlight = false, codexEffectFinishInFlight = false, codexArbiterBinding;
  const invalidateCodexArbiter = () => {
    if (!codexArbiterBinding) return;
    codexArbiterBinding = undefined;
    try { const result = codexEffectArbiter.revoke(); if (result && typeof result.then === 'function') void result.catch(() => {}); }
    catch { /* a binding has no dispatch capability */ }
  };
  const deliveries = new Map();
  const controls = new Map();
  const buckets = new Map();
  let control, executor, controlFault = false;
  const fail = error => {
    fault = error;
    invalidateCodexArbiter();
    for (const socket of server?.clients || []) socket.terminate();
  };
  const unlock = acquireStore(directory, fail);
  const file = join(directory, 'store.json'), securityFile = join(directory, 'security.json');
  let store, security;
  try {
    try { store = validateState(JSON.parse(readPrivate(file))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('State is invalid or legacy; use explicit v2 migration before starting'); store = fresh(); }
    if (codexHandoffOnly && Object.entries(store.bindings).some(([id, binding]) => id.startsWith('opencode:') && (binding.receiverHandoff || binding.ownerDrain)))
      throw new Error('Codex-only handoff cannot start with existing OpenCode handoff state');
    try { security = Security.parse(JSON.parse(readPrivate(securityFile))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Invalid security registry');
      const initial = hosts || [{ hostId: 'local', credential: secret, channels: ['*'], broadcast: true }];
      security = { version: 1, hosts: {} };
      for (const h of initial) security.hosts[h.hostId] = { hostId: h.hostId, tokenHash: digest(validateCredential(h.credential)),
        channels: h.channels, broadcast: h.broadcast, revoked: false };
      security = Security.parse(security);
    }
    const hashes = new Set();
    for (const [key, host] of Object.entries(security.hosts)) {
    if (key !== host.hostId || ['unassigned', 'historical', 'operator'].includes(host.hostId) || matches(adminSecret, host.tokenHash)) throw new Error('Invalid host registry binding');
      if (hashes.has(host.tokenHash)) throw new Error('Host credentials must be unique'); hashes.add(host.tokenHash);
    }
  } catch (error) { unlock(); throw error; }
  const persist = () => {
    if (fault || closing) throw new Error('Broker persistence unavailable');
    try {
      const encoded = JSON.stringify(store);
      if (Buffer.byteLength(encoded) > budget.storeBytes) throw new Error('Store byte limit reached');
      write(file, encoded);
    } catch (error) { fail(error); throw new Error('Broker persistence unavailable'); }
  };
  let manualResumeInterrupted = false;
  for (const binding of Object.values(store.bindings)) if (binding.manualResume?.status === 'armed') {
    binding.manualResume.status = 'uncertain'; manualResumeInterrupted = true;
  }
  if (manualResumeInterrupted) persist();
  const observeManualReceiverDisconnect = (id, socket) => {
    const entry = store.bindings[id]?.manualResume;
    if (entry?.status === 'armed' && manualResumeSources.get(id) === socket) {
      entry.status = 'detached'; manualResumeSources.delete(id);
    }
  };
  const saveSecurity = () => {
    try { write(securityFile, JSON.stringify(security)); }
    catch (error) { fail(error); throw new Error('Broker persistence unavailable'); }
  };
  const consume = (key, rate, burst, amount = 1) => {
    const time = now(), old = buckets.get(key) || { time, tokens: burst };
    const available = Math.min(burst, old.tokens + Math.max(0, time - old.time) * rate / 1000);
    if (available < amount) throw new Error('Rate limit exceeded');
    buckets.set(key, { time, tokens: available - amount });
  };
  const scope = (principal, channel) => principal.admin || (!security.hosts[principal.hostId]?.revoked &&
    (security.hosts[principal.hostId]?.channels.includes('*') || security.hosts[principal.hostId]?.channels.includes(channel)));
  const validPrincipal = principal => principal.admin || (security.hosts[principal.hostId] &&
    !security.hosts[principal.hostId].revoked && security.hosts[principal.hostId].tokenHash === principal.tokenHash);
  const send = (socket, body) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const encoded = JSON.stringify({ v: 2, ...body });
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES || socket.bufferedAmount > MAX_FRAME_BYTES * 4) {
      socket.close(1008, 'Response/backpressure limit'); return;
    }
    socket.send(encoded, error => { if (error) socket.terminate(); });
  };
  const connected = id => subscriptions.get(id)?.readyState === WebSocket.OPEN;
  const reserve = a => {
    if (a.reservationExpiresAt == null) { a.disconnectedAt = now(); a.reservationExpiresAt = now() + NAME_RESERVATION_MS; }
  };
  const remove = (id, reason) => {
    const removed = store.agents[id], cancelled = store.messages.filter(m => m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id]);
    // Revoke role authority durably BEFORE changing the legacy JSON membership. Failure leaves the old membership intact.
    if (control && store.agents[id]) {
      if (controlFault) throw new Error('CONTROL_UNAVAILABLE');
      control.departed(id, store.agents[id].channel);
      control.forgetReceiverHealth(id);
    }
    for (const m of store.messages) if (m.recipients.includes(id) && !m.delivered.includes(id)) m.cancelled[id] = reason;
    if (store.bindings[id]?.manualResume?.status === 'armed') store.bindings[id].manualResume.status = 'uncertain';
    manualResumeSources.delete(id);
    delete store.agents[id];
    if (store.deliveryPauses) delete store.deliveryPauses[id];
    if (store.wakePolicies) delete store.wakePolicies[id];
    return () => {
      if (removed) control?.observeActivity({ type: 'member.removed', channel: removed.channel, agentId: id, reason });
      for (const m of cancelled) control?.observeActivity({ type: 'message.cancelled', channel: m.channel, agentId: id, messageID: m.id, reason });
      const receivers = new Set([subscriptions.get(id), ...(controls.get(id) || [])]);
      for (const socket of receivers) if (socket) send(socket, { event: 'membership_removed', agentId: id, reason });
      controls.delete(id);
      deliveries.delete(id);
    };
  };
  const manualReservationProtected = id => {
    const observation = store.bindings[id]?.manualResume;
    if (!observation) return false;
    if (observation.pendingTakeover) return true;
    if (observation.hostTransfer?.status === 'pending') return true;
    // A missing or unavailable control store cannot prove that the task is
    // settled. Preserve the member until the authoritative state is readable.
    if (!control || controlFault) return true;
    try {
      const task = control.store.snapshot().tasks.find(value => value.id === observation.taskID && value.channel === observation.channel);
      return !!task && task.claimant === id && task.claimGeneration === observation.claimGeneration &&
        ['claimed', 'dispatching', 'running', 'uncertain', 'review'].includes(task.status);
    } catch { return true; }
  };
  const sweep = () => {
    if (closing || fault) return;
    const effects = []; let extended = false;
    for (const a of Object.values(store.agents)) if (!connected(a.agentId) && a.reservationExpiresAt != null && a.reservationExpiresAt <= now()) {
      if (manualReservationProtected(a.agentId)) { a.reservationExpiresAt = now() + NAME_RESERVATION_MS; extended = true; }
      else effects.push(remove(a.agentId, 'reservation_expired'));
    }
    if (effects.length || extended) { persist(); effects.forEach(fn => fn()); }
  };
  for (const a of Object.values(store.agents)) if (!store.codexEffectFence && a.reservationExpiresAt == null) {
    a.disconnectedAt = Math.min(now(), a.lastSeenAt ?? now()); a.reservationExpiresAt = a.disconnectedAt + NAME_RESERVATION_MS;
  }
  const claims = new Set();
  for (const a of Object.values(store.agents)) {
    if (!store.codexEffectFence && a.reservationExpiresAt <= now() && !manualReservationProtected(a.agentId)) { remove(a.agentId, 'reservation_expired'); continue; }
    const key = JSON.stringify([a.channel, nameKey(a.name)]);
    if (claims.has(key)) { unlock(); throw new Error('Duplicate stored channel names require explicit recovery'); }
    claims.add(key);
  }
  const binding = (principal, id, proof, create = false) => {
    if (principal.admin) throw new Error('Host credential required for agent operations');
    let b = store.bindings[id];
    if (!b && create) {
      if (Object.keys(store.bindings).length >= 8192) throw new Error('Session binding archive full');
      b = store.bindings[id] = { hostId: principal.hostId, proofHash: digest(proof), revoked: false };
    }
    if (!b || b.hostId !== principal.hostId) throw new Error('Session ownership denied');
    if (b.revoked) throw new Error('Session capability revoked');
    if (b.manualResume?.hostTransfer?.status === 'pending') throw new Error('Session ownership transfer pending');
    if (b.proofHash === null && create) b.proofHash = digest(proof); // Explicitly adopted legacy session.
    if (!matches(proof, b.proofHash)) throw new Error('Session ownership denied');
    return b;
  };
  const sessionBudget = (principal, id) => {
    const active = new Set(Object.values(store.agents).filter(a => a.hostId === principal.hostId).map(a => a.agentId));
    for (const subscribed of subscriptions.keys()) if (store.bindings[subscribed]?.hostId === principal.hostId) active.add(subscribed);
    if (!active.has(id) && active.size >= budget.sessionsPerHost) throw new Error('Host session limit reached');
  };
  const member = (principal, id, proof, channel) => {
    binding(principal, id, proof);
    const a = store.agents[id];
    if (!a) throw new Error('Join before communicating');
    if (!scope(principal, a.channel) || (channel && a.channel !== channel)) throw new Error('Channel access denied');
    return a;
  };
  const page = (array, limit = 30, offset = 0) => {
    const out = []; let bytes = 0;
    for (const value of array.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(value));
      if (bytes + size > MAX_RESPONSE_BYTES - 4096) break;
      out.push(value); bytes += size;
    }
    return out;
  };
  const list = channel => Object.values(store.agents).filter(a => a.channel === channel).map(a => ({ ...a,
    connected: connected(a.agentId), nameState: connected(a.agentId) ? 'claimed' : 'reserved' }));
  const ownerTaskCurrent = (state, hold, id) => {
    const task = state.tasks.find(value => value.id === hold.taskID && value.channel === hold.channel);
    const preview = state.previews.find(value => value.id === hold.previewID && value.taskID === hold.taskID && value.agentId === id);
    return !!task && ['claimed', 'dispatching', 'running', 'uncertain', 'review', 'completed'].includes(task.status) && task.claimant === id &&
      task.claimGeneration === hold.claimGeneration && preview?.approved === true;
  };
  // Never release a legacy held receiver without an explicit recovery procedure.
  const receiverBlocked = id => !!store.bindings[id]?.receiverHandoff;
  const deliver = id => {
    if (fault || closing || store.codexEffectFence || receiverBlocked(id) || store.deliveryPauses?.[id] || store.wakePolicies?.[id]?.policy === 'paused') return;
    const socket = subscriptions.get(id), a = store.agents[id];
    if (!socket || !a || !validPrincipal(socket.principal) || socket.principal.hostId !== a.hostId || !scope(socket.principal, a.channel)) return;
    if (!deliveries.has(id)) deliveries.set(id, new Set());
    const outstanding = deliveries.get(id);
    for (const m of store.messages) {
      if (outstanding.size >= budget.deliveryWindow) break;
      if (m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id] && !outstanding.has(m.id)) {
        // Persist exposure before sending. A crash here is conservative uncertainty, never proof of non-admission.
        if (Array.isArray(m.offered) && !m.offered.includes(id)) { m.offered.push(id); persist(); }
        control?.observeActivity({ type: 'message.offered', channel: m.channel, agentId: id, messageID: m.id });
        const { offered, ...message } = m; // Exposure is broker-private metadata, not a new peer-frame requirement.
        outstanding.add(m.id); send(socket, { event: 'message', message });
      }
    }
  };
  if (controlPlane) {
    try {
      control = new ControlGateway({ directory: join(directory, 'control'), now, options: controlOptions, effectsEnabled: controlEffects, worktreeGrants, managedRecords, taskDispatch, codexTasks, worktreeTaskDispatch,
        runtimeAvailable: () => !controlFault, manualWorktreeOnly,
        members: () => Object.values(store.agents).filter(a => !security.hosts[a.hostId]?.revoked && !store.bindings[a.agentId]?.revoked)
          .map(a => ({ agentId: a.agentId, channel: a.channel, harness: a.harness, connected: connected(a.agentId) })),
        member, receiver: id => subscriptions.get(id), receiverHeld: receiverBlocked,
        receiverPlacement: id => store.bindings[id]?.receiverHandoff, manualPlacement: id => store.bindings[id]?.manualResume,
        manualLocation: id => store.agents[id]?.project.root,
        receiverHandoffEnabled: receiverHandoff, codexHandoffOnly,
        messages: () => store.messages, hosts: () => security.hosts, adminDigest: digest(adminSecret) });
      if (!store.codexEffectFence) { control.tick(); control.maintainActivity(); }
      control.onTaskChanged = task => {
        if (store.codexEffectFence || !task?.claimant || receiverBlocked(task.claimant)) return false;
        const receiver = subscriptions.get(task.claimant);
        if (!receiver?.taskWatches?.has(task.claimant)) return false;
        send(receiver, { event: 'task_available', agentId: task.claimant }); return true;
      };
      if (controlEffects) {
        executor = new BrokerEffectExecutor({ gateway: control, ...effectHooks, lookup: id => store.effectReceipts?.[id],
          apply: action => {
            const prior = store.effectReceipts?.[action.id];
            if (!prior && action.operation === 'remove_member') control.departed(action.target, action.channel);
            const result = applyBrokerEffect(store, action, now());
            store = result.state; persist();
            if (!prior && result.receipt.outcome === 'succeeded') {
              if (action.operation === 'cancel_queued') control.observeActivity({ type: 'message.cancelled', channel: action.channel,
                agentId: action.target, messageID: action.messageID, reason: 'control_cancelled_unoffered' });
              else if (action.operation === 'remove_member') {
                for (const socket of new Set([subscriptions.get(action.target), ...(controls.get(action.target) || [])])) if (socket) send(socket, { event: 'membership_removed', agentId: action.target, reason: 'control_removed_member' });
                controls.delete(action.target); deliveries.delete(action.target);
                control.observeActivity({ type: 'member.removed', channel: action.channel, agentId: action.target, reason: 'control_removed_member' });
              }
              else if (['pause_delivery', 'resume_delivery'].includes(action.operation)) control.observeActivity({ type: action.operation === 'pause_delivery' ? 'delivery.paused' : 'delivery.resumed',
                channel: action.channel, agentId: action.target });
            }
            return result.receipt;
          } });
        executor.run();
      }
    } catch (error) { try { control?.close(); } finally { unlock(); } throw error; }
  }
  const refreshCodexArbiterBinding = () => {
    const held = codexArbiterBinding;
    if (!held) return false;
    try {
      const arbiterState = codexEffectArbiter.snapshot();
      if (closing || fault || controlFault || !control || held.socket.readyState !== WebSocket.OPEN || !validPrincipal(held.socket.principal) ||
          subscriptions.get(held.agentId) !== held.socket || arbiterState.revoked || arbiterState.faulted || !codexEffectArbiter.matches(held.grant)) throw new Error();
      const binding = store.bindings[held.agentId], hold = binding?.receiverHandoff;
      if (!binding || binding.revoked || binding.receiverHash !== held.receiverHash || hold?.status !== 'held' || !hold.sourceDetached ||
          hold.transitionID !== held.grant.id) throw new Error();
      control.handle(held.socket, 'control_worktree_authorize', { agentId: held.agentId, proof: held.proof, credential: held.credential,
        channel: held.grant.channel, grant: held.grant, action: 'retire-source-contained' });
      return true;
    } catch {
      invalidateCodexArbiter(); return false;
    }
  };
  server = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false,
    verifyClient: ({ req }, done) => {
      try {
        consume('handshakes', 20, 40);
        if (closing || fault || req.headers.origin || server.clients.size >= budget.connections) return done(false, 401);
        const value = req.headers.authorization;
        if (typeof value !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(value)) return done(false, 401);
        const credential = value.slice(7);
        let principal;
        if (matches(credential, digest(adminSecret))) principal = { admin: true, hostId: 'operator' };
        else {
          const h = Object.values(security.hosts).find(h => !h.revoked && matches(credential, h.tokenHash));
          if (h) principal = { admin: false, hostId: h.hostId, tokenHash: h.tokenHash };
        }
        if (!principal || [...server.clients].filter(s => s.principal?.hostId === principal.hostId).length >= budget.hostConnections) return done(false, 401);
        req.principal = principal; done(true);
      } catch { done(false, 429); }
    },
  });
  server.on('error', () => { fault = new Error('Broker listener failure'); if (!closing) void close(); });
  server.on('listening', () => { try { saveSecurity(); persist(); } catch { void close(); } });
  // Only a broker-configured verifier can supply native evidence. Request
  // parameters contain identity and credentials, never an asserted receipt.
  server.on('connection', (socket, req) => {
    socket.principal = req.principal; socket.alive = true; socket.invalid = 0;
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => {
      if (closing || fault) return;
      socket.alive = true; let changed = false;
      for (const [id, s] of subscriptions) if (s === socket && store.agents[id]) { store.agents[id].lastSeenAt = now(); changed = true; }
      if (changed) { try { persist(); } catch { /* fail() already disconnected receivers */ } }
    });
    socket.on('message', raw => {
      let request;
      try {
        if (closing || fault || !validPrincipal(socket.principal)) throw new Error('Broker unavailable or credential revoked');
        try { consume(`requests:${socket.principal.hostId}`, 20, 40); }
        catch {
          // Preserve a valid request ID so the caller receives a failure
          // that explicitly proves the request was not dispatched.
          try { request = parseRequest(raw.toString()); } catch { /* Keep the rate-limit failure. */ }
          throw new ControlError('BROKER_RATE_LIMITED_BEFORE_DISPATCH');
        }
        request = parseRequest(raw.toString());
        if (codexHandoffOnly && request.params?.agentId?.startsWith('opencode:') &&
            (request.method.startsWith('control_receiver_') || request.method === 'control_worktree_authorize' ||
              request.method === 'control_adapter' && ['worktree.begin', 'worktree.settle'].includes(request.params.command?.op)))
          throw new ControlError('OPENCODE_HANDOFF_DISABLED');
        if (codexArbiterBinding && !['hello', 'resume', 'subscribe', 'members', 'history', 'control_info', 'control_query',
          'control_receiver_observe', 'control_worktree_authorize', 'control_codex_effect_bind_arbiter', 'control_codex_effect_begin',
          'control_codex_effect_status', 'control_codex_effect_finish'].includes(request.method)) {
          // Conservatively invalidate before any possibly authority-changing
          // request. This binding has no dispatch capability and cannot delay
          // the actual broker revocation if its own persistence fails.
          invalidateCodexArbiter();
        }
        const activeFence = store.codexEffectFence, principal = socket.principal;
        let pendingReplay = false;
        if (activeFence) {
          const method = request.method, params = request.params;
          const immediateRevocation = activeFence.revocationMode === 'immediate_session_host_adapter_no_new_effects' && principal.admin &&
            ['revoke', 'revoke_session', 'control_revoke_adapter'].includes(method);
          if (immediateRevocation && !activeFence.revocationRequested) { activeFence.revocationRequested = true; persist(); }
          if (method === 'resume' || method === 'subscribe') {
            const bound = store.bindings[activeFence.agentId];
            check(params.agentId === activeFence.agentId && principal.hostId === activeFence.hostId &&
              !!bound && !bound.revoked && bound.hostId === activeFence.hostId && bound.proofHash !== null &&
              matches(params.proof, bound.proofHash) && bound.receiverHash === activeFence.receiverHash &&
              (method !== 'subscribe' || matches(params.receiverKey, activeFence.receiverHash)), 'CODEX_EFFECT_FENCED');
          }
          const observational = ['hello', 'resume', 'subscribe', 'members', 'history', 'control_info', 'control_query', 'control_receiver_observe', 'control_codex_effect_finish', 'control_codex_effect_status', 'control_codex_effect_reconcile_revocation'].includes(method) ||
            method === 'control_worktree_authorize' && ['observe-worktree', 'observe-source-mcp-shutdown', 'observe-source-model-shutdown', 'observe-source-contained-retirement'].includes(params.action);
          const pendingKind = ['revoke', 'revoke_session', 'control_revoke_adapter', 'enroll', 'release', 'leave', 'control_command'].includes(method);
          const principalID = principal.admin ? 'operator' : principal.hostId;
          const fingerprint = digest(JSON.stringify({ method, params }));
          const canQueue = !immediateRevocation && pendingKind && (principal.admin || principal.hostId === activeFence.hostId);
          const samePending = activeFence.pending?.method === method && activeFence.pending.principal === principalID &&
            activeFence.pending.fingerprint === fingerprint;
          if (canQueue && activeFence.pending && !samePending && !activeFence.pendingConflict && !activeFence.replayUncertain) {
            const queue = activeFence.pendingQueue ||= [];
            if (!queue.some(item => item.method === method && item.principal === principalID && item.fingerprint === fingerprint)) {
              if (queue.length >= 16) activeFence.pendingConflict = true;
              else queue.push({ method, principal: principalID, fingerprint });
              persist();
            }
          }
          if (canQueue && activeFence.pendingConflict) throw new ControlError('CODEX_EFFECT_REVOCATION_CONFLICT');
          if (canQueue && activeFence.replayUncertain) throw new ControlError('CODEX_EFFECT_REVOCATION_UNCERTAIN');
          if (activeFence.phase === 'revocation_pending' && pendingKind && activeFence.pending?.method === method &&
              activeFence.pending.principal === principalID && activeFence.pending.fingerprint === fingerprint) {
            // Persist intent before the mutation. A crash or error can leave
            // its cross-store outcome unknown; never replay automatically.
            activeFence.replayUncertain = true; persist();
            pendingReplay = true;
          } else if (!observational && !immediateRevocation) {
            if (canQueue && !activeFence.pending) {
              activeFence.pending = { method, principal: principalID, fingerprint }; persist();
            }
            throw new ControlError(activeFence.pending ? 'CODEX_EFFECT_REVOCATION_PENDING' : 'CODEX_EFFECT_FENCED');
          }
        }
        if (!activeFence && !['control_info', 'control_storage_reclaim', 'control_storage_reclaim_history', 'control_storage_status', 'control_storage_watch', 'control_export', 'control_export_read',
          'control_activity', 'control_activity_status', 'control_receipt', 'control_alerts', 'control_health_report', 'control_notifications', 'control_notification_ack'].includes(request.method) &&
           !(request.method === 'control_query' && request.params.view === 'health')) {
          sweep();
          refreshCodexArbiterBinding();
        }
        const p = request.params; let result;
        switch (request.method) {
          case 'control_manual_resume_review': case 'control_manual_resume_confirm':
          case 'control_manual_resume_authorize_host': case 'control_manual_resume_cancel_host': case 'control_manual_resume_reset': case 'control_manual_resume_takeover_prepare': case 'control_manual_resume_takeover_cancel': case 'control_manual_resume_takeover': {
            check(principal.admin && !!control && !controlFault, 'MANUAL_RESUME_UNAVAILABLE');
            if (request.method === 'control_manual_resume_takeover_cancel') {
              const matches = Object.values(store.bindings).map(value => value.manualResume).filter(value => value?.channel === p.channel &&
                value.taskID === p.taskID && value.previewID === p.previewID && (value.pendingTakeover?.id === p.takeoverID || value.takeoverCancellations?.includes(p.takeoverID)));
              check(matches.length === 1, 'MANUAL_RESUME_UNAVAILABLE');
              const observation = matches[0];
              if (observation.takeoverCancellations?.includes(p.takeoverID)) { result = { takeoverID: p.takeoverID, cancelled: true, replayed: true }; break; }
              const pending = observation.pendingTakeover, state = control.store.snapshot();
              const preview = state.previews.find(value => value.id === p.previewID && value.taskID === p.taskID && value.channel === p.channel);
              const command = { id: pending.id, op: 'worktree.session_takeover', channel: p.channel, taskID: p.taskID, previewID: p.previewID,
                generation: pending.generation, previousCoordinator: pending.previousCoordinator, nextCoordinator: pending.nextCoordinator };
              check(preview?.sessionCoordinator === pending.previousCoordinator && !control.store.replayCommitted(command, { kind: 'operator' }) &&
                (observation.takeoverCancellations?.length || 0) < 32, 'MANUAL_RESUME_UNAVAILABLE');
              observation.takeoverCancellations = [...(observation.takeoverCancellations || []), p.takeoverID]; delete observation.pendingTakeover; persist();
              result = { takeoverID: p.takeoverID, cancelled: true, replayed: false }; break;
            }
            if (request.method === 'control_manual_resume_takeover_prepare') {
              const state = control.store.snapshot(), task = state.tasks.find(value => value.id === p.taskID && value.channel === p.channel);
              const pending = Object.values(store.bindings).map(value => value.manualResume).filter(value => value?.channel === p.channel &&
                value.taskID === p.taskID && value.previewID === p.previewID && value.pendingTakeover);
              check(pending.length <= 1, 'MANUAL_RESUME_UNAVAILABLE');
              if (pending.length) {
                const entry = pending[0].pendingTakeover;
                check(!p.nextCoordinator || entry.nextCoordinator === p.nextCoordinator, 'MANUAL_RESUME_UNAVAILABLE');
                result = { ...entry, takeoverID: entry.id, pending: true }; break;
              }
              const completed = Object.values(store.bindings).map(value => value.manualResume).filter(value => value?.channel === p.channel &&
                value.taskID === p.taskID && value.previewID === p.previewID && (!p.nextCoordinator || value.coordinator === p.nextCoordinator) &&
                value.takeovers?.at(-1)?.nextCoordinator === value.coordinator);
              check(completed.length <= 1, 'MANUAL_RESUME_UNAVAILABLE');
              if (completed.length) {
                const entry = completed[0].takeovers.at(-1), savedPreview = state.previews.find(value => value.id === p.previewID && value.taskID === p.taskID && value.channel === p.channel);
                check(savedPreview?.sessionCoordinator === entry.nextCoordinator, 'MANUAL_RESUME_UNAVAILABLE');
                result = { ...entry, takeoverID: entry.id, completed: true, pending: false }; break;
              }
              check(!!p.nextCoordinator, 'MANUAL_RESUME_UNAVAILABLE');
              const preview = [...state.previews].reverse().find(value => value.taskID === p.taskID && value.agentId === task?.claimant);
              const observation = task?.claimant && store.bindings[task.claimant]?.manualResume;
              check(manualWorktreeOnly && worktreeTaskDispatch && task?.status === 'claimed' && preview?.id === p.previewID && preview.manualResume === true &&
                preview.approved && observation?.taskID === task.id && observation.previewID === preview.id && observation.claimGeneration === task.claimGeneration &&
                observation.status === 'detached' && observation.hostTransfer?.status === 'completed', 'MANUAL_RESUME_UNAVAILABLE');
              const active = state.channels.find(value => value.id === p.channel)?.active;
              const original = control.manualResumeRecord(task, { ...preview, sessionCoordinator: observation.coordinator });
              const copy = control.manualResumeRecord(task, { ...preview, sessionCoordinator: p.nextCoordinator });
              check(preview.sessionCoordinator === observation.coordinator && p.nextCoordinator !== observation.coordinator &&
                active?.agentId === p.nextCoordinator && now() >= state.lastNow && active.expiresAt > now() && connected(p.nextCoordinator) &&
                control.store.offerAccepted(p.channel, p.nextCoordinator, active.id) && original?.id === observation.recordID &&
                !!copy && copy.id !== original.id && copy.text === original.text, 'MANUAL_RESUME_UNAVAILABLE');
              result = { previousCoordinator: observation.coordinator, nextCoordinator: p.nextCoordinator, previousRecordID: original.id,
                nextRecordID: copy.id, generation: active.generation, pending: false }; break;
            }
            if (request.method === 'control_manual_resume_takeover') {
              const state = control.store.snapshot(), task = state.tasks.find(value => value.id === p.taskID && value.channel === p.channel);
              const preview = state.previews.find(value => value.id === p.previewID && value.taskID === p.taskID && value.channel === p.channel);
              const claimantID = preview?.agentId, b = claimantID && store.bindings[claimantID], observation = b?.manualResume, claimant = claimantID && store.agents[claimantID];
              const receipt = { id: p.takeoverID, previousCoordinator: p.previousCoordinator, nextCoordinator: p.nextCoordinator,
                previousRecordID: p.previousRecordID, nextRecordID: p.nextRecordID, generation: p.generation };
              const previous = observation?.takeovers?.find(value => value.id === p.takeoverID);
              if (previous) {
                check(JSON.stringify(previous) === JSON.stringify(receipt), 'MANUAL_RESUME_UNAVAILABLE');
                result = { takeoverID: p.takeoverID, coordinator: previous.nextCoordinator, recordID: previous.nextRecordID, replayed: true }; break;
              }
              check(!observation?.takeoverCancellations?.includes(p.takeoverID), 'MANUAL_RESUME_UNAVAILABLE');
              check(manualWorktreeOnly && worktreeTaskDispatch && task?.requiresWorktree && preview?.id === p.previewID &&
                preview.manualResume === true && preview.approved &&
                observation?.taskID === task.id && observation.previewID === preview.id && observation.channel === p.channel &&
                observation.claimGeneration === preview.claimGeneration && observation.from === preview.from && observation.to === preview.to &&
                observation.status === 'detached' && observation.coordinator === p.previousCoordinator && observation.recordID === p.previousRecordID &&
                observation.hostTransfer?.status === 'completed' && !b.revoked &&
                p.previousCoordinator !== p.nextCoordinator && p.nextCoordinator !== claimantID && (observation.takeovers?.length || 0) < 32,
              'MANUAL_RESUME_UNAVAILABLE');
              const originalTask = { ...task, claimant: claimantID };
              const command = { id: p.takeoverID, op: 'worktree.session_takeover', channel: p.channel, taskID: p.taskID, previewID: p.previewID,
                generation: p.generation, previousCoordinator: p.previousCoordinator, nextCoordinator: p.nextCoordinator };
              const actor = { kind: 'operator' }, committed = control.store.replayCommitted(command, actor);
              const oldRecord = control.manualResumeRecord(originalTask, { ...preview, sessionCoordinator: p.previousCoordinator }, committed ? p.previousRecordID : undefined);
              const nextRecord = control.manualResumeRecord(originalTask, { ...preview, sessionCoordinator: p.nextCoordinator }, committed ? p.nextRecordID : undefined);
              check(oldRecord?.id === p.previousRecordID && nextRecord?.id === p.nextRecordID && oldRecord.text === nextRecord.text &&
                p.previousRecordID !== p.nextRecordID, 'MANUAL_RESUME_UNAVAILABLE');
              if (committed) {
                check(preview.sessionCoordinator === p.nextCoordinator && JSON.stringify(observation.pendingTakeover) === JSON.stringify(receipt), 'MANUAL_RESUME_UNAVAILABLE');
              } else {
                const active = state.channels.find(value => value.id === p.channel)?.active;
                const latest = [...state.previews].reverse().find(value => value.taskID === task.id && value.agentId === task.claimant);
                check(task.status === 'claimed' && task.claimant === claimantID && task.claimGeneration === preview.claimGeneration && latest?.id === preview.id &&
                  preview.sessionCoordinator === p.previousCoordinator && claimant?.project.root === preview.to && claimant.channel === p.channel &&
                  connected(claimantID) && active?.agentId === p.nextCoordinator && active.generation === p.generation && now() >= state.lastNow &&
                  active.expiresAt > now() && connected(p.nextCoordinator) && control.store.offerAccepted(p.channel, p.nextCoordinator, active.id), 'MANUAL_RESUME_UNAVAILABLE');
                if (observation.pendingTakeover) check(JSON.stringify(observation.pendingTakeover) === JSON.stringify(receipt), 'MANUAL_RESUME_UNAVAILABLE');
                else { observation.pendingTakeover = receipt; persist(); }
                control.store.apply(command, control.context(actor));
              }
              // If the broker stops after the control commit and before this
              // write, the mismatch blocks dispatch; the same ID can finish it.
              observation.coordinator = p.nextCoordinator; observation.recordID = p.nextRecordID;
              observation.takeovers = [...(observation.takeovers || []), receipt]; delete observation.pendingTakeover; persist();
              result = { takeoverID: p.takeoverID, coordinator: p.nextCoordinator, recordID: p.nextRecordID, replayed: false }; break;
            }
            if (request.method === 'control_manual_resume_reset') {
              const candidates = Object.entries(store.bindings).filter(([, binding]) => binding.manualResume?.channel === p.channel &&
                binding.manualResume.taskID === p.taskID && binding.manualResume.previewID === p.previewID && binding.manualResume.recordID === p.recordID);
              check(candidates.length === 1, 'MANUAL_RESUME_UNAVAILABLE');
              const [agentId, binding] = candidates[0], observation = binding.manualResume, source = subscriptions.get(agentId), agent = store.agents[agentId];
              const state = control.store.snapshot(), task = state.tasks.find(value => value.id === p.taskID && value.channel === p.channel);
              check(manualWorktreeOnly && worktreeTaskDispatch && task?.status === 'claimed' && task.claimant === agentId &&
                task.claimGeneration === observation.claimGeneration && ['armed', 'uncertain'].includes(observation.status) &&
                (!observation.hostTransfer || observation.hostTransfer.status === 'cancelled') && !binding.revoked &&
                !!source && source.readyState === WebSocket.OPEN && agent?.channel === p.channel && agent.hostId === binding.hostId &&
                agent.project.root === observation.from && (binding.manualResumeHistory?.length || 0) < 256, 'MANUAL_RESUME_UNAVAILABLE');
              binding.manualResumeHistory = [...(binding.manualResumeHistory || []), observation];
              delete binding.manualResume; manualResumeSources.delete(agentId); persist();
              result = { reset: true, retiredPreviewID: p.previewID, requiresNewPreview: true }; break;
            }
            if (request.method === 'control_manual_resume_cancel_host') {
              const candidates = Object.entries(store.bindings).filter(([, binding]) => binding.manualResume?.channel === p.channel &&
                binding.manualResume.taskID === p.taskID && binding.manualResume.previewID === p.previewID && binding.manualResume.hostTransfer?.id === p.transferID);
              check(candidates.length === 1, 'MANUAL_RESUME_UNAVAILABLE');
              const [agentId, binding] = candidates[0], observation = binding.manualResume, transfer = observation.hostTransfer;
              if (transfer.status === 'cancelled') {
                result = { cancelled: true, transferID: transfer.id, status: observation.status, replayed: true }; break;
              }
              check(transfer.status === 'pending' && observation.status === 'detached' && !subscriptions.has(agentId), 'MANUAL_RESUME_UNAVAILABLE');
              transfer.status = 'cancelled'; observation.status = 'uncertain'; persist();
              result = { cancelled: true, transferID: transfer.id, status: 'uncertain' }; break;
            }
            const review = control.manualResumeReview(p), { task, preview, observation, sourceRecord, report, connected: memberConnected, location } = review;
            if (request.method === 'control_manual_resume_review') {
              result = { taskID: task.id, previewID: preview.id, agentId: task.claimant, from: preview.from, to: preview.to,
                hostId: store.bindings[task.claimant]?.hostId, status: observation.status, recordID: observation.reportRecordID || observation.recordID,
                ...(observation.reportRecordID ? { baselineRecordID: observation.recordID } : {}), sourceRecord, report, connected: memberConnected, location,
                ...(observation.receiptID ? { receiptID: observation.receiptID, requestID: observation.requestID } : {}),
                ...(observation.hostTransfer ? { hostTransfer: observation.hostTransfer } : {}),
                ...(observation.hostTransfer?.status === 'cancelled' && (observation.hostTransferCancellations?.length || 0) >= MAX_MANUAL_HOST_CANCELLATIONS
                  ? { hostTransferAttemptsExhausted: true } : {}),
                ...(observation.takeovers ? { takeovers: observation.takeovers } : {}),
                sourceStopped: observation.sourceStopped === true }; break;
            }
            if (request.method === 'control_manual_resume_authorize_host') {
              check(manualWorktreeOnly && worktreeTaskDispatch, 'MANUAL_RESUME_UNAVAILABLE');
              const b = store.bindings[task.claimant], previous = observation.hostTransfer;
              if (previous && previous.status !== 'cancelled') {
                check(previous.id === p.transferID && previous.to === p.targetHostId && previous.sourceStopped === true, 'MANUAL_RESUME_UNAVAILABLE');
                result = { authorized: true, transferID: previous.id, targetHostId: previous.to, status: previous.status, replayed: true }; break;
              }
              const cancelledTransfers = [...(observation.hostTransferCancellations || []), ...(previous ? [previous.id] : [])];
              check(cancelledTransfers.length <= MAX_MANUAL_HOST_CANCELLATIONS && !cancelledTransfers.includes(p.transferID), 'MANUAL_RESUME_UNAVAILABLE');
              const host = security.hosts[p.targetHostId];
              check(task.status === 'claimed' && observation.status === 'detached' && !memberConnected && !subscriptions.has(task.claimant) &&
                !!b && !b.revoked && b.hostId !== p.targetHostId && !!host && !host.revoked &&
                (host.channels.includes('*') || host.channels.includes(p.channel)) &&
                !store.messages.some(m => m.recipients.includes(task.claimant) && !m.delivered.includes(task.claimant) && !m.cancelled[task.claimant] && m.offered?.includes(task.claimant)) &&
                control.manualResumeRecord(task, preview)?.id === observation.recordID, 'MANUAL_RESUME_UNAVAILABLE');
              observation.version = 2;
              if (cancelledTransfers.length) observation.hostTransferCancellations = cancelledTransfers;
              observation.hostTransfer = { id: p.transferID, from: b.hostId, to: p.targetHostId, sourceStopped: true, status: 'pending' };
              persist();
              result = { authorized: true, transferID: p.transferID, targetHostId: p.targetHostId, status: 'pending' }; break;
            }
            if (observation.status === 'confirmed') {
              check(observation.receiptID === p.receiptID && (observation.reportRecordID || observation.recordID) === p.recordID && observation.requestID === p.requestID &&
                observation.sourceStopped === true, 'MANUAL_RESUME_UNAVAILABLE');
              result = { confirmed: true, receiptID: observation.receiptID, sourceStopEvidence: 'operator_attestation', replayed: true }; break;
            }
            const baselineRecord = control.manualResumeRecord(task, preview, observation.recordID);
            const reportedRecord = control.manualResumeRecord(task, preview, report.recordID);
            check(task.status === 'claimed' && observation.status === 'detached' && memberConnected && location === preview.to &&
              report.status === 'reported_match' && !!baselineRecord && !!reportedRecord && baselineRecord.text === reportedRecord.text && report.recordID === p.recordID &&
              report.requestID === p.requestID, 'MANUAL_RESUME_UNAVAILABLE');
            observation.status = 'confirmed'; observation.receiptID = p.receiptID; observation.requestID = p.requestID; observation.sourceStopped = true;
            if (report.recordID !== observation.recordID) observation.reportRecordID = report.recordID;
            persist();
            // Use the same deduplicated readiness path as the periodic sweep.
            // A direct wake here was not recorded in taskSignals and could be
            // repeated immediately by the next scheduler tick.
            control.signalReadyTasks();
            result = { confirmed: true, receiptID: observation.receiptID, sourceStopEvidence: 'operator_attestation' }; break;
          }
          case 'control_manual_resume_observe': {
            check(!!control && !controlFault, 'MANUAL_RESUME_UNAVAILABLE');
            const agent = control.adapter(socket, p, p.channel), state = control.store.snapshot();
            const task = state.tasks.find(value => value.id === p.taskID && value.channel === p.channel && value.claimant === agent.agentId);
            const observation = store.bindings[agent.agentId]?.manualResume;
            check(task?.executionScope?.cwd === p.cwd && observation?.previewID === p.previewID &&
              control.worktreeTaskReady(state, task, p.cwd), 'MANUAL_RESUME_UNAVAILABLE');
            result = { receiptID: observation.receiptID, previewID: observation.previewID, sourceStopEvidence: 'operator_attestation' }; break;
          }
          case 'control_manual_resume_arm': case 'control_manual_resume_status': {
            check(!!control && !controlFault, 'MANUAL_RESUME_UNAVAILABLE');
            const candidate = control.manualResumeCandidate(socket, p, { requireComplete: request.method === 'control_manual_resume_arm' }),
              id = candidate.task.claimant, b = store.bindings[id], existing = b?.manualResume;
            check(!!b && !b.revoked && !b.receiverHandoff && !b.ownerDrain, 'MANUAL_RESUME_UNAVAILABLE');
            const source = subscriptions.get(id), agent = store.agents[id];
            const sourceReady = !!source && source.readyState === WebSocket.OPEN && agent?.project.root === candidate.preview.from &&
              !store.messages.some(m => m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id] && m.offered?.includes(id));
            const nextObservation = () => ({ version: 1, taskID: candidate.task.id, previewID: candidate.preview.id, channel: p.channel,
              claimGeneration: candidate.task.claimGeneration, from: candidate.preview.from, to: candidate.preview.to,
              coordinator: candidate.coordinator, recordID: candidate.recordID, status: 'armed' });
            if (existing) {
              if (existing.taskID !== candidate.task.id || existing.previewID !== candidate.preview.id) {
                const previous = control.store.snapshot().tasks.find(task => task.id === existing.taskID && task.channel === existing.channel);
                const previousSettled = previous && !previous.terminalHold && (
                  previous.status === 'completed' && !!previous.stoppedEvidence ||
                  previous.status === 'open' && !previous.claimant && previous.admission === 'none' && !previous.dispatchIntentID ||
                  previous.id === candidate.task.id && previous.status === 'claimed' && previous.claimGeneration > existing.claimGeneration && !!previous.stoppedEvidence);
                check(request.method === 'control_manual_resume_arm' && sourceReady && previousSettled &&
                  (b.manualResumeHistory?.length || 0) < 256, 'MANUAL_RESUME_UNAVAILABLE');
                b.manualResumeHistory = [...(b.manualResumeHistory || []), existing];
                b.manualResume = nextObservation(); manualResumeSources.set(id, source); persist();
                result = { status: 'armed', observation: 'receiver_disconnect_only' }; break;
              }
              check(existing.taskID === candidate.task.id && existing.previewID === candidate.preview.id &&
                existing.channel === p.channel && existing.claimGeneration === candidate.task.claimGeneration &&
                existing.coordinator === candidate.coordinator && !existing.pendingTakeover, 'MANUAL_RESUME_UNAVAILABLE');
              if (request.method === 'control_manual_resume_status') {
                const baseline = control.manualResumeRecord(candidate.task, candidate.preview, existing.recordID);
                const current = control.manualResumeRecord(candidate.task, candidate.preview, candidate.recordID);
                result = { status: existing.status, observation: 'receiver_disconnect_only',
                  baselineMatches: !!baseline && !!current && baseline.text === current.text, currentRecordID: candidate.recordID }; break;
              }
              if (request.method === 'control_manual_resume_arm' && ['armed', 'uncertain'].includes(existing.status)) {
                check(sourceReady && (existing.status === 'uncertain' || manualResumeSources.get(id) === source), 'MANUAL_RESUME_UNAVAILABLE');
                if (existing.status === 'uncertain') check(existing.recordID !== candidate.recordID, 'MANUAL_RESUME_UNAVAILABLE');
                if (existing.status !== 'armed' || existing.recordID !== candidate.recordID) {
                  existing.status = 'armed'; existing.recordID = candidate.recordID; manualResumeSources.set(id, source); persist();
                }
              } else check(existing.recordID === candidate.recordID, 'MANUAL_RESUME_UNAVAILABLE');
              result = { status: existing.status, observation: 'receiver_disconnect_only' }; break;
            }
            check(request.method === 'control_manual_resume_arm', 'MANUAL_RESUME_UNAVAILABLE');
            check(!(b.manualResumeHistory || []).some(previous => previous.taskID === candidate.task.id && previous.previewID === candidate.preview.id &&
              previous.claimGeneration === candidate.task.claimGeneration), 'MANUAL_RESUME_PREVIEW_RETIRED');
            check(sourceReady, 'MANUAL_RESUME_UNAVAILABLE');
            b.manualResume = nextObservation();
            manualResumeSources.set(id, source); persist();
            result = { status: 'armed', observation: 'receiver_disconnect_only' }; break;
          }
          case 'hello': result = { protocol: 2, hostId: principal.hostId, admin: principal.admin }; break;
          case 'join': {
            if (!scope(principal, p.channel)) throw new Error('Channel access denied');
            const id = identity(p.harness, p.sessionId);
            const conflict = Object.values(store.agents).find(a => a.agentId !== id && a.channel === p.channel && nameKey(a.name) === nameKey(p.name));
            if (conflict) throw new Error('Name already claimed or reserved in channel');
            if (!store.agents[id] && list(p.channel).length >= budget.channelMembers) throw new Error('Channel member limit reached');
            sessionBudget(principal, id);
            const prior = store.agents[id], existing = store.bindings[id]; let effect, transferred = false;
            if (existing && existing.hostId !== principal.hostId) {
              const transfer = existing.manualResume?.hostTransfer;
              if (transfer?.status !== 'pending') throw new Error('Session ownership denied');
              check(!!control && !controlFault && manualWorktreeOnly && worktreeTaskDispatch && !existing.revoked && transfer?.status === 'pending' && transfer.to === principal.hostId &&
                transfer.from === existing.hostId && existing.manualResume.status === 'detached' && !subscriptions.has(id) &&
                !matches(p.proof, existing.proofHash) && !matches(p.proof, existing.receiverHash) &&
                !store.messages.some(m => m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id] && m.offered?.includes(id)) &&
                prior?.hostId === existing.hostId && prior.channel === p.channel && p.project.root === existing.manualResume.to, 'MANUAL_RESUME_UNAVAILABLE');
              const review = control.manualResumeReview({ channel: p.channel, taskID: existing.manualResume.taskID, previewID: existing.manualResume.previewID });
              check(review.task.status === 'claimed' && review.task.claimant === id &&
                control.manualResumeRecord(review.task, review.preview)?.id === existing.manualResume.recordID, 'MANUAL_RESUME_UNAVAILABLE');
              existing.hostId = principal.hostId; existing.proofHash = digest(p.proof); delete existing.receiverHash;
              transfer.status = 'completed'; transferred = true;
            } else binding(principal, id, p.proof, true);
            if (prior && prior.channel !== p.channel) effect = remove(id, 'channel_changed');
            const a = { agentId: id, hostId: principal.hostId, harness: p.harness, sessionId: p.sessionId,
              channel: p.channel, name: p.name, role: p.role, project: p.project };
            const manual = store.bindings[id]?.manualResume;
            if (!transferred && manual?.status === 'detached' && manual.hostTransfer?.status !== 'completed' && p.project.root === manual.from)
              manual.status = 'uncertain';
            if (connected(id)) { a.lastSeenAt = now(); a.disconnectedAt = null; a.reservationExpiresAt = null; }
            else if (prior) Object.assign(a, { lastSeenAt: prior.lastSeenAt, disconnectedAt: prior.disconnectedAt, reservationExpiresAt: prior.reservationExpiresAt });
            else reserve(a);
            store.agents[id] = a; persist(); effect?.();
            if (transferred) {
              for (const previous of controls.get(id) || []) if (previous !== socket) send(previous, { event: 'membership_removed', agentId: id, reason: 'session_host_transferred' });
              controls.delete(id); deliveries.delete(id); control?.forgetTaskSignals(id);
            }
            control?.observeActivity({ type: 'member.joined', channel: a.channel, agentId: id });
            if (!controls.has(id)) controls.set(id, new Set()); controls.get(id).add(socket);
            for (const peer of list(p.channel)) {
              const listeners = new Set([subscriptions.get(peer.agentId), ...(controls.get(peer.agentId) || [])]);
              for (const receiver of listeners) if (receiver) send(receiver, { event: 'presence', agent: a });
            }
            result = { agent: a, members: page(list(p.channel)) }; break;
          }
          case 'subscribe': {
            const known = store.bindings[p.agentId];
            if (known && known.hostId !== principal.hostId && known.manualResume?.hostTransfer?.status === 'pending' &&
                known.manualResume.hostTransfer.to === principal.hostId && scope(principal, known.manualResume.channel) &&
                !known.revoked && !matches(p.proof, known.proofHash) && !matches(p.proof, known.receiverHash))
              throw new ControlError('MANUAL_RESUME_JOIN_REQUIRED');
            if (known && (known.hostId !== principal.hostId || known.revoked ||
                (known.proofHash !== null && !matches(p.proof, known.proofHash)))) throw new Error('Session ownership denied');
            if (known?.receiverHash && !matches(p.receiverKey, known.receiverHash)) throw new Error('Receiver ownership denied');
            const prior = subscriptions.get(p.agentId);
            if (prior && prior !== socket && prior.readyState === WebSocket.OPEN) throw new Error('Session already has a receiver');
            const a = store.agents[p.agentId];
            if (a && !scope(principal, a.channel)) throw new Error('Channel access denied');
            if (p.manualWorktreeHost) {
              check(managedRecords && !!control && !!known && !!a && !known.receiverHandoff && !known.ownerDrain &&
                (!known.manualResume || known.manualResume.status === 'confirmed'), 'MANUAL_WORKTREE_SESSION_UNAVAILABLE');
            }
            sessionBudget(principal, p.agentId);
            binding(principal, p.agentId, p.proof, true);
            const manual = store.bindings[p.agentId]?.manualResume;
            // A resumed Codex process can open its native thread at the target
            // before its agent re-registers there. Refuse this subscription
            // until the join updates membership; the claimed cwd can only
            // delay a receiver, never authorize a transfer or task.
            if (manual?.status === 'detached' && manual.hostTransfer?.status !== 'completed' &&
                a?.project.root === manual.from && manual.from !== manual.to && p.observedCwd === manual.to && a.harness === 'codex')
              throw new ControlError('MANUAL_RESUME_JOIN_REQUIRED');
            if (manual?.status === 'detached' && manual.hostTransfer?.status !== 'completed' && a?.project.root === manual.from)
              manual.status = 'uncertain';
            if (a) { a.lastSeenAt = now(); a.disconnectedAt = null; a.reservationExpiresAt = null; }
            persist();
            if (subscriptions.get(p.agentId) !== socket) deliveries.delete(p.agentId);
            subscriptions.set(p.agentId, socket);
            if (prior !== socket) { control?.forgetTaskSignals(p.agentId); control?.forgetReceiverHealth(p.agentId); }
            if (a && prior !== socket && !store.codexEffectFence) control?.observeActivity({ type: 'receiver.connected', channel: a.channel, agentId: p.agentId });
            result = { subscribed: true, registered: !!a, ...(a ? { channel: a.channel } : {}) }; break;
          }
          case 'resume': {
            binding(principal, p.agentId, p.proof);
            const a = store.agents[p.agentId];
            if (a && !scope(principal, a.channel)) throw new Error('Channel access denied');
            if (a) { if (!controls.has(p.agentId)) controls.set(p.agentId, new Set()); controls.get(p.agentId).add(socket); }
            result = { registered: !!a }; break;
          }
          case 'unsubscribe': {
            binding(principal, p.agentId, p.proof);
            if (subscriptions.get(p.agentId) === socket) {
              observeManualReceiverDisconnect(p.agentId, socket);
              subscriptions.delete(p.agentId); deliveries.delete(p.agentId);
              control?.forgetReceiverHealth(p.agentId);
              const a = store.agents[p.agentId];
              if (a) { reserve(a); persist(); control?.observeActivity({ type: 'receiver.unsubscribed', channel: a.channel, agentId: p.agentId }); }
            }
            result = { unsubscribed: true }; break;
          }
          case 'members': case 'history': {
            let a;
            if (!principal.admin) a = member(principal, p.agentId, p.proof, p.channel);
            if (!scope(principal, p.channel)) throw new Error('Channel access denied');
            const values = request.method === 'members' ? list(p.channel) : store.messages.filter(m => m.channel === p.channel &&
              (principal.admin || m.from.agentId === a.agentId || m.recipients.includes(a.agentId))).slice().reverse();
            result = page(values, p.limit, p.offset); break;
          }
          case 'send': {
            const a = member(principal, p.agentId, p.proof);
            check(!receiverBlocked(a.agentId), 'RECEIVER_HANDOFF_HELD');
            if (p.masterGeneration !== undefined) {
              check(!!control && !controlFault, 'CONTROL_UNAVAILABLE');
              control.authorizeMasterMessage(socket, p, a.channel);
            }
            const existing = store.messages.find(m => m.messageId === p.messageId && m.from.agentId === a.agentId);
            if (existing) {
              if (existing.text !== p.text || existing.to !== p.to || existing.channel !== a.channel) throw new Error('Idempotency key reused with different payload');
              result = existing; break;
            }
            if (p.to === '*' && !security.hosts[principal.hostId].broadcast) throw new Error('Broadcast permission denied');
            const recipients = list(a.channel).filter(peer => peer.agentId !== a.agentId && (p.to === '*' || p.to === peer.agentId)).map(peer => peer.agentId);
            if (!recipients.length) throw new Error('No recipient in this channel');
            if (recipients.some(id => store.messages.filter(m => m.recipients.includes(id) && !m.delivered.includes(id) && !m.cancelled[id]).length >= budget.pendingPerSession)) throw new Error('Recipient queue limit reached');
            if (store.messages.length >= budget.history) throw new Error('Message store full');
            consume(`wake:${principal.hostId}`, 10, 32, recipients.length);
            const m = { id: randomUUID(), messageId: p.messageId, to: p.to, channel: a.channel, from: { ...a }, text: p.text,
              createdAt: new Date(now()).toISOString(), recipients, delivered: [], cancelled: {}, offered: [] };
            if (Buffer.byteLength(JSON.stringify(store)) + Buffer.byteLength(JSON.stringify(m)) + 1 > budget.storeBytes) throw new Error('Store byte limit reached');
            store.messages.push(m); persist();
            control?.observeActivity({ type: 'message.queued', channel: m.channel, agentId: a.agentId, messageID: m.id });
            recipients.forEach(deliver);
            // A control-only connection does not receive the message event.
            // Reuse the existing presence hint without exposing message text.
            for (const recipient of recipients) for (const receiver of controls.get(recipient) || [])
              if (receiver !== subscriptions.get(recipient)) send(receiver, { event: 'presence', agent: store.agents[recipient] });
            result = m; break;
          }
          case 'ack': {
            member(principal, p.agentId, p.proof);
            if (subscriptions.get(p.agentId) !== socket) throw new Error('Only the session receiver can acknowledge');
            const m = store.messages.find(m => m.id === p.id && m.recipients.includes(p.agentId));
            if (!m) throw new Error('Unknown message');
            if (m.cancelled[p.agentId]) throw new Error('Message cancelled when membership was released');
            if (!m.delivered.includes(p.agentId)) {
              m.delivered.push(p.agentId); persist();
              control?.observeActivity({ type: 'message.acknowledged', channel: m.channel, agentId: p.agentId, messageID: m.id });
              if (m.text.startsWith('Turnlink requests session preparation. ') && store.agents[m.from.agentId] && store.agents[p.agentId]) {
                const listeners = new Set([subscriptions.get(m.from.agentId), ...(controls.get(m.from.agentId) || [])]);
                for (const receiver of listeners) if (receiver) send(receiver, { event: 'presence', agent: store.agents[p.agentId] });
              }
            }
            deliveries.get(p.agentId)?.delete(p.id); deliver(p.agentId);
            result = { delivered: true }; break;
          }
          case 'leave': {
            binding(principal, p.agentId, p.proof);
            const effect = remove(p.agentId, 'explicit_leave'); persist(); effect(); result = { left: true }; break;
          }
          case 'release': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            const a = Object.values(store.agents).find(a => a.channel === p.channel && nameKey(a.name) === nameKey(p.name));
            if (!a) throw new Error('Name is not claimed');
            const effect = remove(a.agentId, 'authorized_release'); persist(); effect(); result = { released: true, agentId: a.agentId }; break;
          }
          case 'enroll': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            if (['unassigned', 'historical', 'operator'].includes(p.hostId) || p.credential === adminSecret) throw new Error('Invalid host enrollment');
            if (Object.keys(security.hosts).length >= 64 && !security.hosts[p.hostId]) throw new Error('Host limit reached');
            if (Object.values(security.hosts).some(h => h.hostId !== p.hostId && matches(p.credential, h.tokenHash))) throw new Error('Host credentials must be unique');
            for (const id of p.adopt || []) {
              const b = store.bindings[id];
              if (!b || b.proofHash !== null || !['unassigned', p.hostId].includes(b.hostId)) throw new Error('Only explicitly migrated unclaimed sessions can be adopted');
            }
            security.hosts[p.hostId] = { hostId: p.hostId, tokenHash: digest(p.credential), channels: p.channels, broadcast: p.broadcast, revoked: false };
            saveSecurity();
            for (const id of p.adopt || []) { store.bindings[id].hostId = p.hostId; if (store.agents[id]) store.agents[id].hostId = p.hostId; }
            persist();
            for (const s of server.clients) if (!s.principal.admin && s.principal.hostId === p.hostId) s.close(1008, 'Credential rotated');
            result = { enrolled: true, hostId: p.hostId }; break;
          }
          case 'revoke': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            if (!Object.hasOwn(security.hosts, p.hostId)) throw new Error('Unknown host');
            if (control) {
              if (controlFault) throw new Error('CONTROL_UNAVAILABLE');
              for (const a of Object.values(store.agents).filter(a => a.hostId === p.hostId)) control.departed(a.agentId, a.channel);
            }
            security.hosts[p.hostId].revoked = true; saveSecurity();
            for (const s of server.clients) if (!s.principal.admin && s.principal.hostId === p.hostId) s.close(1008, 'Credential revoked');
            result = { revoked: true, hostId: p.hostId }; break;
          }
          case 'revoke_session': {
            if (!principal.admin) throw new Error('Administrative authorization required');
            const b = store.bindings[p.agentId]; if (!b) throw new Error('Unknown session');
            b.revoked = true;
            const effect = remove(p.agentId, 'session_revoked'); persist(); effect();
            subscriptions.delete(p.agentId);
            result = { revoked: true, agentId: p.agentId }; break;
          }
          case 'handoff': throw new Error('Automatic handoff requires a verified window/project event');
          case 'control_info':
            result = control ? { ...control.handle(socket, request.method, p), available: !controlFault } : { version: 1, enabled: false, effectsEnabled: false };
            break;
          case 'control_storage_reclaim':
          case 'control_storage_reclaim_history':
          case 'control_storage_status': case 'control_storage_watch': case 'control_export': case 'control_export_read':
          case 'control_activity': case 'control_activity_status':
          case 'control_receipt':
          case 'control_alerts':
          case 'control_health_report':
          case 'control_notifications': case 'control_notification_ack':
            if (!control) throw new Error('CONTROL_DISABLED');
            // Diagnostics/exports and bounded observational health writes remain
            // available during scheduler quarantine. They never clear that fault
            // or consume command-receipt capacity.
            result = control.handle(socket, request.method, p); break;
          case 'control_delivery_pull': case 'control_delivery_finish': {
            if (!control || controlFault || !executor) throw new Error(control ? 'CONTROL_UNAVAILABLE' : 'CONTROL_DISABLED');
            const agent = control.adapter(socket, p);
            if (request.method === 'control_delivery_finish') {
              const retry = store.deliveryRetries?.[p.actionID], action = control.store.snapshot().actions.find(a => a.id === p.actionID);
              check(retry?.target === agent.agentId && retry.channel === agent.channel && !!action, 'UNKNOWN_ACTION');
              if (!retry.outcome) {
                const observations = control.store.snapshot().evidence.filter(e => ['admitted', 'unadmitted', 'uncertain'].some(outcome => e.id === stableID(action.id, `delivery:${outcome}`)) && e.entityID === retry.messageID && e.agentId === agent.agentId && e.channel === agent.channel);
                check(observations.length <= 1, 'EFFECT_RECEIPT_CONFLICT');
                if (observations[0]) { const observed = observations[0]; Object.assign(retry, { outcome: observed.kind, evidenceID: observed.id, ...(observed.admissionID ? { admissionID: observed.admissionID } : {}) }); persist(); }
              }
              check(!retry.outcome || (retry.outcome === p.outcome && retry.admissionID === p.admissionID), 'EFFECT_RECEIPT_CONFLICT');
              check(action.evidence !== 'native_idempotent' || action.admissionID === p.admissionID, 'ADMISSION_KEY_REQUIRED');
              if (!retry.outcome) {
                const evidenceID = stableID(action.id, `delivery:${p.outcome}`);
                control.store.apply({ id: evidenceID, op: 'evidence.record', channel: agent.channel, entityID: retry.messageID, kind: p.outcome,
                  ...(p.admissionID ? { admissionID: p.admissionID } : {}) }, control.context({ kind: 'adapter', agentId: agent.agentId }));
                Object.assign(retry, { outcome: p.outcome, evidenceID, ...(p.admissionID ? { admissionID: p.admissionID } : {}) }); persist();
              }
              result = { recorded: true, evidenceID: retry.evidenceID }; break;
            }
            const message = store.messages.find(m => m.id === p.messageID && m.channel === agent.channel && m.recipients.includes(agent.agentId));
            check(!!message, 'MESSAGE_REQUIRED');
            let retry = null;
            for (const [id, pending] of Object.entries(store.deliveryRetries || {}).reverse()) {
              if (pending.messageID !== message.id || pending.target !== agent.agentId || pending.outcome) continue;
              const snapshot = control.store.snapshot();
              const observed = snapshot.evidence.find(e => ['admitted', 'unadmitted', 'uncertain'].some(outcome => e.id === stableID(id, `delivery:${outcome}`)) && e.entityID === message.id && e.agentId === agent.agentId && e.channel === agent.channel);
              if (observed) { Object.assign(pending, { outcome: observed.kind, evidenceID: observed.id, ...(observed.admissionID ? { admissionID: observed.admissionID } : {}) }); persist(); continue; }
              if (message.delivered.includes(agent.agentId) || message.cancelled[agent.agentId]) continue;
              const action = snapshot.actions.find(a => a.id === id);
              if (!action || action.status !== 'succeeded') continue;
              try { executor.authorized(action, true); retry = { id, evidence: action.evidence, evidenceID: action.recoveryEvidenceID, admissionID: action.admissionID }; }
              catch (error) { if (!(error instanceof ControlError)) throw error; }
              break;
            }
            result = { policy: store.deliveryPauses?.[agent.agentId] ? 'paused' : store.wakePolicies?.[agent.agentId]?.policy || 'steer', retry }; break;
          }
          case 'control_query':
            if (!control || (controlFault && p.view !== 'health')) throw new Error(control ? 'CONTROL_UNAVAILABLE' : 'CONTROL_DISABLED');
            result = control.handle(socket, request.method, p); break;
          case 'control_authority_watch': {
            if (!control || controlFault) throw new Error(control ? 'CONTROL_UNAVAILABLE' : 'CONTROL_DISABLED');
            const agent = control.adapter(socket, p, p.channel);
            const previous = authorityWatches.get(socket);
            check(!previous || (previous.agentId === agent.agentId && previous.channel === p.channel &&
              (!previous.grantID || (!!p.grant && WorktreeTransition.parse(p.grant).id === previous.grantID))), 'AUTHORITY_WATCH_UNAVAILABLE');
            if (p.grant) control.handle(socket, 'control_worktree_authorize', { ...p, action: 'observe-worktree' });
            authorityWatches.set(socket, { hostId: socket.principal.hostId, agentId: agent.agentId, channel: p.channel,
              ...(p.grant ? { grantID: WorktreeTransition.parse(p.grant).id } : {}) });
            result = { watching: true }; break;
          }
          case 'control_checkpoint_observe': {
            if (!control || controlFault) throw new Error(control ? 'CONTROL_UNAVAILABLE' : 'CONTROL_DISABLED');
            check(!checkpointInFlight.has(p.agentId), 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
            checkpointInFlight.add(p.agentId);
            const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
            const disconnected = () => controller.abort(); socket.once('close', disconnected);
            const verifier = checkpointVerifier && (async input => {
              const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('CHECKPOINT_OBSERVATION_UNAVAILABLE')), { once: true }));
              const verification = Promise.resolve().then(() => checkpointVerifier(input)).then(proof => {
                if (controller.signal.aborted) { releaseCodexVerifierLease(proof); throw new Error('CHECKPOINT_OBSERVATION_UNAVAILABLE'); }
                return proof;
              });
              const proof = await Promise.race([verification, aborted]);
              if (closing || fault || controlFault || socket.readyState !== WebSocket.OPEN || !validPrincipal(socket.principal)) {
                releaseCodexVerifierLease(proof); throw new Error('CHECKPOINT_OBSERVATION_UNAVAILABLE');
              }
              return proof;
            });
            void control.verifiedCheckpointObservation(socket, p, verifier, controller.signal).then(
              value => send(socket, { id: request.id, result: value }),
              error => send(socket, { id: request.id, error: error?.message === 'CHECKPOINT_DESTINATION_UNCERTAIN' ? 'CHECKPOINT_DESTINATION_UNCERTAIN' : 'CHECKPOINT_OBSERVATION_UNAVAILABLE' }),
            ).finally(() => { socket.off('close', disconnected); clearTimeout(timer); controller.abort(); checkpointInFlight.delete(p.agentId); });
            return;
          }
          case 'control_command': case 'control_adapter': case 'control_notice_ack':
          case 'control_checkpoint_observation':
          case 'control_worktree_authorize':
          case 'control_task_pull': case 'control_task_watch':
          case 'control_enroll_adapter': case 'control_revoke_adapter':
            if (!control || controlFault) throw new Error(control ? 'CONTROL_UNAVAILABLE' : 'CONTROL_DISABLED');
            if (request.method === 'control_adapter' && p.command?.op === 'worktree.settle' && p.command?.destinationCancellation && destinationCancellationVerifier) {
              check(!destinationCancellationInFlight.has(p.agentId), 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
              destinationCancellationInFlight.add(p.agentId);
              const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
              const disconnected = () => controller.abort();
              socket.once('close', disconnected);
              const verifier = async input => {
                const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE')), { once: true }));
                const verification = Promise.resolve().then(() => destinationCancellationVerifier(input)).then(proof => {
                  if (controller.signal.aborted) { releaseCodexVerifierLease(proof); throw new Error('DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE'); }
                  return proof;
                });
                const proof = await Promise.race([verification, aborted]);
                if (closing || fault || controlFault || socket.readyState !== WebSocket.OPEN || !validPrincipal(socket.principal)) {
                  releaseCodexVerifierLease(proof);
                  throw new Error('DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
                }
                return proof;
              };
              void control.verifiedDestinationCancellation(socket, p, verifier, controller.signal).then(
                value => { invalidateAuthorityWatches(request.method, p); send(socket, { id: request.id, result: value }); },
                () => send(socket, { id: request.id, error: 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE' }),
              ).finally(() => { socket.off('close', disconnected); clearTimeout(timer); controller.abort(); destinationCancellationInFlight.delete(p.agentId); });
              return;
            }
            if (request.method === 'control_adapter' && p.command?.op === 'worktree.settle' && p.command?.purpose === 'establish-mcp' && p.command?.cleanupReceipt && mcpCleanupVerifier) {
              check(!mcpCleanupInFlight.has(p.agentId), 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
              mcpCleanupInFlight.add(p.agentId);
              const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
              const disconnected = () => controller.abort();
              socket.once('close', disconnected);
              const verifier = async input => {
                const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('MCP_CLEANUP_VERIFICATION_UNAVAILABLE')), { once: true }));
                const verification = Promise.resolve().then(() => mcpCleanupVerifier(input)).then(proof => {
                  if (controller.signal.aborted) { releaseCodexVerifierLease(proof); throw new Error('MCP_CLEANUP_VERIFICATION_UNAVAILABLE'); }
                  return proof;
                });
                const proof = await Promise.race([verification, aborted]);
                if (closing || fault || controlFault || socket.readyState !== WebSocket.OPEN || !validPrincipal(socket.principal)) {
                  releaseCodexVerifierLease(proof); throw new Error('MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
                }
                return proof;
              };
              void control.verifiedMcpCleanup(socket, p, verifier, controller.signal).then(
                value => { invalidateAuthorityWatches(request.method, p); send(socket, { id: request.id, result: value }); },
                () => send(socket, { id: request.id, error: 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE' }),
              ).finally(() => { socket.off('close', disconnected); clearTimeout(timer); controller.abort(); mcpCleanupInFlight.delete(p.agentId); });
              return;
            }
            result = control.handle(socket, request.method, p); break;
        }
        if (pendingReplay) {
          const fence = store.codexEffectFence, next = fence.pendingQueue?.shift();
          if (next) { fence.pending = next; delete fence.replayUncertain; }
          else delete store.codexEffectFence;
          persist();
        }
        // Any relevant state mutation invalidates a watched grant. Closing is
        // deliberately conservative and avoids relying on delivery of a new
        // event type or on the client's next polling interval.
        invalidateAuthorityWatches(request.method, p);
        send(socket, { id: request.id, result });
        if (request.method === 'subscribe') deliver(p.agentId);
      } catch (error) {
        const invalid = ['ZodError', 'ProtocolError'].includes(error.name) || error instanceof SyntaxError;
        const privateFailure = request?.method?.startsWith('control_receiver_') && !invalid && !(error instanceof ControlError);
        send(socket, { id: request?.id ?? error.requestId ?? null, error: invalid ? 'Invalid request schema or protocol version' :
          privateFailure ? 'CONTROL_UNAVAILABLE' : String(error.message).slice(0, 512) });
        if (invalid && ++socket.invalid >= 3) socket.close(1008, 'Invalid protocol');
      }
    });
    socket.on('close', () => {
      authorityWatches.delete(socket);
      if (codexArbiterBinding?.socket === socket) {
        invalidateCodexArbiter();
      }
      for (const [id, offer] of receiverOffers) if (offer.source === socket || offer.target === socket) receiverOffers.delete(id);
      for (const [id, pending] of receiverDetachAcks) if (pending.source === socket) receiverDetachAcks.delete(id);
      for (const [id, sockets] of controls) { sockets.delete(socket); if (!sockets.size) controls.delete(id); }
      const disconnected = [];
      for (const [id, s] of subscriptions) if (s === socket) {
        observeManualReceiverDisconnect(id, socket);
        subscriptions.delete(id); deliveries.delete(id);
        control?.forgetReceiverHealth(id);
        if (store.agents[id]) { reserve(store.agents[id]); disconnected.push(store.agents[id]); }
      }
      if (disconnected.length && !closing && !fault) {
        try {
          persist();
          if (!store.codexEffectFence) for (const a of disconnected) control?.observeActivity({ type: 'receiver.disconnected', channel: a.channel, agentId: a.agentId });
        } catch { /* fail closed */ }
      }
    });
  });
  heartbeat = setInterval(() => {
    for (const s of server.clients) { if (!validPrincipal(s.principal) || !s.alive) s.terminate(); else { s.alive = false; s.ping(); } }
  }, 15000); heartbeat.unref();
  expiryTimer = setInterval(() => {
    if (store.codexEffectFence) return;
    try { sweep(); } catch { /* membership revocation/persistence failures stay conservative */ }
    if (control && !controlFault && !fault) {
      try {
        control.tick(); executor?.run(); control.signalReadyTasks();
        if (executor) for (const id of subscriptions.keys()) deliver(id);
      } catch { controlFault = true; refreshCodexArbiterBinding(); }
    }
    if (control && !fault) {
      control.maintainActivity();
      try { control.signalStorage(server.clients, send); } catch { /* Diagnostics cannot crash messaging or authorize recovery. */ }
    }
    refreshCodexArbiterBinding();
  }, sweepIntervalMs); expiryTimer.unref();
  function close() {
    if (closePromise) return closePromise;
    invalidateCodexArbiter();
    clearInterval(heartbeat); clearInterval(expiryTimer);
    if (!fault) { for (const id of subscriptions.keys()) if (store.agents[id]) reserve(store.agents[id]); try { persist(); } catch { /* preserve last durable snapshot */ } }
    closing = true;
    for (const entry of ownerPreparations.values()) { entry.controller.abort(); entry.lease.release(); }
    ownerPreparations.clear();
    for (const s of server.clients) s.terminate();
    closePromise = new Promise(resolve => server.close(() => {
      try { control?.close(); } catch { controlFault = true; } finally { unlock(); resolve(); }
    })); return closePromise;
  }
  return { server, get store() { return store; }, get security() { return security; }, get fault() { return fault; }, sweep, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const address = new URL(url);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'ws:') throw new Error('Broker must use ws://127.0.0.1');
  const options = brokerEnvironmentOptions();
  const host = token(true), admin = adminToken(true);
  const destinationCancellationVerifier = brokerEnvironmentCancellationVerifier(process.env, options, { host, admin });
  const cancellation = process.env.AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE ? validateCredential(readPrivate(process.env.AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE, 128).trim()) : undefined;
  const completionVerifier = brokerEnvironmentOpenCodeCompletionVerifier(process.env, options, { host, admin, cancellation });
  const completion = process.env.AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE ? validateCredential(readPrivate(process.env.AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE, 128).trim()) : undefined;
  const sourceRecoveryVerifier = brokerEnvironmentOpenCodeSourceRecoveryVerifier(process.env, options, { host, admin, cancellation, completion });
  const ownerEndpointDirectory = brokerEnvironmentOwnerEndpointDirectory(process.env, options);
  const broker = createBroker({ port: Number(address.port), secret: host, adminSecret: admin, ...options, ownerEndpointDirectory, destinationCancellationVerifier, completionVerifier, sourceRecoveryVerifier });
  broker.server.on('listening', () => { if (!broker.fault) console.error(`Turnlink protocol v2 listening on ${url}`); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await broker.close(); process.exit(0); });
}
