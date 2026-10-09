import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { url, token } from './config.js';

export class ChannelClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.pending = new Map();
    this.sequence = 0;
    this.subscriptions = new Set();
    this.closed = false;
  }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const socket = this.socket = new WebSocket(this.options.url || process.env.AGENT_CHANNEL_URL || url, {
        headers: { Authorization: `Bearer ${this.options.token || token()}` },
        handshakeTimeout: 3000,
      });
      socket.once('open', resolve);
      socket.once('error', reject);
      socket.on('message', raw => {
        let data;
        try { data = JSON.parse(raw.toString()); } catch { return; }
        if (data.event === 'message') this.emit('message', data.message);
        else if (data.event) this.emit(data.event, data);
        else {
          const pending = this.pending.get(data.id);
          if (!pending) return;
          this.pending.delete(data.id);
          clearTimeout(pending.timer);
          data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
        }
      });
      socket.on('close', () => {
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Broker disconnected')); }
        this.pending.clear();
        this.emit('disconnected');
        if (!this.closed && this.subscriptions.size) {
          this.reconnect = setTimeout(async () => {
            try { await this.connect(); } catch { /* next close retries */ }
          }, 1000);
          this.reconnect.unref();
        }
      });
    }).then(async () => {
      for (const agentId of this.subscriptions) await this.request('subscribe', { agentId }, true);
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async request(method, params = {}, connected = false) {
    if (!connected) await this.connect();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async subscribe(agentId) {
    this.subscriptions.add(agentId);
    await this.connect();
    return this.request('subscribe', { agentId });
  }
  async unsubscribe(agentId) {
    this.subscriptions.delete(agentId);
    if (this.socket?.readyState === WebSocket.OPEN) await this.request('unsubscribe', { agentId });
  }
  close() { this.closed = true; clearTimeout(this.reconnect); this.socket?.close(); }
}
