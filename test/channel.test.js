import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { privateTemp as mkdtempSync } from '../src/storage.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { openCodeFixture } from './fixtures/opencode.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { receiverHandoffKey, sessionProof } from '../src/config.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TOKEN = '1'.repeat(64), ADMIN = '2'.repeat(64);
async function eventually(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await delay(30); }
  throw new Error('Condition did not become true');
}
async function setup(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-channel-'));
  const broker = createBroker({ port: 0, secret: TOKEN, adminSecret: ADMIN, directory, ...extra });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: TOKEN, credentialDirectory: join(directory, 'credentials') };
  const clients = [];
  const make = () => { const c = new ChannelClient(options); clients.push(c); return c; };
  t.after(async () => { clients.forEach(c => c.close()); await broker.close(); rmSync(directory, { recursive: true, force: true }); });
  return { broker, options, make, directory };
}
const registration = (sessionId, harness = 'codex') => ({ harness, sessionId, channel: 'development', name: sessionId, role: 'implementation', project: { name: sessionId, root: `/projects/${sessionId}` } });

test('a second host cannot take a disconnected session merely by copying its proof', async t => {
  const destinationToken = '3'.repeat(64);
  const f = await setup(t, { hosts: [
    { hostId: 'source', credential: TOKEN, channels: ['*'], broadcast: true },
    { hostId: 'destination', credential: destinationToken, channels: ['*'], broadcast: true },
  ] });
  const source = f.make(), target = new ChannelClient({ ...f.options, token: destinationToken });
  t.after(() => target.close());
  const identity = 'codex:cross-host';
  await source.request('join', registration('cross-host'));
  await source.subscribe(identity); await source.unsubscribe(identity);
  await target.connect();
  const copiedProof = sessionProof('source', identity, f.options.credentialDirectory, false);
  await assert.rejects(target.rpc('join', { ...registration('cross-host'), proof: copiedProof }), /Session ownership denied/);
  await assert.rejects(target.rpc('subscribe', { agentId: identity, proof: copiedProof }), /Session ownership denied/);
  assert.equal(f.broker.store.bindings[identity].hostId, 'source');
});

test('receiver activity disappears as soon as its socket starts closing', () => {
  const client = new ChannelClient(), id = 'codex:closing';
  client.hostId = 'local'; client.socket = { readyState: 1 }; client.activeSubscriptions.add(id);
  assert.equal(client.activeSubscriptions.has(id), true);
  client.socket.readyState = 2;
  assert.equal(client.activeSubscriptions.has(id), false, 'CLOSING is not a live receiver even before the close event');
});

test('guarded broker requests enforce synchronous checks at the actual send boundary', async () => {
  const client = new ChannelClient(); let sent = 0, checks = 0;
  client.connect = async () => {}; client.authorize = (_method, params) => params;
  client.rpc = async () => { sent++; return { ok: true }; };
  client.request = async () => { throw new Error('unguarded request hook must not be used'); };
  assert.deepEqual(await client.requestGuarded('control_query', {}, () => { checks++; }), { ok: true });
  assert.equal(checks, 3); assert.equal(sent, 1);
  for (const method of ['control_adapter', 'control_task_pull'])
    assert.deepEqual(await client.requestGuarded(method, {}, () => {}), { ok: true });
  await assert.rejects(client.requestGuarded('control_query', {}, () => false), /Guarded request unavailable/);
  await assert.rejects(client.requestGuarded('control_query', {}, async () => true), /Guarded request unavailable/);
  for (const method of ['join', 'leave', 'subscribe', 'unsubscribe', 'send', 'control_receiver_release'])
    await assert.rejects(client.requestGuarded(method, {}, () => {}), /Guarded request unavailable/);
  assert.equal(sent, 3, 'refused guards must not dispatch');
});

