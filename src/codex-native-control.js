import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentID } from './protocol.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { ProviderEstablishmentPlan, ProviderEstablishmentReceipt, ProviderCleanupReceipt, ProviderObservation, cleanupMatchesOwner, receiptMatchesPlan, sameProviderPlan } from './control/provider-establishment-contracts.js';
import { McpEstablishmentPlan, McpEstablishmentReceipt, McpObservation, McpQuiescence, sameMcpPlan, mcpReceiptMatchesPlan, mcpCleanupMatchesOwner } from './control/mcp-establishment-contracts.js';
import { CodexResourceJournal, CodexStepPreparationReceipt, CodexStepDisposalReceipt } from './codex-resource-journal.js';
import { compatibleResourceHold } from './control/worktree-holds.js';
import { CodexAdmissionFence, requireCodexPublicationBarrier } from './codex-admission-fence.js';
import { CheckpointMetadata } from './control/checkpoint-observation.js';

const reservationSchema = z.strictObject({ generation: z.string().uuid(), revision: Stamp });
const checkpointChunkSchema = z.strictObject({ version: z.literal(1), threadId: z.string().uuid(), transitionId: z.string().uuid(), reservation: reservationSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/), rolloutSha256: z.string().regex(/^[a-f0-9]{64}$/), journalSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rolloutBytes: z.number().int().min(0).max(4 * 1024 * 1024), journalBytes: z.number().int().min(1).max(64 * 1024),
  kind: z.enum(['rollout', 'journal']), offset: z.number().int().min(0), data: z.string().max(8192), nextOffset: z.number().int().min(0),
  done: z.boolean(), releaseAllowed: z.literal(false) });
const restoredCommitReceiptSchema = z.strictObject({ transition_id: z.string().uuid(), reservation: reservationSchema,
  source_cwd: z.string().refine(isAbsolute), cwd: z.string().refine(isAbsolute) });
const restoredCommitSchema = z.discriminatedUnion('status', [
  z.strictObject({ transitionID: z.string().uuid(), status: z.literal('uncertain') }),
  z.strictObject({ transitionID: z.string().uuid(), status: z.literal('committed'), receipt: restoredCommitReceiptSchema }),
]);
const restoredPublicationSchema = z.strictObject({ operationID: z.string().uuid(), snapshotObserved: z.boolean() });
const sourceMcpInventorySchema = z.strictObject({ entries: z.array(z.strictObject({ name: z.string().min(1).max(128),
  owner: z.number().int().min(0).max(63), transport: z.enum(['stdio', 'http', 'unknown']),
  processId: z.number().int().min(1).max(0xffffffff).nullable() })).max(64), eventStreamPresent: z.boolean() })
  .superRefine((value, context) => {
    const names = new Set(), owners = new Map();
    for (const entry of value.entries) {
      const identity = JSON.stringify([entry.transport, entry.processId]);
      if (names.has(entry.name) || (owners.has(entry.owner) && owners.get(entry.owner) !== identity) || (entry.transport === 'http' && entry.processId !== null))
        context.addIssue({ code: 'custom', message: 'Inconsistent native MCP inventory' });
      names.add(entry.name); owners.set(entry.owner, identity);
    }
    for (let index = 0; index < owners.size; index++) if (!owners.has(index)) context.addIssue({ code: 'custom', message: 'Invalid native MCP owner index' });
  });
const restoredSourceShutdownSchema = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(),
  transitionID: z.string().uuid(), stepID: z.string().uuid(), historicalStatus: z.enum(['pending', 'uncertain', 'closed']) });
const restoredSourceModelShutdownSchema = restoredSourceShutdownSchema.extend({ historicalStatus: z.enum(['pending', 'uncertain', 'closed', 'absent']) });
const MAX_FRAME = 16 * 1024;
const unavailable = () => new Error('NATIVE_CONTINUITY_UNAVAILABLE');
// Only the exact result from the private native acquisition request can mint this.
// It says nothing about pre-existing reservations and never authorizes an effect.
class NativeAcquisitionRefused extends Error {
  constructor() { super('NATIVE_CONTINUITY_NOT_ACQUIRED'); this.code = 'NATIVE_CONTINUITY_NOT_ACQUIRED'; }
}
class NativeEffectReplyUncertain extends Error {
  constructor(operation) { super('NATIVE_CONTINUITY_UNCERTAIN'); this.code = 'NATIVE_CONTINUITY_UNCERTAIN';
    if (operation) Object.defineProperty(this, 'operation', { value: operation }); }
}
// This is a complete native refusal of a read-only observation, not a
// timeout or evidence that any retained resource may be recreated.
class NativeStepObservationRefused extends NativeEffectReplyUncertain {}
// A completed, read-only validation may refuse while the exact native owner
// remains usable for separately authorized cleanup. Timeouts and malformed
// replies remain uncertain and close the channel.
class NativeDestinationValidationRefused extends Error {
  constructor() { super('NATIVE_CONTINUITY_UNAVAILABLE'); }
}
// This method only reads retained state. A complete native refusal therefore
// proves that this preflight did not start the step or any contributor effect.
class NativePreflightRefused extends Error {
  constructor() { super('NATIVE_PREFLIGHT_REFUSED'); this.code = 'NATIVE_PREFLIGHT_REFUSED'; }
}
const destinationCancellationSchema = z.strictObject({ transitionID: z.string().uuid(), stepID: z.string().uuid(), cancellationID: z.string().uuid() });
const acquisitionRefusalSchema = z.strictObject({ refusedBeforeAcquisition: z.literal(true) });
const stepObservationSchema = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('uncertain') }), z.strictObject({ status: z.literal('retained'), receipt: CodexStepPreparationReceipt })]);
const stepNotStartedSchema = z.strictObject({ operationID: z.string().uuid(), candidateID: z.string().uuid(), refusedBeforeIntent: z.literal(true) });
const stepDisposalObservationSchema = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('uncertain') }), z.strictObject({ status: z.literal('disposed'), receipt: CodexStepDisposalReceipt })]);

