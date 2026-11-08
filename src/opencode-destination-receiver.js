import { EventEmitter } from 'node:events';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { digest, matches, receiverHandoffKey, validateCredential } from './config.js';
import { WorktreeTransition } from './control/contracts.js';

const unavailable = () => Object.assign(new Error('DESTINATION_RECEIVER_UNAVAILABLE'), { code: 'DESTINATION_RECEIVER_UNAVAILABLE' });
const statusSchema = z.strictObject({ state: z.enum(['pending', 'held', 'prepared', 'released']), hostId: z.string().nullable(),
  receiverHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), offerID: z.string().uuid().optional(), sourceDetached: z.boolean().optional(),
  receiptID: z.string().uuid().optional(), epoch: z.number().int().nonnegative().safe(), incarnation: z.string().uuid() });

// Calls only the private, explicitly configured Location RPC. Its password and
// capability remain local; this does not authorize placement or release.
export function openCodeMovementRpc({ url, password, directory, timeoutMs = 5000 }) {
  const base = new URL(url);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.username || base.password ||
    base.pathname !== '/' || base.search || base.hash || !isAbsolute(directory) || typeof password !== 'string' || !password ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw unavailable();
  return async (method, input) => {
    if (!['offer', 'resume', 'reconcile', 'status', 'request', 'source'].includes(method)) throw unavailable();
    const endpoint = new URL(`/api/rpc/turnlink.movement/${method}`, base);
    endpoint.searchParams.set('location[directory]', directory);
    let response;
    try {
      response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input }) });
      if (!response.ok) throw unavailable();
      const chunks = []; let size = 0;
      if (!response.body) throw unavailable();
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 65536) throw unavailable();
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'output')) throw unavailable();
      return value.output;
    } catch { throw unavailable(); }
  };
}

