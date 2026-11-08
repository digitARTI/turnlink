import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { intentSchema, membershipSealSchema, destinationMembershipSchema, placementReceiptSchema, completionSchema } from './opencode-native-recovery.js';

const limit = 16 * 1024;
const unavailable = () => Object.assign(new Error('NATIVE_MOVEMENT_UNAVAILABLE'), { code: 'NATIVE_MOVEMENT_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('NATIVE_MOVEMENT_UNCERTAIN'), { code: 'NATIVE_MOVEMENT_UNCERTAIN' });
const busy = () => Object.assign(new Error('NATIVE_MOVEMENT_BUSY'), { code: 'NATIVE_MOVEMENT_BUSY' });
const sessionSchema = z.string().startsWith('ses_').max(1024);
const locationSchema = z.strictObject({ directory: z.string().refine(isAbsolute), workspaceID: z.string().optional() });
const replySchema = z.strictObject({ id: z.number().int().positive().safe(), result: z.unknown().optional(), error: z.string().optional() });
const idleRevokedSchema = z.strictObject({ event: z.literal('idle_revoked'), sessionID: sessionSchema, holdID: z.string().uuid() });
const receiptSchema = z.strictObject({ sessionID: sessionSchema, family: z.literal('session-model-websocket'), released: z.number().int().nonnegative().safe() });
const idleHolds = new WeakMap();
export const isOpenCodeNativeIdleHold = (value, owner, directory) => {
  const entry = value && idleHolds.get(value); return !!entry && entry.owner === owner && entry.active && (directory === undefined || entry.directory === directory);
};

// An inherited private descriptor is a native owner capability, not broker approval.
// Calls that may have changed native state are never replayed after an uncertain reply.
export class OpenCodeNativeMovement {
  #stream; #session; #source; #plugin; #timeout; #sequence = 0; #buffer = Buffer.alloc(0);
  #pending; #closed = false; #intent; #idleHold; #released = false; #detaching = false; #detached = false; #staging = false; #stage; #closeListeners = new Set();
  constructor({ stream, sessionID, source, pluginID, timeoutMs = 30000 }) {
    if (!stream?.write || !stream?.on || !stream?.destroy || !sessionSchema.safeParse(sessionID).success ||
      !locationSchema.safeParse(source).success || typeof pluginID !== 'string' || !pluginID ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw unavailable();
    this.#stream = stream; this.#session = sessionID; this.#source = locationSchema.parse(source); this.#plugin = pluginID; this.#timeout = timeoutMs;
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
        const raw = JSON.parse(Buffer.concat([this.#buffer, data.subarray(start, i)]).toString('utf8'));
        this.#buffer = Buffer.alloc(0); start = i + 1;
        const event = idleRevokedSchema.safeParse(raw);
        if (event.success) {
          if (!this.#idleHold || event.data.sessionID !== this.#session || event.data.holdID !== this.#idleHold.holdID) throw unavailable();
          this.close(); return;
        }
        const reply = replySchema.parse(raw);
        if (Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error') || !this.#pending || reply.id !== this.#pending.id) throw unavailable();
        const pending = this.#pending; this.#pending = undefined; clearTimeout(pending.timer);
        if (reply.error) pending.reject(pending.method === 'prepare' && reply.error === 'NATIVE_PREPARE_BUSY' ? busy() : pending.mutating ? uncertain() : unavailable());
        else pending.resolve(reply.result);
      }
      this.#buffer = Buffer.concat([this.#buffer, data.subarray(start)]);
    } catch { this.close(); }
  }
  #request(method, transitionID, extra = {}) {
    if (this.#closed || this.#pending || this.#sequence >= Number.MAX_SAFE_INTEGER) return Promise.reject(unavailable());
    const id = ++this.#sequence, mutating = !['inspect', 'observeIdle', 'checkIdle', 'observeHeldAuthority', 'observePlacement', 'observeCompletion'].includes(method);
    const frame = Buffer.from(`${JSON.stringify({ id, method, sessionID: this.#session, ...(transitionID ? { transitionID } : {}), ...extra })}\n`);
    if (frame.length > limit) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), this.#timeout);
      this.#pending = { id, resolve, reject, timer, mutating, method };
      try { this.#stream.write(frame, error => { if (error) this.close(); }); } catch { this.close(); }
    });
  }
  #checkIntent(value) {
    const intent = intentSchema.parse(value);
    if (intent.sessionID !== this.#session || intent.pluginID !== this.#plugin || intent.membershipFence !== 1 || !intent.leaseIncarnation ||
      JSON.stringify(intent.source) !== JSON.stringify(this.#source) || intent.directory === intent.source.directory) throw unavailable();
    return intent;
  }
  async inspect() {
    try {
      const value = await this.#request('inspect');
      if (value === null) { if (this.#intent) throw unavailable(); return null; }
      const intent = this.#checkIntent(value);
      if (this.#intent && JSON.stringify(intent) !== JSON.stringify(this.#intent)) throw unavailable();
      return structuredClone(intent);
    } catch { this.close(); throw unavailable(); }
  }
  // A point-in-time native reservation of the idle Session family; this is
  // neither a retained lease nor an authority snapshot or movement grant.
  async observeIdle() {
    try {
      const value = z.strictObject({ sessionID: sessionSchema, idle: z.literal(true) }).parse(await this.#request('observeIdle'));
      if (value.sessionID !== this.#session) throw unavailable();
      return value;
    } catch { this.close(); throw unavailable(); }
  }
  // The caller must independently authorize the broker grant and bind its
  // authority before transferring this private native reservation.
  async holdIdle() {
    if (this.#idleHold || this.#intent) throw unavailable();
    try {
      const value = z.strictObject({ sessionID: sessionSchema, holdID: z.string().uuid(), held: z.literal(true) }).parse(await this.#request('holdIdle'));
      if (value.sessionID !== this.#session) throw unavailable();
      this.#idleHold = Object.freeze(value); idleHolds.set(this.#idleHold, { owner: this, directory: this.#source.directory, active: true }); return this.#idleHold;
    } catch { this.close(); throw unavailable(); }
  }
  async checkIdle(holdID) {
    if (!this.#idleHold || holdID !== this.#idleHold.holdID) throw unavailable();
    try {
      const value = z.strictObject({ sessionID: sessionSchema, holdID: z.string().uuid(), held: z.literal(true) }).parse(await this.#request('checkIdle', undefined, { holdID }));
      if (value.sessionID !== this.#session || value.holdID !== holdID) throw unavailable(); return value;
    } catch { this.close(); throw unavailable(); }
  }
  async observeHeldAuthority(holdID) {
    if (!this.#idleHold || holdID !== this.#idleHold.holdID) throw unavailable();
    try {
      const value = z.strictObject({ version: z.literal(1), sessionID: sessionSchema, holdID: z.string().uuid(),
        sourceAuthorityDigest: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().nonnegative().safe(),
        componentDigests: z.strictObject(Object.fromEntries(['agent', 'model', 'permissions', 'permissionRules', 'hooks', 'tools', 'toolDefinitions', 'instructions']
          .map(name => [name, z.string().regex(/^[a-f0-9]{64}$/)]))).optional(),
        modelResolution: z.enum(['current', 'unavailable']).optional(),
        projectInstructionFilesDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        hostedActivations: z.array(z.strictObject({ definition: z.string().uuid(), bundleDigest: z.string().regex(/^[a-f0-9]{64}$/) })).max(64).optional(),
        hostedHookActivations: z.array(z.strictObject({ definition: z.string().uuid(), bundleDigest: z.string().regex(/^[a-f0-9]{64}$/) })).max(64).optional(),
        executionEligible: z.literal(false), unresolved: z.array(z.string().min(1).max(128)).min(1).max(32) }).parse(
        await this.#request('observeHeldAuthority', undefined, { holdID }));
      if (value.sessionID !== this.#session || value.holdID !== holdID) throw unavailable(); return value;
    } catch { this.close(); throw unavailable(); }
  }
  async releaseIdle(holdID) {
    if (!this.#idleHold || holdID !== this.#idleHold.holdID) throw unavailable();
    try {
      const value = z.strictObject({ sessionID: sessionSchema, holdID: z.string().uuid(), released: z.literal(true) }).parse(await this.#request('releaseIdle', undefined, { holdID }));
      if (value.sessionID !== this.#session || value.holdID !== holdID) throw unavailable(); idleHolds.get(this.#idleHold).active = false; this.#idleHold = undefined; return value;
    } catch { this.close(); throw unavailable(); }
  }
  async prepareHeld(holdID, transitionID, directory) {
    if (this.#closed || this.#intent || !this.#idleHold || holdID !== this.#idleHold.holdID || !z.string().uuid().safeParse(transitionID).success ||
        !isAbsolute(directory) || directory === this.#source.directory) throw unavailable();
    try {
      const intent = this.#checkIntent(await this.#request('prepareHeld', transitionID, { holdID, directory }));
      if (intent.transitionID !== transitionID || intent.directory !== directory) throw uncertain();
      idleHolds.get(this.#idleHold).active = false; this.#idleHold = undefined; this.#intent = intent;
      if (JSON.stringify(await this.inspect()) !== JSON.stringify(intent)) throw uncertain();
      return structuredClone(intent);
    } catch { this.close(); throw uncertain(); }
  }
  async prepare(transitionID, directory) {
    if (this.#closed || this.#intent || this.#idleHold || !z.string().uuid().safeParse(transitionID).success || !isAbsolute(directory) || directory === this.#source.directory) throw unavailable();
    try {
      const intent = this.#checkIntent(await this.#request('prepare', transitionID, { directory }));
      if (intent.transitionID !== transitionID || intent.directory !== directory) throw uncertain();
      this.#intent = intent;
      if (JSON.stringify(await this.inspect()) !== JSON.stringify(intent)) throw uncertain();
      return structuredClone(intent);
    } catch (error) { if (error?.code === 'NATIVE_MOVEMENT_BUSY') throw error; this.close(); throw uncertain(); }
  }
  async releaseTransport(transitionID) {
    if (this.#closed || !this.#intent || this.#released || transitionID !== this.#intent.transitionID) throw unavailable();
    this.#released = true;
    try {
      const receipt = receiptSchema.parse(await this.#request('releaseTransport', transitionID));
      if (receipt.sessionID !== this.#session) throw uncertain();
      return structuredClone(receipt);
    } catch { this.close(); throw uncertain(); }
  }
  async detachLiveMembership(transitionID, channel) {
    if (this.#closed || !this.#intent || !this.#released || this.#detaching || transitionID !== this.#intent.transitionID ||
      typeof channel !== 'string' || !channel || channel.length > 256) throw unavailable();
    this.#detaching = true;
    try {
      const seal = membershipSealSchema.parse(await this.#request('detachLiveMembership', transitionID, { channel }));
      const { binding, ...fields } = seal;
      if (seal.sessionID !== this.#session || seal.transitionID !== transitionID || seal.pluginID !== this.#plugin ||
        JSON.stringify(seal.source) !== JSON.stringify(this.#source) || seal.destination !== this.#intent.directory ||
        seal.leaseIncarnation !== this.#intent.leaseIncarnation || binding !== JSON.stringify(fields)) throw uncertain();
      this.#detached = true;
      return structuredClone(seal);
    } catch { this.close(); throw uncertain(); }
  }
  async stageDestinationMembership(transitionID, channel, receiverHash) {
    if (this.#closed || !this.#intent || !this.#detached || this.#staging || transitionID !== this.#intent.transitionID ||
      typeof channel !== 'string' || !channel || channel.length > 256 || !/^[a-f0-9]{64}$/.test(receiverHash)) throw unavailable();
    this.#staging = true;
    try {
      const stage = destinationMembershipSchema.parse(await this.#request('stageDestinationMembership', transitionID, { channel, receiverHash }));
      if (stage.sessionID !== this.#session || stage.transitionID !== transitionID || stage.pluginID !== this.#plugin ||
        JSON.stringify(stage.source) !== JSON.stringify(this.#source) || stage.destination !== this.#intent.directory ||
        stage.leaseIncarnation !== this.#intent.leaseIncarnation || stage.receiverHash !== receiverHash) throw uncertain();
      this.#stage = structuredClone(stage);
      return structuredClone(stage);
    } catch { this.close(); throw uncertain(); }
  }
  async observePlacement(transitionID) {
    if (this.#closed || !this.#intent || !this.#stage || transitionID !== this.#intent.transitionID) throw unavailable();
    try {
      const value = await this.#request('observePlacement', transitionID);
      if (value === null) return null;
      const receipt = placementReceiptSchema.parse(value);
      if (receipt.sessionID !== this.#session || receipt.transitionID !== transitionID ||
        JSON.stringify(receipt.source) !== JSON.stringify(this.#source) || receipt.destination.directory !== this.#intent.directory ||
        receipt.archiveNonce !== this.#stage.archiveNonce || receipt.stageNonce !== this.#stage.nonce ||
        receipt.receiverHash !== this.#stage.receiverHash || receipt.leaseIncarnation !== this.#intent.leaseIncarnation) throw unavailable();
      return structuredClone(receipt);
    } catch { this.close(); throw unavailable(); }
  }
  async observeCompletion(staged) {
    if (this.#closed || !this.#intent || !this.#stage || JSON.stringify(staged) !== JSON.stringify(this.#stage)) throw unavailable();
    try {
      const value = await this.#request('observeCompletion', this.#intent.transitionID);
      if (value === null) return null;
      const result = completionSchema.parse(value), receipt = result.placement;
      if (receipt.sessionID !== this.#session || receipt.transitionID !== this.#intent.transitionID ||
        JSON.stringify(receipt.source) !== JSON.stringify(this.#source) || receipt.destination.directory !== this.#intent.directory ||
        receipt.destination.workspaceID !== this.#source.workspaceID || receipt.archiveNonce !== this.#stage.archiveNonce ||
        receipt.stageNonce !== this.#stage.nonce || receipt.receiverHash !== this.#stage.receiverHash ||
        receipt.leaseIncarnation !== this.#intent.leaseIncarnation || result.leaseIncarnation !== this.#intent.leaseIncarnation) throw unavailable();
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
    if (this.#idleHold) { idleHolds.get(this.#idleHold).active = false; this.#idleHold = undefined; }
    for (const listener of this.#closeListeners) { try { listener(); } catch { /* Closing must continue. */ } }
    this.#closeListeners.clear();
    if (this.#pending) {
      const pending = this.#pending; this.#pending = undefined; clearTimeout(pending.timer);
      pending.reject(pending.mutating ? uncertain() : unavailable());
    }
    this.#stream.destroy();
  }
}
