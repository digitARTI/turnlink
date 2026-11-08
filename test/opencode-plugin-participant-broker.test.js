import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createOpenCodePluginParticipantBroker } from '../src/opencode-plugin-participant-broker.js';

test('participant broker rejects foreign identity, credentials, adapter operations and unapproved controls', async () => {
  const channel = new EventEmitter(); channel.hostId = 'local'; channel.connect = async () => {}; channel.close = () => {};
  channel.request = async () => ({}); channel.subscribe = async () => ({}); channel.unsubscribe = async () => ({});
  const broker = createOpenCodePluginParticipantBroker({ channel, sessionID: 'ses_owned', directory: '/synthetic' });
  await assert.rejects(broker.call('send', { agentId: 'opencode:ses_other', to: '*', text: 'x', messageId: 'x' }));
  await assert.rejects(broker.call('send', { agentId: 'opencode:ses_owned', to: '*', text: 'x', messageId: 'x', proof: 'fake' }));
  await assert.rejects(broker.call('control_adapter', {}));
  await assert.rejects(broker.call('control_command', { agentId: 'opencode:ses_owned', command: { id: randomUUID(), channel: 'dev', op: 'task.claim', taskID: randomUUID() } }));
  await assert.rejects(broker.call('subscribe', {}));
  broker.close(); await assert.rejects(broker.call('connect', {}));
});

test('participant broker checks control operations and revokes late results', async () => {
  const channel = new EventEmitter(); channel.hostId = 'local'; channel.connect = async () => {}; channel.close = () => {};
  let release; channel.request = () => new Promise(resolve => { release = resolve; });
  channel.subscribe = async () => ({}); channel.unsubscribe = async () => ({});
  const broker = createOpenCodePluginParticipantBroker({ channel, sessionID: 'ses_owned', directory: '/synthetic', allowParticipantControl: true });
  await assert.rejects(broker.call('control_command', { agentId: 'opencode:ses_owned', command: { id: randomUUID(), channel: 'dev', op: 'worktree.begin', taskID: randomUUID() } }));
  const pending = broker.call('send', { agentId: 'opencode:ses_owned', to: '*', text: 'synthetic', messageId: 'test' });
  assert.ok(release); broker.close(); release({ sent: true }); await assert.rejects(pending, /PLUGIN_BROKER_UNAVAILABLE/);
});

test('participant broker enforces the owner channel before join and control', async () => {
  const channel = new EventEmitter(); let calls = 0;
  channel.hostId = 'local'; channel.connect = async () => {}; channel.close = () => {};
  channel.request = async () => { calls++; return {}; }; channel.subscribe = async () => ({}); channel.unsubscribe = async () => ({});
  const broker = createOpenCodePluginParticipantBroker({ channel, sessionID: 'ses_owned', directory: '/synthetic',
    allowedChannel: 'dev', allowParticipantControl: true });
  const join = { harness: 'opencode', sessionId: 'ses_owned', channel: 'other', name: 'test', role: 'test', project: { name: 'test', root: '/synthetic' } };
  await assert.rejects(broker.call('join', join), /PLUGIN_BROKER_UNAVAILABLE/);
  await assert.rejects(broker.call('control_command', { agentId: 'opencode:ses_owned', command: { id: randomUUID(), channel: 'other', op: 'task.claim', taskID: randomUUID() } }), /PLUGIN_BROKER_UNAVAILABLE/);
  assert.equal(calls, 0); await broker.call('join', { ...join, channel: 'dev' }); assert.equal(calls, 1); broker.close();
});

test('participant broker does not report a quiet or observable receiver until the current subscription is confirmed', () => {
  const channel = new EventEmitter(), agentId = 'opencode:ses_owned';
  channel.hostId = 'local'; channel.socket = { readyState: 1 }; channel.subscriptions = new Set([agentId]); channel.activeSubscriptions = new Set();
  channel.connect = async () => {}; channel.close = () => {}; channel.request = async () => ({});
  channel.subscribe = async () => ({}); channel.unsubscribe = async () => ({});
  const broker = createOpenCodePluginParticipantBroker({ channel, sessionID: 'ses_owned', directory: '/synthetic' });
  assert.equal(broker.isQuiet(), false); assert.equal(broker.observeMessage('m1'), undefined);
  channel.activeSubscriptions.add(agentId); assert.equal(broker.isQuiet(), true);
  channel.emit('message', { id: 'm1', recipients: [agentId] });
  assert.equal(broker.observeMessage('m1').id, 'm1');
  channel.activeSubscriptions.clear(); assert.equal(broker.observeMessage('m1'), undefined); assert.equal(broker.isQuiet(), false);
  broker.close();
});
