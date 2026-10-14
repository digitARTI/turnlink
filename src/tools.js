import { randomUUID } from 'node:crypto';
import { identity } from './config.js';
import { z } from 'zod';
import { Command } from './control/contracts.js';
import { PARTICIPANT_OPERATIONS } from './control/operations.js';

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
const ParticipantCommand = z.discriminatedUnion('op', Command.options.filter(schema => PARTICIPANT_OPERATIONS.includes(schema.shape.op.value)));
export const controlTools = [
  { name: 'channel_control', description: 'Opt-in Turnlink governance and task records. Identity is harness-bound. Only participant operations are offered; query channel status for supported broker effects. Task dispatch remains disabled.',
    inputSchema: schema({ command: z.toJSONSchema(ParticipantCommand) }) },
  { name: 'channel_status', description: 'Read authenticated channel state, tasks, incidents or audit events. Message bodies require the current master generation; ordinary history visibility is unchanged.',
    inputSchema: schema({ channel: str, view: { type: 'string', enum: ['channel', 'tasks', 'actions', 'incidents', 'events', 'messages', 'notices', 'previews', 'transitions'] },
      generation: { type: 'integer', minimum: 0 }, after: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0, maximum: 100000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['channel', 'view']) },
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
    if (name === 'channel_control') {
      let command;
      try { command = ParticipantCommand.parse(args.command); } catch { throw new Error('Invalid participant control command'); }
      return this.client.request('control_command', { agentId: this.agentId, command });
    }
    if (name === 'channel_status') return this.client.request('control_query', { ...args, agentId: this.agentId });
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
