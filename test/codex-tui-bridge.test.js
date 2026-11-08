import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createCodexTuiBridge } from '../src/codex-tui-bridge.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateTemp } from '../src/storage.js';

test('TUI bridge authenticates one client and delivers a broker message to the same Codex thread', { timeout: 20000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-tui-bridge-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64) });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const client = new ChannelClient(options);
  const bridge = await createCodexTuiBridge({ proxyArgs: [resolve('test/fixtures/codex.js'), 'app-server'], env: {
    ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: options.url,
    AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory,
    AGENT_CHANNEL_STATE_DIR: join(root, 'state'),
  } });
  let socket;
  t.after(async () => { socket?.terminate(); client.close(); await bridge.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const denied = new WebSocket(bridge.url, { headers: { Authorization: 'Bearer incorrect' } });
  denied.on('error', () => {});
  const [, response] = await once(denied, 'unexpected-response'); assert.equal(response.statusCode, 403); denied.terminate();
  socket = new WebSocket(bridge.url, { headers: { Authorization: `Bearer ${bridge.secret}` } }); await once(socket, 'open');
  const duplicate = new WebSocket(bridge.url, { headers: { Authorization: `Bearer ${bridge.secret}` } });
  duplicate.on('error', () => {});
  const [, duplicateResponse] = await once(duplicate, 'unexpected-response'); assert.equal(duplicateResponse.statusCode, 403); duplicate.terminate();
  const messages = []; socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const wait = async condition => { for (let i = 0; i < 200; i++) { const result = condition(); if (result) return result; await delay(25); } throw new Error('Timed out'); };
  const send = value => socket.send(JSON.stringify(value));
  send({ id: 1, method: 'initialize', params: {} }); await wait(() => messages.find(value => value.id === 1));
  send({ id: 2, method: 'thread/start', params: { fixtureId: 'tui-thread' } }); await wait(() => messages.find(value => value.id === 2));
  const register = sessionId => ({ harness: 'codex', sessionId, name: sessionId, role: 'test', channel: 'dev', project: { name: 'test', root } });
  await client.request('join', register('sender'));
  await client.request('join', register('tui-thread'));
  await delay(100);
  await client.request('send', { agentId: 'codex:sender', to: 'codex:tui-thread', text: 'bridge wake', messageId: 'bridge-wake' });
  const wake = await wait(() => messages.find(value => value.method === 'fixture/received'));
  assert.equal(wake.params.method, 'turn/start'); assert.equal(wake.params.threadId, 'tui-thread');
  assert.match(wake.params.input[0].text, /bridge wake/);
});
