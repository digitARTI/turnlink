import { EventEmitter } from 'node:events';
import { identity } from './config.js';

// Development-only participant port. Control and movement are not implemented;
// callers must not run this as a production receiver.
export class OpenCodePluginParticipantChannel extends EventEmitter {
  hostId = null;
  registrations = new Map();
  constructor(capability, sessionID) {
    super(); if (!capability?.broker?.call || !capability?.onClose || !sessionID?.startsWith('ses_')) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    this.capability = capability; this.agentId = identity('opencode', sessionID);
    capability.onBrokerEvent((name, data) => this.emit(name, data));
    capability.onClose(() => { this.hostId = null; this.emit('disconnected'); });
  }
  async connect() { const result = await this.capability.broker.call('connect'); this.hostId = result.hostId; this.emit('connected'); }
  async request(method, params) { if (!this.hostId) await this.connect(); return this.capability.broker.call(method, params); }
  async subscribe(agentId) { if (agentId !== this.agentId) throw new Error('PLUGIN_BROKER_UNAVAILABLE'); if (!this.hostId) await this.connect(); return this.capability.broker.call('subscribe'); }
  async unsubscribe(agentId) { if (agentId !== this.agentId) throw new Error('PLUGIN_BROKER_UNAVAILABLE'); if (!this.hostId) await this.connect(); return this.capability.broker.call('unsubscribe'); }
  close() { this.capability.close(); }
}
