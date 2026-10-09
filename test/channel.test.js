import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import plugin from '../adapters/opencode.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

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
  const disconnected = once(b, 'disconnected');
  b.socket.terminate();
  await disconnected;
  const received = once(b, 'message');
  const message = await a.request('send', { agentId: 'codex:a', to: 'codex:b', text: 'offline task', messageId: 'reconnect' });
  assert.equal((await received)[0].id, message.id);
  await b.request('ack', { agentId: 'codex:b', id: message.id });
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

test('OpenCode plugin wakes idle existing session and inserts busy context', async t => {
  const { options, make, broker } = await setup(t);
  const before = { url: process.env.AGENT_CHANNEL_URL, token: process.env.AGENT_CHANNEL_TOKEN, credentials: process.env.AGENT_CHANNEL_CREDENTIAL_DIR };
  process.env.AGENT_CHANNEL_URL = options.url; process.env.AGENT_CHANNEL_TOKEN = options.token;
  process.env.AGENT_CHANNEL_CREDENTIAL_DIR = options.credentialDirectory;
  t.after(() => {
    for (const [key, value] of Object.entries({ AGENT_CHANNEL_URL: before.url, AGENT_CHANNEL_TOKEN: before.token, AGENT_CHANNEL_CREDENTIAL_DIR: before.credentials })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = []; let busy = false;
  const hooks = await plugin({ directory: '/projects/b', client: {
    session: {
      status: async () => ({ data: { b: { type: busy ? 'busy' : 'idle' } } }),
      messages: async () => ({ data: [{ info: { role: 'user', agent: 'plan', model: { providerID: 'fixture', modelID: 'test' }, tools: { edit: false } } }] }),
      promptAsync: async input => { calls.push({ method: 'wake', input }); },
      prompt: async input => { calls.push({ method: 'context', input }); },
    }, app: { log: async () => {} },
  } });
  t.after(() => hooks.dispose());
  await hooks.tool.channel_join.execute({ name: 'b', role: 'frontend', channel: 'development', project: { name: 'ui' } }, { sessionID: 'b' });
  const a = make(); await a.request('join', registration('a'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'wake', messageId: 'open-wake' });
  await eventually(() => calls.length === 1);
  assert.equal(calls[0].method, 'wake'); assert.equal(calls[0].input.path.id, 'b');
  assert.equal(calls[0].input.body.agent, 'plan'); assert.equal(calls[0].input.body.tools.edit, false);
  await eventually(() => broker.store.messages[0].delivered.includes('opencode:b'));
  busy = true;
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'steer', messageId: 'open-steer' });
  await eventually(() => calls.length === 2);
  assert.equal(calls[1].method, 'context'); assert.equal(calls[1].input.body.noReply, true);
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
  const hooks = await plugin({ directory: '/projects/b', client: {
    session: {
      status: () => new Promise(resolve => { resumeStatus = resolve; }),
      promptAsync: async input => { calls.push(input); },
      prompt: async input => { calls.push(input); },
    }, app: { log: async () => {} },
  } });
  t.after(() => hooks.dispose());
  const context = { sessionID: 'b' };
  await hooks.tool.channel_join.execute({ name: 'b', role: 'frontend', channel: 'development', project: { name: 'ui' } }, context);
  const a = make(); await a.request('join', registration('a'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'must not wake after leave', messageId: 'leave-race' });
  await eventually(() => !!resumeStatus);
  await hooks.tool.channel_leave.execute({}, context);
  resumeStatus({ data: { b: { type: 'idle' } } });
  await delay(30);
  assert.equal(calls.length, 0);
  assert.equal(broker.store.agents['opencode:b'], undefined);
  assert.equal(broker.store.messages[0].cancelled['opencode:b'], 'explicit_leave');
});

test('OpenCode v2 permission/question prompts remain blocking until both are answered', async t => {
  const { options, make } = await setup(t);
  const calls = [];
  // Plugin credentials are supplied through a private synthetic host file, not the real user token.
  const file = join(options.credentialDirectory, '..', 'host.token');
  writeFileSync(file, TOKEN, { mode: 0o600 });
  const configured = await plugin({ directory: '/test', client: {
    session: {
      status: async () => ({ data: { b: { type: 'idle' } } }),
      messages: async () => ({ data: [{ info: { role: 'user', agent: 'plan', model: { providerID: 'fixture', modelID: 'test' } } }] }),
      promptAsync: async args => calls.push(args), prompt: async args => calls.push(args),
    }, app: { log: async () => {} },
  } }, { url: options.url, credentialDirectory: options.credentialDirectory, tokenFile: file });
  t.after(() => configured.dispose());
  await configured.tool.channel_join.execute({ channel: 'development', name: 'b', role: 'worker', project: { name: 'test' } }, { sessionID: 'b' });
  await configured.event({ event: { type: 'permission.v2.asked', properties: { sessionID: 'b', id: 'permission' } } });
  await configured.event({ event: { type: 'question.v2.asked', properties: { sessionID: 'b', id: 'question' } } });
  const a = make(); await a.request('join', registration('a'));
  await a.request('send', { agentId: 'codex:a', to: 'opencode:b', text: 'pending approval wake', messageId: 'approval-v2' });
  await delay(30); assert.equal(calls.length, 0);
  await configured.event({ event: { type: 'permission.v2.replied', properties: { sessionID: 'b', requestID: 'permission' } } });
  await configured.event({ event: { type: 'session.idle', properties: { sessionID: 'b' } } });
  await delay(30); assert.equal(calls.length, 0);
  await configured.event({ event: { type: 'question.v2.replied', properties: { sessionID: 'b', requestID: 'question' } } });
  await configured.event({ event: { type: 'session.idle', properties: { sessionID: 'b' } } });
  await eventually(() => calls.length === 1);
  assert.equal(calls[0].body.agent, 'plan');
});
