import { authorizeWorktreeGrant, observeCodexDestinationOwners, observeCodexDestinationStepRecovery, authorizeCodexDestinationStep, authorizeCodexDestinationStepDisposal } from './worktree-authorization.js';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ControlStore } from './store.js';
import { Command, RETENTION_MS, WorktreeTransition, taskNeedsStopAttention } from './contracts.js';
import { ControlError, requireControl as check } from './policy.js';
import { digest, matches } from '../config.js';
import { codexVerifierLease, releaseCodexVerifierLease } from '../codex-verifier-lease.js';
import { MAX_RESPONSE_BYTES } from '../protocol.js';
import { PARTICIPANT_OPERATIONS, OPERATOR_OPERATIONS, ADAPTER_OPERATIONS } from './operations.js';
import { BROKER_EFFECT_OPERATIONS } from './effects.js';
import { readyTasks } from './reducer.js';
import { ControlArchives } from './archives.js';
import { StorageStatus, combinePressure, pressureLevel } from './storage-contracts.js';
import { ChannelAlerts, projectChannelAlerts } from './alert-contracts.js';
import { projectHealth } from './health.js';
import { CheckpointMetadata, CheckpointReservation, checkpointObservation } from './checkpoint-observation.js';
import { CheckpointGuestReceipt, codexCheckpointDestination } from './checkpoint-destination.js';
import { sessionEvidenceStatus, sessionRecord, completeSessionRecord, parseSessionJSON, isSessionRecordMessage } from '../session-evidence.js';

const participantOps = new Set(PARTICIPANT_OPERATIONS);
const operatorOps = new Set(OPERATOR_OPERATIONS);
const adapterOps = new Set(ADAPTER_OPERATIONS);
const masterOps = new Set(['action.request', 'incident.resolve', 'task.create', 'task.review', 'task.reassign', 'worktree.session_require', 'worktree.manual_preview']);

