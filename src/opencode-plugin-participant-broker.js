import { z } from 'zod';
import { identity } from './config.js';
import { Command } from './control/contracts.js';
import { PARTICIPANT_OPERATIONS } from './control/operations.js';

// Narrow experimental broker port. The underlying ChannelClient and all
// receiver/session proofs remain with the owner. Movement and adapter
// operations are deliberately absent until they have their own verifier.
export function createOpenCodePluginParticipantBroker({ channel, sessionID, directory, allowedChannel, allowTestSubscribe = false, allowParticipantControl = false }) {
  if (!channel?.request || !channel?.connect || !channel?.subscribe || !channel?.unsubscribe || !sessionID?.startsWith('ses_') || !directory?.startsWith('/'))
    throw new Error('PLUGIN_BROKER_UNAVAILABLE');
  const agentId = identity('opencode', sessionID), small = z.string().min(1).max(4096);
  const empty = z.strictObject({});
  const participantCommand = z.discriminatedUnion('op', Command.options.filter(schema => PARTICIPANT_OPERATIONS.includes(schema.shape.op.value)));
  const schemas = {
    connect: empty, subscribe: empty, unsubscribe: empty,
    join: z.strictObject({ harness: z.literal('opencode'), sessionId: z.literal(sessionID), channel: small, name: small, role: small,
      project: z.strictObject({ name: small, root: z.literal(directory) }) }),
    members: z.strictObject({ agentId: z.literal(agentId), channel: small, limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(100000).optional() }),
    history: z.strictObject({ agentId: z.literal(agentId), channel: small, limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(100000).optional() }),
    send: z.strictObject({ agentId: z.literal(agentId), to: small, text: z.string().max(256 * 1024), messageId: small }),
    ack: z.strictObject({ agentId: z.literal(agentId), id: small }),
    leave: z.strictObject({ agentId: z.literal(agentId) }),
    resume: z.strictObject({ agentId: z.literal(agentId) }),
    control_command: z.strictObject({ agentId: z.literal(agentId), command: participantCommand }),
    control_query: z.strictObject({ agentId: z.literal(agentId), channel: small,
      view: z.enum(['channel', 'tasks', 'actions', 'incidents', 'events', 'messages', 'notices', 'previews', 'transitions', 'evidence', 'health']),
      generation: z.number().int().nonnegative().optional(), after: z.number().int().nonnegative().optional(),
      offset: z.number().int().min(0).max(100000).optional(), limit: z.number().int().min(1).max(100).optional() }),
  };
  let closed = false, listener, authorizeAck; const delivered = new Map();
  const message = value => {
    if (closed || !Array.isArray(value?.recipients) || !value.recipients.includes(agentId) || typeof value.id !== 'string') return;
    if (!delivered.has(value.id) && delivered.size >= 2048) { channel.close(); return; }
    delivered.set(value.id, structuredClone(value)); listener?.('message', value);
  };
  const removed = value => { if (!closed && value?.agentId === agentId) listener?.('membership_removed', value); };
  const disconnected = () => { if (!closed) listener?.('disconnected', {}); };
  channel.on('message', message); channel.on('membership_removed', removed); channel.on('disconnected', disconnected);
  return Object.freeze({ call: async (operation, input) => {
    if (closed || !Object.hasOwn(schemas, operation)) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    if ((operation === 'control_command' || operation === 'control_query') && !allowParticipantControl) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    if (operation === 'subscribe' && !allowTestSubscribe) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    const params = schemas[operation].parse(input);
    if (allowedChannel !== undefined && (params.channel !== undefined && params.channel !== allowedChannel ||
        params.command?.channel !== undefined && params.command.channel !== allowedChannel)) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    if (operation === 'ack' && (typeof authorizeAck !== 'function' || authorizeAck(params.id) !== true)) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    if (operation === 'connect') { await channel.connect(); if (closed || !channel.hostId) throw new Error('PLUGIN_BROKER_UNAVAILABLE'); return { hostId: channel.hostId }; }
    const result = operation === 'subscribe' || operation === 'unsubscribe' ? await channel[operation](agentId) : await channel.request(operation, params);
    if (closed) throw new Error('PLUGIN_BROKER_UNAVAILABLE');
    if (operation === 'ack') delivered.delete(params.id);
    return result;
  }, observeMessage: id => {
    if (closed || !channel.hostId || channel.socket?.readyState !== 1 || !channel.activeSubscriptions?.has(agentId)) return undefined;
    const value = delivered.get(id); return value && structuredClone(value);
  }, isQuiet: () => !closed && !!channel.hostId && channel.socket?.readyState === 1 && channel.activeSubscriptions?.has(agentId) && delivered.size === 0,
  setAckVerifier: fn => { if (closed || authorizeAck || typeof fn !== 'function') throw new Error('PLUGIN_BROKER_UNAVAILABLE'); authorizeAck = fn; },
  onEvent: fn => { if (closed || listener || typeof fn !== 'function') throw new Error('PLUGIN_BROKER_UNAVAILABLE'); listener = fn; },
  close: () => { if (!closed) { closed = true; listener = undefined; channel.off('message', message); channel.off('membership_removed', removed);
    channel.off('disconnected', disconnected); channel.close(); } } });
}
