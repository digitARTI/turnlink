import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { validateCredential } from './config.js';
import { WorktreeTransition } from './control/contracts.js';

const unavailable = () => Object.assign(new Error('OPENCODE_SOURCE_RECEIVER_UNAVAILABLE'), { code: 'OPENCODE_SOURCE_RECEIVER_UNAVAILABLE' });
const bindingSchema = z.strictObject({ hostId: z.string().min(1), epoch: z.number().int().nonnegative().safe(), incarnation: z.string().uuid() });

// Minimal client surface for the live movement journal. The plugin retains
// the actual participant proof and performs every broker call on its socket.
export class OpenCodeSourceReceiver extends EventEmitter {
  #rpc; #token; #credential; #grant; #binding; #closed = false;
  hostId = null;
  constructor({ rpc, token, credential, grant }) {
    super();
    if (typeof rpc !== 'function' || typeof token !== 'function' || typeof credential !== 'function') throw unavailable();
    this.#grant = WorktreeTransition.parse(grant);
    if (!this.#grant.agentId.startsWith('opencode:ses_') || this.#grant.status !== 'prepared' || this.#grant.purpose) throw unavailable();
    this.#rpc = rpc; this.#token = token; this.#credential = credential;
  }
  async #call(method) {
    if (this.#closed) throw unavailable();
    const result = await this.#rpc('source', { token: validateCredential(await this.#token()), credential: validateCredential(await this.#credential()),
      grant: this.#grant, method, ...(method === 'bind' ? {} : { epoch: this.#binding.epoch, incarnation: this.#binding.incarnation }) });
    if (this.#closed) throw unavailable(); return result;
  }
  async connect() {
    const current = bindingSchema.parse(await this.#call('bind'));
    if (this.#binding && JSON.stringify(this.#binding) !== JSON.stringify(current)) { this.close(); throw unavailable(); }
    this.#binding = current; this.hostId = current.hostId;
  }
  async refreshIdle() { if (!this.#binding) throw unavailable(); return this.#call('idle'); }
  async observeGrant(value) {
    if (JSON.stringify(WorktreeTransition.parse(value)) !== JSON.stringify(this.#grant)) throw unavailable();
    await this.connect(); return true;
  }
  async watchGrant(value) {
    if (!this.#binding || JSON.stringify(WorktreeTransition.parse(value)) !== JSON.stringify(this.#grant)) throw unavailable();
    const watched = await this.#call('watch'); if (watched?.watching !== true) throw unavailable(); return true;
  }
  async request(method, params) {
    if (!this.#binding || method !== 'control_worktree_authorize' || params.agentId !== this.#grant.agentId ||
        params.channel !== this.#grant.channel || JSON.stringify(WorktreeTransition.parse(params.grant)) !== JSON.stringify(this.#grant) ||
        params.action !== undefined || params.credential !== validateCredential(await this.#credential())) throw unavailable();
    return this.#call('authorize');
  }
  close() { if (this.#closed) return; this.#closed = true; this.hostId = null; this.emit('disconnected'); }
}