// All identity/clock/membership inputs below originate in the broker. No caller can provide an Actor or scheduler role.
export class ControlGateway {
  constructor({ directory, now, members, member, receiver, receiverHeld = () => false, receiverPlacement = () => undefined, manualPlacement = () => undefined, manualLocation = () => undefined, receiverHandoffEnabled = false, codexHandoffOnly = false, messages, hosts, adminDigest, options, effectsEnabled = false, worktreeGrants = false, managedRecords = false, taskDispatch = false, codexTasks = false, worktreeTaskDispatch = false, manualWorktreeOnly = false, runtimeAvailable = () => true }) {
    this.store = new ControlStore(directory, options);
    try { this.archives = new ControlArchives(join(directory, 'exports'), options?.exportLimits); }
    catch (error) { this.store.close(); throw error; }
    this.runtimeAvailable = runtimeAvailable;
    Object.assign(this, { now, members, member, receiver, messages, hosts, adminDigest });
    this.effectsEnabled = effectsEnabled;
    this.worktreeGrants = worktreeGrants;
    this.receiverHeld = receiverHeld;
    this.receiverPlacement = receiverPlacement;
    this.manualPlacement = manualPlacement; this.manualLocation = manualLocation;
    this.receiverHandoffEnabled = receiverHandoffEnabled;
    this.codexHandoffOnly = codexHandoffOnly;
    this.managedRecords = managedRecords;
    this.taskDispatch = taskDispatch;
    this.codexTasks = codexTasks;
    this.worktreeTaskDispatch = worktreeTaskDispatch;
    this.manualWorktreeOnly = manualWorktreeOnly;
    this.activityRunID = randomUUID(); this.activityStartedAt = now(); this.activityFailures = 0; this.activityPruneFailed = false;
    this.healthReceivers = new Map();
  }
  manualResumeCandidate(socket, params, { requireComplete = false } = {}) {
    check(this.worktreeGrants && this.runtimeAvailable(), 'MANUAL_RESUME_UNAVAILABLE');
    const coordinator = this.boundMember(socket.principal, params.agentId, params.proof, params.channel);
    const state = this.store.snapshot(), channel = state.channels.find(value => value.id === params.channel);
    const now = this.now(); check(now >= state.lastNow, 'CLOCK_REGRESSION');
    check(channel?.active?.agentId === coordinator.agentId && channel.active.expiresAt > now &&
      this.members().some(m => m.agentId === coordinator.agentId && m.channel === params.channel && m.connected) &&
      this.store.offerAccepted(params.channel, coordinator.agentId, channel.active.id), 'MANUAL_RESUME_UNAVAILABLE');
    const task = state.tasks.find(value => value.id === params.taskID && value.channel === params.channel);
    const preview = [...state.previews].reverse().find(value => value.taskID === params.taskID && value.agentId === task?.claimant);
    check(task?.status === 'claimed' && task.requiresWorktree && preview?.id === params.previewID && preview.manualResume === true &&
      preview.approved && preview.sessionCoordinator === coordinator.agentId && preview.claimGeneration === task.claimGeneration,
    'MANUAL_RESUME_UNAVAILABLE');
    const record = this.manualResumeRecord(task, preview);
    check(!!record && (!requireComplete || completeSessionRecord(sessionRecord.parse(parseSessionJSON(record.text)))), 'MANUAL_RESUME_UNAVAILABLE');
    return { task, preview, coordinator: coordinator.agentId, recordID: record.id };
  }
  manualResumeRecord(task, preview, recordID) {
    const candidate = [...this.messages()].reverse().find(message => {
      if (message.channel !== task.channel || message.from.agentId !== task.claimant || message.to !== preview.sessionCoordinator) return false;
      if (recordID !== undefined && message.id !== recordID) return false;
      return isSessionRecordMessage(message.text, task.id, preview.id);
    });
    if (!candidate) return;
    const parsed = sessionRecord.safeParse(parseSessionJSON(candidate.text));
    if (parsed.success && parsed.data.runtime !== null && parsed.data.session === task.claimant && parsed.data.source === preview.from && parsed.data.destination === preview.to) return candidate;
  }
  manualResumeReview(params) {
    check(this.worktreeGrants && this.runtimeAvailable(), 'MANUAL_RESUME_UNAVAILABLE');
    const state = this.store.snapshot(), task = state.tasks.find(value => value.id === params.taskID && value.channel === params.channel);
    const preview = [...state.previews].reverse().find(value => value.taskID === params.taskID && value.agentId === task?.claimant);
    check(task && task.status !== 'open' && task.requiresWorktree && preview?.id === params.previewID && preview.manualResume === true &&
      preview.approved && preview.sessionCoordinator && preview.claimGeneration === task.claimGeneration, 'MANUAL_RESUME_UNAVAILABLE');
    const observation = this.manualPlacement(task.claimant);
    check(observation && !observation.pendingTakeover && observation.taskID === task.id && observation.previewID === preview.id && observation.channel === task.channel &&
      observation.claimGeneration === task.claimGeneration && observation.coordinator === preview.sessionCoordinator &&
      observation.from === preview.from && observation.to === preview.to, 'MANUAL_RESUME_UNAVAILABLE');
    const baselineMessage = this.manualResumeRecord(task, preview, observation.recordID);
    const sourceRecord = baselineMessage ? sessionRecord.parse(parseSessionJSON(baselineMessage.text)) : null;
    let report = sessionEvidenceStatus(this.messages().filter(m => m.channel === task.channel).slice().reverse(),
      { task, preview, owner: preview.sessionCoordinator });
    if (report.status === 'reported_match') {
      const candidate = this.manualResumeRecord(task, preview, report.recordID);
      if (!baselineMessage || !candidate || baselineMessage.text !== candidate.text)
        report = { status: 'invalid_record', reason: 'record_differs_from_baseline', agentReported: true };
    }
    const connected = this.members().some(member => member.agentId === task.claimant && member.channel === task.channel && member.connected);
    return { task, preview, observation, sourceRecord, report, connected, location: this.manualLocation(task.claimant) };
  }
  async verifiedCheckpointObservation(socket, params, verifier, signal) {
    const grant = WorktreeTransition.parse(params.grant), reservation = CheckpointReservation.parse(params.reservation);
    check(this.worktreeGrants && this.runtimeAvailable() && !signal.aborted &&
      params.channel === grant.channel && params.agentId === grant.agentId, 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
    const initialAgent = this.adapter(socket, params, grant.channel);
    const prior = this.store.checkpointObservation(params.requestID);
    if (prior) {
      const expected = checkpointObservation({ requestID: params.requestID, hostId: initialAgent.hostId, grant,
        metadata: prior.metadata, recordedAt: prior.recordedAt });
      check(JSON.stringify(prior) === JSON.stringify(expected) && JSON.stringify(prior.metadata.reservation) === JSON.stringify(reservation), 'CHECKPOINT_OBSERVATION_CONFLICT');
      const destination = this.store.checkpointDestination(params.requestID);
      return { observation: prior, historical: true, ...(destination ? { destination, recoveryStatus: destination.status === 'pending' ? 'uncertain' : destination.status } : {}) };
    }
    check(typeof verifier === 'function', 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
    const snapshot = () => {
      check(!signal.aborted && this.worktreeGrants && this.runtimeAvailable(), 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
      const agent = this.adapter(socket, params, grant.channel);
      const observed = authorizeWorktreeGrant(this.store.snapshot(), grant, agent, this.now(), this.members(), 'checkpoint-inspect');
      check(agent.hostId === initialAgent.hostId && JSON.stringify(observed.grant) === JSON.stringify(grant), 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
      return agent;
    };
    snapshot();
    const proof = await verifier({ grant, reservation, hostId: initialAgent.hostId, signal });
    try {
      const metadata = CheckpointMetadata.parse(proof), lease = proof?.[codexVerifierLease];
      const stage = proof?.[codexCheckpointDestination];
      check(JSON.stringify(metadata.reservation) === JSON.stringify(reservation) && typeof lease?.check === 'function' &&
        typeof lease?.release === 'function', 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
      if (params.stageDestination) check(stage && /^[a-f0-9]{64}$/.test(stage.vmInstance || '') && typeof stage.dispatch === 'function', 'CHECKPOINT_DESTINATION_UNAVAILABLE');
      const assertCurrent = () => {
        snapshot();
        const checked = lease.check();
        if (checked && typeof checked.then === 'function') { Promise.resolve(checked).catch(() => {}); check(false, 'CHECKPOINT_OBSERVATION_UNAVAILABLE'); }
        check(checked === undefined || checked === true, 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
      };
      assertCurrent();
      const observation = checkpointObservation({ requestID: params.requestID, hostId: initialAgent.hostId, grant, metadata, recordedAt: this.now() });
      const recorded = this.store.recordCheckpointObservation(observation, assertCurrent);
      if (!params.stageDestination || recorded.historical) return recorded;
      const intent = this.store.beginCheckpointDestination({ version: 1, requestID: params.requestID, transitionID: grant.id,
        vmInstance: stage.vmInstance, checkpointDigest: metadata.digest, status: 'pending', startedAt: this.now() }, assertCurrent);
      if (intent.historical) return { ...recorded, historical: true, destination: intent.destination,
        recoveryStatus: intent.destination.status === 'pending' ? 'uncertain' : intent.destination.status };
      try {
        assertCurrent();
        const receipt = CheckpointGuestReceipt.parse(await stage.dispatch());
        assertCurrent();
        const destination = this.store.finishCheckpointDestination(params.requestID, receipt, this.now(), assertCurrent);
        return { ...recorded, destination, recoveryStatus: 'quarantined' };
      } catch {
        try { this.store.markCheckpointDestinationUncertain(params.requestID, this.now()); } catch { /* pending remains uncertain */ }
        throw new Error('CHECKPOINT_DESTINATION_UNCERTAIN');
      }
    } finally { releaseCodexVerifierLease(proof); }
  }
  capabilities() { return { effectsEnabled: this.effectsEnabled, effectOperations: this.effectsEnabled ? BROKER_EFFECT_OPERATIONS : [], taskDispatchEnabled: this.taskDispatch,
    taskExecutionHarnesses: this.taskDispatch ? ['opencode', ...(this.codexTasks ? ['codex'] : [])] : [], taskWorktreesEnabled: this.worktreeTaskDispatch,
    manualResumeEnabled: this.worktreeTaskDispatch, manualWorktreeOnlyEnabled: this.manualWorktreeOnly,
    worktreeGrantsEnabled: this.worktreeGrants, worktreeExecutionEnabled: false,
    receiverHandoffHarnesses: this.receiverHandoffEnabled ? (this.codexHandoffOnly ? ['codex'] : ['opencode', 'codex']) : [],
    providerEstablishmentGrantsEnabled: this.worktreeGrants, providerEstablishmentExecutionEnabled: false,
    mcpEstablishmentGrantsEnabled: this.worktreeGrants, mcpEstablishmentExecutionEnabled: false,
    managedWorktreeRecordsEnabled: this.managedRecords, managedWorktreeExecutionEnabled: false, adapterHealthSupported: true, operatorNotificationsSupported: true }; }
  storageStatus() {
    const checkedAt = this.now(), controlAvailable = this.runtimeAvailable();
    try {
      const report = this.store.storageStatus(), exports = this.archives.usage();
      for (const [resource, used, limit] of [['export_count', exports.count, exports.countLimit], ['export_bytes', exports.bytes, exports.byteLimit]])
        report.quotas.push({ resource, used, limit, level: pressureLevel(used, limit) });
      const activity = this.store.activityStatus();
      report.quotas.push({ resource: 'telemetry_rows', used: activity.rows, limit: activity.limit, level: pressureLevel(activity.rows, activity.limit) });
      if (activity.rejected || this.activityFailures || this.activityPruneFailed)
        report.quotas.push({ resource: 'telemetry_health', used: 1, limit: 1, level: 'critical' });
      if (!controlAvailable) report.quotas.push({ resource: 'control_runtime', used: 1, limit: 1, level: 'critical' });
      return StorageStatus.parse({ version: 1, checkedAt, controlAvailable, ...report, pressure: combinePressure(report.quotas) });
    } catch {
      return StorageStatus.parse({ version: 1, checkedAt, controlAvailable, pressure: { level: 'unavailable', resources: ['control_runtime'] }, quotas: [] });
    }
  }
  signalStorage(sockets, send) {
    const watching = [...sockets].filter(s => s.principal?.admin && s.storageWatch === true);
    if (!watching.length) return;
    const status = this.storageStatus(), signature = JSON.stringify(status.pressure);
    for (const socket of watching) if (socket.storageSignature !== signature) {
      send(socket, { event: 'control_storage', status }); socket.storageSignature = signature;
    }
  }
  observeActivity(fields) {
    try {
      this.store.recordActivity({ ...fields, id: randomUUID(), runID: this.activityRunID, at: this.now() }, this.activityFailures);
      this.activityFailures = 0;
    }
    catch { this.activityFailures = Math.min(Number.MAX_SAFE_INTEGER, this.activityFailures + 1); }
  }
  maintainActivity() {
    const now = this.now();
    if (this.activityPruneAt !== undefined && now >= this.activityPruneAt && now - this.activityPruneAt < 60000) return;
    this.activityPruneAt = now;
    try {
      const state = this.store.snapshot(), pins = new Set();
      // Cancellation/disconnect is not native stop proof. Retain exposed or
      // legacy-unknown undelivered messages even after membership removal.
      for (const message of this.messages()) if (message.recipients.some(id => !message.delivered.includes(id) &&
        (!message.cancelled[id] || !Array.isArray(message.offered) || message.offered.includes(id)))) pins.add(message.id);
      for (const item of state.evidence) pins.add(item.entityID);
      for (const item of state.incidents.filter(i => i.status === 'open')) if (item.entityID) pins.add(item.entityID);
      for (const item of state.actions.filter(a => !['succeeded', 'failed', 'rejected'].includes(a.status))) if (item.messageID) pins.add(item.messageID);
      this.store.pruneActivity(now, [...pins], this.activityFailures); this.activityFailures = 0; this.activityPruneFailed = false;
      const agents = new Set(state.evidence.map(e => e.agentId));
      for (const t of state.tasks.filter(t => t.terminalHold || !['completed', 'cancelled'].includes(t.status))) if (t.claimant) agents.add(t.claimant);
      for (const a of state.actions.filter(a => !['succeeded', 'failed', 'rejected'].includes(a.status))) agents.add(a.target);
      // Evidence-linked snapshots are retained; health itself never serves as evidence.
      for (const m of this.members()) agents.add(m.agentId);
      this.store.pruneHealth(now, [...agents]);
    } catch { this.activityPruneFailed = true; } // Unknown protection set means no pruning, never an empty guess.
  }
  activityStatus() {
    const scope = { coverage: 'observational', runID: this.activityRunID, startedAt: this.activityStartedAt,
      retentionMs: RETENTION_MS, unpersisted: this.activityFailures, pruningAvailable: !this.activityPruneFailed };
    try { return { ...scope, available: true, ...this.store.activityStatus() }; }
    catch { return { ...scope, available: false }; }
  }
  alerts(socket, params) {
    check(!socket.principal.admin, 'PARTICIPANT_REQUIRED');
    const member = this.boundMember(socket.principal, params.agentId, params.proof, params.channel);
    const state = this.store.snapshot(), channel = state.channels.find(c => c.id === params.channel), now = this.now();
    check(now >= state.lastNow, 'CLOCK_REGRESSION'); check(channel, 'CHANNEL_NOT_CONFIGURED');
    const reviewAuthority = channel.active?.agentId === member.agentId && channel.active.expiresAt > now &&
      this.members().some(m => m.agentId === member.agentId && m.channel === channel.id && m.connected) &&
      this.store.offerAccepted(channel.id, member.agentId, channel.active.id);
    return ChannelAlerts.parse({ version: 1, agentId: member.agentId, channel: channel.id, checkedAt: now,
      controlAvailable: this.runtimeAvailable(), pressure: this.storageStatus().pressure,
      ...projectChannelAlerts(state, channel, member.agentId, now, !!reviewAuthority) });
  }
  context(actor) { return { actor, now: this.now(), members: this.members() }; }
  boundMember(principal, agentId, proof, channel) {
    try { return this.member(principal, agentId, proof, channel); }
    catch { throw new ControlError('CONTROL_ACCESS_DENIED'); }
  }
  authorizeMasterMessage(socket, params, channel) {
    const agent = this.boundMember(socket.principal, params.agentId, params.proof, channel);
    const state = this.store.snapshot(), active = state.channels.find(value => value.id === channel)?.active;
    const now = this.now(); check(now >= state.lastNow, 'CLOCK_REGRESSION');
    check(active?.agentId === agent.agentId && active.generation === params.masterGeneration && active.expiresAt > now &&
      this.members().some(member => member.agentId === agent.agentId && member.channel === channel && member.connected) &&
      this.store.offerAccepted(channel, agent.agentId, active.id), 'STALE_MASTER');
  }
  page(values, offset = 0, limit = 30) {
    const entries = []; let bytes = 256;
    for (const entry of values.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(entry));
      check(size <= MAX_RESPONSE_BYTES - 4096, 'CONTROL_ITEM_TOO_LARGE');
      if (bytes + size > MAX_RESPONSE_BYTES - 4096) break;
      entries.push(entry); bytes += size;
    }
    return { entries, next: offset + entries.length };
  }
  adapter(socket, params, channel) {
    check(!socket.principal.admin, 'ADAPTER_HOST_REQUIRED');
    const agent = this.boundMember(socket.principal, params.agentId, params.proof, channel);
    check(this.receiver(agent.agentId) === socket, 'ADAPTER_RECEIVER_REQUIRED');
    const credentialDigest = this.store.adapterDigest(socket.principal.hostId);
    check(!!credentialDigest && matches(params.credential, credentialDigest), 'ADAPTER_CREDENTIAL_REQUIRED');
    return agent;
  }
  // A candidate is not the receiver yet. This check only permits it to offer
  // a transport key; the current receiver must separately commit the swap.
  receiverCandidate(socket, params) {
    check(!socket.principal.admin && this.worktreeGrants, 'RECEIVER_HANDOFF_UNAVAILABLE');
    const agent = this.boundMember(socket.principal, params.agentId, params.proof, params.channel);
    check(!this.codexHandoffOnly || agent.harness === 'codex', 'OPENCODE_HANDOFF_DISABLED');
    check(this.receiver(agent.agentId) && this.receiver(agent.agentId) !== socket, 'RECEIVER_HANDOFF_UNAVAILABLE');
    const credentialDigest = this.store.adapterDigest(socket.principal.hostId);
    check(!!credentialDigest && matches(params.credential, credentialDigest), 'ADAPTER_CREDENTIAL_REQUIRED');
    const observed = authorizeWorktreeGrant(this.store.snapshot(), params.grant, agent, this.now(), this.members(),
      params.grant?.destinationOwners ? 'handoff-receiver' : undefined);
    check(observed.grant.purpose === undefined, 'WORKTREE_EFFECT_SCOPE_MISMATCH');
    return { ...observed, credentialDigest };
  }
  // A broker-owned recovery path can validate an unsubscribed candidate while
  // preserving all grant and adapter checks. This does not rotate a receiver.
  receiverRecoveryCandidate(socket, params) {
    check(!socket.principal.admin && this.worktreeGrants, 'RECEIVER_HANDOFF_UNAVAILABLE');
    const agent = this.boundMember(socket.principal, params.agentId, params.proof, params.channel);
    check(!this.codexHandoffOnly || agent.harness === 'codex', 'OPENCODE_HANDOFF_DISABLED');
    check(!this.receiver(agent.agentId), 'RECEIVER_HANDOFF_UNAVAILABLE');
    const credentialDigest = this.store.adapterDigest(socket.principal.hostId);
    check(!!credentialDigest && matches(params.credential, credentialDigest), 'ADAPTER_CREDENTIAL_REQUIRED');
    // The authenticated candidate is connected but not yet a subscription.
    const members = this.members().map(member => member.agentId === agent.agentId ? { ...member, connected: true } : member);
    const state = this.store.snapshot();
    const grant = WorktreeTransition.parse(params.grant);
    const task = state.tasks.find(item => item.id === grant.taskID && item.channel === grant.channel);
    check(task?.status === 'claimed' && task.claimant === agent.agentId && task.claimGeneration === grant.claimGeneration && !task.terminalHold, 'STALE_TASK_CLAIM');
    // Recovery merely installs a held receiver. It cannot execute movement,
    // so the disconnected owner's invalidated idle evidence is not a receipt.
    const observed = authorizeWorktreeGrant(state, grant, agent, this.now(), members, 'observe-worktree');
    check(observed.grant.purpose === undefined, 'WORKTREE_EFFECT_SCOPE_MISMATCH');
    return { ...observed, credentialDigest };
  }
  receiverRelease(socket, params, hold) {
    const agent = this.adapter(socket, params, params.channel);
    check(!this.codexHandoffOnly, 'RECEIVER_HANDOFF_UNAVAILABLE');
    check(this.worktreeGrants && hold && hold.transitionID === params.transitionID && hold.channel === agent.channel, 'RECEIVER_HANDOFF_UNAVAILABLE');
    if (hold.status === 'released') return;
    check(hold.sourceDetached === true, 'RECEIVER_HANDOFF_UNAVAILABLE');
    const state = this.store.snapshot();
    const transition = state.transitions.find(value => value.id === hold.transitionID && value.agentId === agent.agentId && value.channel === hold.channel);
    const task = state.tasks.find(value => value.id === hold.taskID && value.channel === hold.channel);
    const preview = [...state.previews].reverse().find(value => value.taskID === hold.taskID && value.agentId === agent.agentId);
    check(transition?.status === 'moved' && transition.receiptID && transition.actualLocation === hold.to &&
      transition.taskID === hold.taskID && transition.previewID === hold.previewID && transition.claimGeneration === hold.claimGeneration &&
      transition.from === hold.from && transition.to === hold.to && transition.configurationDigest === hold.configurationDigest &&
      transition.authorityDigest === hold.authorityDigest && !transition.purpose && task?.claimant === agent.agentId &&
      task.status === 'claimed' && task.claimGeneration === hold.claimGeneration && preview?.id === hold.previewID && preview.approved === true,
    'RECEIVER_HANDOFF_UNAVAILABLE');
  }
  async verifiedMcpCleanup(socket, params, verifier, signal) {
    const command = Command.parse(params.command);
    check(command.op === 'worktree.settle' && command.purpose === 'establish-mcp' && command.cleanupReceipt && command.outcome === 'failed' && typeof verifier === 'function', 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
    check(!signal.aborted && this.worktreeGrants && this.runtimeAvailable(), 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
    const agent = this.adapter(socket, params, command.channel);
    const replay = this.store.replayCommitted(command, { kind: 'adapter', agentId: agent.agentId });
    if (replay) return { ...replay, ...this.capabilities() };
    const snapshot = () => {
      check(!signal.aborted && this.worktreeGrants && this.runtimeAvailable(), 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
      const agent = this.adapter(socket, params, command.channel);
      const grant = this.store.snapshot().transitions.find(value => value.id === command.transitionID && value.agentId === agent.agentId && value.channel === command.channel);
      check(grant?.purpose === 'establish-mcp', 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
      const authorized = authorizeWorktreeGrant(this.store.snapshot(), grant, agent, this.now(), this.members(), 'cleanup-mcp');
      return { agent, grant: authorized.grant };
    };
    const before = snapshot();
    const proof = await verifier({ grant: structuredClone(before.grant), hostId: before.agent.hostId, signal });
    try {
      const after = snapshot(), lease = proof?.[codexVerifierLease];
      check(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(proof) === JSON.stringify(command.cleanupReceipt) &&
        typeof lease?.check === 'function' && typeof lease?.release === 'function', 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
      const checked = lease.check();
      if (checked && typeof checked.then === 'function') {
        Promise.resolve(checked).catch(() => {});
        check(false, 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
      }
      check(checked === undefined || checked === true, 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
      return this.command(socket, params, true, true);
    } finally { releaseCodexVerifierLease(proof); }
  }
  async verifiedDestinationCancellation(socket, params, verifier, signal) {
    const command = Command.parse(params.command);
    check(command.op === 'worktree.settle' && command.outcome === 'failed' && command.destinationCancellation &&
      typeof verifier === 'function', 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
    check(!signal.aborted && this.worktreeGrants && this.runtimeAvailable(), 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
    const agent = this.adapter(socket, params, command.channel);
    const replay = this.store.replayCommitted(command, { kind: 'adapter', agentId: agent.agentId });
    if (replay) return { ...replay, ...this.capabilities() };
    const snapshot = () => {
      check(!signal.aborted && this.worktreeGrants && this.runtimeAvailable(), 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
      const agent = this.adapter(socket, params, command.channel);
      const grant = this.store.snapshot().transitions.find(value => value.id === command.transitionID && value.agentId === agent.agentId && value.channel === command.channel);
      check(grant?.destinationOwners && grant.destinationOwners.stepID === command.destinationCancellation.stepID, 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
      return { agent, grant: authorizeWorktreeGrant(this.store.snapshot(), grant, agent, this.now(), this.members(), 'cancel-destination-grant').grant };
    };
    const before = snapshot();
    const proof = await verifier({ grant: structuredClone(before.grant), receipt: structuredClone(command.destinationCancellation), hostId: before.agent.hostId, signal });
    try {
      const after = snapshot(), lease = proof?.[codexVerifierLease];
      check(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(proof) === JSON.stringify(command.destinationCancellation) &&
        typeof lease?.check === 'function' && typeof lease?.release === 'function', 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
      const checked = lease.check();
      if (checked && typeof checked.then === 'function') {
        Promise.resolve(checked).catch(() => {});
        check(false, 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
      }
      check(checked === undefined || checked === true, 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
      return this.command(socket, params, true, false, true);
    } finally { releaseCodexVerifierLease(proof); }
  }
  command(socket, params, adapter = false, verifiedMcpCleanup = false, verifiedDestinationCancellation = false) {
    const command = Command.parse(params.command);
    let actor;
    if (adapter) {
      const agent = this.adapter(socket, params, command.channel);
      if (this.codexHandoffOnly && agent.harness !== 'codex' && ['worktree.begin', 'worktree.settle'].includes(command.op))
        check(false, 'OPENCODE_HANDOFF_DISABLED');
      check(adapterOps.has(command.op), 'CONTROL_OPERATION_DISABLED'); actor = { kind: 'adapter', agentId: agent.agentId };
      if (['worktree.begin', 'worktree.settle'].includes(command.op)) check(this.worktreeGrants, 'WORKTREE_GRANTS_DISABLED');
      // Native MCP quiescence is not proof of physical owner release. There is
      // no native MCP cleanup receipt issuer yet, so a caller-supplied receipt
      // must not clear the broker's retained-resource hold.
      if (command.op === 'worktree.settle' && command.purpose === 'establish-mcp' && command.cleanupReceipt && !verifiedMcpCleanup)
        check(false, 'MCP_CLEANUP_VERIFICATION_UNAVAILABLE');
      if (command.op === 'worktree.settle' && command.destinationCancellation && !verifiedDestinationCancellation) {
        // An exact durable replay cannot perform a new settlement. It remains
        // available after verifier loss or broker restart, but a changed or
        // previously uncommitted command still requires fresh native proof.
        const replay = this.store.replayCommitted(command, actor);
        if (replay) return { ...replay, ...this.capabilities() };
        check(false, 'DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
      }
      if (command.op.startsWith('managed.')) {
        check(this.managedRecords, 'MANAGED_WORKTREE_RECORDS_DISABLED');
        if (command.op === 'managed.preview') check(command.hostId === socket.principal.hostId, 'MANAGED_HOST_MISMATCH');
        else {
          const value = this.store.snapshot().managedPreviews.find(v => v.id === command.previewID && v.channel === command.channel);
          check(value?.hostId === socket.principal.hostId, 'MANAGED_HOST_MISMATCH');
        }
      }
      if (command.op === 'master.renew') {
        const active = this.store.snapshot().channels.find(c => c.id === command.channel)?.active;
        check(active?.agentId === agent.agentId && this.store.offerAccepted(command.channel, agent.agentId, active.id), 'ROLE_NOTICE_NOT_ADMITTED');
      }
    } else if (socket.principal.admin) {
      check(operatorOps.has(command.op), 'CONTROL_OPERATION_DISABLED'); actor = { kind: 'operator' };
      if (command.op.startsWith('managed.')) check(this.managedRecords, 'MANAGED_WORKTREE_RECORDS_DISABLED');
    } else {
      const agent = this.boundMember(socket.principal, params.agentId, params.proof, command.channel);
      check(participantOps.has(command.op), 'CONTROL_OPERATION_DISABLED'); actor = { kind: 'participant', agentId: agent.agentId };
      if (['worktree.manual_preview', 'worktree.session_require'].includes(command.op)) check(this.worktreeGrants, 'WORKTREE_GRANTS_DISABLED');
      if (command.op === 'worktree.session_require') {
        const state = this.store.snapshot(), task = state.tasks.find(value => value.id === command.taskID && value.channel === command.channel);
        const observation = task?.claimant && this.manualPlacement(task.claimant);
        // Changing the preview alone would orphan the broker's observation,
        // which is bound to the original coordinator and its record. Until a
        // verified takeover exists, retain the original recovery path.
        if (observation?.taskID === command.taskID && observation.previewID === command.previewID &&
            observation.channel === command.channel && observation.claimGeneration === task.claimGeneration)
          check(observation.coordinator === agent.agentId, 'MANUAL_RESUME_COORDINATOR_HELD');
      }
      if (command.op === 'master.accept') check(this.store.offerAccepted(command.channel, agent.agentId, command.proposalID), 'ROLE_NOTICE_NOT_ADMITTED');
      if (masterOps.has(command.op)) {
        const active = this.store.snapshot().channels.find(c => c.id === command.channel)?.active;
        check(active?.agentId === agent.agentId && this.store.offerAccepted(command.channel, agent.agentId, active.id), 'ROLE_NOTICE_NOT_ADMITTED');
      }
    }
    // Models cannot invoke execution, reconciliation or adapter worktree grants;
    // native task dispatch uses the separately enabled receiver-only pull path.
    const result = this.store.apply(command, this.context(actor), params.expected, params.expectedTask);
    if (['task.claim', 'task.review', 'task.missed', 'task.report', 'task.reassign'].includes(command.op)) {
      const task = this.store.snapshot().tasks.find(t => t.id === command.taskID);
      this.onTaskChanged?.(task);
    }
    return { ...result, ...this.capabilities() };
  }
  worktreeTaskReady(state, task, cwd) {
    if (!task.requiresWorktree) return true;
    const manual = this.manualPlacement?.(task.claimant), preview = [...state.previews].reverse().find(p => p.taskID === task.id && p.agentId === task.claimant);
    if (preview?.manualResume) {
      if (!this.worktreeTaskDispatch || !manual || manual.status !== 'confirmed' || manual.sourceStopped !== true || !manual.receiptID ||
          manual.taskID !== task.id || manual.previewID !== preview.id || manual.channel !== task.channel || manual.claimGeneration !== task.claimGeneration ||
          manual.coordinator !== preview.sessionCoordinator || manual.from !== preview.from || manual.to !== preview.to || !preview.approved ||
          this.manualLocation(task.claimant) !== manual.to || (cwd !== undefined && cwd !== manual.to) ||
          !this.members().some(member => member.agentId === task.claimant && member.channel === task.channel && member.connected)) return false;
      const report = sessionEvidenceStatus(this.messages().filter(m => m.channel === task.channel).slice().reverse(), { task, preview, owner: manual.coordinator });
      return report.status === 'reported_match' && report.recordID === (manual.reportRecordID || manual.recordID) && report.requestID === manual.requestID;
    }
    if (this.manualWorktreeOnly) return false;
    const hold = this.receiverPlacement(task.claimant);
    if (!this.worktreeTaskDispatch || !hold || hold.status !== 'released' || !hold.sourceDetached ||
      hold.taskID !== task.id || hold.claimGeneration !== task.claimGeneration || hold.channel !== task.channel ||
      (cwd !== undefined && cwd !== hold.to)) return false;
    const transition = state.transitions.find(t => t.id === hold.transitionID && t.channel === task.channel && t.agentId === task.claimant);
    if (preview?.sessionCoordinator && sessionEvidenceStatus(this.messages().filter(m => m.channel === task.channel).slice().reverse(),
      { task, preview, owner: preview.sessionCoordinator }).status !== 'reported_match') return false;
    return !!transition && transition.status === 'moved' && !!transition.receiptID && transition.taskID === task.id &&
      !transition.purpose && transition.claimGeneration === task.claimGeneration && transition.previewID === hold.previewID && transition.from === hold.from && transition.to === hold.to &&
      transition.actualLocation === hold.to && transition.configurationDigest === hold.configurationDigest &&
      transition.authorityDigest === hold.authorityDigest && preview?.id === hold.previewID && preview.approved === true && !preview.purpose &&
      preview.claimGeneration === task.claimGeneration && preview.from === hold.from && preview.to === hold.to && preview.configurationDigest === hold.configurationDigest;
  }
  pullTask(socket, params) {
    const agent = this.adapter(socket, params, params.channel);
    check(this.taskDispatch && (agent.harness === 'opencode' || (agent.harness === 'codex' && this.codexTasks)), 'TASK_DISPATCH_DISABLED');
    if (this.receiverHeld(agent.agentId)) return { task: null, held: true };
    const state = this.store.snapshot();
    if (state.tasks.some(t => t.channel === agent.channel && t.claimant === agent.agentId && t.terminalHold)) return { task: null, held: true };
    const active = state.tasks.find(t => t.channel === agent.channel && t.claimant === agent.agentId && ['dispatching', 'running', 'uncertain'].includes(t.status));
    if (active) return this.worktreeTaskReady(state, active, params.cwd) && (!active.requiresWorktree ||
      (active.executionScope?.cwd === params.cwd && active.executionScope?.digest === params.scopeDigest)) ? { task: active, prepared: false } : { task: null, held: true };
    const next = readyTasks(state, agent.channel, this.now()).find(t => t.claimant === agent.agentId && this.worktreeTaskReady(state, t, params.cwd));
    if (!next) return { task: null };
    const context = this.context({ kind: 'adapter', agentId: agent.agentId });
    const capabilityID = randomUUID();
    this.store.apply({ id: capabilityID, op: 'evidence.record', channel: agent.channel, entityID: next.id, kind: 'capability', sameConversationWorktree: next.requiresWorktree }, context);
    this.store.apply({ id: randomUUID(), op: 'evidence.record', channel: agent.channel, entityID: next.id, kind: 'idle' }, context);
    try {
      const preview = next.requiresWorktree && [...state.previews].reverse().find(p => p.taskID === next.id && p.agentId === next.claimant);
      const manual = preview?.manualResume ? this.manualPlacement(next.claimant) : undefined;
      const scheduler = { ...this.context({ kind: 'scheduler' }), ...(manual?.status === 'confirmed' ?
        { manualResume: { taskID: next.id, previewID: preview.id, receiptID: manual.receiptID } } : {}) };
      this.store.apply({ id: randomUUID(), op: 'task.prepare', channel: agent.channel, taskID: next.id, capabilityEvidenceID: capabilityID,
        cwd: params.cwd, scopeDigest: params.scopeDigest }, scheduler);
    } catch (error) {
      if (error instanceof ControlError && ['CONVERSATION_CAPACITY', 'CHANNEL_CAPACITY', 'WORKTREE_TRANSITION_UNRESOLVED'].includes(error.code)) return { task: null };
      throw error;
    }
    return { task: this.store.snapshot().tasks.find(t => t.id === next.id), prepared: true };
  }
  signalReadyTasks() {
    if (!this.taskDispatch) return;
    const state = this.store.snapshot(), next = new Set(), owners = new Map();
    for (const channel of state.channels) for (const task of readyTasks(state, channel.id, this.now()).filter(t => !this.receiverHeld(t.claimant) && this.worktreeTaskReady(state, t))) {
      const key = `${task.id}:${task.claimGeneration}:${task.attempt}:${task.missedDecision || ''}`;
      if (this.taskSignals?.has(key) || this.onTaskChanged?.(task)) { next.add(key); owners.set(key, task.claimant); }
    }
    this.taskSignals = next; this.taskSignalOwners = owners;
  }
  // Handoff can complete between scheduler ticks. Forget only the old
  // receiver's signals so a fast release can wake its new receiver again.
  forgetTaskSignals(agentId) {
    if (!this.taskSignals || !this.taskSignalOwners) return;
    for (const [key, owner] of this.taskSignalOwners) if (owner === agentId) {
      this.taskSignals.delete(key); this.taskSignalOwners.delete(key);
    }
  }
  forgetReceiverHealth(agentId) { this.healthReceivers.delete(agentId); }
  query(socket, params) {
    const agent = socket.principal.admin ? undefined : this.boundMember(socket.principal, params.agentId, params.proof, params.channel);
    const state = this.store.snapshot(), channel = state.channels.find(c => c.id === params.channel);
    check(this.now() >= state.lastNow, 'CLOCK_REGRESSION');
    check(!!channel, 'CHANNEL_NOT_CONFIGURED');
    const verifiedActive = channel.active && channel.active.expiresAt > this.now() &&
      this.members().some(m => m.agentId === channel.active.agentId && m.channel === params.channel) &&
      this.store.offerAccepted(params.channel, channel.active.agentId, channel.active.id) ? channel.active : null;
    const master = agent && verifiedActive?.agentId === agent.agentId &&
      this.members().some(m => m.agentId === agent.agentId && m.channel === params.channel && m.connected);
    if (params.view === 'channel') {
      return { channel: { ...channel, active: verifiedActive },
        members: this.members().filter(m => m.channel === params.channel), ...this.capabilities() };
    }
    if (params.view === 'messages') {
      check(socket.principal.admin || (master && params.generation === channel.active.generation), 'MASTER_MESSAGE_ACCESS_REQUIRED');
      const result = this.page(this.messages().filter(m => m.channel === params.channel).slice().reverse(), params.offset, params.limit);
      if (result.entries.length) this.store.recordMessageAccess(params.channel, socket.principal.admin ? { kind: 'operator' } : { kind: 'participant', agentId: agent.agentId },
        result.entries.at(-1).id, this.now(), master ? channel.active.generation : undefined);
      return result;
    }
    if (params.view === 'notices') {
      const recipient = agent?.agentId || (socket.principal.admin ? params.agentId : undefined);
      check(!!recipient, 'NOTICE_RECIPIENT_REQUIRED');
      const result = this.store.notices(params.channel, recipient, { after: params.after, limit: params.limit });
      const bounded = this.page(result.entries, 0, params.limit);
      return { entries: bounded.entries, next: bounded.entries.at(-1)?.sequence ?? (params.after || 0) };
    }
    if (params.view === 'events') {
      const result = this.store.events(params.channel, { after: params.after, limit: params.limit });
      const bounded = this.page(result.entries, 0, params.limit);
      return { entries: bounded.entries, next: bounded.entries.at(-1)?.sequence ?? (params.after || 0) };
    }
    if (params.view === 'health') {
      const rows = this.store.health(params.channel), members = this.members().filter(m => m.channel === params.channel);
      const ids = new Set([...rows.map(r => r.agentId), ...members.map(m => m.agentId)]);
      const values = [...ids].sort().filter(id => socket.principal.admin || master || id === agent.agentId).map(agentId => projectHealth({ agentId,
        channel: params.channel, connected: members.some(m => m.agentId === agentId && m.connected), record: rows.find(r => r.agentId === agentId),
        currentReceiver: !!this.receiver(agentId) && this.healthReceivers.get(agentId) === this.receiver(agentId),
        runID: this.activityRunID, now: this.now(), uncertainTasks: state.tasks.filter(t => t.channel === params.channel && t.claimant === agentId && taskNeedsStopAttention(t)).length }));
      return { ...this.page(values, params.offset, params.limit), observedAt: this.now(), coverage: 'observational' };
    }
    const values = state[params.view].filter(value => value.channel === params.channel && (!params.entityID || value.id === params.entityID));
    if (['previews', 'transitions', 'evidence', 'managedPreviews'].includes(params.view)) return this.page(socket.principal.admin || master ? values : values.filter(v => v.agentId === agent.agentId), params.offset, params.limit);
    // Tasks/incident metadata is shared channel coordination data; action targets/evidence are visible only to the operator/master/requester.
    return this.page(params.view === 'actions' && !socket.principal.admin && !master ? values.filter(a => a.requester === agent.agentId) : values,
      params.offset, params.limit);
  }
  handle(socket, method, params) {
    try {
      if (method === 'control_info') return { version: 1, enabled: true, ...this.capabilities(), adaptersRequireEnrollment: true,
        storagePressure: this.storageStatus().pressure };
      if (method === 'control_alerts') return this.alerts(socket, params);
      if (['control_notifications', 'control_notification_ack'].includes(method)) {
        check(socket.principal.admin, 'OPERATOR_REQUIRED');
        if (method === 'control_notification_ack') return this.store.acknowledgeNotification(params.channel, params.id, this.now(), params.expected);
        if (params.id) return this.store.notification(params.channel, params.id);
        return this.store.notifications(params.channel, params);
      }
      if (method === 'control_health_report') {
        const agent = this.adapter(socket, params);
        try { this.store.recordHealth({ version: 1, agentId: agent.agentId, channel: agent.channel,
          runID: this.activityRunID, observedAt: this.now(), report: params.report }); }
        catch (error) { this.activityFailures = Math.min(Number.MAX_SAFE_INTEGER, this.activityFailures + 1); throw error; }
        this.healthReceivers.set(agent.agentId, socket);
        return { recorded: true, observedAt: this.now() };
      }
      if (method === 'control_receipt') {
        check(socket.principal.admin, 'OPERATOR_REQUIRED');
        return { ...this.store.commandReceipt(params.channel, params.commandID), observedAt: this.now() };
      }
      if (method === 'control_checkpoint_observation') {
        check(socket.principal.admin, 'OPERATOR_REQUIRED');
        const observation = this.store.checkpointObservation(params.requestID);
        check(!observation || observation.channel === params.channel, 'CHECKPOINT_OBSERVATION_UNAVAILABLE');
        if (!observation) return { known: false };
        const destination = this.store.checkpointDestination(params.requestID);
        return { known: true, observation, historical: true, ...(destination ? { destination,
          recoveryStatus: destination.status === 'pending' ? 'uncertain' : destination.status } : {}) };
      }
      if (['control_activity', 'control_activity_status'].includes(method)) {
        check(socket.principal.admin, 'OPERATOR_REQUIRED');
        if (method === 'control_activity_status') return this.activityStatus();
        const result = this.store.activity(params.channel, params), bounded = this.page(result.entries, 0, params.limit);
        return { entries: bounded.entries, next: bounded.entries.at(-1)?.sequence ?? (params.after || 0), status: this.activityStatus() };
      }
      if (['control_storage_status', 'control_storage_watch', 'control_storage_reclaim', 'control_storage_reclaim_history', 'control_export', 'control_export_read'].includes(method)) {
        check(socket.principal.admin, 'OPERATOR_REQUIRED');
        if (method === 'control_storage_status') return this.storageStatus();
        if (method === 'control_storage_reclaim') return this.store.reclaimReceipts(this.archives, params);
        if (method === 'control_storage_reclaim_history') return this.store.reclaimHistory(this.archives, params, this.now());
        if (method === 'control_storage_watch') {
          const status = this.storageStatus(); socket.storageWatch = true; socket.storageSignature = JSON.stringify(status.pressure);
          return { watching: true, status };
        }
        if (method === 'control_export_read') return this.archives.read(params.id, params.offset, params.limit);
        try { return this.archives.describe(params.id); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        return this.store.exportTo(this.archives, params.id, this.now());
      }
      if (method === 'control_command') return this.command(socket, params);
      if (method === 'control_adapter') return this.command(socket, params, true);
      if (method === 'control_query') return this.query(socket, params);
      if (method === 'control_notice_ack') {
        const agent = this.adapter(socket, params);
        this.store.acceptNotice(agent.channel, agent.agentId, params.id, params.receiptID, this.now());
        return { accepted: true };
      }
      if (method === 'control_worktree_authorize') {
        const agent = this.adapter(socket, params, params.channel);
        check(!this.codexHandoffOnly || agent.harness === 'codex', 'OPENCODE_HANDOFF_DISABLED');
        check(this.worktreeGrants, 'WORKTREE_GRANTS_DISABLED');
        if (params.action === 'observe-destination-owners')
          return observeCodexDestinationOwners(this.store.snapshot(), params.grant, params.peerGrant, agent, this.now(), this.members());
        if (params.action === 'observe-destination-step')
          return observeCodexDestinationStepRecovery(this.store.snapshot(), params.grant, params.peerGrant, agent, this.now(), this.members());
        if (params.action === 'dispose-destination-step')
          return authorizeCodexDestinationStepDisposal(this.store.snapshot(), params.grant, params.peerGrant, agent, this.now(), this.members());
        if (params.action === 'prepare-destination-step')
          return authorizeCodexDestinationStep(this.store.snapshot(), params.grant, params.peerGrant, agent, this.now(), this.members());
        const observed = authorizeWorktreeGrant(this.store.snapshot(), params.grant, agent, this.now(), this.members(), params.action);
        if (params.action === 'detach-worktree-membership' || params.action === 'check-codex-source-receiver' || params.action === 'observe-moved-worktree' || params.action === 'place-worktree') {
          const hold = this.receiverPlacement(agent.agentId), grant = observed.grant;
          check(this.receiverHandoffEnabled && agent.harness === (params.action === 'check-codex-source-receiver' ? 'codex' : 'opencode') && hold?.status === 'held' &&
            hold.sourceDetached === !['detach-worktree-membership', 'check-codex-source-receiver'].includes(params.action) &&
            hold.transitionID === grant.id && hold.taskID === grant.taskID && hold.previewID === grant.previewID &&
            hold.claimGeneration === grant.claimGeneration && hold.channel === grant.channel && hold.from === grant.from && hold.to === grant.to &&
            hold.configurationDigest === grant.configurationDigest && hold.authorityDigest === grant.authorityDigest,
          'RECEIVER_HANDOFF_UNAVAILABLE');
        }
        return observed;
      }
      if (method === 'control_task_pull') return this.pullTask(socket, params);
      if (method === 'control_task_watch') {
        const agent = this.adapter(socket, params);
        check(this.taskDispatch && (agent.harness === 'opencode' || (agent.harness === 'codex' && this.codexTasks)), 'TASK_DISPATCH_DISABLED');
        socket.taskWatches ??= new Set(); socket.taskWatches.add(agent.agentId); return { watching: true };
      }
      check(socket.principal.admin, 'OPERATOR_REQUIRED');
      const registry = this.hosts();
      check(Object.hasOwn(registry, params.hostId), 'ENROLLED_HOST_REQUIRED');
      const host = registry[params.hostId]; check(!host.revoked, 'ENROLLED_HOST_REQUIRED');
      if (method === 'control_enroll_adapter') {
        const hash = digest(params.credential);
        check(hash !== this.adminDigest && !Object.values(this.hosts()).some(h => h.tokenHash === hash), 'SEPARATE_ADAPTER_CREDENTIAL_REQUIRED');
        this.store.enrollAdapter(params.hostId, hash, this.now()); return { enrolled: true, hostId: params.hostId };
      }
      if (method === 'control_revoke_adapter') { this.store.revokeAdapter(params.hostId, this.now()); return { revoked: true, hostId: params.hostId }; }
      throw new ControlError('CONTROL_OPERATION_DISABLED');
    } catch (error) {
      if (error.name === 'ZodError') throw error;
      // Do not send SQLite errors, filesystem paths, credentials, or request bodies to remote clients.
      throw new ControlError(error instanceof ControlError ? error.code : 'CONTROL_UNAVAILABLE');
    }
  }
  departed(agentId, channel) {
    try {
      if (!this.store.snapshot().channels.some(c => c.id === channel)) return;
      this.store.apply({ id: randomUUID(), op: 'member.departed', channel, agentId }, this.context({ kind: 'scheduler' }));
    } catch { throw new ControlError('CONTROL_UNAVAILABLE'); }
  }
  tick() {
    const state = this.store.snapshot(), now = this.now(), members = this.members();
    for (const channel of state.channels) {
      const absent = id => !members.some(m => m.agentId === id && m.channel === channel.id);
      const due = (channel.active && (channel.active.expiresAt <= now || absent(channel.active.agentId))) ||
        (channel.proposal && (channel.proposal.acceptBy <= now || absent(channel.proposal.agentId))) || channel.election?.deadline <= now ||
        state.tasks.some(t => t.channel === channel.id && !['completed', 'cancelled'].includes(t.status) &&
          ((!t.deadlineIncident && ((t.deadlineAt && t.deadlineAt <= now) || (t.status === 'running' && t.lastProgressAt + t.progressTimeoutMs <= now))) ||
          (t.schedule && ['open', 'claimed'].includes(t.status) && !t.missedDecision && t.schedule.missed !== 'run_late' &&
            t.schedule.at + t.schedule.maxLatenessMs < now && !state.incidents.some(i => i.entityID === t.id && i.status === 'open' && i.category === 'deadline'))));
      if (due) this.store.apply({ id: randomUUID(), op: 'clock.tick', channel: channel.id }, this.context({ kind: 'scheduler' }));
    }
  }
  close() { this.store.close(); }
}