// Trusted host port over a separate inherited descriptor. Never pass the stream
// to editor/model RPC forwarding. No movement, commit or resource-release API is exposed.
export class CodexNativeControl {
  #stream; #client; #credential; #pending = new Map(); #sequence = 0; #buffer = Buffer.alloc(0); #closed = false; #closeListeners = new Set(); #timeout; #agents = new Set(); #reservations = new Map(); #abandoning = new Set(); #disconnected; #removed; #providerPlans = new Map(); #mcpPlans = new Map(); #destinations = new Map(); #destinationPending = new Set(); #providerResources = new Map(); #providerCleanupCompletions = new Map(); #mcpResources = new Map(); #mcpQuiescence = new Map(); #stepResources = new Map(); #stepDisposals = new Map(); #boundDestinationGrants = new Map(); #cancelledDestinationGrants = new Map(); #experimentalStep; #experimentalPublication; #publicationFence; #stagedPublications = new Map(); #effectAuthorizing = new Set(); #uncertain = new Map(); #retiredReplies = new Set();
  constructor({ stream, client, credential, timeoutMs = 30000, experimentalStepPreparation = false, experimentalPublicationFixture = false, publicationFence }) {
    if (!stream?.write || !stream?.on || !client?.request || !client?.on || !client?.off || typeof credential !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000 || typeof experimentalStepPreparation !== 'boolean' ||
      typeof experimentalPublicationFixture !== 'boolean' || experimentalPublicationFixture && (!experimentalStepPreparation || !(publicationFence instanceof CodexAdmissionFence))) throw unavailable();
    this.#stream = stream; this.#client = client; this.#credential = credential; this.#timeout = timeoutMs; this.#experimentalStep = experimentalStepPreparation;
    this.#experimentalPublication = experimentalPublicationFixture; this.#publicationFence = publicationFence;
    this.#disconnected = () => this.close();
    this.#removed = event => { if (this.#agents.has(event.agentId)) this.close(); };
    client.on('disconnected', this.#disconnected); client.on('membership_removed', this.#removed);
    stream.on('data', chunk => this.#read(chunk));
    stream.on('error', () => this.close()); stream.on('end', () => this.close()); stream.on('close', () => this.close());
  }
  get timeoutMs() { return this.#timeout; }
  get supportsMcpBindingCapture() { return true; }
  get supportsMcpPluginCapture() { return true; }
  get supportsMcpSkillCapture() { return true; }
  get supportsMcpStepPreparation() { return this.#experimentalStep; }
  get supportsMcpStepDisposal() { return this.#experimentalStep; }
  get supportsPublicationFixture() { return this.#experimentalPublication; }
  usesPublicationFence(fence) { return !this.#closed && this.#experimentalPublication && this.#publicationFence === fence; }
  assertHandoffSourceOwner(expected, reservation, retainedValue, operationID, mcpShutdownID, modelShutdownID, fence) {
    if (!this.usesPublicationFence(fence)) throw unavailable();
    const { agentId } = this.#fixtureOwner(expected, reservation, retainedValue), staged = this.#stagedPublications.get(agentId);
    if (this.#uncertain.has(agentId) || staged?.operationID !== operationID || staged.shutdownID !== mcpShutdownID ||
        staged.modelShutdownID !== modelShutdownID) throw unavailable();
    fence.assertCurrentPublication(agentId.slice(6));
  }
  assertPublicationBarrier(barrier, threadId) {
    if (!this.#experimentalPublication || this.#closed) throw unavailable();
    requireCodexPublicationBarrier(barrier, threadId, this.#publicationFence);
  }
  usesClient(client) { return !this.#closed && this.#client === client; }
  onClose(listener) {
    if (typeof listener !== 'function') throw unavailable();
    if (this.#closed) { listener(); return () => {}; }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }
  #read(chunk) {
    try {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      // Enforce the per-frame bound even when many responses arrive together.
      let start = 0;
      for (let index = 0; index < data.length; index++) {
        if (index - start + this.#buffer.length + 1 > MAX_FRAME) throw unavailable();
        if (data[index] !== 10) continue;
        const bytes = Buffer.concat([this.#buffer, data.subarray(start, index)]);
        this.#buffer = Buffer.alloc(0); start = index + 1;
        const reply = z.strictObject({ id: Stamp, result: z.unknown().optional(), error: z.string().optional() }).parse(JSON.parse(bytes));
        if (Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error')) throw unavailable();
        if (this.#retiredReplies.delete(reply.id)) continue;
        const pending = this.#pending.get(reply.id); if (!pending) throw unavailable();
        this.#pending.delete(reply.id); clearTimeout(pending.timer);
        if (pending.timedOut) continue;
        if (reply.error) pending.reject(pending.method === 'preflightDestinationStep' && reply.error === 'NATIVE_CONTINUITY_UNAVAILABLE' ?
          new NativePreflightRefused() : pending.method === 'validateDestination' && reply.error === 'NATIVE_CONTINUITY_UNAVAILABLE' ?
            new NativeDestinationValidationRefused() : pending.method === 'observeDestinationStep' && reply.error === 'NATIVE_CONTINUITY_UNAVAILABLE' ?
              new NativeStepObservationRefused() : pending.recoverable ? new NativeEffectReplyUncertain(pending.method) : unavailable());
        else pending.resolve(reply.result);
      }
      this.#buffer = Buffer.concat([this.#buffer, data.subarray(start)]);
    } catch { this.close(); }
  }
  #request(operation) {
    if (this.#closed || this.#pending.size >= 8 || this.#sequence === Number.MAX_SAFE_INTEGER) return Promise.reject(unavailable());
    const id = ++this.#sequence, frame = Buffer.from(`${JSON.stringify({ id, operation })}\n`);
    if (frame.length > MAX_FRAME) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const recoverable = ['constructProvider', 'cleanupProvider', 'observeProvider', 'constructMcp', 'observeMcp', 'quiesceMcp', 'prepareDestinationStep', 'observeDestinationStep', 'disposeDestinationStep', 'observeDestinationStepDisposal', 'bindDestinationGrant', 'observeDestinationGrant', 'cancelDestinationGrant', 'observeDestinationGrantCancellation', 'abandonPreparation', 'observeAbandonedPreparation', 'stageDestinationFixture', 'observeStagedDestinationFixture', 'shutdownSourceFixture', 'observeSourceShutdownFixture', 'shutdownSourceModelFixture', 'observeSourceModelShutdownFixture'].includes(operation.method);
      const timer = setTimeout(() => {
        const entry = this.#pending.get(id);
        if (!recoverable) { this.close(); return; }
        if (entry) { entry.timedOut = true; reject(new NativeEffectReplyUncertain(entry.method)); }
      }, this.#timeout);
      this.#pending.set(id, { resolve, reject, timer, recoverable, threadId: operation.threadId, method: operation.method, timedOut: false });
      try { this.#stream.write(frame, error => { if (error) this.close(); }); } catch { this.close(); }
    });
  }
  // Read the exact effect-free native release after reopening the source.
  // It is not a movement receipt or evidence of remote-resource completion.
  async observeRestoredAbandonment(threadId, reservation) {
    const agentId = AgentID.parse(`codex:${threadId}`), expected = reservationSchema.parse(reservation);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const result = z.strictObject({ reservation: reservationSchema, abandoned: z.literal(true) }).parse(
        await this.#request({ method: 'observeRestoredAbandonment', threadId, reservation: expected }));
      if (this.#closed || JSON.stringify(result.reservation) !== JSON.stringify(expected)) throw unavailable();
      return result;
    } catch { this.close(); throw unavailable(); }
  }
  // Historical local cleanup; this does not revive an owner or release MCP.
  async observeRestoredProviderCleanup(threadId, reservation, cleanupID) {
    const agentId = AgentID.parse(`codex:${threadId}`), expected = reservationSchema.parse(reservation);
    z.string().uuid().parse(cleanupID);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const receipt = ProviderCleanupReceipt.parse(await this.#request({ method: 'observeRestoredProviderCleanup', threadId, reservation: expected, cleanupID }));
      if (this.#closed || receipt.cleanupID !== cleanupID || JSON.stringify(receipt.resource.reservation) !== JSON.stringify(expected)) throw unavailable();
      return receipt;
    } catch { this.close(); throw unavailable(); }
  }
  // Absence of the provider intent is historical evidence only. The MCP owner
  // remains quarantined and this cannot authorize a new provider effect.
  async observeRestoredUnstartedProvider(threadId, reservation, mcpReceipt) {
    const agentId = AgentID.parse(`codex:${threadId}`), expected = reservationSchema.parse(reservation);
    const mcp = McpEstablishmentReceipt.parse(mcpReceipt);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) || mcp.phase !== 'constructed' ||
        JSON.stringify(mcp.reservation) !== JSON.stringify(expected) || [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const result = z.strictObject({ reservation: reservationSchema, mcpReceipt: McpEstablishmentReceipt, providerUnstarted: z.literal(true) }).parse(
        await this.#request({ method: 'observeRestoredUnstartedProvider', threadId, reservation: expected, mcpReceipt: mcp }));
      if (this.#closed || JSON.stringify(result.reservation) !== JSON.stringify(expected) || JSON.stringify(result.mcpReceipt) !== JSON.stringify(mcp)) throw unavailable();
      return result;
    } catch { this.close(); throw unavailable(); }
  }
  // Read-only evidence from a restored legacy commit. It never clears the
  // native quarantine and does not authorize a broker settlement or movement.
  async observeRestoredCommit(threadId, transitionID) {
    const agentId = AgentID.parse(`codex:${threadId}`);
    z.string().uuid().parse(transitionID);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const observed = restoredCommitSchema.parse(await this.#request({ method: 'observeRestoredCommit', threadId, transitionID }));
      if (this.#closed || observed.transitionID !== transitionID ||
          (observed.status === 'committed' && observed.receipt.transition_id !== transitionID)) throw unavailable();
      return observed;
    } catch { this.close(); throw unavailable(); }
  }
  // A correlated history observation is not resource reconciliation or release.
  async observeRestoredPublication(threadId, operationID) {
    const agentId = AgentID.parse(`codex:${threadId}`);
    z.string().uuid().parse(operationID);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const observed = restoredPublicationSchema.parse(await this.#request({ method: 'observeRestoredPublication', threadId, operationID }));
      if (this.#closed || observed.operationID !== operationID) throw unavailable();
      return observed;
    } catch { this.close(); throw unavailable(); }
  }
  // Historical correlation only. The original resources are not recovered.
  async observeRestoredPublicationExact(threadId, reservation, ids) {
    const agentId = AgentID.parse(`codex:${threadId}`), expected = reservationSchema.parse(reservation),
      identity = z.strictObject({ operationID: z.string().uuid(), transitionID: z.string().uuid(), stepID: z.string().uuid() }).parse(ids);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const observed = z.strictObject({ reservation: reservationSchema, operationID: z.string().uuid(), transitionID: z.string().uuid(),
        stepID: z.string().uuid(), historicalStatus: z.enum(['pending', 'uncertain', 'installed']), snapshotObserved: z.boolean() }).parse(
        await this.#request({ method: 'observeRestoredPublicationExact', threadId, reservation: expected, ...identity }));
      if (this.#closed || JSON.stringify(observed.reservation) !== JSON.stringify(expected) ||
          Object.entries(identity).some(([key, value]) => observed[key] !== value) ||
          observed.historicalStatus === 'installed' && !observed.snapshotObserved) throw unavailable();
      return observed;
    } catch { this.close(); throw unavailable(); }
  }
  // Observe only a cancellation durably made by a dead owner. Native resource
  // and admission quarantines remain held by the restored thread.
  async observeRestoredDestinationCancellation(expected, reservation, retainedValue, cancellationID) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation),
      retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = AgentID.parse(grant.agentId);
    z.string().uuid().parse(cancellationID);
    if (!agentId.startsWith('codex:') || grant.purpose || grant.destinationOwners?.stepID !== retained.stepID ||
        this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === agentId.slice(6))) throw unavailable();
    this.#agents.add(agentId);
    const { destinationOwners: _owners, sourceMcpShutdown: _mcp, sourceModelShutdown: _model, sourceRetirement: _retirement, ...nativeGrant } = grant;
    try {
      const receipt = destinationCancellationSchema.parse(await this.#request({ method: 'observeRestoredDestinationCancellation',
        threadId: agentId.slice(6), reservation: held, grant: nativeGrant, retained, cancellationID }));
      if (this.#closed || receipt.cancellationID !== cancellationID || receipt.transitionID !== grant.id || receipt.stepID !== retained.stepID) throw unavailable();
      return receipt;
    } catch { this.close(); throw unavailable(); }
  }
  // Historical journal evidence only; it cannot release a receiver or prove
  // the old local process or remote effects have stopped.
  async observeRestoredSourceShutdown(threadId, ids) {
    const agentId = AgentID.parse(`codex:${threadId}`);
    const expected = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(),
      transitionID: z.string().uuid(), stepID: z.string().uuid() }).parse(ids);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const observed = restoredSourceShutdownSchema.parse(await this.#request({ method: 'observeRestoredSourceShutdown', threadId, ...expected }));
      if (this.#closed || Object.entries(expected).some(([key, value]) => observed[key] !== value)) throw unavailable();
      return observed;
    } catch { this.close(); throw unavailable(); }
  }
  // Historical evidence only: the old process and any remote work are not reconstructed.
  async observeRestoredSourceModelShutdown(threadId, ids) {
    const agentId = AgentID.parse(`codex:${threadId}`);
    const expected = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(),
      transitionID: z.string().uuid(), stepID: z.string().uuid() }).parse(ids);
    if (this.#closed || this.#reservations.has(agentId) || this.#uncertain.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#agents.add(agentId);
    try {
      const observed = restoredSourceModelShutdownSchema.parse(await this.#request({ method: 'observeRestoredSourceModelShutdown', threadId, ...expected }));
      if (this.#closed || Object.entries(expected).some(([key, value]) => observed[key] !== value)) throw unavailable();
      return observed;
    } catch { this.close(); throw unavailable(); }
  }
  async acquire(threadId) {
    AgentID.parse(`codex:${threadId}`);
    if (this.#uncertain.has(`codex:${threadId}`) || this.#abandoning.has(`codex:${threadId}`)) throw unavailable();
    this.#agents.add(`codex:${threadId}`);
    try {
      const result = await this.#request({ method: 'acquire', threadId });
      if (acquisitionRefusalSchema.safeParse(result).success) throw new NativeAcquisitionRefused();
      const held = reservationSchema.parse(result);
      this.#reservations.set(`codex:${threadId}`, held);
      return held;
    } catch (error) {
      if (error instanceof NativeAcquisitionRefused) throw error;
      this.close(); throw unavailable();
    }
  }
  // Snapshot of the source runtime's materialized connections under the exact
  // held reservation. A process ID is only the captured launch ID; it may be
  // stale or reused. This is not a cleanup proof or an authorization to move.
  async observeSourceMcpInventory(threadId, reservation) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), acquired = this.#reservations.get(agentId);
    if (this.#closed || !acquired || JSON.stringify(acquired) !== JSON.stringify(held) || this.#uncertain.has(agentId) ||
        this.#abandoning.has(agentId) || [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    try {
      const result = z.strictObject({ reservation: reservationSchema, inventory: sourceMcpInventorySchema }).parse(
        await this.#request({ method: 'observeSourceMcpInventory', threadId, reservation: held }));
      if (this.#closed || this.#reservations.get(agentId) !== acquired || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
          JSON.stringify(result.reservation) !== JSON.stringify(held)) throw unavailable();
      return result.inventory;
    } catch { this.close(); throw unavailable(); }
  }
  // Private, read-only peer challenge. A successful result is ephemeral and
  // cannot authorize cleanup, commit or receiver release.
  async verifySourceMcpPeer(threadId, reservation, peer) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), acquired = this.#reservations.get(agentId);
    const expected = z.strictObject({ name: z.string().min(1).max(128), path: z.string().refine(isAbsolute).refine(value => Buffer.byteLength(value) <= 100),
      nonce: z.string().regex(/^[a-f0-9]{64}$/) }).parse(peer);
    if (this.#closed || !acquired || JSON.stringify(acquired) !== JSON.stringify(held) || this.#uncertain.has(agentId) ||
        this.#abandoning.has(agentId) || [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    try {
      const result = z.strictObject({ reservation: reservationSchema, processId: z.number().int().min(1).max(0xffffffff) }).parse(
        await this.#request({ method: 'verifySourceMcpPeer', threadId, reservation: held, ...expected }));
      if (this.#closed || this.#reservations.get(agentId) !== acquired || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
          JSON.stringify(result.reservation) !== JSON.stringify(held)) throw unavailable();
      return result.processId;
    } catch { this.close(); throw unavailable(); }
  }
  // This is only for preparation and unstarted plans. A lost reply requires
  // same-owner native observation; it is not proof of a safe release.
  async abandonPreparation(threadId, reservation) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), acquired = this.#reservations.get(agentId);
    if (this.#closed || !acquired || JSON.stringify(acquired) !== JSON.stringify(held) || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
      this.#destinationPending.has(agentId) || this.#providerResources.has(agentId) || this.#mcpResources.has(agentId) || this.#mcpQuiescence.has(agentId) || this.#effectAuthorizing.has(agentId) ||
      [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#abandoning.add(agentId);
    try {
      this.#uncertain.set(agentId, { operation: 'abandonPreparation', reservation: held });
      const receipt = z.strictObject({ reservation: reservationSchema, abandoned: z.literal(true) }).parse(
        await this.#request({ method: 'abandonPreparation', threadId, reservation: held }));
      if (this.#closed || this.#reservations.get(agentId) !== acquired || JSON.stringify(receipt.reservation) !== JSON.stringify(held)) throw unavailable();
      this.#uncertain.delete(agentId); this.#reservations.delete(agentId); this.#destinations.delete(agentId); this.#providerPlans.delete(agentId); this.#mcpPlans.delete(agentId); this.#agents.delete(agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#abandoning.delete(agentId); }
  }
  async observeAbandonedPreparation(threadId, reservation) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), recovery = this.#uncertain.get(agentId);
    if (this.#closed || this.#abandoning.has(agentId) || !recovery || recovery.operation !== 'abandonPreparation' ||
      JSON.stringify(recovery.reservation) !== JSON.stringify(held)) throw unavailable();
    this.#abandoning.add(agentId);
    try {
      const receipt = z.strictObject({ reservation: reservationSchema, abandoned: z.literal(true) }).parse(
        await this.#request({ method: 'observeAbandonedPreparation', threadId, reservation: held }));
      if (this.#closed || this.#uncertain.get(agentId) !== recovery || JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) || JSON.stringify(receipt.reservation) !== JSON.stringify(held)) throw unavailable();
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === threadId && ['abandonPreparation', 'observeAbandonedPreparation'].includes(entry.method)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      this.#uncertain.delete(agentId); this.#reservations.delete(agentId); this.#destinations.delete(agentId); this.#providerPlans.delete(agentId); this.#mcpPlans.delete(agentId); this.#agents.delete(agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#abandoning.delete(agentId); }
  }
  // These IDs identify retained data only. They do not prove resource readiness
  // or authorize a commit, and are valid solely for this native owner.
  async retainDestination(threadId, reservation, to) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`);
    if (this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) || !this.#agents.has(agentId) || this.#destinations.has(agentId) || this.#destinationPending.has(agentId) || this.#providerPlans.has(agentId) || this.#mcpPlans.has(agentId) || [...this.#pending.values()].some(request => request.threadId === threadId && ['planProvider', 'planMcp'].includes(request.method)) || typeof to !== 'string') throw unavailable();
    this.#destinationPending.add(agentId);
    try {
      const result = z.strictObject({ candidateId: z.string().uuid() }).parse(await this.#request({ method: 'retainDestination', threadId, reservation: held, to }));
      if (this.#closed) throw unavailable();
      this.#destinations.set(agentId, { candidateId: result.candidateId, reservation: held, to });
      return result;
    } catch { this.close(); throw unavailable(); } finally { this.#destinationPending.delete(agentId); }
  }
  async validateDestination(threadId, reservation, candidateId) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), candidate = this.#destinations.get(agentId);
    if (this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) || !candidate || candidate.invalid || candidate.candidateId !== candidateId || JSON.stringify(candidate.reservation) !== JSON.stringify(held)) throw unavailable();
    try {
      const result = z.strictObject({ candidateId: z.string().uuid() }).parse(await this.#request({ method: 'validateDestination', threadId, reservation: held, candidateId }));
      if (this.#closed || this.#destinations.get(agentId) !== candidate || candidate.invalid || result.candidateId !== candidateId) throw unavailable();
      return result;
    } catch (error) {
      if (error instanceof NativeDestinationValidationRefused && !this.#closed && this.#destinations.get(agentId) === candidate) {
        candidate.invalid = true;
        throw unavailable();
      }
      this.close(); throw unavailable();
    }
  }
  // A local presence observation only: no credential value is returned and a
  // successful observation does not certify remote authentication.
  async preflightProviderCredential(threadId, reservation, to) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), candidate = this.#destinations.get(agentId);
    if (this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) || this.#abandoning.has(agentId) ||
        this.#destinationPending.has(agentId) || !this.#agents.has(agentId) || (candidate && (candidate.invalid || candidate.to !== to)) || typeof to !== 'string' ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) || [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    try {
      const observed = z.strictObject({ reservation: reservationSchema, status: z.enum(['present', 'missing', 'not_declared', 'changed']) }).parse(
        await this.#request({ method: 'preflightProviderCredential', threadId, reservation: held, to }));
      if (this.#closed || this.#destinations.get(agentId) !== candidate || candidate?.invalid ||
          JSON.stringify(observed.reservation) !== JSON.stringify(held)) throw unavailable();
      return observed.status;
    } catch { this.close(); throw unavailable(); }
  }
  async planProvider(threadId, reservation, to, { modelContext = false, refreshCatalog = false } = {}) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`);
    const destination = this.#destinations.get(agentId);
    if (this.#uncertain.has(agentId) || this.#abandoning.has(agentId) || !this.#agents.has(agentId) || this.#providerPlans.has(agentId) || this.#destinationPending.has(agentId) || (destination && (destination.invalid || destination.to !== to || JSON.stringify(destination.reservation) !== JSON.stringify(held))) || this.#closed || typeof to !== 'string' || typeof modelContext !== 'boolean' || typeof refreshCatalog !== 'boolean' || (refreshCatalog && !modelContext)) throw unavailable();
    try {
      const plan = ProviderEstablishmentPlan.parse(await this.#request({ method: 'planProvider', threadId, reservation: held, to, ...(modelContext ? { modelContext: true } : {}), ...(refreshCatalog ? { refreshCatalog: true } : {}) }));
      if (plan.kind !== (refreshCatalog ? 'provider_catalog' : modelContext ? 'provider_context' : 'provider_factory') || plan.agentId !== agentId || plan.to !== to || JSON.stringify(plan.reservation) !== JSON.stringify(held)) throw unavailable();
      const mcp = this.#mcpPlans.get(agentId);
      if (mcp && (mcp.from !== plan.from || mcp.to !== plan.to || mcp.processGeneration !== plan.processGeneration || JSON.stringify(mcp.reservation) !== JSON.stringify(plan.reservation))) throw unavailable();
      this.#providerPlans.set(agentId, plan);
      return plan;
    } catch { this.close(); throw unavailable(); }
  }
  // A retained native plan is a disclosure, not an authorization or startup receipt.
  async planMcp(threadId, reservation, to, { bindingCapture = false, pluginCapture = false, skillCapture = false, stepPreparation = false } = {}) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`);
    const destination = this.#destinations.get(agentId);
    if (this.#uncertain.has(agentId) || this.#abandoning.has(agentId) || !this.#agents.has(agentId) || this.#mcpPlans.has(agentId) || this.#destinationPending.has(agentId) || (destination && (destination.invalid || destination.to !== to || JSON.stringify(destination.reservation) !== JSON.stringify(held))) || this.#closed || typeof to !== 'string' || typeof bindingCapture !== 'boolean' || typeof pluginCapture !== 'boolean' || typeof skillCapture !== 'boolean' || typeof stepPreparation !== 'boolean' || ((bindingCapture || pluginCapture || skillCapture || stepPreparation) && !destination) || (skillCapture && (!bindingCapture || !pluginCapture)) || (stepPreparation && !skillCapture)) throw unavailable();
    try {
      const plan = McpEstablishmentPlan.parse(await this.#request({ method: 'planMcp', threadId, reservation: held, to, ...(bindingCapture ? { bindingCapture: true } : {}), ...(pluginCapture ? { pluginCapture: true } : {}), ...(skillCapture ? { skillCapture: true } : {}), ...(stepPreparation ? { stepPreparation: true } : {}) }));
      if (plan.agentId !== agentId || plan.to !== to || JSON.stringify(plan.reservation) !== JSON.stringify(held) || !!plan.effects.bindingCapture !== bindingCapture || !!plan.effects.pluginCapture !== pluginCapture || !!plan.effects.skillCapture !== skillCapture || !!plan.effects.stepPreparation !== stepPreparation) throw unavailable();
      const provider = this.#providerPlans.get(agentId);
      if (provider && (provider.from !== plan.from || provider.to !== plan.to || provider.processGeneration !== plan.processGeneration || JSON.stringify(provider.reservation) !== JSON.stringify(plan.reservation))) throw unavailable();
      this.#mcpPlans.set(agentId, plan);
      return plan;
    } catch { this.close(); throw unavailable(); }
  }
  // Host-local liveness check for pre-effect broker retries. It never grants
  // authority: construction still revalidates the native owner and broker.
  assertRetainedResourcePlan(value, reservation) {
    const isMcp = value?.kind === 'mcp_runtime', plan = isMcp ? McpEstablishmentPlan.parse(value) : ProviderEstablishmentPlan.parse(value);
    const held = reservationSchema.parse(reservation), agentId = plan.agentId;
    const retained = isMcp ? this.#mcpPlans.get(agentId) : this.#providerPlans.get(agentId);
    if (this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) || this.#effectAuthorizing.has(agentId) ||
        this.#destinations.get(agentId)?.invalid || !this.#agents.has(agentId) || !retained || JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        JSON.stringify(plan.reservation) !== JSON.stringify(held) || !(isMcp ? sameMcpPlan(retained, plan) : sameProviderPlan(retained, plan))) throw unavailable();
    if (isMcp && !this.#providerPlans.has(agentId)) throw unavailable();
  }
  assertRetainedDestinationOwners({ mcpGrant: mcpValue, providerGrant: providerValue, candidateId, reservation }) {
    const mcp = WorktreeTransition.parse(mcpValue), provider = WorktreeTransition.parse(providerValue), held = reservationSchema.parse(reservation);
    z.string().uuid().parse(candidateId);
    const agentId = mcp.agentId, destination = this.#destinations.get(agentId);
    if (!this.#experimentalStep || this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
        this.#effectAuthorizing.has(agentId) || this.#mcpQuiescence.has(agentId) ||
        !destination || destination.invalid || destination.candidateId !== candidateId ||
        JSON.stringify(destination.reservation) !== JSON.stringify(held) || JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        mcp.purpose !== 'establish-mcp' || provider.purpose !== 'establish-provider' || mcp.status !== 'established' || provider.status !== 'established' ||
        !Stamp.safeParse(mcp.settledAt).success || !Stamp.safeParse(provider.settledAt).success ||
        !mcp.mcpPlan.effects.stepPreparation || !mcp.resourceReceipt || !provider.resourceReceipt ||
        !mcpReceiptMatchesPlan(mcp.resourceReceipt, mcp) || !receiptMatchesPlan(provider.resourceReceipt, provider) ||
        JSON.stringify(mcp.resourceReceipt) !== JSON.stringify(this.#mcpResources.get(agentId)) ||
        JSON.stringify(provider.resourceReceipt) !== JSON.stringify(this.#providerResources.get(agentId)) ||
        JSON.stringify(mcp.resourceReceipt.reservation) !== JSON.stringify(held) ||
        !compatibleResourceHold(mcp, provider) || !compatibleResourceHold(provider, mcp)) throw unavailable();
  }
  async #authorizeStep(mcpGrant, providerGrant, action, earliest) {
    const result = await this.#client.request('control_worktree_authorize', { agentId: mcpGrant.agentId, channel: mcpGrant.channel,
      credential: await this.#credential(), action, grant: mcpGrant, peerGrant: providerGrant });
    if (this.#closed || (action === 'prepare-destination-step' && this.#destinations.get(mcpGrant.agentId)?.invalid) ||
        !Stamp.safeParse(result?.checkedAt).success || result.checkedAt < earliest ||
        JSON.stringify(WorktreeTransition.parse(result.mcpGrant)) !== JSON.stringify(mcpGrant) ||
        JSON.stringify(WorktreeTransition.parse(result.providerGrant)) !== JSON.stringify(providerGrant) ||
        (['prepare-destination-step', 'dispose-destination-step'].includes(action) && result.purpose !== action)) throw unavailable();
    return result.checkedAt;
  }
  async preflightDestinationStep({ threadId, reservation, candidateId, mcpGrant: mcpValue, providerGrant: providerValue }) {
    const mcpGrant = WorktreeTransition.parse(mcpValue), providerGrant = WorktreeTransition.parse(providerValue), held = reservationSchema.parse(reservation);
    if (mcpGrant.agentId !== AgentID.parse(`codex:${threadId}`)) throw unavailable();
    this.assertRetainedDestinationOwners({ mcpGrant, providerGrant, candidateId, reservation: held });
    this.#effectAuthorizing.add(mcpGrant.agentId);
    try {
      const checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', Math.max(mcpGrant.settledAt, providerGrant.settledAt));
      const result = z.strictObject({ allowed: z.boolean() }).parse(await this.#request({ method: 'preflightDestinationStep', threadId, reservation: held, candidateId }));
      await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', checkedAt);
      return result.allowed;
    } catch (error) { if (error instanceof NativePreflightRefused) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(mcpGrant.agentId); }
  }
  async prepareDestinationStep({ threadId, reservation, candidateId, operationID, mcpGrant: mcpValue, providerGrant: providerValue, guard = () => {} }) {
    const mcpGrant = WorktreeTransition.parse(mcpValue), providerGrant = WorktreeTransition.parse(providerValue), held = reservationSchema.parse(reservation);
    z.string().uuid().parse(operationID);
    if (mcpGrant.agentId !== AgentID.parse(`codex:${threadId}`) || this.#stepResources.has(mcpGrant.agentId) || this.#stepDisposals.has(mcpGrant.agentId)) throw unavailable();
    this.assertRetainedDestinationOwners({ mcpGrant, providerGrant, candidateId, reservation: held });
    this.#effectAuthorizing.add(mcpGrant.agentId);
    try {
      let checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', Math.max(mcpGrant.settledAt, providerGrant.settledAt));
      guard();
      if (this.#destinations.get(mcpGrant.agentId)?.invalid) throw unavailable();
      const recovery = { operation: 'prepareDestinationStep', reservation: held, candidateId, operationID, mcpGrant, providerGrant };
      this.#uncertain.set(mcpGrant.agentId, recovery);
      let receipt;
      for (let attempt = 0; attempt < 3; attempt++) {
        guard();
        const response = await this.#request({ method: 'prepareDestinationStep', threadId,
          reservation: held, candidateId, operationID, mcpResource: mcpGrant.resourceReceipt, providerResource: providerGrant.resourceReceipt });
        const noIntent = stepNotStartedSchema.safeParse(response);
        if (!noIntent.success) { receipt = CodexStepPreparationReceipt.parse(response); break; }
        if (noIntent.data.operationID !== operationID || noIntent.data.candidateID !== candidateId) throw unavailable();
        if (attempt === 2) { recovery.refusedBeforeIntent = true; throw new NativeEffectReplyUncertain(); }
        await delay(50 * (attempt + 1));
        checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', checkedAt);
        if (this.#closed || this.#destinations.get(mcpGrant.agentId)?.invalid) throw unavailable();
      }
      if (receipt.operationID !== operationID || receipt.candidateID !== candidateId || receipt.mcpResourceID !== mcpGrant.resourceReceipt.resourceID ||
          receipt.providerResourceID !== providerGrant.resourceReceipt.resourceID) throw unavailable();
      await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', checkedAt);
      this.#stepResources.set(mcpGrant.agentId, receipt); this.#uncertain.delete(mcpGrant.agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(mcpGrant.agentId); }
  }
  markCompletedStepUncertain(step, value) {
    const mcpGrant = WorktreeTransition.parse(step.mcpGrant), providerGrant = WorktreeTransition.parse(step.providerGrant);
    const receipt = CodexStepPreparationReceipt.parse(value), held = reservationSchema.parse(mcpGrant.resourceReceipt.reservation), agentId = mcpGrant.agentId;
    if (!this.#experimentalStep || this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(receipt) || receipt.operationID !== step.operationID ||
        receipt.candidateID !== step.candidateID || receipt.mcpResourceID !== mcpGrant.resourceReceipt.resourceID ||
        receipt.providerResourceID !== providerGrant.resourceReceipt?.resourceID || !compatibleResourceHold(mcpGrant, providerGrant)) throw unavailable();
    this.assertRetainedDestinationOwners({ mcpGrant, providerGrant, candidateId: step.candidateID, reservation: held });
    this.#uncertain.set(agentId, { operation: 'prepareDestinationStep', reservation: held, candidateId: step.candidateID,
      operationID: step.operationID, mcpGrant, providerGrant });
  }
  async observeDestinationStep({ threadId, reservation, candidateId, operationID, mcpGrant: mcpValue, providerGrant: providerValue, guard = () => {} }) {
    const mcpGrant = WorktreeTransition.parse(mcpValue), providerGrant = WorktreeTransition.parse(providerValue), held = reservationSchema.parse(reservation);
    const agentId = AgentID.parse(`codex:${threadId}`), recovery = this.#uncertain.get(agentId);
    if (!this.#experimentalStep || this.#closed || this.#effectAuthorizing.has(agentId) || !recovery || recovery.operation !== 'prepareDestinationStep' ||
        recovery.candidateId !== candidateId || recovery.operationID !== operationID || JSON.stringify(recovery.reservation) !== JSON.stringify(held) ||
        JSON.stringify(recovery.mcpGrant) !== JSON.stringify(mcpGrant) || JSON.stringify(recovery.providerGrant) !== JSON.stringify(providerGrant)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      // Only a proof received on this live owner permits another dispatch. The
      // durable operation remains uncertain, so a crash or lost reply cannot
      // turn a journal entry into replay authority.
      if (recovery.refusedBeforeIntent === true) {
        const checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', Math.max(mcpGrant.settledAt, providerGrant.settledAt));
        guard();
        recovery.refusedBeforeIntent = false;
        const response = await this.#request({ method: 'prepareDestinationStep', threadId, reservation: held, candidateId,
          operationID, mcpResource: mcpGrant.resourceReceipt, providerResource: providerGrant.resourceReceipt });
        const noIntent = stepNotStartedSchema.safeParse(response);
        if (noIntent.success) {
          if (noIntent.data.operationID !== operationID || noIntent.data.candidateID !== candidateId) throw unavailable();
          await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', checkedAt);
          recovery.refusedBeforeIntent = true;
          return { status: 'pending' };
        }
        const receipt = CodexStepPreparationReceipt.parse(response);
        if (receipt.operationID !== operationID || receipt.candidateID !== candidateId ||
            receipt.mcpResourceID !== mcpGrant.resourceReceipt.resourceID || receipt.providerResourceID !== providerGrant.resourceReceipt.resourceID) throw unavailable();
        await this.#authorizeStep(mcpGrant, providerGrant, 'prepare-destination-step', checkedAt);
        this.#stepResources.set(agentId, receipt); this.#uncertain.delete(agentId);
        return { status: 'retained', receipt };
      }
      const checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'observe-destination-step', Math.max(mcpGrant.settledAt, providerGrant.settledAt));
      const result = stepObservationSchema.parse(await this.#request({ method: 'observeDestinationStep', threadId, reservation: held, candidateId, operationID }));
      if (result.receipt && (result.receipt.operationID !== operationID || result.receipt.candidateID !== candidateId ||
          result.receipt.mcpResourceID !== mcpGrant.resourceReceipt.resourceID || result.receipt.providerResourceID !== providerGrant.resourceReceipt.resourceID)) throw unavailable();
      await this.#authorizeStep(mcpGrant, providerGrant, 'observe-destination-step', checkedAt);
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === threadId) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      if (result.receipt) { this.#stepResources.set(agentId, result.receipt); this.#uncertain.delete(agentId); }
      return result;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  // Revalidate the actual retained router and its exact paired owners, not
  // merely the candidate that existed before contributor preparation.
  async validateRetainedDestinationStep({ threadId, reservation, step }) {
    const held = reservationSchema.parse(reservation), mcpGrant = WorktreeTransition.parse(step.mcpGrant), providerGrant = WorktreeTransition.parse(step.providerGrant),
      retained = CodexStepPreparationReceipt.parse(step.receipt), agentId = AgentID.parse(`codex:${threadId}`);
    this.assertRetainedDestinationOwners({ mcpGrant, providerGrant, candidateId: step.candidateID, reservation: held });
    if (agentId !== mcpGrant.agentId || step.phase !== 'observed' || step.disposal || this.#stepDisposals.has(agentId) ||
        retained.operationID !== step.operationID || retained.candidateID !== step.candidateID ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      const bound = this.#boundDestinationGrants.get(agentId);
      const action = bound ? 'observe-destination-step' : 'prepare-destination-step';
      if (bound && (bound.destinationOwners.stepID !== retained.stepID || bound.destinationOwners.mcpTransitionID !== mcpGrant.id ||
          bound.destinationOwners.providerTransitionID !== providerGrant.id)) throw unavailable();
      for (let attempt = 0; attempt < 3; attempt++) {
        // Every retry is a read-only observation, bracketed by fresh broker
        // authorization. Never replay step creation or retry a lost reply.
        const checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, action, Math.max(mcpGrant.settledAt, providerGrant.settledAt));
        if (bound) await this.#authorizeDestinationGrant(bound, checkedAt);
        let response;
        try { response = await this.#request({ method: 'observeDestinationStep', threadId, reservation: held,
          candidateId: step.candidateID, operationID: step.operationID }); }
        catch (error) {
          if (!(error instanceof NativeStepObservationRefused) || attempt === 2) throw error;
          await delay(50 * (attempt + 1));
          continue;
        }
        const result = stepObservationSchema.parse(response);
        if (result.status !== 'retained' || JSON.stringify(result.receipt) !== JSON.stringify(retained)) throw unavailable();
        await this.#authorizeStep(mcpGrant, providerGrant, action, checkedAt);
        if (bound) await this.#authorizeDestinationGrant(bound, checkedAt);
        return retained;
      }
      throw unavailable();
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  assertRetainedStepDisposal({ threadId, reservation, step }) {
    const held = reservationSchema.parse(reservation), mcp = WorktreeTransition.parse(step.mcpGrant), provider = WorktreeTransition.parse(step.providerGrant);
    const retained = CodexStepPreparationReceipt.parse(step.receipt), agentId = AgentID.parse(`codex:${threadId}`), destination = this.#destinations.get(agentId);
    if (!this.#experimentalStep || this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) || this.#stepDisposals.has(agentId) ||
        mcp.agentId !== agentId || !destination || destination.candidateId !== retained.candidateID ||
        JSON.stringify(destination.reservation) !== JSON.stringify(held) || JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained) || retained.operationID !== step.operationID ||
        retained.candidateID !== step.candidateID || JSON.stringify(this.#mcpResources.get(agentId)) !== JSON.stringify(mcp.resourceReceipt) ||
        JSON.stringify(this.#providerResources.get(agentId)) !== JSON.stringify(provider.resourceReceipt) ||
        mcp.status !== 'established' || provider.status !== 'established' || !mcp.mcpPlan.effects.stepPreparation ||
        !mcpReceiptMatchesPlan(mcp.resourceReceipt, mcp) || !receiptMatchesPlan(provider.resourceReceipt, provider) ||
        !compatibleResourceHold(mcp, provider) || !compatibleResourceHold(provider, mcp)) throw unavailable();
  }
  #checkStepDisposalReceipt(value, retained, disposalID) {
    const receipt = CodexStepDisposalReceipt.parse(value);
    if (receipt.disposalID !== disposalID || receipt.operationID !== retained.operationID || receipt.candidateID !== retained.candidateID ||
        receipt.stepID !== retained.stepID || receipt.mcpResourceID !== retained.mcpResourceID || receipt.providerResourceID !== retained.providerResourceID) throw unavailable();
    return receipt;
  }
  async disposeDestinationStep({ threadId, reservation, step, disposalID }) {
    z.string().uuid().parse(disposalID); this.assertRetainedStepDisposal({ threadId, reservation, step });
    const held = reservationSchema.parse(reservation), mcpGrant = WorktreeTransition.parse(step.mcpGrant), providerGrant = WorktreeTransition.parse(step.providerGrant),
      retained = CodexStepPreparationReceipt.parse(step.receipt), agentId = mcpGrant.agentId;
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'dispose-destination-step', Math.max(mcpGrant.settledAt, providerGrant.settledAt));
      this.#uncertain.set(agentId, { operation: 'disposeDestinationStep', reservation: held, retained, disposalID, mcpGrant, providerGrant });
      const receipt = this.#checkStepDisposalReceipt(await this.#request({ method: 'disposeDestinationStep', threadId, reservation: held, retained, disposalID }), retained, disposalID);
      await this.#authorizeStep(mcpGrant, providerGrant, 'dispose-destination-step', checkedAt);
      this.#stepDisposals.set(agentId, { receipt, mcpGrant, providerGrant, retained, acknowledged: false }); this.#uncertain.delete(agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  markCompletedStepDisposalUncertain(step, disposal, value) {
    const mcpGrant = WorktreeTransition.parse(step.mcpGrant), providerGrant = WorktreeTransition.parse(step.providerGrant), retained = CodexStepPreparationReceipt.parse(step.receipt),
      receipt = this.#checkStepDisposalReceipt(value, retained, disposal.disposalID), agentId = mcpGrant.agentId;
    if (this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) ||
        JSON.stringify(this.#stepDisposals.get(agentId)?.receipt) !== JSON.stringify(receipt) ||
        JSON.stringify(this.#stepDisposals.get(agentId)?.mcpGrant) !== JSON.stringify(mcpGrant) ||
        JSON.stringify(this.#stepDisposals.get(agentId)?.providerGrant) !== JSON.stringify(providerGrant)) throw unavailable();
    this.#uncertain.set(agentId, { operation: 'disposeDestinationStep', reservation: reservationSchema.parse(mcpGrant.resourceReceipt.reservation),
      retained, disposalID: disposal.disposalID, mcpGrant, providerGrant });
  }
  // Called only after the exact native disposal receipt is durable in the
  // host journal. This enables resource cleanup, never movement or release.
  acknowledgeRecordedStepDisposal(step, journal) {
    const mcp = WorktreeTransition.parse(step.mcpGrant), provider = WorktreeTransition.parse(step.providerGrant),
      retained = CodexStepPreparationReceipt.parse(step.receipt), receipt = this.#checkStepDisposalReceipt(step.disposal?.receipt, retained, step.disposal?.disposalID),
      agentId = mcp.agentId, completed = this.#stepDisposals.get(agentId);
    if (!(journal instanceof CodexResourceJournal) || journal.agentId !== agentId || journal.hostId !== this.#client.hostId) throw unavailable();
    const records = journal.entries(), mcpRecord = records.find(record => record.transitionID === mcp.id),
      providerRecord = records.find(record => record.transitionID === provider.id);
    if (JSON.stringify(mcpRecord?.step) !== JSON.stringify(step) ||
        (mcpRecord?.quiescence?.phase !== 'dispatching' && providerRecord?.cleanup?.phase !== 'dispatching') ||
        this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) || step.phase !== 'observed' ||
        step.disposal?.phase !== 'observed' || JSON.stringify(completed?.receipt) !== JSON.stringify(receipt) ||
        JSON.stringify(completed?.mcpGrant) !== JSON.stringify(mcp) || JSON.stringify(completed?.providerGrant) !== JSON.stringify(provider) ||
        JSON.stringify(completed?.retained) !== JSON.stringify(retained) || (!this.#stepResources.has(agentId) && !completed?.acknowledged) ||
        !compatibleResourceHold(mcp, provider) || !compatibleResourceHold(provider, mcp) ||
        (this.#stepResources.has(agentId) && JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained))) throw unavailable();
    this.#stepResources.delete(agentId); completed.acknowledged = true;
  }
  async observeDestinationStepDisposal({ threadId, reservation, step, disposal }) {
    const held = reservationSchema.parse(reservation), agentId = AgentID.parse(`codex:${threadId}`), recovery = this.#uncertain.get(agentId),
      retained = CodexStepPreparationReceipt.parse(step.receipt), mcpGrant = WorktreeTransition.parse(step.mcpGrant), providerGrant = WorktreeTransition.parse(step.providerGrant);
    if (!this.#experimentalStep || this.#closed || this.#effectAuthorizing.has(agentId) || !recovery || recovery.operation !== 'disposeDestinationStep' ||
        recovery.disposalID !== disposal.disposalID || JSON.stringify(recovery.reservation) !== JSON.stringify(held) ||
        JSON.stringify(recovery.retained) !== JSON.stringify(retained) || JSON.stringify(recovery.mcpGrant) !== JSON.stringify(mcpGrant) ||
        JSON.stringify(recovery.providerGrant) !== JSON.stringify(providerGrant)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeStep(mcpGrant, providerGrant, 'observe-destination-step', Math.max(mcpGrant.settledAt, providerGrant.settledAt));
      const result = stepDisposalObservationSchema.parse(await this.#request({ method: 'observeDestinationStepDisposal', threadId, reservation: held, retained, disposalID: disposal.disposalID }));
      if (result.receipt) result.receipt = this.#checkStepDisposalReceipt(result.receipt, retained, disposal.disposalID);
      await this.#authorizeStep(mcpGrant, providerGrant, 'observe-destination-step', checkedAt);
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === threadId) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      if (result.receipt) { this.#stepDisposals.set(agentId, { receipt: result.receipt, mcpGrant, providerGrant, retained, acknowledged: false }); this.#uncertain.delete(agentId); }
      return result;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  async #confirmAuthorization(grant, action, checkedAt) {
    const confirmed = await this.#client.request('control_worktree_authorize', {
      agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, ...(action ? { action } : {}),
    });
    if (this.#closed || !Stamp.safeParse(confirmed.checkedAt).success || confirmed.checkedAt < checkedAt ||
      JSON.stringify(WorktreeTransition.parse(confirmed.grant)) !== JSON.stringify(grant)) throw unavailable();
  }
  async constructProvider(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    if (grant.purpose !== 'establish-provider' || grant.status !== 'prepared' || this.#closed || this.#uncertain.has(grant.agentId) || this.#abandoning.has(grant.agentId) || this.#mcpQuiescence.has(grant.agentId) || this.#destinations.get(grant.agentId)?.invalid ||
      grant.configurationDigest !== grant.providerPlan.digest ||
      !this.#providerPlans.has(grant.agentId) || !sameProviderPlan(this.#providerPlans.get(grant.agentId), grant.providerPlan) ||
      JSON.stringify(grant.providerPlan.reservation) !== JSON.stringify(held)) throw unavailable();
    if (this.#effectAuthorizing.has(grant.agentId)) throw unavailable();
    this.#effectAuthorizing.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant,
      });
      if (this.#destinations.get(grant.agentId)?.invalid || !Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      // Never replay an effect after a receipt or an ambiguous transport result.
      this.#providerPlans.delete(grant.agentId);
      this.#uncertain.set(grant.agentId, { operation: 'constructProvider', reservation: held, plan: grant.providerPlan, transitionID: grant.id, observed: false });
      const receipt = ProviderEstablishmentReceipt.parse(await this.#request({ method: 'constructProvider',
        threadId: grant.agentId.slice('codex:'.length), reservation: held, grant }));
      if (receipt.phase !== 'constructed' || !receiptMatchesPlan(receipt, grant)) throw unavailable();
      await this.#confirmAuthorization(grant, undefined, authorized.checkedAt);
      this.#providerResources.set(grant.agentId, receipt);
      this.#uncertain.delete(grant.agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(grant.agentId); }
  }
  async constructMcp(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const provider = this.#providerPlans.get(grant.agentId);
    if (grant.purpose !== 'establish-mcp' || grant.status !== 'prepared' || this.#closed || this.#uncertain.has(grant.agentId) || this.#abandoning.has(grant.agentId) || this.#destinations.get(grant.agentId)?.invalid ||
      grant.configurationDigest !== grant.mcpPlan.digest || !this.#mcpPlans.has(grant.agentId) ||
      !sameMcpPlan(this.#mcpPlans.get(grant.agentId), grant.mcpPlan) ||
      !provider || provider.from !== grant.from || provider.to !== grant.to || provider.processGeneration !== grant.mcpPlan.processGeneration ||
      JSON.stringify(provider.reservation) !== JSON.stringify(held) ||
      JSON.stringify(grant.mcpPlan.reservation) !== JSON.stringify(held)) throw unavailable();
    if (this.#effectAuthorizing.has(grant.agentId)) throw unavailable();
    this.#effectAuthorizing.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant,
      });
      if (this.#destinations.get(grant.agentId)?.invalid || !Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      this.#mcpPlans.delete(grant.agentId);
      this.#uncertain.set(grant.agentId, { operation: 'constructMcp', reservation: held, plan: grant.mcpPlan, transitionID: grant.id, observed: false });
      const receipt = McpEstablishmentReceipt.parse(await this.#request({ method: 'constructMcp',
        threadId: grant.agentId.slice('codex:'.length), reservation: held, grant }));
      if (receipt.phase !== 'constructed' || !mcpReceiptMatchesPlan(receipt, grant)) throw unavailable();
      await this.#confirmAuthorization(grant, undefined, authorized.checkedAt);
      this.#mcpResources.set(grant.agentId, receipt);
      this.#uncertain.delete(grant.agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(grant.agentId); }
  }
  // The caller could not durably record a successful construction response.
  // Restore the same-owner observation path without executing the effect again.
  markConstructedResourceUncertain(expected, reservation, value) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const isMcp = grant.purpose === 'establish-mcp';
    if (!isMcp && grant.purpose !== 'establish-provider') throw unavailable();
    const receipt = isMcp ? McpEstablishmentReceipt.parse(value) : ProviderEstablishmentReceipt.parse(value);
    const resource = (isMcp ? this.#mcpResources : this.#providerResources).get(grant.agentId);
    if (this.#closed || grant.status !== 'prepared' || this.#uncertain.has(grant.agentId) || this.#effectAuthorizing.has(grant.agentId) ||
        JSON.stringify(this.#reservations.get(grant.agentId)) !== JSON.stringify(held) ||
        JSON.stringify(resource) !== JSON.stringify(receipt) || receipt.phase !== 'constructed' ||
        !(isMcp ? mcpReceiptMatchesPlan(receipt, grant) : receiptMatchesPlan(receipt, grant))) throw unavailable();
    this.#uncertain.set(grant.agentId, { operation: isMcp ? 'constructMcp' : 'constructProvider', reservation: held,
      plan: isMcp ? grant.mcpPlan : grant.providerPlan, transitionID: grant.id, observed: false });
  }
  markCompletedResourceStopUncertain(expected, reservation, value) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const isMcp = grant.purpose === 'establish-mcp';
    if (!isMcp && grant.purpose !== 'establish-provider') throw unavailable();
    const receipt = isMcp ? McpQuiescence.parse(value) : ProviderCleanupReceipt.parse(value);
    const completed = (isMcp ? this.#mcpQuiescence : this.#providerCleanupCompletions).get(grant.agentId);
    if (this.#closed || !['established', 'uncertain'].includes(grant.status) || this.#uncertain.has(grant.agentId) || this.#effectAuthorizing.has(grant.agentId) ||
        JSON.stringify(this.#reservations.get(grant.agentId)) !== JSON.stringify(held) ||
        JSON.stringify(completed) !== JSON.stringify(receipt) || !grant.resourceReceipt ||
        JSON.stringify(receipt.resource) !== JSON.stringify(grant.resourceReceipt) ||
        JSON.stringify(receipt.resource.reservation) !== JSON.stringify(held) ||
        !(isMcp ? mcpReceiptMatchesPlan(receipt.resource, grant) : cleanupMatchesOwner(receipt, grant))) throw unavailable();
    this.#uncertain.set(grant.agentId, { operation: isMcp ? 'quiesceMcp' : 'cleanupProvider', reservation: held,
      plan: isMcp ? grant.mcpPlan : grant.providerPlan, transitionID: grant.id,
      ...(isMcp ? { shutdownID: receipt.shutdownID } : { cleanupID: receipt.cleanupID }), observed: false });
  }
  async observeMcp(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const recovery = this.#uncertain.get(grant.agentId);
    if (this.#closed || grant.purpose !== 'establish-mcp' || !recovery || !sameMcpPlan(recovery.plan, grant.mcpPlan) ||
      recovery.transitionID !== grant.id || JSON.stringify(held) !== JSON.stringify(recovery.reservation)) throw unavailable();
    recovery.observed = false;
    if (this.#effectAuthorizing.has(grant.agentId)) throw unavailable();
    this.#effectAuthorizing.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, action: 'observe-mcp',
      });
      if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      const observation = McpObservation.parse(await this.#request({ method: 'observeMcp',
        threadId: grant.agentId.slice('codex:'.length), reservation: held, plan: grant.mcpPlan, transitionID: grant.id,
        ...(recovery.cleanupID ? { cleanupID: recovery.cleanupID } : {}) }));
      if ((observation.status === 'released') !== !!observation.cleanup ||
        !sameMcpPlan(observation.plan, grant.mcpPlan) || !mcpReceiptMatchesPlan(observation.resource, grant) ||
        grant.resourceReceipt && JSON.stringify(grant.resourceReceipt) !== JSON.stringify(observation.resource) ||
        observation.cleanup && (observation.cleanup.cleanupID !== recovery.cleanupID || !mcpCleanupMatchesOwner(observation.cleanup, grant)) ||
        observation.quiescence && (observation.status !== 'owned' || observation.quiescence.shutdownID !== recovery.shutdownID ||
          JSON.stringify(observation.quiescence.resource) !== JSON.stringify(observation.resource))) throw unavailable();
      await this.#confirmAuthorization(grant, 'observe-mcp', authorized.checkedAt);
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === grant.agentId.slice('codex:'.length)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      if (observation.quiescence) { this.#mcpQuiescence.set(grant.agentId, observation.quiescence); this.#uncertain.delete(grant.agentId); }
      else if (observation.status === 'released') { this.#uncertain.delete(grant.agentId); this.#mcpResources.delete(grant.agentId); }
      else { recovery.observed = true; this.#mcpResources.set(grant.agentId, observation.resource); }
      return observation;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(grant.agentId); }
  }
  // This is a tracked stop, not a broker cleanup receipt or physical release.
  async quiesceMcp(expected, reservation, shutdownID) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const recovery = this.#uncertain.get(grant.agentId);
    const previous = this.#mcpQuiescence.get(grant.agentId);
    shutdownID ??= recovery?.shutdownID ?? previous?.shutdownID ?? randomUUID();
    z.string().uuid().parse(shutdownID);
    if (recovery && (!recovery.observed || recovery.operation !== 'quiesceMcp' || recovery.shutdownID !== shutdownID)) throw unavailable();
    if (this.#closed || this.#stepResources.has(grant.agentId) || grant.purpose !== 'establish-mcp' || !['established', 'uncertain'].includes(grant.status) || grant.cleanupReceipt ||
      !grant.resourceReceipt || JSON.stringify(grant.resourceReceipt) !== JSON.stringify(this.#mcpResources.get(grant.agentId)) ||
      JSON.stringify(held) !== JSON.stringify(grant.resourceReceipt.reservation)) throw unavailable();
    if (previous) {
      if (previous.shutdownID !== shutdownID || JSON.stringify(previous.resource) !== JSON.stringify(grant.resourceReceipt)) throw unavailable();
    }
    if (this.#effectAuthorizing.has(grant.agentId)) throw unavailable();
    this.#effectAuthorizing.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, action: 'cleanup-mcp',
      });
      if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      this.#uncertain.set(grant.agentId, { operation: 'quiesceMcp', reservation: held, plan: grant.mcpPlan, transitionID: grant.id, shutdownID, observed: false });
      const receipt = McpQuiescence.parse(await this.#request({ method: 'quiesceMcp',
        threadId: grant.agentId.slice('codex:'.length), reservation: held, shutdownID, receipt: grant.resourceReceipt }));
      if (receipt.shutdownID !== shutdownID || JSON.stringify(receipt.resource) !== JSON.stringify(grant.resourceReceipt)) throw unavailable();
      await this.#confirmAuthorization(grant, 'cleanup-mcp', authorized.checkedAt);
      this.#mcpQuiescence.set(grant.agentId, receipt);
      this.#uncertain.delete(grant.agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(grant.agentId); }
  }

  async observeProvider(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const recovery = this.#uncertain.get(grant.agentId);
    if (this.#closed || !recovery || !sameProviderPlan(recovery.plan, grant.providerPlan) || recovery.transitionID !== grant.id ||
      JSON.stringify(held) !== JSON.stringify(recovery.reservation)) throw unavailable();
    recovery.observed = false;
    if (this.#effectAuthorizing.has(grant.agentId)) throw unavailable();
    this.#effectAuthorizing.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, action: 'observe-provider',
      });
      if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      const observation = ProviderObservation.parse(await this.#request({ method: 'observeProvider',
        threadId: grant.agentId.slice('codex:'.length), reservation: held, plan: grant.providerPlan, transitionID: grant.id,
        ...(recovery.cleanupID ? { cleanupID: recovery.cleanupID } : {}) }));
      if (!sameProviderPlan(observation.plan, grant.providerPlan) || !receiptMatchesPlan(observation.resource, grant) ||
        grant.resourceReceipt && JSON.stringify(grant.resourceReceipt) !== JSON.stringify(observation.resource) ||
        observation.cleanup && (observation.cleanup.cleanupID !== recovery.cleanupID || !cleanupMatchesOwner(observation.cleanup, grant))) throw unavailable();
      await this.#confirmAuthorization(grant, 'observe-provider', authorized.checkedAt);
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === grant.agentId.slice('codex:'.length)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      if (observation.status === 'released') { this.#uncertain.delete(grant.agentId); this.#providerResources.delete(grant.agentId); this.#providerCleanupCompletions.set(grant.agentId, observation.cleanup); }
      else { recovery.observed = true; this.#providerResources.set(grant.agentId, observation.resource); }
      return observation;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(grant.agentId); }
  }
  async cleanupProvider(expected, reservation, cleanupID) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const recovery = this.#uncertain.get(grant.agentId);
    cleanupID ??= recovery?.cleanupID ?? randomUUID();
    z.string().uuid().parse(cleanupID);
    if (recovery && (!recovery.observed || recovery.cleanupID && recovery.cleanupID !== cleanupID)) throw unavailable();
    if (this.#closed || this.#stepResources.has(grant.agentId) || grant.purpose !== 'establish-provider' || !['established', 'uncertain'].includes(grant.status) || grant.cleanupReceipt ||
      !grant.resourceReceipt || JSON.stringify(grant.resourceReceipt) !== JSON.stringify(this.#providerResources.get(grant.agentId)) ||
      JSON.stringify(held) !== JSON.stringify(grant.resourceReceipt.reservation)) throw unavailable();
    if (this.#effectAuthorizing.has(grant.agentId)) throw unavailable();
    this.#effectAuthorizing.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, action: 'cleanup-provider',
      });
      if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      this.#providerResources.delete(grant.agentId);
      this.#uncertain.set(grant.agentId, { operation: 'cleanupProvider', reservation: held, plan: grant.providerPlan, transitionID: grant.id, cleanupID, observed: false });
      const receipt = ProviderCleanupReceipt.parse(await this.#request({ method: 'cleanupProvider',
        threadId: grant.agentId.slice('codex:'.length), reservation: held, cleanupID, receipt: grant.resourceReceipt }));
      if (receipt.cleanupID !== cleanupID || !cleanupMatchesOwner(receipt, grant)) throw unavailable();
      await this.#confirmAuthorization(grant, 'cleanup-provider', authorized.checkedAt);
      this.#uncertain.delete(grant.agentId);
      this.#providerCleanupCompletions.set(grant.agentId, receipt);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(grant.agentId); }
  }
  // Consume only a same-owner native cleanup receipt when no MCP plan, effect,
  // outstanding request or other retained resource exists. Broker settlement
  // and the admission fence are checked separately by the caller.
  takeReleasedProviderOwner(threadId, reservation, cleanupReceipt, client) {
    const agentId = AgentID.parse(`codex:${threadId}`), held = reservationSchema.parse(reservation);
    const receipt = ProviderCleanupReceipt.parse(cleanupReceipt);
    if (this.#closed || client !== this.#client || JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        JSON.stringify(this.#providerCleanupCompletions.get(agentId)) !== JSON.stringify(receipt) ||
        JSON.stringify(receipt.resource.reservation) !== JSON.stringify(held) || this.#mcpPlans.has(agentId) ||
        this.#providerPlans.has(agentId) || this.#providerResources.has(agentId) || this.#mcpResources.has(agentId) ||
        this.#mcpQuiescence.has(agentId) || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
        this.#destinationPending.has(agentId) || this.#effectAuthorizing.has(agentId) ||
        [...this.#pending.values()].some(request => request.threadId === threadId)) throw unavailable();
    this.#providerCleanupCompletions.delete(agentId); this.#reservations.delete(agentId);
    this.#destinations.delete(agentId); this.#agents.delete(agentId);
  }
  async bindGrant(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    if (grant.purpose !== undefined || !grant.agentId.startsWith('codex:') || grant.status !== 'prepared' || this.#closed || this.#uncertain.has(grant.agentId) || this.#abandoning.has(grant.agentId) || this.#mcpPlans.has(grant.agentId)) throw unavailable();
    this.#agents.add(grant.agentId);
    try {
      const authorized = await this.#client.request('control_worktree_authorize', {
        agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, ...(grant.checkpointConfigSha256 ? { action: 'checkpoint-inspect' } : {}),
      });
      if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
      const receipt = z.strictObject({ transitionId: z.string().uuid(), reservation: reservationSchema }).parse(
        await this.#request({ method: 'bindGrant', threadId: grant.agentId.slice('codex:'.length), reservation: held, grant }));
      if (receipt.transitionId !== grant.id || JSON.stringify(receipt.reservation) !== JSON.stringify(held)) throw unavailable();
      return receipt;
    } catch { this.close(); throw unavailable(); }
  }
  // The imported journal is read without starting a thread. This is not a
  // policy approval or execution grant. Recheck broker authority after the
  // native reply so a revocation during the observation discards the reply.
  async inspectCheckpointJournal(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), agentId = grant.agentId;
    if (!agentId.startsWith('codex:') || grant.purpose !== undefined || grant.status !== 'prepared' ||
        !grant.checkpointConfigSha256 || this.#closed || this.#effectAuthorizing.has(agentId)) throw unavailable();
    this.#agents.add(agentId);
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'checkpoint-inspect');
      const threadId = agentId.slice('codex:'.length);
      const value = z.strictObject({ version: z.literal(1), threadId: z.string().uuid(), transitionId: z.string().uuid(),
        reservation: reservationSchema, status: z.literal('quarantined_unverified'), releaseAllowed: z.literal(false) }).parse(
        await this.#request({ method: 'inspectCheckpointJournal', threadId, reservation: held, grant }));
      if (value.threadId !== threadId || value.transitionId !== grant.id || JSON.stringify(value.reservation) !== JSON.stringify(held)) throw unavailable();
      await this.#authorizeDestinationGrant(grant, checkedAt, 'checkpoint-inspect');
      return value;
    } catch { this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(agentId); }
  }
  // This keeps a native candidate only for observational use. Metadata must
  // come from the verifier's authenticated receipt context; the hashes do not
  // authenticate the caller or authorize policy approval or execution.
  async inspectCheckpointCandidate(expected, reservation, inputMetadata) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const metadata = CheckpointMetadata.parse(inputMetadata), agentId = grant.agentId;
    const composite = createHash('sha256').update(`${metadata.threadId}:${grant.id}:${held.generation}:${held.revision}:${metadata.rolloutSha256}:${metadata.journalSha256}:${metadata.rolloutBytes}`).digest('hex');
    if (!agentId.startsWith('codex:') || grant.purpose !== undefined || grant.status !== 'prepared' || !grant.checkpointConfigSha256 ||
        metadata.threadId !== agentId.slice(6) || metadata.transitionId !== grant.id || metadata.digest !== composite ||
        JSON.stringify(metadata.reservation) !== JSON.stringify(held) || this.#closed || this.#effectAuthorizing.has(agentId)) throw unavailable();
    this.#agents.add(agentId); this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'checkpoint-inspect');
      const value = z.strictObject({ version: z.literal(1), candidateId: z.string().uuid(), status: z.literal('quarantined_unverified'),
        releaseAllowed: z.literal(false) }).parse(await this.#request({ method: 'inspectCheckpointCandidate', threadId: metadata.threadId,
        reservation: held, grant, digest: metadata.digest, rolloutSha256: metadata.rolloutSha256, journalSha256: metadata.journalSha256 }));
      await this.#authorizeDestinationGrant(grant, checkedAt, 'checkpoint-inspect');
      return value;
    } catch { this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(agentId); }
  }
  async revalidateCheckpointCandidate(expected, reservation, candidateId) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), id = z.string().uuid().parse(candidateId), agentId = grant.agentId;
    if (!agentId.startsWith('codex:') || grant.purpose !== undefined || grant.status !== 'prepared' || !grant.checkpointConfigSha256 ||
        this.#closed || this.#effectAuthorizing.has(agentId)) throw unavailable();
    this.#agents.add(agentId); this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'checkpoint-inspect');
      const value = z.strictObject({ version: z.literal(1), candidateId: z.string().uuid(), status: z.literal('quarantined_unverified'),
        releaseAllowed: z.literal(false) }).parse(await this.#request({ method: 'revalidateCheckpointCandidate', candidateId: id, reservation: held, grant }));
      if (value.candidateId !== id) throw unavailable();
      await this.#authorizeDestinationGrant(grant, checkedAt, 'checkpoint-inspect');
      return value;
    } catch { this.close(); throw unavailable(); } finally { this.#effectAuthorizing.delete(agentId); }
  }
  // Experimental checkpoint data only; never an import, receipt or release.
  async exportCheckpoint(expected, reservation) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), agentId = grant.agentId;
    if (!agentId.startsWith('codex:') || grant.status !== 'prepared' || this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held)) throw unavailable();
    const threadId = agentId.slice('codex:'.length), chunks = {}; let baseline;
    try {
      for (const kind of ['rollout', 'journal']) {
        let offset = 0; const parts = [];
        for (;;) {
          const authorized = await this.#client.request('control_worktree_authorize', { agentId, channel: grant.channel, credential: await this.#credential(), grant,
            ...(grant.checkpointConfigSha256 ? { action: 'checkpoint-inspect' } : {}) });
          if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
              JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw unavailable();
          const chunk = checkpointChunkSchema.parse(await this.#request({ method: 'exportCheckpointChunk', threadId, reservation: held, grant, kind, offset,
            expectedDigest: baseline?.digest ?? null }));
          const meta = { threadId: chunk.threadId, transitionId: chunk.transitionId, reservation: chunk.reservation, digest: chunk.digest,
            rolloutSha256: chunk.rolloutSha256, journalSha256: chunk.journalSha256, rolloutBytes: chunk.rolloutBytes, journalBytes: chunk.journalBytes };
          const digest = createHash('sha256').update(`${threadId}:${grant.id}:${held.generation}:${held.revision}:${chunk.rolloutSha256}:${chunk.journalSha256}:${chunk.rolloutBytes}`).digest('hex');
          if (chunk.threadId !== threadId || chunk.transitionId !== grant.id || JSON.stringify(chunk.reservation) !== JSON.stringify(held) ||
              chunk.digest !== digest || (baseline && JSON.stringify(meta) !== JSON.stringify(baseline)) || chunk.kind !== kind || chunk.offset !== offset ||
              this.#closed || JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held)) throw unavailable();
          baseline ??= meta;
          const bytes = Buffer.from(chunk.data, 'base64');
          if (bytes.toString('base64') !== chunk.data || chunk.nextOffset !== offset + bytes.length || bytes.length > 6144 ||
              chunk.nextOffset > (kind === 'rollout' ? chunk.rolloutBytes : chunk.journalBytes) ||
              chunk.done !== (chunk.nextOffset === (kind === 'rollout' ? chunk.rolloutBytes : chunk.journalBytes)) || (!chunk.done && bytes.length === 0)) throw unavailable();
          parts.push(bytes); offset = chunk.nextOffset; if (chunk.done) break;
        }
        const bytes = Buffer.concat(parts); const sha = createHash('sha256').update(bytes).digest('hex');
        if (sha !== (kind === 'rollout' ? baseline.rolloutSha256 : baseline.journalSha256)) throw unavailable();
        chunks[kind] = bytes;
      }
      // A revocation can arrive after the final native chunk. Do not expose
      // even an observational export unless the same grant is still current.
      const authorized = await this.#client.request('control_worktree_authorize', { agentId, channel: grant.channel, credential: await this.#credential(), grant,
        ...(grant.checkpointConfigSha256 ? { action: 'checkpoint-inspect' } : {}) });
      if (!Stamp.safeParse(authorized.checkedAt).success || authorized.checkedAt < grant.preparedAt ||
          JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant) || this.#closed ||
          JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held)) throw unavailable();
      return { version: 1, ...baseline, rollout: chunks.rollout, journal: chunks.journal, releaseAllowed: false };
    } catch { this.close(); throw unavailable(); }
  }
  // Re-read and hash both native files under the original owner/reservation.
  // This is an observation at one instant, not a filesystem exclusion lease.
  async revalidateCheckpoint(expected, reservation, checkpoint) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), agentId = grant.agentId;
    const meta = z.strictObject({ version: z.literal(1), threadId: z.string().uuid(), transitionId: z.string().uuid(), reservation: reservationSchema,
      digest: z.string().regex(/^[a-f0-9]{64}$/), rolloutSha256: z.string().regex(/^[a-f0-9]{64}$/), journalSha256: z.string().regex(/^[a-f0-9]{64}$/),
      rolloutBytes: z.number().int().min(0).max(4 * 1024 * 1024), journalBytes: z.number().int().min(0).max(65536) }).parse(checkpoint);
    if (!agentId.startsWith('codex:') || grant.status !== 'prepared' || this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) || meta.threadId !== agentId.slice(6) ||
        meta.transitionId !== grant.id || JSON.stringify(meta.reservation) !== JSON.stringify(held)) throw unavailable();
    const authorize = async () => {
      const result = await this.#client.request('control_worktree_authorize', { agentId, channel: grant.channel, credential: await this.#credential(), grant,
        ...(grant.checkpointConfigSha256 ? { action: 'checkpoint-inspect' } : {}) });
      if (!Stamp.safeParse(result.checkedAt).success || result.checkedAt < grant.preparedAt ||
          JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant) || this.#closed ||
          JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held)) throw unavailable();
    };
    try {
      await authorize();
      const result = checkpointChunkSchema.parse(await this.#request({ method: 'exportCheckpointChunk', threadId: meta.threadId, reservation: held, grant,
        kind: 'rollout', offset: meta.rolloutBytes, expectedDigest: meta.digest }));
      if (result.threadId !== meta.threadId || result.transitionId !== meta.transitionId || JSON.stringify(result.reservation) !== JSON.stringify(held) ||
          result.digest !== meta.digest || result.rolloutSha256 !== meta.rolloutSha256 || result.journalSha256 !== meta.journalSha256 ||
          result.rolloutBytes !== meta.rolloutBytes || result.journalBytes !== meta.journalBytes || result.kind !== 'rollout' ||
          result.offset !== meta.rolloutBytes || result.nextOffset !== meta.rolloutBytes || result.data !== '' || !result.done || this.#closed) throw unavailable();
      await authorize();
      return { ...meta, status: 'quarantined_unverified', releaseAllowed: false };
    } catch { this.close(); throw unavailable(); }
  }
  // The native owner closes this channel if the retained snapshot is
  // invalidated or expires. This watch does not authorize publication.
  async watchCheckpointSnapshot(expected, reservation, checkpoint) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    try {
      const observed = await this.revalidateCheckpoint(grant, held, checkpoint);
      const brokerWatch = await this.#client.request('control_authority_watch', { agentId: grant.agentId, channel: grant.channel,
        credential: await this.#credential(), grant });
      if (brokerWatch?.watching !== true || this.#closed) throw unavailable();
      const result = z.strictObject({ status: z.literal('watching_unverified'), releaseAllowed: z.literal(false) }).parse(
        await this.#request({ method: 'watchCheckpointSnapshot', threadId: observed.threadId, reservation: held, grant, digest: observed.digest }));
      const checked = await this.#client.request('control_worktree_authorize', { agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant,
        ...(grant.checkpointConfigSha256 ? { action: 'checkpoint-inspect' } : {}) });
      if (!Stamp.safeParse(checked.checkedAt).success || checked.checkedAt < grant.preparedAt ||
          JSON.stringify(WorktreeTransition.parse(checked.grant)) !== JSON.stringify(grant) || this.#closed ||
          JSON.stringify(this.#reservations.get(grant.agentId)) !== JSON.stringify(held)) throw unavailable();
      return result;
    } catch { this.close(); throw unavailable(); }
  }
  async #authorizeDestinationGrant(grant, earliest, action = 'bind-destination-grant') {
    const checked = await this.#client.request('control_worktree_authorize', {
      agentId: grant.agentId, channel: grant.channel, credential: await this.#credential(), grant, action,
    });
    if (this.#closed || this.#destinations.get(grant.agentId)?.invalid || !Stamp.safeParse(checked.checkedAt).success || checked.checkedAt < earliest ||
        JSON.stringify(WorktreeTransition.parse(checked.grant)) !== JSON.stringify(grant)) throw unavailable();
    return checked.checkedAt;
  }
  #fixtureOwner(expected, reservation, retainedValue) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation),
      retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = grant.agentId;
    if (!this.#experimentalPublication || this.#closed || this.#effectAuthorizing.has(agentId) ||
        JSON.stringify(this.#boundDestinationGrants.get(agentId)) !== JSON.stringify(grant) ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained) ||
        grant.destinationOwners?.stepID !== retained.stepID) throw unavailable();
    return { grant, held, retained, agentId };
  }
  // Debug-only staging; the resulting native session remains quarantined.
  async stageDestinationFixture(expected, reservation, retainedValue, operationID, barrier) {
    z.string().uuid().parse(operationID);
    const { grant, held, retained, agentId } = this.#fixtureOwner(expected, reservation, retainedValue);
    const guard = () => this.assertPublicationBarrier(barrier, agentId.slice(6)); guard();
    if (this.#uncertain.has(agentId) || this.#stagedPublications.has(agentId)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      guard(); const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt); guard();
      this.#uncertain.set(agentId, { operation: 'stageDestinationFixture', operationID });
      const { destinationOwners: _owners, sourceMcpShutdown: _sourceMcpShutdown, sourceModelShutdown: _sourceModelShutdown, sourceRetirement: _sourceRetirement, ...nativeGrant } = grant;
      const result = z.strictObject({ operationID: z.string().uuid(), quarantined: z.literal(true) }).parse(
        await this.#request({ method: 'stageDestinationFixture', threadId: agentId.slice(6), reservation: held, grant: nativeGrant, retained, operationID }));
      if (result.operationID !== operationID) throw unavailable();
      guard(); await this.#authorizeDestinationGrant(grant, checkedAt); guard();
      this.#stagedPublications.set(agentId, { operationID, grant, held, retained }); this.#uncertain.delete(agentId);
      return { operationID, transitionID: grant.id, stepID: retained.stepID, status: 'staged' };
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  // Recover only the same live owner's exact staged publication; never replay it.
  async observeStagedDestinationFixture(expected, reservation, retainedValue, operationID, barrier) {
    z.string().uuid().parse(operationID);
    const { grant, held, retained, agentId } = this.#fixtureOwner(expected, reservation, retainedValue), recovery = this.#uncertain.get(agentId),
      staged = this.#stagedPublications.get(agentId);
    const guard = () => this.assertPublicationBarrier(barrier, agentId.slice(6)); guard();
    if (!(recovery?.operation === 'stageDestinationFixture' && recovery.operationID === operationID && !staged ||
          !recovery && staged?.operationID === operationID && JSON.stringify(staged.grant) === JSON.stringify(grant) &&
          JSON.stringify(staged.held) === JSON.stringify(held) && JSON.stringify(staged.retained) === JSON.stringify(retained))) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      guard(); const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'observe-worktree'); guard();
      const result = z.strictObject({ operationID: z.string().uuid(), installed: z.boolean() }).parse(
        await this.#request({ method: 'observeStagedDestinationFixture', threadId: agentId.slice(6), reservation: held,
          operationID, transitionID: grant.id, stepID: retained.stepID }));
      if (result.operationID !== operationID) throw unavailable();
      guard(); await this.#authorizeDestinationGrant(grant, checkedAt, 'observe-worktree'); guard();
      if (!result.installed) return null;
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === agentId.slice(6) && ['stageDestinationFixture', 'observeStagedDestinationFixture'].includes(entry.method)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      this.#stagedPublications.set(agentId, { operationID, grant, held, retained }); this.#uncertain.delete(agentId);
      return { operationID, transitionID: grant.id, stepID: retained.stepID, status: 'staged' };
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  async shutdownSourceFixture(expected, reservation, retainedValue, operationID, shutdownID, barrier) {
    z.string().uuid().parse(operationID); z.string().uuid().parse(shutdownID);
    const { grant, held, retained, agentId } = this.#fixtureOwner(expected, reservation, retainedValue), staged = this.#stagedPublications.get(agentId);
    const guard = () => this.assertPublicationBarrier(barrier, agentId.slice(6)); guard();
    if (grant.sourceMcpShutdown !== true || this.#uncertain.has(agentId) || staged?.operationID !== operationID || staged.shutdownID) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      guard(); const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'shutdown-source-mcp'); guard();
      this.#uncertain.set(agentId, { operation: 'shutdownSourceFixture', operationID, shutdownID });
      const result = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(), closedLocal: z.literal(true) }).parse(
        await this.#request({ method: 'shutdownSourceFixture', threadId: agentId.slice(6), reservation: held, operationID, shutdownID }));
      if (result.operationID !== operationID || result.shutdownID !== shutdownID) throw unavailable();
      guard(); await this.#authorizeDestinationGrant(grant, checkedAt, 'shutdown-source-mcp'); guard();
      staged.shutdownID = shutdownID; this.#uncertain.delete(agentId);
      return { shutdownID, operationID, transitionID: grant.id, stepID: retained.stepID, status: 'closed_local' };
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  async observeSourceShutdownFixture(expected, reservation, retainedValue, operationID, shutdownID, barrier) {
    z.string().uuid().parse(operationID); z.string().uuid().parse(shutdownID);
    const { grant, held, retained, agentId } = this.#fixtureOwner(expected, reservation, retainedValue), staged = this.#stagedPublications.get(agentId), recovery = this.#uncertain.get(agentId);
    const guard = () => this.assertPublicationBarrier(barrier, agentId.slice(6)); guard();
    if (grant.sourceMcpShutdown !== true || staged?.operationID !== operationID ||
        !(recovery?.operation === 'shutdownSourceFixture' && recovery.operationID === operationID && recovery.shutdownID === shutdownID ||
          !recovery && staged.shutdownID === shutdownID)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      guard(); const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'observe-source-mcp-shutdown'); guard();
      const result = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(), closedLocal: z.boolean() }).parse(
        await this.#request({ method: 'observeSourceShutdownFixture', threadId: agentId.slice(6), reservation: held, operationID, shutdownID }));
      if (result.operationID !== operationID || result.shutdownID !== shutdownID) throw unavailable();
      guard(); await this.#authorizeDestinationGrant(grant, checkedAt, 'observe-source-mcp-shutdown'); guard();
      if (!result.closedLocal) return null;
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === agentId.slice(6)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      staged.shutdownID = shutdownID; this.#uncertain.delete(agentId);
      return { shutdownID, operationID, transitionID: grant.id, stepID: retained.stepID, status: 'closed_local' };
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  // Debug fixture only. The broker approval and barrier do not prove remote completion.
  async shutdownSourceModelFixture(expected, reservation, retainedValue, operationID, shutdownID, barrier) {
    z.string().uuid().parse(operationID); z.string().uuid().parse(shutdownID);
    const { grant, held, retained, agentId } = this.#fixtureOwner(expected, reservation, retainedValue), staged = this.#stagedPublications.get(agentId);
    const guard = () => this.assertPublicationBarrier(barrier, agentId.slice(6)); guard();
    if (grant.sourceModelShutdown !== true || this.#uncertain.has(agentId) || staged?.operationID !== operationID || !staged.shutdownID || staged.modelShutdownID) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      guard(); const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'shutdown-source-model'); guard();
      this.#uncertain.set(agentId, { operation: 'shutdownSourceModelFixture', operationID, shutdownID });
      const result = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(), socketClosed: z.boolean() }).parse(
        await this.#request({ method: 'shutdownSourceModelFixture', threadId: agentId.slice(6), reservation: held, operationID, shutdownID }));
      if (result.operationID !== operationID || result.shutdownID !== shutdownID) throw unavailable();
      guard(); await this.#authorizeDestinationGrant(grant, checkedAt, 'shutdown-source-model'); guard();
      staged.modelShutdownID = shutdownID; this.#uncertain.delete(agentId);
      return { shutdownID, operationID, transitionID: grant.id, stepID: retained.stepID,
        status: result.socketClosed ? 'closed_local' : 'absent_local' };
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  async observeSourceModelShutdownFixture(expected, reservation, retainedValue, operationID, shutdownID, barrier) {
    z.string().uuid().parse(operationID); z.string().uuid().parse(shutdownID);
    const { grant, held, retained, agentId } = this.#fixtureOwner(expected, reservation, retainedValue), staged = this.#stagedPublications.get(agentId), recovery = this.#uncertain.get(agentId);
    const guard = () => this.assertPublicationBarrier(barrier, agentId.slice(6)); guard();
    if (grant.sourceModelShutdown !== true || staged?.operationID !== operationID || !staged.shutdownID ||
        !(recovery?.operation === 'shutdownSourceModelFixture' && recovery.operationID === operationID && recovery.shutdownID === shutdownID ||
          !recovery && staged.modelShutdownID === shutdownID)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      guard(); const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'observe-source-model-shutdown'); guard();
      const result = z.strictObject({ operationID: z.string().uuid(), shutdownID: z.string().uuid(), socketClosed: z.boolean().nullable() }).parse(
        await this.#request({ method: 'observeSourceModelShutdownFixture', threadId: agentId.slice(6), reservation: held, operationID, shutdownID }));
      if (result.operationID !== operationID || result.shutdownID !== shutdownID) throw unavailable();
      guard(); await this.#authorizeDestinationGrant(grant, checkedAt, 'observe-source-model-shutdown'); guard();
      if (result.socketClosed === null) return null;
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === agentId.slice(6)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      staged.modelShutdownID = shutdownID; this.#uncertain.delete(agentId);
      return { shutdownID, operationID, transitionID: grant.id, stepID: retained.stepID,
        status: result.socketClosed ? 'closed_local' : 'absent_local' };
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  async bindDestinationGrant(expected, reservation, retainedValue) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation);
    const retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = grant.agentId;
    const refs = grant.destinationOwners, destination = this.#destinations.get(agentId);
    if (!this.#experimentalStep || !refs || grant.status !== 'prepared' || grant.purpose !== undefined ||
        !agentId.startsWith('codex:') || this.#closed || this.#uncertain.has(agentId) || this.#abandoning.has(agentId) ||
        this.#effectAuthorizing.has(agentId) || this.#mcpQuiescence.has(agentId) || this.#stepDisposals.has(agentId) || this.#cancelledDestinationGrants.has(agentId) ||
        !destination || destination.invalid || destination.candidateId !== retained.candidateID ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained) ||
        retained.status !== 'retained' || retained.stepID !== refs.stepID ||
        retained.mcpResourceID !== refs.mcpResourceID || retained.providerResourceID !== refs.providerResourceID ||
        this.#mcpResources.get(agentId)?.transitionID !== refs.mcpTransitionID ||
        this.#providerResources.get(agentId)?.transitionID !== refs.providerTransitionID ||
        JSON.stringify(this.#mcpResources.get(agentId)?.reservation) !== JSON.stringify(held) ||
        JSON.stringify(this.#providerResources.get(agentId)?.reservation) !== JSON.stringify(held)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt);
      this.#uncertain.set(agentId, { operation: 'bindDestinationGrant', grant, reservation: held, retained });
      const { destinationOwners: _owners, sourceMcpShutdown: _sourceMcpShutdown, sourceModelShutdown: _sourceModelShutdown, sourceRetirement: _sourceRetirement, ...nativeGrant } = grant;
      const receipt = z.strictObject({ transitionId: z.string().uuid(), reservation: reservationSchema }).parse(
        await this.#request({ method: 'bindDestinationGrant', threadId: agentId.slice('codex:'.length), reservation: held, grant: nativeGrant, retained }));
      if (receipt.transitionId !== grant.id || JSON.stringify(receipt.reservation) !== JSON.stringify(held)) throw unavailable();
      await this.#authorizeDestinationGrant(grant, checkedAt);
      this.#boundDestinationGrants.set(agentId, grant); this.#uncertain.delete(agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  markCompletedDestinationBindingUncertain(expected, reservation, retainedValue) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = grant.agentId;
    if (this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) ||
        JSON.stringify(this.#boundDestinationGrants.get(agentId)) !== JSON.stringify(grant) ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained)) throw unavailable();
    this.#uncertain.set(agentId, { operation: 'bindDestinationGrant', grant, reservation: held, retained });
  }
  async observeDestinationGrant(expected, reservation, retainedValue) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = grant.agentId,
      recovery = this.#uncertain.get(agentId);
    if (this.#closed || this.#effectAuthorizing.has(agentId) || recovery?.operation !== 'bindDestinationGrant' ||
        JSON.stringify(recovery.grant) !== JSON.stringify(grant) || JSON.stringify(recovery.reservation) !== JSON.stringify(held) ||
        JSON.stringify(recovery.retained) !== JSON.stringify(retained)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'observe-worktree');
      const { destinationOwners: _owners, sourceMcpShutdown: _sourceMcpShutdown, sourceModelShutdown: _sourceModelShutdown, sourceRetirement: _sourceRetirement, ...nativeGrant } = grant;
      const result = z.strictObject({ transitionId: z.string().uuid(), reservation: reservationSchema }).parse(
        await this.#request({ method: 'observeDestinationGrant', threadId: agentId.slice('codex:'.length), reservation: held, grant: nativeGrant, retained }));
      if (result.transitionId !== grant.id || JSON.stringify(result.reservation) !== JSON.stringify(held)) throw unavailable();
      await this.#authorizeDestinationGrant(grant, checkedAt, 'observe-worktree');
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === agentId.slice('codex:'.length)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      this.#boundDestinationGrants.set(agentId, grant); this.#uncertain.delete(agentId);
      return result;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  #checkDestinationCancellation(value, grant, retained, cancellationID) {
    const receipt = destinationCancellationSchema.parse(value);
    if (receipt.transitionID !== grant.id || receipt.stepID !== retained.stepID || receipt.cancellationID !== cancellationID) throw unavailable();
    return receipt;
  }
  async cancelDestinationGrant(expected, reservation, retainedValue, cancellationID) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = grant.agentId;
    z.string().uuid().parse(cancellationID);
    if (this.#closed || this.#uncertain.has(agentId) || this.#effectAuthorizing.has(agentId) || this.#cancelledDestinationGrants.has(agentId) ||
        JSON.stringify(this.#boundDestinationGrants.get(agentId)) !== JSON.stringify(grant) ||
        JSON.stringify(this.#stepResources.get(agentId)) !== JSON.stringify(retained) ||
        JSON.stringify(this.#reservations.get(agentId)) !== JSON.stringify(held) || grant.destinationOwners?.stepID !== retained.stepID) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'cancel-destination-grant');
      this.#uncertain.set(agentId, { operation: 'cancelDestinationGrant', grant, reservation: held, retained, cancellationID });
      const { destinationOwners: _owners, sourceMcpShutdown: _sourceMcpShutdown, sourceModelShutdown: _sourceModelShutdown, sourceRetirement: _sourceRetirement, ...nativeGrant } = grant;
      const receipt = this.#checkDestinationCancellation(await this.#request({ method: 'cancelDestinationGrant', threadId: agentId.slice('codex:'.length),
        reservation: held, grant: nativeGrant, retained, cancellationID }), grant, retained, cancellationID);
      await this.#authorizeDestinationGrant(grant, checkedAt, 'cancel-destination-grant');
      this.#cancelledDestinationGrants.set(agentId, { grant, retained, receipt });
      this.#boundDestinationGrants.delete(agentId); this.#uncertain.delete(agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  async observeDestinationGrantCancellation(expected, reservation, retainedValue, cancellationID) {
    const grant = WorktreeTransition.parse(expected), held = reservationSchema.parse(reservation), retained = CodexStepPreparationReceipt.parse(retainedValue), agentId = grant.agentId,
      recovery = this.#uncertain.get(agentId), completed = this.#cancelledDestinationGrants.get(agentId);
    z.string().uuid().parse(cancellationID);
    const recovering = recovery?.operation === 'cancelDestinationGrant' && recovery.cancellationID === cancellationID &&
      JSON.stringify(recovery.grant) === JSON.stringify(grant) && JSON.stringify(recovery.reservation) === JSON.stringify(held) &&
      JSON.stringify(recovery.retained) === JSON.stringify(retained);
    const alreadyObserved = !recovery && completed?.receipt.cancellationID === cancellationID &&
      JSON.stringify(completed.grant) === JSON.stringify(grant) && JSON.stringify(completed.retained) === JSON.stringify(retained) &&
      JSON.stringify(this.#reservations.get(agentId)) === JSON.stringify(held);
    if (this.#closed || this.#effectAuthorizing.has(agentId) || (!recovering && !alreadyObserved)) throw unavailable();
    this.#effectAuthorizing.add(agentId);
    try {
      const checkedAt = await this.#authorizeDestinationGrant(grant, grant.preparedAt, 'cancel-destination-grant');
      const { destinationOwners: _owners, sourceMcpShutdown: _sourceMcpShutdown, sourceModelShutdown: _sourceModelShutdown, sourceRetirement: _sourceRetirement, ...nativeGrant } = grant;
      const receipt = this.#checkDestinationCancellation(await this.#request({ method: 'observeDestinationGrantCancellation', threadId: agentId.slice('codex:'.length),
        reservation: held, grant: nativeGrant, retained, cancellationID }), grant, retained, cancellationID);
      await this.#authorizeDestinationGrant(grant, checkedAt, 'cancel-destination-grant');
      for (const [id, entry] of this.#pending) if (entry.timedOut && entry.threadId === agentId.slice('codex:'.length)) {
        if (this.#retiredReplies.size >= 32) throw unavailable();
        this.#pending.delete(id); clearTimeout(entry.timer); this.#retiredReplies.add(id);
      }
      this.#cancelledDestinationGrants.set(agentId, { grant, retained, receipt });
      this.#boundDestinationGrants.delete(agentId); this.#uncertain.delete(agentId);
      return receipt;
    } catch (error) { if (error instanceof NativeEffectReplyUncertain) throw error; this.close(); throw unavailable(); }
    finally { this.#effectAuthorizing.delete(agentId); }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) { try { listener(); } catch { /* Closing the owner must still complete. */ } }
    this.#closeListeners.clear();
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
    this.#pending.clear(); this.#buffer = Buffer.alloc(0); this.#agents.clear(); this.#reservations.clear(); this.#abandoning.clear(); this.#providerPlans.clear(); this.#mcpPlans.clear(); this.#destinations.clear(); this.#destinationPending.clear(); this.#providerResources.clear(); this.#providerCleanupCompletions.clear(); this.#mcpResources.clear(); this.#mcpQuiescence.clear(); this.#stepResources.clear(); this.#stepDisposals.clear(); this.#boundDestinationGrants.clear(); this.#cancelledDestinationGrants.clear(); this.#effectAuthorizing.clear(); this.#uncertain.clear(); this.#retiredReplies.clear();
    this.#client.off('disconnected', this.#disconnected); this.#client.off('membership_removed', this.#removed);
    this.#stream.destroy();
  }
}