test('a replacement socket cannot inherit subscriptions before its own ACK', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const subscriptions = [];
  server.on('connection', socket => socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    else if (request.method === 'subscribe') {
      subscriptions.push({ socket, request });
      if (subscriptions.length === 1) socket.send(JSON.stringify({ v: 2, id: request.id, result: { subscribed: true } }));
    }
  }));
  await client.connect(); const id = 'codex:replacement'; await client.subscribe(id);
  assert.equal(client.activeSubscriptions.has(id), true);
  let disconnected = 0; client.on('disconnected', () => { disconnected++; });
  client.socket.terminate();
  const connecting = client.connect();
  assert.equal(client.activeSubscriptions.has(id), false);
  assert.equal(disconnected, 1, 'superseded socket invalidates in-flight work immediately');
  await eventually(() => subscriptions.length === 2);
  assert.equal(client.activeSubscriptions.has(id), false, 'new open socket cannot inherit the old ACK');
  subscriptions[1].socket.send(JSON.stringify({ v: 2, id: subscriptions[1].request.id, result: { subscribed: true } }));
  await connecting;
  assert.equal(client.activeSubscriptions.has(id), true);
});

test('onboarding, cross-project routing, duplicate send, offline replay and authorized ack', async t => {
  const { make, broker } = await setup(t);
  const a = make(), b = make(), other = make();
  await assert.rejects(a.request('join', { ...registration('a'), role: '' }), /Invalid request/);
  await a.request('join', registration('a'));
  await b.request('join', registration('b', 'claude'));
  await other.request('join', { ...registration('other'), channel: 'private' });
  const pending = await a.request('send', { agentId: 'codex:a', to: '*', text: 'Implement endpoint', messageId: 'key' });
  assert.deepEqual(pending.recipients, ['claude:b']);
  const duplicate = await a.request('send', { agentId: 'codex:a', to: '*', text: 'Implement endpoint', messageId: 'key' });
  assert.equal(duplicate.id, pending.id);
  assert.equal(broker.store.messages.length, 1);
  const received = once(b, 'message');
  await b.subscribe('claude:b');
  assert.equal((await received)[0].id, pending.id);
  await assert.rejects(a.request('ack', { agentId: 'claude:b', id: pending.id }), /receiver/);
  await b.request('ack', { agentId: 'claude:b', id: pending.id });
  assert.deepEqual(broker.store.messages[0].delivered, ['claude:b']);
  await assert.rejects(a.request('send', { agentId: 'codex:a', to: 'codex:other', text: 'x', messageId: 'bad' }), /recipient/);
});

test('persistent store replays pending messages after broker restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-channel-persist-'));
  let broker = createBroker({ port: 0, secret: TOKEN, adminSecret: ADMIN, directory });
  await once(broker.server, 'listening');
  let c = new ChannelClient({ url: `ws://127.0.0.1:${broker.server.address().port}`, token: TOKEN, credentialDirectory: join(directory, 'credentials') });
  await c.request('join', registration('a'));
  await c.request('join', registration('b'));
  const sent = await c.request('send', { agentId: 'codex:a', to: 'codex:b', text: 'resume', messageId: 'persist' });
  c.close(); await broker.close();
  broker = createBroker({ port: 0, secret: TOKEN, adminSecret: ADMIN, directory });
  await once(broker.server, 'listening');
  c = new ChannelClient({ url: `ws://127.0.0.1:${broker.server.address().port}`, token: TOKEN, credentialDirectory: join(directory, 'credentials') });
  t.after(async () => { c.close(); await broker.close(); rmSync(directory, { recursive: true, force: true }); });
  const received = once(c, 'message');
  await c.subscribe('codex:b');
  assert.equal((await received)[0].id, sent.id);
});

test('unauthenticated sockets cannot connect', async t => {
  const { options } = await setup(t);
  const bad = new ChannelClient({ ...options, token: 'wrong' });
  t.after(() => bad.close());
  await assert.rejects(bad.connect(), /401/);
});

test('receiver reconnects and replays messages sent while its socket is disconnected', async t => {
  const { make } = await setup(t);
  const a = make(), b = make();
  await a.request('join', registration('a'));
  await b.request('join', registration('b'));
  await b.subscribe('codex:b');
  assert.equal(b.activeSubscriptions.has('codex:b'), true);
  const disconnected = once(b, 'disconnected');
  b.socket.terminate();
  assert.equal(b.activeSubscriptions.has('codex:b'), false, 'termination immediately invalidates receiver authority');
  await disconnected;
  assert.equal(b.subscriptions.has('codex:b'), true, 'reconnect intent remains');
  assert.equal(b.activeSubscriptions.has('codex:b'), false, 'closed socket has no receiver authority');
  const received = once(b, 'message');
  b.once('message', () => assert.equal(b.activeSubscriptions.has('codex:b'), true, 'subscribe ACK precedes replay delivery'));
  const message = await a.request('send', { agentId: 'codex:a', to: 'codex:b', text: 'offline task', messageId: 'reconnect' });
  assert.equal((await received)[0].id, message.id);
  await b.request('ack', { agentId: 'codex:b', id: message.id });
});

