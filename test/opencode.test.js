import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import plugin from '../adapters/opencode.js';
import { AdmissionLedger, fingerprint } from '../src/admissions.js';
import { configureOpenCode } from '../deploy/opencode-config.js';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { openCodeFixture } from './fixtures/opencode.js';

const joinArgs = { channel: 'development', name: 'b', role: 'worker', project: { name: 'test' } };
async function eventually(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await delay(30); }
  throw new Error('Condition did not become true');
}
async function setup(t, overrides = {}) {
  const directory = privateTemp(join(tmpdir(), 'turnlink-opencode-'));
  const token = '1'.repeat(64);
  const broker = createBroker({ port: 0, secret: token, adminSecret: '2'.repeat(64), directory });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token, credentialDirectory: join(directory, 'credentials') };
  const sender = new ChannelClient(options);
  await sender.request('join', { ...joinArgs, name: 'sender', harness: 'codex', sessionId: 'sender', project: { name: 'test', root: '/sender' } });
  const fixture = await openCodeFixture(t, options, overrides);
  t.after(async () => { fixture.cleanup(); sender.close(); await broker.close(); rmSync(directory, { recursive: true, force: true }); });
  await fixture.tools.channel_join.execute(joinArgs, { sessionID: 'b' });
  const send = text => sender.request('send', { agentId: 'codex:sender', to: 'opencode:b', text, messageId: text });
  return { ...fixture, send, broker, options, sender };
}

test('OpenCode V2 registers all native tools and shares strict schemas', async t => {
  const f = await setup(t);
  assert.deepEqual(Object.keys(f.tools).sort(), ['channel_history', 'channel_join', 'channel_leave', 'channel_members', 'channel_send']);
  assert.equal(f.tools.channel_join.input.properties.sessionId, undefined);
  assert.equal(f.tools.channel_join.input.additionalProperties, false);
  const members = JSON.parse((await f.tools.channel_members.execute({ channel: 'development' }, { sessionID: 'b' })).content);
  assert.equal(members.length, 2);
  assert.equal(members.find(m => m.agentId === 'opencode:b').project.root, '/projects/b');
  await f.tools.channel_send.execute({ to: '*', text: 'broadcast' }, { sessionID: 'b' });
  const history = JSON.parse((await f.tools.channel_history.execute({ channel: 'development' }, { sessionID: 'b' })).content);
  assert.match(JSON.stringify(history), /broadcast/);
});

test('OpenCode V2 rejects unsupported versions and cross-location identity', async t => {
  await assert.rejects(plugin.setup({ app: { version: '1.18.35' } }), /requires OpenCode/);
  await assert.rejects(plugin.setup({ app: { version: '2.0.27' } }), /requires OpenCode/);
  await assert.rejects(plugin.setup({ app: { version: '3.0.0' } }), /requires OpenCode/);
  const f = await setup(t);
  f.ctx.session.get = async () => ({ location: { directory: '/another' } });
  await assert.rejects(f.tools.channel_send.execute({ to: '*', text: 'forged' }, { sessionID: 'foreign' }), /another plugin location/);
});

test('OpenCode V2 isolates two sessions in one location and never transfers membership to a new session', async t => {
  const f = await setup(t);
  await assert.rejects(f.tools.channel_send.execute({ to: '*', text: 'not joined' }, { sessionID: 'new-session' }), /channel_join first/);
  await f.tools.channel_join.execute({ ...joinArgs, name: 'second' }, { sessionID: 'second' });
  await f.tools.channel_send.execute({ to: 'opencode:second', text: 'second-only' }, { sessionID: 'b' });
  await f.send('first-only');
  await eventually(() => f.calls.length === 2);
  assert.equal(f.calls.find(call => call.text.includes('second-only')).sessionID, 'second');
  assert.equal(f.calls.find(call => call.text.includes('first-only')).sessionID, 'b');
});

test('OpenCode V2 retries uncertain admission with the same native idempotency key', async t => {
  const calls = [], admitted = new Set();
  const f = await setup(t, { session: { prompt: async input => {
    calls.push(input);
    if (!admitted.has(input.id)) { admitted.add(input.id); throw new Error('Lost response after durable admission'); }
    return { id: input.id, sessionID: input.sessionID };
  } } });
  await f.send('lost-response');
  await eventually(() => f.broker.store.messages[0].delivered.length === 1);
  assert.equal(calls.length, 2); assert.equal(calls[0].id, calls[1].id); assert.equal(admitted.size, 1);
  const ledger = new AdmissionLedger('local', 'opencode:b', f.options.credentialDirectory);
  assert.equal(ledger.records[0].state, 'accepted');
});

