import { randomUUID } from 'node:crypto';
import { identity } from './config.js';

const str = { type: 'string', minLength: 1 };
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const tools = [
  { name: 'channel_join', description: 'Join with your role and project. Use the session ID supplied by the harness onboarding context.', inputSchema: schema({
    harness: { type: 'string', enum: ['codex', 'claude', 'opencode'] }, sessionId: str, channel: str, name: str, role: str,
    project: schema({ name: str, root: str }),
  }) },
  { name: 'channel_members', description: 'List channel members, roles, projects and receiver connectivity.', inputSchema: schema({ channel: str }) },
  { name: 'channel_send', description: 'Send a task or reply to an agentId, or * to broadcast. Incoming messages wake idle agents with an installed adapter.', inputSchema: schema({ to: str, text: str, messageId: str }, ['to', 'text']) },
  { name: 'channel_history', description: 'Read channel history and delivery state.', inputSchema: schema({ channel: str, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['channel']) },
  { name: 'channel_ack', description: 'Confirm an incoming message was seen by the model. Required for Claude channel delivery confirmation.', inputSchema: schema({ id: str }) },
  { name: 'channel_leave', description: 'Leave the channel.', inputSchema: schema({}) },
];
export class ToolSession {
  constructor(client, { harness, sessionId, onJoin } = {}) { Object.assign(this, { client, harness, sessionId, onJoin }); }
  async call(name, args) {
    if (name === 'channel_join') {
      if (!this.harness || !this.sessionId) throw new Error('Harness-supplied session binding is required; the model cannot choose its session identity');
      if (this.harness && args.harness !== this.harness) throw new Error('Wrong harness');
      if (this.sessionId && args.sessionId !== this.sessionId) throw new Error('Wrong session');
      if (this.agentId && this.agentId !== identity(args.harness, args.sessionId)) throw new Error('MCP instance already bound to another session');
      const result = await this.client.request('join', args);
      this.agentId = result.agent.agentId;
      await this.onJoin?.(result.agent);
      return result;
    }
    if (!this.agentId) throw new Error('Call channel_join first');
    if (name === 'channel_members') return this.client.request('members', { ...args, agentId: this.agentId });
    if (name === 'channel_history') return this.client.request('history', { ...args, agentId: this.agentId });
    if (name === 'channel_send') return this.client.request('send', { ...args, agentId: this.agentId, messageId: args.messageId || randomUUID() });
    if (name === 'channel_ack') return this.client.request('ack', { ...args, agentId: this.agentId });
    if (name === 'channel_leave') {
      const agentId = this.agentId;
      const result = await this.client.request('leave', { agentId });
      await this.client.unsubscribe(agentId);
      this.agentId = null;
      return result;
    }
    throw new Error('Unknown tool');
  }
}