test('subscription ACK cannot revive ownership across unsubscribe and a replacement subscribe', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const requests = []; let peer;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    else requests.push(request);
  }); });
  await client.connect(); const id = 'codex:race';
  const first = client.subscribe(id).then(() => null, error => error);
  await eventually(() => requests.length === 1);
  const remove = client.unsubscribe(id), replacement = client.subscribe(id);
  assert.equal(client.activeSubscriptions.has(id), false);
  await delay(30); assert.deepEqual(requests.map(value => value.method), ['subscribe']);
  peer.send(JSON.stringify({ v: 2, id: requests[0].id, result: { subscribed: true } }));
  assert.match((await first).message, /superseded/i);
  await eventually(() => requests.length === 2);
  assert.equal(requests[1].method, 'unsubscribe');
  assert.equal(client.activeSubscriptions.has(id), false, 'stale ACK must not activate ownership');
  peer.send(JSON.stringify({ v: 2, id: requests[1].id, result: {} })); await remove;
  await eventually(() => requests.length === 3);
  assert.equal(requests[2].method, 'subscribe');
  assert.equal(client.activeSubscriptions.has(id), false);
  peer.send(JSON.stringify({ v: 2, id: requests[2].id, result: { subscribed: true } })); await replacement;
  assert.equal(client.activeSubscriptions.has(id), true);
});

test('leave and membership removal invalidate pending subscribe generations', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const requests = []; let peer;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    else requests.push(request);
  }); });
  await client.connect(); const firstID = 'codex:leave-race';
  const first = client.subscribe(firstID).then(() => null, error => error);
  await eventually(() => requests.length === 1);
  const leave = client.request('leave', { agentId: firstID });
  peer.send(JSON.stringify({ v: 2, id: requests[0].id, result: { subscribed: true } }));
  assert.match((await first).message, /superseded/i);
  await eventually(() => requests.length === 2);
  assert.equal(requests[1].method, 'leave');
  assert.equal(client.activeSubscriptions.has(firstID), false);
  peer.send(JSON.stringify({ v: 2, id: requests[1].id, result: {} })); await leave;
  assert.equal(client.subscriptions.has(firstID), false);
  const secondID = 'codex:removed-race';
  const second = client.subscribe(secondID).then(() => null, error => error);
  await eventually(() => requests.length === 3);
  peer.send(JSON.stringify({ v: 2, event: 'membership_removed', agentId: secondID, reason: 'control_removed_member' }));
  peer.send(JSON.stringify({ v: 2, id: requests[2].id, result: { subscribed: true } }));
  assert.match((await second).message, /superseded/i);
  assert.equal(client.activeSubscriptions.has(secondID), false);
  assert.equal(client.subscriptions.has(secondID), false);
});

test('failed membership resume invalidates desired receiver before reconnect replay', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const requests = [], id = 'codex:expired';
  client.registrations.set(id, {}); client.subscriptions.add(id); client.subscriptionGenerations.set(id, 1);
  server.on('connection', socket => socket.on('message', raw => {
    const request = JSON.parse(raw.toString()); requests.push(request.method);
    const result = request.method === 'hello' ? { protocol: 2, hostId: 'local', admin: true }
      : request.method === 'resume' ? { registered: false } : { subscribed: true };
    socket.send(JSON.stringify({ v: 2, id: request.id, result }));
  }));
  let removed = 0; client.on('membership_removed', event => { if (event.agentId === id) removed++; });
  await client.connect();
  assert.deepEqual(requests, ['hello', 'resume']);
  assert.equal(removed, 1);
  assert.equal(client.subscriptions.has(id), false);
  assert.equal(client.activeSubscriptions.has(id), false);
  assert.equal(client.subscriptionGenerations.get(id), 2);
});