test('OpenCode V2 reload resumes membership and replays offline messages', async t => {
  const f = await setup(t);
  await f.send('first');
  await eventually(() => f.broker.store.messages[0].delivered.length === 1);
  f.cleanup();
  await eventually(() => !f.broker.receivers?.get?.('opencode:b') || f.broker.store.agents['opencode:b'].disconnectedAt !== null);
  await f.send('offline');
  const next = await openCodeFixture(t, f.options, { storage: f.storage });
  await eventually(() => f.broker.store.messages[1].delivered.length === 1);
  assert.equal(next.calls.length, 1); assert.match(next.calls[0].text, /offline/);
  assert.equal(f.broker.store.agents['opencode:b'].name, 'b');
});

test('OpenCode V2 reads preexisting blockers even when no event was observed', async t => {
  const f = await setup(t);
  f.permissions.set('b', [{ id: 'existing' }]);
  await f.send('blocked');
  await delay(100); assert.equal(f.calls.length, 0);
  f.permissions.clear();
  await eventually(() => f.calls.length === 1);
});

test('OpenCode V2 recovers native running questions from context without form events', async t => {
  const f = await setup(t);
  f.forms.set('b', [{ id: 'existing-question' }]);
  await f.send('question-snapshot');
  await delay(100); assert.equal(f.calls.length, 0);
  f.forms.clear();
  await eventually(() => f.calls.length === 1);
});

test('OpenCode V2 reload retains observed form blockers and waits for settlement', async t => {
  const f = await setup(t);
  f.emit('form.created', { form: { sessionID: 'b', id: 'pending-form' } });
  await eventually(() => f.storage.get('memberships/b')?.forms?.length === 1);
  f.cleanup();
  await f.send('persisted-form');
  const next = await openCodeFixture(t, f.options, { storage: f.storage });
  await delay(100); assert.equal(next.calls.length, 0);
  next.emit('form.replied', { sessionID: 'b', id: 'pending-form' });
  await eventually(() => next.calls.length === 1);
});

test('OpenCode V2 re-subscribes after event stream failure and refreshes permission blockers', async t => {
  const f = await setup(t);
  f.permissions.set('b', [{ id: 'pending' }]);
  f.disconnectEvents();
  await f.send('stream-recovery');
  await delay(1200); assert.equal(f.calls.length, 0); assert.ok(f.subscriptionCount() >= 2);
  f.emit('permission.replied', { sessionID: 'b', requestID: 'pending' });
  await eventually(() => f.calls.length === 1);
});

test('OpenCode V2 holds legacy uncertain receipts rather than guessing admission', async t => {
  const f = await setup(t);
  f.permissions.set('b', [{ id: 'hold' }]);
  const message = await f.send('legacy');
  const ledger = new AdmissionLedger('local', 'opencode:b', f.options.credentialDirectory);
  ledger.set({ id: message.id, fingerprint: fingerprint(message), state: 'uncertain', updatedAt: Date.now() });
  f.permissions.clear();
  await delay(2300);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.broker.store.messages[0].delivered, []);
});

test('OpenCode V2 deletion clears subscription and durable membership without handoff', async t => {
  const f = await setup(t);
  f.emit('session.deleted', { sessionID: 'b' });
  await eventually(() => !f.storage.has('memberships/b'));
  await f.send('deleted');
  await delay(100); assert.equal(f.calls.length, 0);
});

test('OpenCode V2 configuration edits preserve comments, options and unrelated plugins', () => {
  const text = '{\n // retain this\n "model": "fixture/test",\n "plugins": ["other", {"package":"file:///turnlink.js","options":{"keep":true}}]\n}';
  const updated = configureOpenCode(text, 'file:///turnlink.js', { url: 'ws://127.0.0.1:47323' });
  assert.match(updated, /retain this/); assert.match(updated, /"keep": true/);
  assert.equal(JSON.parse(updated.replace('// retain this', '')).plugins[0], 'other');
  assert.throws(() => configureOpenCode('{"plugin":[]}', 'file:///turnlink.js', {}), /native OpenCode V2/);
  assert.throws(() => configureOpenCode('{"plugins":["x","x"]}', 'x', {}), /exactly one/);
});