// Implements the narrow broker-client surface used by the existing live
// detachment/staging bridges, but requests execute on the plugin's own socket.
export class OpenCodeDestinationReceiver extends EventEmitter {
  #rpc; #token; #credential; #grant; #directory; #closed = false; #epoch; #incarnation;
  hostId = null;
  receiverKeys = new Map();
  constructor({ rpc, token, credential, grant, credentialDirectory }) {
    super();
    if (typeof rpc !== 'function' || typeof token !== 'function' || typeof credential !== 'function') throw unavailable();
    this.#grant = WorktreeTransition.parse(grant);
    if (!this.#grant.agentId.startsWith('opencode:') || !['prepared', 'uncertain', 'moved'].includes(this.#grant.status) || this.#grant.purpose) throw unavailable();
    this.#rpc = rpc; this.#token = token; this.#credential = credential; this.#directory = credentialDirectory;
  }
  async #call(method, extra = {}) {
    if (this.#closed) throw unavailable();
    const token = validateCredential(await this.#token()), credential = validateCredential(await this.#credential());
    const result = await this.#rpc(method, { token, credential, grant: this.#grant, ...extra });
    if (this.#closed) throw unavailable();
    return result;
  }
  async offer(options = {}) {
    if (options.previousTransitionID !== undefined && (!z.string().uuid().safeParse(options.previousTransitionID).success || options.previousTransitionID === this.#grant.id)) throw unavailable();
    return z.strictObject({ offerID: z.string().uuid() }).parse(await this.#call('offer', options.previousTransitionID ? { previousTransitionID: options.previousTransitionID } : {}));
  }
  async resume() {
    const status = statusSchema.parse(await this.#call('resume'));
    if (!['held', 'prepared', 'released'].includes(status.state)) throw unavailable();
    const current = await this.status();
    if (!['held', 'prepared', 'released'].includes(current.state) || (status.state === 'released' && current.state !== 'released') ||
      current.incarnation !== status.incarnation || current.epoch !== status.epoch) { this.close(); throw unavailable(); }
    return current;
  }
  async reconcile() {
    const status = statusSchema.parse(await this.#call('reconcile'));
    if (!['held', 'prepared', 'released'].includes(status.state)) throw unavailable();
    const current = await this.status();
    if (!['held', 'prepared', 'released'].includes(current.state) || (status.state === 'released' && current.state !== 'released') ||
      current.incarnation !== status.incarnation || current.epoch !== status.epoch) { this.close(); throw unavailable(); }
    return current;
  }
  async settlePlacement({ commandID, receiptID }) {
    if (this.#closed || !this.hostId || this.#epoch === undefined || !['prepared', 'uncertain', 'moved'].includes(this.#grant.status) ||
        !z.string().uuid().safeParse(commandID).success || !z.string().uuid().safeParse(receiptID).success) throw unavailable();
    if (this.#grant.status === 'moved' && this.#grant.receiptID !== receiptID) throw unavailable();
    const key = this.receiverKeys.get(this.#grant.agentId);
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
    const result = await this.#call('request', { method: 'settlePlacement', epoch: this.#epoch, incarnation: this.#incarnation,
      receiverHash: digest(key), settlement: { commandID, receiptID } });
    const grant = WorktreeTransition.parse(result?.grant);
    if (!['id', 'agentId', 'channel', 'taskID', 'previewID', 'claimGeneration', 'from', 'to', 'configurationDigest', 'authorityDigest', 'pluginProvenanceDigest', 'nativeAuthorityObservationDigest', 'preparedAt']
      .every(field => grant[field] === this.#grant[field]) || grant.status !== 'moved' || grant.actualLocation !== grant.to || grant.receiptID !== receiptID) throw unavailable();
    this.#grant = grant;
    return grant;
  }
  async refreshRecoveryIdle() {
    if (this.#closed || !this.hostId || this.#epoch === undefined || this.#grant.status !== 'prepared') throw unavailable();
    const key = this.receiverKeys.get(this.#grant.agentId);
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
    return this.#call('request', { method: 'recoveryIdle', epoch: this.#epoch, incarnation: this.#incarnation, receiverHash: digest(key) });
  }
  async status() {
    const status = statusSchema.parse(await this.#call('status'));
    if (this.#epoch !== undefined && (this.#epoch !== status.epoch || this.#incarnation !== status.incarnation)) { this.close(); throw unavailable(); }
    if (status.state === 'held' || status.state === 'prepared' || status.state === 'released') {
      if (!status.hostId || !status.receiverHash || typeof status.sourceDetached !== 'boolean') throw unavailable();
      if (['prepared', 'released'].includes(status.state) && (this.#grant.status !== 'moved' || status.sourceDetached !== true || status.receiptID !== this.#grant.receiptID)) throw unavailable();
      const key = receiverHandoffKey(status.hostId, this.#grant.agentId, this.#grant.id, this.#directory);
      if (digest(key) !== status.receiverHash || (this.hostId && this.hostId !== status.hostId)) throw unavailable();
      this.#epoch = status.epoch; this.#incarnation = status.incarnation; this.hostId = status.hostId; this.receiverKeys.set(this.#grant.agentId, key);
    }
    return status;
  }
  async request(method, params) {
    if (this.#closed || !this.hostId || this.#epoch === undefined || params.agentId !== this.#grant.agentId || params.channel !== this.#grant.channel ||
      !matches(params.credential, digest(validateCredential(await this.#credential())))) throw unavailable();
    const receiverKey = this.receiverKeys.get(this.#grant.agentId);
    if (!/^[a-f0-9]{64}$/.test(receiverKey || '')) throw unavailable();
    const binding = { epoch: this.#epoch, incarnation: this.#incarnation, receiverHash: digest(receiverKey) };
    if (method === 'control_worktree_authorize') {
      if (JSON.stringify(WorktreeTransition.parse(params.grant)) !== JSON.stringify(this.#grant) ||
        (params.action !== undefined && !['observe-worktree', 'observe-moved-worktree', 'detach-worktree-membership', 'place-worktree'].includes(params.action))) throw unavailable();
      return this.#call('request', { method: 'authorize', ...binding, ...(params.action ? { action: params.action } : {}) });
    }
    if (method === 'control_receiver_observe' && params.transitionID === this.#grant.id)
      return this.#call('request', { method: 'observe', ...binding });
    if (method === 'control_receiver_check_source' && typeof params.offerID === 'string')
      return this.#call('request', { method: 'checkSource', offerID: params.offerID, ...binding });
    if (method === 'control_receiver_recover_source' && params.transitionID === this.#grant.id)
      return this.#call('request', { method: 'recoverSource', ...binding });
    if (method === 'control_receiver_release_verified' && this.#grant.status === 'moved' && params.transitionID === this.#grant.id)
      return this.#call('request', { method: 'releaseVerified', ...binding, ...(params.ownerGeneration ? { ownerGeneration: params.ownerGeneration } : {}),
        ...(params.ownerProof ? { ownerProof: params.ownerProof } : {}) });
    if (['control_receiver_owner_activate', 'control_receiver_owner_status'].includes(method) && this.#grant.status === 'moved' &&
        params.transitionID === this.#grant.id && z.string().uuid().safeParse(params.ownerGeneration).success)
      return this.#call('request', { method: method === 'control_receiver_owner_activate' ? 'ownerActivate' : 'ownerStatus', ...binding, ownerGeneration: params.ownerGeneration });
    if (method === 'control_worktree_authorize_next' && this.#grant.status === 'moved' &&
        z.string().uuid().safeParse(params.ownerGeneration).success) {
      const nextGrant = WorktreeTransition.parse(params.grant);
      if (nextGrant.status !== 'prepared' || nextGrant.purpose || nextGrant.agentId !== this.#grant.agentId ||
          nextGrant.channel !== this.#grant.channel || nextGrant.from !== this.#grant.to || nextGrant.id === this.#grant.id) throw unavailable();
      return this.#call('request', { method: 'nextAuthorize', ...binding, ownerGeneration: params.ownerGeneration, nextGrant });
    }
    if (['control_receiver_owner_drain', 'control_receiver_owner_drain_observe'].includes(method) && this.#grant.status === 'moved' && params.transitionID === this.#grant.id &&
        z.string().uuid().safeParse(params.ownerGeneration).success && z.string().uuid().safeParse(params.drainID).success && /^[a-f0-9]{64}$/.test(params.ownerProof || '')) {
      const nextGrant = WorktreeTransition.parse(params.nextGrant);
      if (nextGrant.status !== 'prepared' || nextGrant.purpose || nextGrant.agentId !== this.#grant.agentId ||
          nextGrant.channel !== this.#grant.channel || nextGrant.from !== this.#grant.to || nextGrant.id === this.#grant.id) throw unavailable();
      return this.#call('request', { method: method === 'control_receiver_owner_drain' ? 'ownerDrain' : 'ownerDrainObserve', ...binding, ownerGeneration: params.ownerGeneration,
        nextGrant, drainID: params.drainID, ownerProof: params.ownerProof });
    }
    throw unavailable();
  }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.receiverKeys.clear(); this.emit('disconnected');
  }
}