test('subscription with an observed cwd falls back only when an older broker rejects its schema', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const attempts = [];
  server.on('connection', socket => socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') return socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    attempts.push(request.params);
    const response = request.params.observedCwd ? { error: 'Invalid request schema or protocol version' } : { result: { subscribed: true } };
    socket.send(JSON.stringify({ v: 2, id: request.id, ...response }));
  }));
  assert.equal((await client.subscribe('codex:old-broker', { observedCwd: '/destination' })).subscribed, true);
  assert.deepEqual(attempts, [{ agentId: 'codex:old-broker', observedCwd: '/destination' }, { agentId: 'codex:old-broker' }]);
});

test('operator-supervised worktree subscription never drops its guard for an older broker', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const attempts = [];
  server.on('connection', socket => socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') return socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    attempts.push(request.params);
    socket.send(JSON.stringify({ v: 2, id: request.id, error: 'Invalid request schema or protocol version' }));
  }));
  await assert.rejects(client.subscribe('codex:old-broker', { observedCwd: '/source', manualWorktreeHost: true }), /Invalid request schema/);
  assert.deepEqual(attempts, [{ agentId: 'codex:old-broker', observedCwd: '/source', manualWorktreeHost: true }]);
  assert.equal(client.subscriptions.size, 0);
  assert.equal(client.manualWorktreeSubscriptions.size, 0);
});

test('operator-supervised worktree subscription preserves its guard after reconnect', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const attempts = []; let firstSocket;
  server.on('connection', socket => {
    firstSocket ??= socket;
    socket.on('message', raw => {
      const request = JSON.parse(raw.toString());
      if (request.method === 'hello') return socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
      if (request.method === 'subscribe') attempts.push(request.params);
      socket.send(JSON.stringify({ v: 2, id: request.id, result: { subscribed: true } }));
    });
  });
  await client.subscribe('codex:fixture', { manualWorktreeHost: true });
  firstSocket.terminate();
  await eventually(() => attempts.length === 2);
  assert.deepEqual(attempts, [{ agentId: 'codex:fixture', manualWorktreeHost: true }, { agentId: 'codex:fixture', manualWorktreeHost: true }]);
});

test('target handoff racing an older unsubscribe fails closed and drops the socket', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  const requests = []; let peer;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    else requests.push(request);
  }); });
  await client.connect(); const id = 'codex:race-target';
  const subscribed = client.subscribe(id); await eventually(() => requests.length === 1);
  peer.send(JSON.stringify({ v: 2, id: requests[0].id, result: { subscribed: true } })); await subscribed;
  await eventually(() => !client.subscriptionOperations.has(id));
  const remove = client.unsubscribe(id).then(() => null, error => error); await eventually(() => requests.length === 2);
  const offerID = randomUUID(); client.handoffCandidates.set(offerID, { agentId: id, key: 'c'.repeat(64) });
  let handoffPublished = false; client.on('receiver_handoff', () => { handoffPublished = true; });
  const disconnected = once(client, 'disconnected');
  peer.send(JSON.stringify({ v: 2, event: 'receiver_handoff', agentId: id, offerID, role: 'target' }));
  await disconnected; assert.ok(await remove);
  assert.equal(client.activeSubscriptions.has(id), false);
  assert.equal(client.subscriptions.has(id), false);
  assert.equal(handoffPublished, false, 'ambiguous target ownership must not be published');
});

