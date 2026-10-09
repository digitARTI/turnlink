import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { url, token, identity, sessionProof } from './config.js';
import { parseFrame, MAX_FRAME_BYTES, Hello } from './protocol.js';

export class ChannelClient extends EventEmitter {
  constructor(options = {}) {
    super(); this.options = options; this.pending = new Map(); this.sequence = 0;
    this.subscriptions = new Set(); this.registrations = new Map(); this.closed = false;
    this.attempt = 0; this.hostId = null; this.admin = false;
  }
  async connect() {
    if (this.closed) throw new Error('Client is closed');
    if (this.connecting) return this.connecting;
    if (this.socket?.readyState === WebSocket.OPEN && this.hostId) return;
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
          if (data.event === 'membership_removed') this.registrations.delete(data.agentId);
          if (data.event === 'membership_removed' && data.reason === 'session_revoked') this.subscriptions.delete(data.agentId);
          this.emit(data.event, data.event === 'message' ? data.message : data);
        }
        else {
          const p = this.pending.get(data.id); if (!p) return;
          this.pending.delete(data.id); clearTimeout(p.timer);
          data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
        }
      });
      socket.on('close', () => {
        if (this.socket !== socket) { reject(new Error('Superseded connection')); return; }
        this.hostId = null;
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
          this.registrations.delete(id);
          this.emit('membership_removed', { agentId: id, reason: 'membership_expired_or_released' });
        }
      }
      for (const id of this.subscriptions) await this.rpc('subscribe', this.authorize('subscribe', { agentId: id }));
      this.attempt = 0;
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
    if (id && ['join', 'subscribe', 'unsubscribe', 'send', 'ack', 'leave', 'resume', 'members', 'history'].includes(method)) {
      if (method !== 'join') p.agentId = id;
      p.proof = sessionProof(this.hostId, id, this.options.credentialDirectory, ['join', 'subscribe'].includes(method));
    }
    return p;
  }
  rpc(method, params) {
    const id = ++this.sequence;
    if (this.pending.size >= 128) return Promise.reject(new Error('Client request limit reached'));
    const encoded = JSON.stringify({ v: 2, id, method, params });
    if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) return Promise.reject(new Error('Request frame too large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      if (this.socket?.readyState !== WebSocket.OPEN) { clearTimeout(timer); this.pending.delete(id); reject(new Error('Broker disconnected')); return; }
      this.socket.send(encoded, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  async request(method, params = {}) {
    await this.connect();
    const result = await this.rpc(method, this.authorize(method, params));
    if (method === 'join') { this.primaryAgentId = result.agent.agentId; this.registrations.set(result.agent.agentId, { ...params }); }
    if (method === 'leave') { this.registrations.delete(params.agentId); if (this.primaryAgentId === params.agentId) this.primaryAgentId = null; }
    return result;
  }
  async subscribe(id) {
    await this.connect(); // Initial subscription occurs exactly once, after the handshake.
    this.subscriptions.add(id);
    try { return await this.request('subscribe', { agentId: id }); }
    catch (error) { this.subscriptions.delete(id); throw error; }
  }
  async unsubscribe(id) {
    this.subscriptions.delete(id);
    if (this.socket?.readyState === WebSocket.OPEN) return this.request('unsubscribe', { agentId: id });
  }
  close() { this.closed = true; clearTimeout(this.reconnect); this.reconnect = null; this.socket?.close(); }
}
