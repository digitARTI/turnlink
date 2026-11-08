import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const limit = 16 * 1024;
const unavailable = () => Object.assign(new Error('NATIVE_RECOVERY_UNAVAILABLE'), { code: 'NATIVE_RECOVERY_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('NATIVE_RECOVERY_UNCERTAIN'), { code: 'NATIVE_RECOVERY_UNCERTAIN' });
const liveBusy = () => Object.assign(new Error('NATIVE_MOVEMENT_BUSY'), { code: 'NATIVE_MOVEMENT_BUSY' });
const session = z.string().startsWith('ses_').max(1024);
const location = z.strictObject({ directory: z.string().refine(isAbsolute), workspaceID: z.string().optional() });
export const intentSchema = z.strictObject({
  version: z.literal(1), phase: z.literal('quarantined'), sessionID: session, transitionID: z.string().min(1),
  pluginID: z.string().min(1), incarnation: z.string().uuid(), leaseIncarnation: z.string().uuid().optional(), membershipFence: z.literal(1).optional(),
  activation: z.string().uuid(), generation: z.number().int().positive().safe(), source: location,
  directory: z.string().refine(isAbsolute),
});
const recoverySchema = z.strictObject({
  version: z.literal(1), sessionID: session, transitionID: z.string().min(1), previousLeaseIncarnation: z.string().uuid(),
  leaseIncarnation: z.string().uuid(), incarnation: z.string().uuid(), activation: z.string().uuid(),
  generation: z.number().int().positive().safe(),
});
const recoveryRecordSchema = z.strictObject({ currentLease: z.string().uuid(), recovery: recoverySchema.nullable() });
export const membershipSealSchema = z.strictObject({ version: z.literal(1), sessionID: session, transitionID: z.string().min(1),
  pluginID: z.string().min(1), namespace: z.string().min(1), source: location, destination: z.string().refine(isAbsolute), leaseIncarnation: z.string().uuid(),
  nonce: z.string().uuid(), binding: z.string().min(1) }).refine(value => {
  const { binding, ...fields } = value;
  const namespace = `plugin:${value.pluginID.split('').map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}:`;
  return value.namespace === namespace && binding === JSON.stringify(fields);
});
export const destinationMembershipSchema = z.strictObject({ version: z.literal(1), sessionID: session, transitionID: z.string().min(1),
  pluginID: z.string().min(1), namespace: z.string().min(1), source: location, destination: z.string().refine(isAbsolute),
  leaseIncarnation: z.string().uuid(), archiveNonce: z.string().uuid(), archiveDigest: z.string().regex(/^[a-f0-9]{64}$/),
  receiverHash: z.string().regex(/^[a-f0-9]{64}$/), nonce: z.string().uuid(), valueDigest: z.string().regex(/^[a-f0-9]{64}$/),
  binding: z.string().min(1) }).refine(value => {
  const { binding, ...fields } = value;
  const namespace = `plugin:${value.pluginID.split('').map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}:`;
  return value.namespace === namespace && binding === JSON.stringify(fields);
});
export const placementReceiptSchema = z.strictObject({ version: z.literal(1), sessionID: session, transitionID: z.string().min(1),
  source: location, destination: location, projectID: z.string().min(1), subpath: z.string().optional(),
  eventID: z.string().startsWith('evt_'), eventSeq: z.number().int().nonnegative().safe(),
  archiveNonce: z.string().uuid(), stageNonce: z.string().uuid(), receiverHash: z.string().regex(/^[a-f0-9]{64}$/),
  leaseIncarnation: z.string().uuid() });
export const completionSchema = z.strictObject({ version: z.literal(1), placement: placementReceiptSchema, leaseIncarnation: z.string().uuid() });
// Deterministic broker receipt identity for this exact durable native event.
// This binds values; it does not authenticate the native observation itself.
export function placementReceiptID(value) {
  const receipt = placementReceiptSchema.parse(value);
  const fields = ['opencode-placement-v1', receipt.sessionID, receipt.transitionID, receipt.source.directory,
    receipt.source.workspaceID ?? null, receipt.destination.directory, receipt.destination.workspaceID ?? null,
    receipt.projectID, receipt.subpath ?? null, receipt.eventID, receipt.eventSeq, receipt.archiveNonce,
    receipt.stageNonce, receipt.receiverHash, receipt.leaseIncarnation];
  const hash = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const inspectionSchema = z.strictObject({
  recovery: recoverySchema,
  session: z.strictObject({ id: session, location, agent: z.string().optional(), model: z.unknown().optional() }),
  inboxCount: z.number().int().nonnegative().safe(), pendingCount: z.number().int().nonnegative().safe(),
  messageCount: z.number().int().nonnegative().safe(),
  webSocketAcquisitions: z.strictObject({ priorLease: z.number().int().nonnegative().safe(), currentLease: z.number().int().nonnegative().safe() }),
  dependentPriorWebSocketSessions: z.number().int().nonnegative().safe(),
  membershipSeal: membershipSealSchema.nullable(), membershipPresent: z.boolean(),
  unresolved: z.array(z.string()).max(100),
});
const replySchema = z.strictObject({ id: z.number().int().positive().safe(), result: z.unknown().optional(), error: z.string().optional() });
const promotionReceiptSchema = z.strictObject({ version: z.literal(1), sessionID: session, transitionID: z.string().uuid(), destination: location,
  completionLeaseIncarnation: z.string().uuid(), nativeLeaseIncarnation: z.string().uuid(), promotionID: z.string().uuid() });
const transportReceiptSchema = z.strictObject({ sessionID: session, family: z.literal('session-model-websocket'), released: z.number().int().nonnegative().safe() });
const recoveryTransportSchema = z.strictObject({ intent: intentSchema, recovery: recoverySchema,
  release: z.strictObject({ version: z.literal(1), sessionID: session, transitionID: z.string().min(1), leaseIncarnation: z.string().uuid(),
    incarnation: z.string().uuid(), activation: z.string().uuid(), generation: z.number().int().positive().safe(),
    family: z.literal('session-model-websocket'), released: z.number().int().nonnegative().safe() }) });

// The inherited stream is a host capability, not broker approval or proof that
// the prior process released resources. Never attach it to plugin/model RPC.
export class OpenCodeNativeRecovery {
  #stream; #session; #source; #plugin; #timeout; #sequence = 0; #buffer = Buffer.alloc(0);
  #pending; #closed = false; #intent; #claim; #observation; #promotionDispatched = false; #promoted; #liveAdapter; #closeListeners = new Set();
  constructor({ stream, sessionID, source, pluginID, timeoutMs = 30000 }) {
    if (!stream?.write || !stream?.on || !stream?.destroy || !session.safeParse(sessionID).success ||
      !location.safeParse(source).success || typeof pluginID !== 'string' || !pluginID ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw unavailable();
    this.#stream = stream; this.#session = sessionID; this.#source = location.parse(source); this.#plugin = pluginID; this.#timeout = timeoutMs;
    stream.on('data', chunk => this.#read(chunk));
    stream.on('error', () => this.close()); stream.on('end', () => this.close()); stream.on('close', () => this.close());
  }
  #read(chunk) {
    try {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      let start = 0;
      for (let i = 0; i < data.length; i++) {
        if (i - start + this.#buffer.length >= limit) throw unavailable();
        if (data[i] !== 10) continue;
        const reply = replySchema.parse(JSON.parse(Buffer.concat([this.#buffer, data.subarray(start, i)]).toString('utf8')));
        this.#buffer = Buffer.alloc(0); start = i + 1;
        if (Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error') || !this.#pending || reply.id !== this.#pending.id) throw unavailable();
        const pending = this.#pending; this.#pending = undefined; clearTimeout(pending.timer);
        if (reply.error) pending.reject(pending.method === 'prepare' && reply.error === 'NATIVE_PREPARE_BUSY' ? liveBusy() : pending.mutating ? uncertain() : unavailable());
        else pending.resolve(reply.result);
      }
      this.#buffer = Buffer.concat([this.#buffer, data.subarray(start)]);
    } catch { this.close(); }
  }
  #request(method, transitionID, extra = {}) {
    if (this.#closed || this.#pending || this.#sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(unavailable());
    const id = ++this.#sequence, mutating = ['claimRecovery', 'takeoverRecovery', 'sealMembership', 'detachMembership', 'stageRecoveredDestinationMembership',
      'commitPreparedPlacement', 'completePlacement', 'promoteLive', 'prepare', 'releaseTransport', 'detachLiveMembership', 'stageDestinationMembership'].includes(method);
    const frame = Buffer.from(`${JSON.stringify({ id, method, sessionID: this.#session, ...(transitionID === undefined ? {} : { transitionID }), ...extra })}\n`);
    if (frame.length > limit) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), this.#timeout);
      this.#pending = { id, resolve, reject, timer, mutating, method };
      try { this.#stream.write(frame, error => { if (error) this.close(); }); } catch { this.close(); }
    });
  }
  #checkIntent(value) {
    const intent = intentSchema.parse(value);
    if (intent.sessionID !== this.#session || intent.pluginID !== this.#plugin ||
      JSON.stringify(intent.source) !== JSON.stringify(this.#source) || intent.directory === intent.source.directory) throw unavailable();
    return intent;
  }
  async inspect() {
    try {
      const intent = this.#checkIntent(await this.#request('inspect'));
      if (this.#intent && JSON.stringify(intent) !== JSON.stringify(this.#intent)) throw unavailable();
      this.#intent = intent;
      return structuredClone(intent);
    } catch { this.close(); throw unavailable(); }
  }
  // Only the host with a durable dispatch record should invoke this private
  // descriptor operation. An ambiguous response is never replayed here.
  async promoteLive(transitionID, promotionID, receiverHash) {
    if (this.#closed || this.#promotionDispatched || !z.string().uuid().safeParse(transitionID).success ||
        !z.string().uuid().safeParse(promotionID).success || !/^[a-f0-9]{64}$/.test(receiverHash || '')) throw unavailable();
    this.#promotionDispatched = true;
    try {
      const value = promotionReceiptSchema.parse(await this.#request('promoteLive', transitionID, { promotionID, receiverHash }));
      if (value.sessionID !== this.#session || value.transitionID !== transitionID || value.promotionID !== promotionID ||
          value.destination.directory === this.#source.directory) throw uncertain();
      this.#promoted = structuredClone(value);
      return structuredClone(value);
    } catch { this.close(); throw uncertain(); }
  }
  // A promoted adapter is valid only in this process and on this descriptor;
  // a persisted promotion receipt cannot recreate it after restart.
  promotedLive(promotionID) {
    if (this.#closed || !this.#promoted || this.#promoted.promotionID !== promotionID || this.#liveAdapter) throw unavailable();
    const owner = this, source = structuredClone(this.#promoted.destination), lease = this.#promoted.nativeLeaseIncarnation;
    let closed = false, intent, released = false, detached = false, stage, committing = false, placement, completing = false, completed;
    const valid = () => { if (closed || owner.#closed) throw unavailable(); };
    const checkedIntent = value => {
      const result = intentSchema.parse(value);
      if (result.sessionID !== owner.#session || result.pluginID !== owner.#plugin || result.membershipFence !== 1 ||
          result.leaseIncarnation !== lease || JSON.stringify(result.source) !== JSON.stringify(source) || result.directory === source.directory) throw unavailable();
      return result;
    };
    const adapter = {
      promotion() { valid(); return structuredClone(owner.#promoted); },
      transportReleased(transitionID) { valid(); return !!intent && released && transitionID === intent.transitionID; },
      async inspect() {
        valid();
        try { const value = await owner.#request('inspectLive'); if (value === null) { if (intent) throw unavailable(); return null; }
          const result = checkedIntent(value); if (intent && JSON.stringify(intent) !== JSON.stringify(result)) throw unavailable(); return structuredClone(result); }
        catch { owner.close(); throw unavailable(); }
      },
      async prepare(transitionID, directory) {
        valid(); if (intent || !z.string().uuid().safeParse(transitionID).success || !isAbsolute(directory) || directory === source.directory) throw unavailable();
        try { const result = checkedIntent(await owner.#request('prepare', transitionID, { directory }));
          if (result.transitionID !== transitionID || result.directory !== directory) throw uncertain();
          intent = result; if (JSON.stringify(await adapter.inspect()) !== JSON.stringify(result)) throw uncertain(); return structuredClone(result); }
        catch (error) { if (error?.code === 'NATIVE_MOVEMENT_BUSY') throw error; owner.close(); throw uncertain(); }
      },
      async releaseTransport(transitionID) {
        valid(); if (!intent || released || transitionID !== intent.transitionID) throw unavailable(); released = true;
        try { const result = transportReceiptSchema.parse(await owner.#request('releaseTransport', transitionID));
          if (result.sessionID !== owner.#session) throw uncertain(); return structuredClone(result); }
        catch { owner.close(); throw uncertain(); }
      },
      async detachLiveMembership(transitionID, channel) {
        valid(); if (!intent || !released || detached || transitionID !== intent.transitionID || typeof channel !== 'string' || !channel || channel.length > 256) throw unavailable();
        detached = true;
        try { const result = membershipSealSchema.parse(await owner.#request('detachLiveMembership', transitionID, { channel }));
          if (result.sessionID !== owner.#session || result.transitionID !== transitionID || result.pluginID !== owner.#plugin ||
              JSON.stringify(result.source) !== JSON.stringify(source) || result.destination !== intent.directory || result.leaseIncarnation !== lease) throw uncertain();
          return structuredClone(result); } catch { owner.close(); throw uncertain(); }
      },
      async stageDestinationMembership(transitionID, channel, receiverHash) {
        valid(); if (!intent || !detached || stage || transitionID !== intent.transitionID || typeof channel !== 'string' || !channel ||
          !/^[a-f0-9]{64}$/.test(receiverHash || '')) throw unavailable();
        try { const result = destinationMembershipSchema.parse(await owner.#request('stageDestinationMembership', transitionID, { channel, receiverHash }));
          if (result.sessionID !== owner.#session || result.transitionID !== transitionID || result.pluginID !== owner.#plugin ||
              JSON.stringify(result.source) !== JSON.stringify(source) || result.destination !== intent.directory || result.leaseIncarnation !== lease || result.receiverHash !== receiverHash) throw uncertain();
          stage = result; return structuredClone(result); } catch { owner.close(); throw uncertain(); }
      },
      async observePlacement(staged) {
        valid(); if (!intent || !stage || JSON.stringify(stage) !== JSON.stringify(staged)) throw unavailable();
        try { const value = await owner.#request('observePlacement', intent.transitionID); if (value === null) return null;
          const result = placementReceiptSchema.parse(value);
          if (result.sessionID !== owner.#session || result.transitionID !== intent.transitionID || JSON.stringify(result.source) !== JSON.stringify(source) ||
              result.destination.directory !== intent.directory || result.destination.workspaceID !== source.workspaceID ||
              result.archiveNonce !== stage.archiveNonce || result.stageNonce !== stage.nonce || result.receiverHash !== stage.receiverHash || result.leaseIncarnation !== lease) throw unavailable();
          return structuredClone(result); } catch { owner.close(); throw unavailable(); }
      },
      async commitPreparedPlacement(staged) {
        valid(); if (!intent || !stage || committing || JSON.stringify(stage) !== JSON.stringify(staged)) throw unavailable(); committing = true;
        try { const result = placementReceiptSchema.parse(await owner.#request('commitPreparedPlacement', intent.transitionID, { receiverHash: stage.receiverHash }));
          if (result.sessionID !== owner.#session || result.transitionID !== intent.transitionID || JSON.stringify(result.source) !== JSON.stringify(source) ||
              result.destination.directory !== intent.directory || result.destination.workspaceID !== source.workspaceID || result.archiveNonce !== stage.archiveNonce ||
              result.stageNonce !== stage.nonce || result.receiverHash !== stage.receiverHash || result.leaseIncarnation !== lease) throw uncertain();
          placement = result; return structuredClone(result); } catch { owner.close(); throw uncertain(); }
      },
      async completePlacement(staged) {
        valid(); if (!intent || !stage || !placement || completing || JSON.stringify(stage) !== JSON.stringify(staged)) throw unavailable(); completing = true;
        try { const result = completionSchema.parse(await owner.#request('completePlacement', intent.transitionID));
          if (JSON.stringify(result.placement) !== JSON.stringify(placement) || result.leaseIncarnation !== lease) throw uncertain();
          completed = result; return structuredClone(result); } catch { owner.close(); throw uncertain(); }
      },
      async observeCompletion(staged) {
        valid(); if (!intent || !stage || JSON.stringify(stage) !== JSON.stringify(staged)) throw unavailable();
        try { const value = await owner.#request('observeCompletion', intent.transitionID); if (value === null) return null;
          const result = completionSchema.parse(value);
          if (!placement || JSON.stringify(result.placement) !== JSON.stringify(placement) || result.leaseIncarnation !== lease ||
              (completed && JSON.stringify(result) !== JSON.stringify(completed))) throw unavailable();
          return structuredClone(result); } catch { owner.close(); throw unavailable(); }
      },
      onClose(listener) { return owner.onClose(listener); },
      close() { closed = true; },
    };
    this.#liveAdapter = Object.freeze(adapter); return this.#liveAdapter;
  }
  async observeRecoveryRecord() {
    if (this.#closed || !this.#intent || !this.#intent.leaseIncarnation) throw unavailable();
    try {
      const observed = recoveryRecordSchema.parse(await this.#request('observeRecoveryRecord', this.#intent.transitionID));
      const claim = observed.recovery;
      if (observed.currentLease === this.#intent.leaseIncarnation || (claim &&
        (claim.sessionID !== this.#session || claim.transitionID !== this.#intent.transitionID ||
          claim.previousLeaseIncarnation !== this.#intent.leaseIncarnation || claim.leaseIncarnation === claim.previousLeaseIncarnation ||
          claim.incarnation === this.#intent.incarnation || claim.activation === this.#intent.activation ||
          claim.generation <= this.#intent.generation))) throw unavailable();
      this.#observation = structuredClone(observed);
      return structuredClone(observed);
    } catch { this.close(); throw unavailable(); }
  }
  async takeoverRecovery(expected, targetLease) {
    if (this.#closed || !this.#intent || this.#claim || !this.#observation?.recovery ||
      JSON.stringify(this.#observation.recovery) !== JSON.stringify(expected) || this.#observation.currentLease !== targetLease)
      throw unavailable();
    try {
      const claim = recoverySchema.parse(await this.#request('takeoverRecovery', this.#intent.transitionID, { expected, targetLease }));
      if (claim.sessionID !== this.#session || claim.transitionID !== this.#intent.transitionID ||
        claim.previousLeaseIncarnation !== this.#intent.leaseIncarnation || claim.leaseIncarnation !== targetLease ||
        claim.generation <= expected.generation || claim.activation === expected.activation || claim.incarnation === expected.incarnation)
        throw uncertain();
      const current = this.#checkIntent(await this.#request('inspect'));
      if (JSON.stringify(current) !== JSON.stringify(this.#intent)) throw uncertain();
      this.#claim = claim;
      return structuredClone(claim);
    } catch { this.close(); throw uncertain(); }
  }
  async claimRecovery(transitionID) {
    if (this.#closed || !this.#intent || this.#claim || transitionID !== this.#intent.transitionID || !this.#intent.leaseIncarnation) throw unavailable();
    try {
      const claim = recoverySchema.parse(await this.#request('claimRecovery', transitionID));
      if (claim.sessionID !== this.#session || claim.transitionID !== transitionID ||
        claim.previousLeaseIncarnation !== this.#intent.leaseIncarnation || claim.leaseIncarnation === claim.previousLeaseIncarnation ||
        claim.incarnation === this.#intent.incarnation || claim.activation === this.#intent.activation ||
        claim.generation <= this.#intent.generation) throw uncertain();
      const current = this.#checkIntent(await this.#request('inspect'));
      if (JSON.stringify(current) !== JSON.stringify(this.#intent)) throw uncertain();
      this.#claim = claim;
      return structuredClone(claim);
    } catch { this.close(); throw uncertain(); }
  }
  async observeRecoveryTransport() {
    if (this.#closed || !this.#claim || !this.#intent) throw unavailable();
    try {
      const raw = await this.#request('observeRecoveryTransport', this.#claim.transitionID);
      if (raw === null) return null;
      const observed = recoveryTransportSchema.parse(raw), release = observed.release;
      if (JSON.stringify(observed.intent) !== JSON.stringify(this.#intent) || JSON.stringify(observed.recovery) !== JSON.stringify(this.#claim) ||
          release.sessionID !== this.#intent.sessionID || release.transitionID !== this.#intent.transitionID ||
          release.leaseIncarnation !== this.#intent.leaseIncarnation || release.incarnation !== this.#intent.incarnation ||
          release.activation !== this.#intent.activation || release.generation !== this.#intent.generation) throw unavailable();
      return structuredClone(observed);
    } catch { this.close(); throw unavailable(); }
  }
  async inspectRecovery() {
    if (!this.#claim) throw unavailable();
    try {
      const observed = inspectionSchema.parse(await this.#request('inspectRecovery', this.#claim.transitionID));
      if (JSON.stringify(observed.recovery) !== JSON.stringify(this.#claim) || observed.session.id !== this.#session ||
        JSON.stringify(observed.session.location) !== JSON.stringify(this.#source) ||
        !['PRIOR_PROCESS_RESOURCES_UNRECONCILED', 'DESTINATION_AUTHORITY_UNVERIFIED', 'RECEIVER_UNVERIFIED'].every(value => observed.unresolved.includes(value))) throw unavailable();
      if (observed.membershipSeal) {
        this.#checkMembershipSeal(observed.membershipSeal);
        if (observed.membershipPresent) throw unavailable();
      }
      return structuredClone(observed);
    } catch { this.close(); throw unavailable(); }
  }
  #checkMembershipSeal(value) {
    const seal = membershipSealSchema.parse(value), { binding, ...fields } = seal;
    if (!this.#intent || this.#intent.membershipFence !== 1 || seal.sessionID !== this.#session ||
      seal.transitionID !== this.#intent.transitionID || seal.pluginID !== this.#plugin ||
      JSON.stringify(seal.source) !== JSON.stringify(this.#source) || seal.destination !== this.#intent.directory ||
      binding !== JSON.stringify(fields)) throw unavailable();
    return seal;
  }
  async sealMembership() {
    if (!this.#claim || this.#intent?.membershipFence !== 1) throw unavailable();
    try {
      const seal = this.#checkMembershipSeal(await this.#request('sealMembership', this.#claim.transitionID));
      if (seal.leaseIncarnation !== this.#claim.leaseIncarnation) throw uncertain();
      return structuredClone(seal);
    } catch { this.close(); throw uncertain(); }
  }
  async detachMembership(channel) {
    if (!this.#claim || this.#intent?.membershipFence !== 1 || typeof channel !== 'string' || !channel || channel.length > 256) throw unavailable();
    try {
      const seal = this.#checkMembershipSeal(await this.#request('detachMembership', this.#claim.transitionID, { channel }));
      if (seal.leaseIncarnation !== this.#claim.leaseIncarnation) throw uncertain();
      return structuredClone(seal);
    } catch { this.close(); throw uncertain(); }
  }
  async observeDetachedMembership() {
    if (!this.#claim || this.#intent?.membershipFence !== 1) throw unavailable();
    try {
      const value = await this.#request('observeDetachedMembership', this.#claim.transitionID);
      return value === null ? null : structuredClone(this.#checkMembershipSeal(value));
    } catch { this.close(); throw unavailable(); }
  }
  #checkDestination(value) {
    const destination = destinationMembershipSchema.parse(value);
    if (!this.#intent || destination.sessionID !== this.#session || destination.transitionID !== this.#intent.transitionID ||
      destination.pluginID !== this.#plugin || JSON.stringify(destination.source) !== JSON.stringify(this.#source) ||
      destination.destination !== this.#intent.directory) throw unavailable();
    return destination;
  }
  async stageRecoveredDestinationMembership(channel, receiverHash) {
    if (!this.#claim || this.#intent?.membershipFence !== 1 || typeof channel !== 'string' || !channel || channel.length > 256 ||
      !/^[a-f0-9]{64}$/.test(receiverHash || '')) throw unavailable();
    try {
      const destination = this.#checkDestination(await this.#request('stageRecoveredDestinationMembership', this.#claim.transitionID, { channel, receiverHash }));
      if (destination.receiverHash !== receiverHash) throw uncertain();
      const inspection = await this.inspectRecovery();
      if (!inspection.membershipSeal || inspection.membershipPresent || destination.archiveNonce !== inspection.membershipSeal.nonce ||
        destination.leaseIncarnation !== inspection.membershipSeal.leaseIncarnation) throw uncertain();
      return structuredClone(destination);
    } catch { this.close(); throw uncertain(); }
  }
  async observeDestinationMembership() {
    if (!this.#claim || this.#intent?.membershipFence !== 1) throw unavailable();
    try {
      const value = await this.#request('observeDestinationMembership', this.#claim.transitionID);
      if (value === null) return null;
      const destination = this.#checkDestination(value), inspection = await this.inspectRecovery();
      if (!inspection.membershipSeal || inspection.membershipPresent || destination.archiveNonce !== inspection.membershipSeal.nonce ||
        destination.leaseIncarnation !== inspection.membershipSeal.leaseIncarnation) throw unavailable();
      return structuredClone(destination);
    } catch { this.close(); throw unavailable(); }
  }
  async observePlacement(staged) {
    if (!this.#claim || this.#intent?.membershipFence !== 1) throw unavailable();
    try {
      const destination = this.#checkDestination(staged);
      const value = await this.#request('observePlacement', this.#claim.transitionID);
      if (value === null) return null;
      return structuredClone(this.#checkPlacement(destination, value));
    } catch { this.close(); throw unavailable(); }
  }
  #checkPlacement(destination, value) {
    const receipt = placementReceiptSchema.parse(value);
    if (!this.#intent || receipt.sessionID !== this.#session || receipt.transitionID !== this.#intent.transitionID ||
      JSON.stringify(receipt.source) !== JSON.stringify(this.#source) || receipt.destination.directory !== this.#intent.directory ||
      receipt.archiveNonce !== destination.archiveNonce || receipt.stageNonce !== destination.nonce ||
      receipt.receiverHash !== destination.receiverHash) throw unavailable();
    return receipt;
  }
  async commitPreparedPlacement(staged) {
    if (!this.#claim || this.#intent?.membershipFence !== 1) throw unavailable();
    try {
      const destination = this.#checkDestination(staged);
      const value = await this.#request('commitPreparedPlacement', this.#claim.transitionID, { receiverHash: destination.receiverHash });
      return structuredClone(this.#checkPlacement(destination, value));
    } catch { this.close(); throw uncertain(); }
  }
  async completePlacement(staged) {
    if (!this.#claim || this.#intent?.membershipFence !== 1) throw unavailable();
    try {
      const destination = this.#checkDestination(staged);
      const value = completionSchema.parse(await this.#request('completePlacement', this.#claim.transitionID));
      this.#checkPlacement(destination, value.placement);
      return structuredClone(value);
    } catch { this.close(); throw uncertain(); }
  }
  // Completion removes the quarantine, so this observation deliberately does
  // not inspect or claim it. The inherited channel remains source-scoped.
  async observeCompletion(staged) {
    if (this.#closed) throw unavailable();
    try {
      const destination = destinationMembershipSchema.parse(staged);
      if (destination.sessionID !== this.#session || destination.pluginID !== this.#plugin ||
        JSON.stringify(destination.source) !== JSON.stringify(this.#source)) throw unavailable();
      const value = await this.#request('observeCompletion', destination.transitionID);
      if (value === null) return null;
      const result = completionSchema.parse(value), receipt = result.placement;
      if (receipt.sessionID !== this.#session || receipt.transitionID !== destination.transitionID ||
        JSON.stringify(receipt.source) !== JSON.stringify(this.#source) || receipt.destination.directory !== destination.destination ||
        receipt.destination.workspaceID !== this.#source.workspaceID || receipt.archiveNonce !== destination.archiveNonce ||
        receipt.stageNonce !== destination.nonce || receipt.receiverHash !== destination.receiverHash) throw unavailable();
      return structuredClone(result);
    } catch { this.close(); throw unavailable(); }
  }
  onClose(listener) {
    if (typeof listener !== 'function') throw unavailable();
    if (this.#closed) { listener(); return () => {}; }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) { try { listener(); } catch { /* Closing must continue. */ } }
    this.#closeListeners.clear();
    if (this.#pending) {
      const pending = this.#pending; this.#pending = undefined; clearTimeout(pending.timer);
      pending.reject(pending.mutating ? uncertain() : unavailable());
    }
    this.#stream.destroy();
  }
}