test('contained owner recovery confirms the current socket before replay and rejects superseded recovery', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'turnlink-owner-ack-'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const client = new ChannelClient({ url: `ws://127.0.0.1:${server.address().port}`, token: TOKEN, credentialDirectory: directory });
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const requests = []; let peer;
  server.on('connection', socket => { peer = socket; socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.method === 'hello') socket.send(JSON.stringify({ v: 2, id: request.id, result: { protocol: 2, hostId: 'local', admin: true } }));
    else requests.push(request);
  }); });
  await client.connect(); const id = 'opencode:owner-ack', previousID = randomUUID(), transitionID = randomUUID();
  receiverHandoffKey('local', id, previousID, directory, true);
  const recovered = client.recoverContainedOwner(id, '3'.repeat(64), previousID, { id: transitionID, agentId: id, channel: 'dev' });
  await eventually(() => requests.length === 1);
  assert.equal(client.activeSubscriptions.has(id), false);
  let activeAtNotification = false;
  client.once('task_available', () => { activeAtNotification = client.activeSubscriptions.has(id); });
  peer.send(JSON.stringify({ v: 2, id: requests[0].id, result: { transferred: true, transitionID } }));
  peer.send(JSON.stringify({ v: 2, event: 'task_available', agentId: id }));
  await recovered;
  await eventually(() => activeAtNotification);
  assert.equal(client.activeSubscriptions.has(id), true);
  assert.equal(client.subscriptions.has(id), true);
  assert.ok(client.receiverKeys.has(id));
  const other = 'opencode:owner-race', old = randomUUID(), next = randomUUID();
  receiverHandoffKey('local', other, old, directory, true);
  const pending = client.recoverContainedOwner(other, '3'.repeat(64), old, { id: next, agentId: other, channel: 'dev' }).then(() => null, error => error);
  await eventually(() => requests.length === 2);
  const removal = client.unsubscribe(other).catch(() => {});
  const disconnected = once(client, 'disconnected');
  peer.send(JSON.stringify({ v: 2, id: requests[1].id, result: { transferred: true, transitionID: next } }));
  assert.match((await pending).message, /unavailable/i); await disconnected; await removal;
  assert.equal(client.activeSubscriptions.has(other), false);
});

