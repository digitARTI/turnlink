import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { url, token, identity, sessionProof, receiverHandoffKey, digest, validateCredential } from './config.js';
import { parseFrame, MAX_FRAME_BYTES, Hello } from './protocol.js';
import { isDiagnosticCode } from './diagnostics.js';

// Membership of this set is valid only while the exact transport remains
// open. WebSocket.close()/terminate() change readyState before emitting close,
// so waiting for the close event leaves a window of stale receiver authority.
class ActiveSubscriptions extends Set {
  constructor(client) { super(); this.client = client; }
  has(id) { return !this.client.closed && !!this.client.hostId && this.client.socket?.readyState === WebSocket.OPEN && super.has(id); }
}

export class ChannelClient extends EventEmitter {
  constructor(options = {}) {
    super(); this.options = options; this.pending = new Map(); this.sequence = 0;
    this.subscriptions = new Set(); this.activeSubscriptions = new ActiveSubscriptions(this); this.registrations = new Map(); this.closed = false;
    this.manualWorktreeSubscriptions = new Set();
    this.subscriptionGenerations = new Map(); this.subscriptionOperations = new Map();
    this.receiverKeys = new Map(); this.handoffCandidates = new Map(); this.receiverResumes = new Set();
    this.attempt = 0; this.hostId = null; this.admin = false;
  }
  async connect() {
    if (this.closed) throw new Error('Client is closed');
    if (this.connecting) return this.connecting;
    if (this.socket?.readyState === WebSocket.OPEN && this.hostId) return;
    if (this.socket && (this.hostId !== null || this.activeSubscriptions.size > 0)) {
      // A new socket can supersede an old one before its close callback runs.
      // Invalidate its authority and work now; the old callback is ignored.
      this.hostId = null; this.activeSubscriptions.clear(); this.handoffCandidates.clear();
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Broker disconnected')); }
      this.pending.clear(); this.emit('disconnected');
    }
    const address = new URL(this.options.url || process.env.AGENT_CHANNEL_URL || url);
    if (address.username || address.password || address.search || address.hash) throw new Error('Broker URLs must not contain credentials, query parameters or fragments');
    if (!((address.protocol === 'ws:' && ['127.0.0.1', '[::1]', 'localhost'].includes(address.hostname)) || address.protocol === 'wss:')) {
      throw new Error('Plain WebSockets require loopback/SSH forwarding; remote endpoints require wss');
    }
    this.connecting = new Promise((resolve, reject) => {
      const socket = this.socket = new WebSocket(address, { headers: { Authorization: `Bearer ${this.options.token || token(false, this.options.tokenFile)}` },
        handshakeTimeout: 3000, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
      socket.once('open', () => { if (this.closed) { socket.close(); reject(new Error('Client is closed')); } else resolve(); });
      socket.on('error', error => { reject(error); socket.terminate(); });
      socket.on('message', raw => {
        if (this.socket !== socket) return;
        let data;
        try { data = parseFrame(raw.toString()); } catch { socket.close(1008, 'Invalid broker protocol'); return; }
        if (data.event) {
          if (data.event === 'membership_removed') {
            this.invalidateMembership(data.agentId, data.reason === 'session_revoked');
          }
          if (data.event === 'receiver_handoff') {
            if (data.role === 'source') {
              this.activeSubscriptions.delete(data.agentId);
              this.bumpSubscriptionGeneration(data.agentId);
              this.subscriptions.delete(data.agentId); this.receiverKeys.delete(data.agentId); this.registrations.delete(data.agentId);
              if (this.primaryAgentId === data.agentId) this.primaryAgentId = null;
            }
            else {
              const candidate = this.handoffCandidates.get(data.offerID);
              if (!candidate || candidate.agentId !== data.agentId) { socket.terminate(); return; }
              if (this.subscriptionOperations.has(data.agentId)) {
                // An older subscribe/unsubscribe may still reach the broker
                // after this rotation. Drop the ambiguous receiver rather than
                // publish ownership that the pending operation could remove.
                this.bumpSubscriptionGeneration(data.agentId);
                this.activeSubscriptions.delete(data.agentId); this.subscriptions.delete(data.agentId);
                this.receiverKeys.delete(data.agentId); this.registrations.delete(data.agentId);
                if (this.primaryAgentId === data.agentId) this.primaryAgentId = null;
                socket.terminate(); return;
              }
              this.handoffCandidates.delete(data.offerID);
              this.bumpSubscriptionGeneration(data.agentId);
              this.receiverKeys.set(data.agentId, candidate.key); this.subscriptions.add(data.agentId);
              this.activeSubscriptions.add(data.agentId);
              this.registrations.set(data.agentId, {});
            }
          }
          this.emit(data.event, data.event === 'message' ? data.message : data);
        }
        else {
          const p = this.pending.get(data.id); if (!p) return;
          this.pending.delete(data.id); clearTimeout(p.timer);
          if (data.error) {
            const error = new Error(data.error);
            if (isDiagnosticCode(data.error)) error.code = data.error;
            p.reject(error);
          } else {
            // Broker sends the subscribe response before replayed deliveries.
            // Record ownership synchronously, before resolving the promise or
            // processing the next frame from this same socket.
            if (p.method === 'subscribe' && data.result?.subscribed !== true) { p.reject(new Error('Subscription not confirmed')); return; }
            if (p.method === 'subscribe' && this.subscriptions.has(p.agentId) &&
                this.subscriptionGenerations.get(p.agentId) === p.subscriptionGeneration) this.activeSubscriptions.add(p.agentId);
            if (p.method === 'control_receiver_recover_owner' && p.recovery) {
              if (this.subscriptionGenerations.get(p.agentId) !== p.recovery.generation ||
                  data.result?.transferred !== true || data.result?.transitionID !== p.recovery.transitionID) {
                p.reject(new Error('Receiver recovery unavailable')); socket.terminate(); return;
              }
              this.receiverKeys.set(p.agentId, p.recovery.key);
              this.subscriptions.add(p.agentId); this.activeSubscriptions.add(p.agentId);
            }
            p.resolve(data.result);
          }
        }
      });
      socket.on('close', () => {
        if (this.socket !== socket) { reject(new Error('Superseded connection')); return; }
        this.hostId = null;
        this.activeSubscriptions.clear();
        this.handoffCandidates.clear();
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Broker disconnected')); }
        this.pending.clear(); reject(new Error('Broker disconnected')); this.emit('disconnected');
        this.scheduleReconnect();
      });
    }).then(async () => {
      const hello = Hello.parse(await this.rpc('hello', {}));
      this.hostId = hello.hostId; this.admin = hello.admin === true;
      for (const id of this.registrations.keys()) {
        const resumed = await this.rpc('resume', this.authorize('resume', { agentId: id }));
        if (!resumed.registered) {
          this.invalidateMembership(id);
          this.emit('membership_removed', { agentId: id, reason: 'membership_expired_or_released' });
        }
      }
      for (const id of this.subscriptions) await this.rpc('subscribe', this.authorize('subscribe', { agentId: id,
        ...(this.manualWorktreeSubscriptions.has(id) ? { manualWorktreeHost: true } : {}) }));
      this.attempt = 0; this.emit('connected');
    }).catch(error => { this.socket?.terminate(); this.scheduleReconnect(); throw error; }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  scheduleReconnect() {
    if (this.closed || this.reconnect || !(this.subscriptions.size || this.registrations.size)) return;
    const delay = Math.min(30000, 500 * 2 ** Math.min(this.attempt++, 6)) + Math.floor(Math.random() * 250);
    this.reconnect = setTimeout(async () => {
      this.reconnect = null;
      try { await this.connect(); } catch { this.scheduleReconnect(); }
    }, delay); this.reconnect.unref();
  }
  authorize(method, original) {
    const p = { ...original };
    if (this.admin) return p;
    const id = method === 'join' ? identity(p.harness, p.sessionId) : p.agentId ||
      (['members', 'history'].includes(method) ? this.primaryAgentId : undefined);
    if (id && ['join', 'subscribe', 'unsubscribe', 'send', 'ack', 'leave', 'resume', 'members', 'history',
      'control_delivery_pull', 'control_delivery_finish', 'control_command', 'control_query', 'control_manual_resume_arm', 'control_manual_resume_status', 'control_manual_resume_observe', 'control_worktree_authorize', 'control_checkpoint_observe', 'control_receiver_offer', 'control_receiver_ready', 'control_receiver_commit', 'control_receiver_check_source', 'control_receiver_recover_source', 'control_receiver_observe', 'control_codex_effect_begin', 'control_codex_effect_bind_arbiter', 'control_codex_effect_finish', 'control_codex_effect_status', 'control_receiver_observe_verified', 'control_receiver_observe_prepared', 'control_receiver_release', 'control_receiver_release_verified', 'control_receiver_owner_activate', 'control_receiver_owner_status', 'control_receiver_owner_drain', 'control_receiver_owner_drain_observe', 'control_adapter', 'control_notice_ack', 'control_task_pull', 'control_task_watch', 'control_authority_watch', 'control_alerts', 'control_health_report'].includes(method)) {
      if (method !== 'join') p.agentId = id;
      p.proof = this.receiverKeys.get(id) || sessionProof(this.hostId, id, this.options.credentialDirectory, ['join', 'subscribe'].includes(method));
    }
    if (method === 'subscribe' && p.receiverKey === undefined && this.receiverKeys.has(id)) p.receiverKey = this.receiverKeys.get(id);
    return p;
  }
  rpc(method, params, timeoutMs = 5000, context = undefined) {
    const id = ++this.sequence;
    if (this.pending.size >= 128) return Promise.reject(new Error('Client request limit reached'));
    const encoded = JSON.stringify({ v: 2, id, method, params });
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) return Promise.reject(new Error('Request frame too large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method, agentId: params?.agentId,
        subscriptionGeneration: method === 'subscribe' ? this.subscriptionGenerations.get(params?.agentId) : undefined,
        recovery: context?.recovery });
      if (this.socket?.readyState !== WebSocket.OPEN) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Broker disconnected')); return; }
      this.socket.send(encoded, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  request(method, params = {}, guard) {
    if (method === 'leave') {
      const id = params.agentId;
      this.bumpSubscriptionGeneration(id); this.activeSubscriptions.delete(id); this.subscriptions.delete(id);
      return this.serializeSubscription(id, () => this.requestCore(method, params));
    }
    return this.requestCore(method, params, guard);
  }
  async requestCore(method, params = {}, guard) {
    await this.connect();
    const checkGuard = () => {
      if (!guard) return;
      const result = guard();
      if (result === false || result && typeof result.then === 'function') {
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
        throw new Error('Guarded request unavailable');
      }
    };
    checkGuard();
    const authorized = this.authorize(method, params);
    checkGuard();
    const result = await this.rpc(method, authorized);
    checkGuard();
    if (method === 'join') { this.primaryAgentId = result.agent.agentId; this.registrations.set(result.agent.agentId, { ...params }); }
    if (method === 'leave') { this.registrations.delete(params.agentId); if (this.primaryAgentId === params.agentId) this.primaryAgentId = null; }
    return result;
  }
  requestGuarded(method, params, guard) {
    if (typeof guard !== 'function' || !['control_adapter', 'control_query', 'control_task_pull'].includes(method))
      return Promise.reject(new Error('Guarded request unavailable'));
    return this.requestCore(method, params, guard);
  }
  invalidateMembership(id, revoked = false) {
    this.registrations.delete(id); this.activeSubscriptions.delete(id); this.subscriptions.delete(id); this.manualWorktreeSubscriptions.delete(id);
    this.bumpSubscriptionGeneration(id);
    if (revoked) this.receiverKeys.delete(id);
    if (this.primaryAgentId === id) this.primaryAgentId = null;
  }
  bumpSubscriptionGeneration(id) {
    const next = (this.subscriptionGenerations.get(id) || 0) + 1;
    this.subscriptionGenerations.set(id, next); return next;
  }
  serializeSubscription(id, operation) {
    const previous = this.subscriptionOperations.get(id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    this.subscriptionOperations.set(id, pending);
    void pending.finally(() => { if (this.subscriptionOperations.get(id) === pending) this.subscriptionOperations.delete(id); }).catch(() => {});
    return pending;
  }
  subscribe(id, { receiverKey, observedCwd, manualWorktreeHost = false } = {}) {
    const generation = this.bumpSubscriptionGeneration(id);
    return this.serializeSubscription(id, async () => {
      if (this.subscriptionGenerations.get(id) !== generation) throw new Error('Subscription superseded');
      await this.connect(); // Initial subscription occurs exactly once, after the handshake.
      if (this.subscriptionGenerations.get(id) !== generation) throw new Error('Subscription superseded');
      const previous = this.receiverKeys.get(id);
      if (manualWorktreeHost) this.manualWorktreeSubscriptions.add(id);
      else this.manualWorktreeSubscriptions.delete(id);
      if (receiverKey !== undefined) this.receiverKeys.set(id, validateCredential(receiverKey));
      this.subscriptions.add(id);
      try {
        let result;
        try { result = await this.request('subscribe', { agentId: id, ...(observedCwd === undefined ? {} : { observedCwd }),
          ...(manualWorktreeHost ? { manualWorktreeHost: true } : {}) }); }
        catch (error) {
          // Older protocol-v2 brokers reject unknown fields before applying the
          // request. Retain their original conservative subscription behavior.
          if (manualWorktreeHost || observedCwd === undefined || error.message !== 'Invalid request schema or protocol version' ||
              this.subscriptionGenerations.get(id) !== generation) throw error;
          result = await this.request('subscribe', { agentId: id });
        }
        if (this.subscriptionGenerations.get(id) !== generation) throw new Error('Subscription superseded');
        return result;
      } catch (error) {
        if (this.subscriptionGenerations.get(id) === generation) {
          this.subscriptions.delete(id); this.activeSubscriptions.delete(id);
          this.manualWorktreeSubscriptions.delete(id);
          if (receiverKey !== undefined) { if (previous === undefined) this.receiverKeys.delete(id); else this.receiverKeys.set(id, previous); }
        }
        throw error;
      }
    });
  }
  async offerReceiverHandoff(agentId, credential, grant) {
    await this.connect();
    const key = receiverHandoffKey(this.hostId, agentId, grant.id, this.options.credentialDirectory, true);
    const result = await this.request('control_receiver_offer', { agentId, credential, channel: grant.channel, grant, receiverKeyHash: digest(key) });
    for (const [offerID, candidate] of this.handoffCandidates) if (candidate.agentId === agentId) this.handoffCandidates.delete(offerID);
    this.handoffCandidates.set(result.offerID, { agentId, key });
    await this.request('control_receiver_ready', { agentId, credential, channel: grant.channel, offerID: result.offerID });
    return result;
  }
  async resumeReceiverHandoff(agentId, transitionID) {
    if (this.receiverResumes.has(agentId)) throw new Error('Receiver recovery is already in progress');
    this.receiverResumes.add(agentId);
    try {
      await this.connect();
      if (this.subscriptions.has(agentId)) throw new Error('Receiver is already subscribed');
      const key = receiverHandoffKey(this.hostId, agentId, transitionID, this.options.credentialDirectory);
      const socket = this.socket;
      const pending = this.subscribe(agentId, { receiverKey: key });
      const generation = this.subscriptionGenerations.get(agentId);
      try { return await pending; }
      catch (error) {
        if (this.subscriptionGenerations.get(agentId) !== generation) {
          // A concurrent replacement can be installed on the same socket;
          // never send stale cleanup that might remove that new receiver.
          if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(socket?.readyState)) socket.terminate();
          if (this.socket !== socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket?.readyState)) this.socket.terminate();
          throw error;
        }
        // A failed subscribe reply can leave this socket installed at the broker.
        // Remove only this exact key/socket; if that is uncertain, close it.
        if (this.socket === socket && socket?.readyState === WebSocket.OPEN) {
          try { await this.rpc('unsubscribe', { agentId, proof: key }); }
          catch { socket.terminate(); }
          if (this.socket !== socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket?.readyState)) this.socket.terminate();
        } else if (this.socket !== socket) {
          // A concurrent reconnect may have replayed the temporary subscribe.
          if (socket?.readyState === WebSocket.OPEN) socket.terminate();
          if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket?.readyState)) this.socket.terminate();
        }
        throw error;
      }
    } finally { this.receiverResumes.delete(agentId); }
  }
  recoverContainedOwner(agentId, credential, previousTransitionID, grant) {
    if (this.subscriptions.has(agentId) || !grant || grant.agentId !== agentId || grant.id === previousTransitionID)
      return Promise.reject(new Error('Receiver recovery unavailable'));
    const generation = this.bumpSubscriptionGeneration(agentId);
    this.activeSubscriptions.delete(agentId);
    return this.serializeSubscription(agentId, async () => {
      if (this.subscriptionGenerations.get(agentId) !== generation) throw new Error('Receiver recovery unavailable');
      await this.connect();
      if (this.subscriptionGenerations.get(agentId) !== generation || this.subscriptions.has(agentId) || !grant ||
          grant.agentId !== agentId || grant.id === previousTransitionID) throw new Error('Receiver recovery unavailable');
      const oldKey = receiverHandoffKey(this.hostId, agentId, previousTransitionID, this.options.credentialDirectory);
      const nextKey = receiverHandoffKey(this.hostId, agentId, grant.id, this.options.credentialDirectory, true);
      const socket = this.socket;
      try {
        const result = await this.rpc('control_receiver_recover_owner', { agentId, proof: oldKey, credential, channel: grant.channel,
          grant, receiverKeyHash: digest(nextKey) }, 20000, { recovery: { generation, key: nextKey, transitionID: grant.id } });
        if (this.socket !== socket || socket?.readyState !== WebSocket.OPEN || this.subscriptionGenerations.get(agentId) !== generation ||
            !this.activeSubscriptions.has(agentId) || result?.transferred !== true || result.transitionID !== grant.id)
          throw new Error('Receiver recovery unavailable');
        return result;
      } catch (error) {
        // A lost acknowledgement may have committed. Close this connection and
        // reconcile using the already persisted next key, never replay blindly.
        if (this.socket === socket) socket?.terminate();
        throw error;
      }
    });
  }
  async commitReceiverHandoff(agentId, credential, offerID, channel) {
    return this.request('control_receiver_commit', { agentId, credential, channel, offerID });
  }
  async ackReceiverHandoff(agentId, offerID) {
    return this.request('control_receiver_detached', { agentId, offerID });
  }
  async checkSourceReceiverHandoff(agentId, credential, offerID, channel) {
    return this.request('control_receiver_check_source', { agentId, credential, offerID, channel });
  }
  async observeReceiverHandoff(agentId, credential, transitionID, channel) {
    return this.request('control_receiver_observe', { agentId, credential, channel, transitionID });
  }
  async releaseReceiverHandoff(agentId, credential, transitionID, channel) {
    return this.request('control_receiver_release', { agentId, credential, channel, transitionID });
  }
  unsubscribe(id) {
    this.bumpSubscriptionGeneration(id);
    this.subscriptions.delete(id);
    this.manualWorktreeSubscriptions.delete(id);
    this.activeSubscriptions.delete(id);
    return this.serializeSubscription(id, async () => {
      if (this.socket?.readyState === WebSocket.OPEN) return this.request('unsubscribe', { agentId: id });
    });
  }
  close() { this.closed = true; this.activeSubscriptions.clear(); this.manualWorktreeSubscriptions.clear(); clearTimeout(this.reconnect); this.reconnect = null; this.socket?.close(); }
}