test('Codex proxy wakes same idle thread, steers busy thread, isolates sessions and preserves approvals', async t => {
  const { options, make, broker } = await setup(t);
  const child = spawn(process.execPath, ['src/codex-proxy.js', 'test/fixtures/codex.js', 'app-server'], {
    cwd: resolve('.'), env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: options.url, AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const output = [];
  createInterface({ input: child.stdout }).on('line', line => output.push(JSON.parse(line)));
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const send = data => child.stdin.write(`${JSON.stringify(data)}\n`);
  send({ id: 1, method: 'initialize', params: {} });
  await eventually(() => output.some(m => m.id === 1));
  send({ id: 2, method: 'thread/start', params: { fixtureId: 'thread-b' } });
  send({ id: 3, method: 'thread/start', params: { fixtureId: 'thread-c' } });
  await eventually(() => output.some(m => m.id === 3));
  const a = make();
  await a.request('join', registration('a'));
  await a.request('join', registration('thread-b'));
  await a.request('join', registration('thread-c'));
  await eventually(() => output.some(m => m.id === 2));
  await delay(100);
  await a.request('send', { agentId: 'codex:a', to: 'codex:thread-b', text: 'wake task', messageId: 'wake' });
  await eventually(() => output.some(m => m.method === 'fixture/received'));
  const first = output.find(m => m.method === 'fixture/received').params;
  assert.equal(first.method, 'turn/start');
  assert.equal(first.threadId, 'thread-b');
  assert.match(first.input[0].text, /wake task/);
  await a.request('send', { agentId: 'codex:a', to: 'codex:thread-b', text: 'change direction', messageId: 'steer' });
  await eventually(() => output.filter(m => m.method === 'fixture/received').length === 2);
  assert.equal(output.filter(m => m.method === 'fixture/received')[1].params.method, 'turn/steer');
  send({ id: 4, method: 'fixture/approval', params: { threadId: 'thread-b' } });
  await eventually(() => output.some(m => m.id === 999));
  await a.request('send', { agentId: 'codex:a', to: 'codex:thread-b', text: 'wait for permission', messageId: 'approval' });
  await delay(150);
  assert.equal(output.filter(m => m.method === 'fixture/received').length, 2);
  send({ id: 999, result: { decision: 'approved' } });
  await eventually(() => output.filter(m => m.method === 'fixture/received').length === 3);
  assert.ok(output.filter(m => m.method === 'fixture/received').every(m => m.params.threadId === 'thread-b'));
  assert.ok(!output.some(m => String(m.id).startsWith('agent-channel-')));
  await eventually(() => broker.store.messages.every(m => m.delivered.includes('codex:thread-b')));
  assert.equal(stderr, '');
});

test('Codex queued delivery waits for receiver confirmation after broker disconnect', async t => {
  const { options, make, broker } = await setup(t);
  const child = spawn(process.execPath, ['src/codex-proxy.js', 'test/fixtures/codex.js', 'app-server'], {
    cwd: resolve('.'), env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: options.url,
      AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit'); child.stderr.resume();
  const output = []; createInterface({ input: child.stdout }).on('line', line => output.push(JSON.parse(line)));
  const send = data => child.stdin.write(`${JSON.stringify(data)}\n`);
  try {
    send({ id: 1, method: 'initialize', params: {} }); await eventually(() => output.some(frame => frame.id === 1));
    send({ id: 2, method: 'thread/start', params: { fixtureId: 'thread-disconnect' } });
    await eventually(() => output.some(frame => frame.id === 2));
    const sender = make(); await sender.request('join', registration('sender')); await sender.request('join', registration('thread-disconnect'));
    await eventually(() => broker.store.agents['codex:thread-disconnect']?.disconnectedAt === null);
    send({ id: 3, method: 'fixture/approval', params: { threadId: 'thread-disconnect' } });
    await eventually(() => output.some(frame => frame.id === 999));
    await sender.request('send', { agentId: 'codex:sender', to: 'codex:thread-disconnect', text: 'queued while held', messageId: 'receiver-loss' });
    await delay(100);
    for (const socket of broker.server.clients) socket.terminate();
    await eventually(() => broker.store.agents['codex:thread-disconnect']?.disconnectedAt != null);
    send({ id: 999, result: { decision: 'approved' } });
    await delay(200);
    assert.equal(output.some(frame => frame.method === 'fixture/received'), false, 'queued work must not start on a lost receiver');
    await eventually(() => output.some(frame => frame.method === 'fixture/received'));
    assert.match(output.find(frame => frame.method === 'fixture/received').params.input[0].text, /queued while held/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});

test('OpenCode V2 admits peer input in the existing session without overriding agent/model', async t => {
  const { options, make, broker } = await setup(t);
  const before = { url: process.env.AGENT_CHANNEL_URL, token: process.env.AGENT_CHANNEL_TOKEN, credentials: process.env.AGENT_CHANNEL_CREDENTIAL_DIR };
  process.env.AGENT_CHANNEL_URL = options.url; process.env.AGENT_CHANNEL_TOKEN = options.token;
  process.env.AGENT_CHANNEL_CREDENTIAL_DIR = options.credentialDirectory;
  t.after(() => {
    for (const [key, value] of Object.entries({ AGENT_CHANNEL_URL: before.url, AGENT_CHANNEL_TOKEN: before.token, AGENT_CHANNEL_CREDENTIAL_DIR: before.credentials })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const { tools, calls } = await openCodeFixture(t, options);
  await tools.channel_join.execute({ name: 'b', role: 'frontend', channel: 'development', project: { name: 'ui' } }, { sessionID: 'b' });
  const a = make(); await a.request('join', registration('a'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'wake', messageId: 'open-wake' });
  await eventually(() => calls.length === 1);
  assert.equal(calls[0].sessionID, 'b'); assert.equal(calls[0].delivery, 'steer'); assert.equal(calls[0].resume, true);
  assert.equal(calls[0].agent, undefined); assert.equal(calls[0].model, undefined); assert.equal(calls[0].tools, undefined);
  assert.match(calls[0].id, /^msg_turnlink_/);
  await eventually(() => broker.store.messages[0].delivered.includes('opencode:b'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'steer', messageId: 'open-steer' });
  await eventually(() => calls.length === 2);
  assert.equal(calls[1].delivery, 'steer'); assert.notEqual(calls[0].id, calls[1].id);
});

test('Claude MCP channel pushes unsolicited messages and requires explicit model acknowledgement', async t => {
  const { options, make, broker } = await setup(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.js'), '--claude-channel'],
    env: { ...process.env, AGENT_CHANNEL_URL: options.url, AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_SESSION_ID: 'claude-b', AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory }, stderr: 'pipe' });
  const mcp = new Client({ name: 'test-harness', version: '1' });
  t.after(() => mcp.close());
  const events = [];
  mcp.setNotificationHandler(z.object({ method: z.literal('notifications/claude/channel'), params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) }), event => { events.push(event); });
  await mcp.connect(transport);
  assert.ok(mcp.getServerCapabilities().experimental['claude/channel']);
  const joined = await mcp.callTool({ name: 'channel_join', arguments: registration('claude-b', 'claude') });
  assert.ok(!joined.isError);
  const registered = JSON.parse(joined.content[0].text).agent;
  assert.equal(registered.connected, true);
  assert.equal(registered.nameState, 'claimed');
  const a = make(); await a.request('join', registration('a'));
  const message = await a.request('send', { agentId: 'codex:a', to: 'claude:claude-b', text: 'idle task', messageId: 'claude-push' });
  await eventually(() => events.length === 1);
  assert.match(events[0].params.content, /idle task/);
  assert.deepEqual(broker.store.messages[0].delivered, []);
  const ack = await mcp.callTool({ name: 'channel_ack', arguments: { id: message.id } });
  assert.ok(!ack.isError);
  assert.deepEqual(broker.store.messages[0].delivered, ['claude:claude-b']);
});

test('OpenCode leave clears pending wake before the harness has admitted the task', async t => {
  const { options, make, broker } = await setup(t);
  const before = { url: process.env.AGENT_CHANNEL_URL, token: process.env.AGENT_CHANNEL_TOKEN, credentials: process.env.AGENT_CHANNEL_CREDENTIAL_DIR };
  process.env.AGENT_CHANNEL_URL = options.url; process.env.AGENT_CHANNEL_TOKEN = options.token;
  process.env.AGENT_CHANNEL_CREDENTIAL_DIR = options.credentialDirectory;
  t.after(() => {
    for (const [key, value] of Object.entries({ AGENT_CHANNEL_URL: before.url, AGENT_CHANNEL_TOKEN: before.token, AGENT_CHANNEL_CREDENTIAL_DIR: before.credentials })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let resumeStatus;
  const calls = [];
  const fixture = await openCodeFixture(t, options, { session: {
    prompt: async input => { calls.push(input); return { id: input.id, sessionID: input.sessionID }; },
  } });
  fixture.ctx.permission.list = () => new Promise(resolve => { resumeStatus = resolve; });
  const context = { sessionID: 'b' };
  await fixture.tools.channel_join.execute({ name: 'b', role: 'frontend', channel: 'development', project: { name: 'ui' } }, context);
  const a = make(); await a.request('join', registration('a'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'must not wake after leave', messageId: 'leave-race' });
  await eventually(() => !!resumeStatus);
  await fixture.tools.channel_leave.execute({}, context);
  resumeStatus([]);
  await delay(30);
  assert.equal(calls.length, 0);
  assert.equal(broker.store.agents['opencode:b'], undefined);
  assert.equal(broker.store.messages[0].cancelled['opencode:b'], 'explicit_leave');
});

test('OpenCode V2 permissions/forms remain blocking until both are answered', async t => {
  const { options, make } = await setup(t);
  const calls = [];
  // Plugin credentials are supplied through a private synthetic host file, not the real user token.
  const file = join(options.credentialDirectory, '..', 'host.token');
  writeFileSync(file, TOKEN, { mode: 0o600 });
  const configured = await openCodeFixture(t, { url: options.url, credentialDirectory: options.credentialDirectory, tokenFile: file }, { session: {
    prompt: async input => { calls.push(input); return { id: input.id, sessionID: input.sessionID }; },
  } });
  await configured.tools.channel_join.execute({ channel: 'development', name: 'b', role: 'worker', project: { name: 'test' } }, { sessionID: 'b' });
  configured.emit('permission.asked', { sessionID: 'b', id: 'permission' });
  configured.emit('form.created', { form: { sessionID: 'b', id: 'question' } });
  const a = make(); await a.request('join', registration('a'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'pending approval wake', messageId: 'approval-v2' });
  await delay(30); assert.equal(calls.length, 0);
  configured.emit('permission.replied', { sessionID: 'b', requestID: 'permission' });
  await delay(30); assert.equal(calls.length, 0);
  configured.emit('form.replied', { sessionID: 'b', id: 'question' });
  await eventually(() => calls.length === 1);
  assert.equal(calls[0].agent, undefined);
});
