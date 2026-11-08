import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateTemp } from '../src/storage.js';

test('Codex keeps its receiver after moving channels', { timeout: 15000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-switch-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64) });
  await once(broker.server, 'listening');
  const opts = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const agent = new ChannelClient(opts), sender = new ChannelClient(opts);
  const proxy = spawn(process.execPath, [resolve('src/codex-proxy.js'), resolve('test/fixtures/codex.js'), 'app-server'], { env: {
    ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: opts.url,
    AGENT_CHANNEL_TOKEN: opts.token, AGENT_CHANNEL_CREDENTIAL_DIR: opts.credentialDirectory, AGENT_CHANNEL_STATE_DIR: join(root, 'state'),
  }, stdio: ['pipe', 'pipe', 'pipe'] }); proxy.stderr.resume();
  t.after(async () => { if (proxy.exitCode === null && proxy.signalCode === null) { const done = once(proxy, 'exit'); proxy.kill(); await done; } agent.close(); sender.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const frames = []; createInterface({ input: proxy.stdout }).on('line', line => frames.push(JSON.parse(line)));
  const wait = async condition => { for (let i = 0; i < 200; i++) { const value = condition(); if (value) return value; await delay(25); } throw new Error('Timed out waiting for Codex delivery'); };
  proxy.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {} })+'\n'); await wait(() => frames.some(x => x.id === 1));
  proxy.stdin.write(JSON.stringify({ id: 2, method: 'thread/start', params: { fixtureId: 'moving' } })+'\n'); await wait(() => frames.some(x => x.id === 2));
  const reg = (id, channel) => ({ harness: 'codex', sessionId: id, name: id, role: 'test', project: { name: 'test', root }, channel });
  await agent.request('join', reg('moving', 'one')); await delay(100);
  await agent.request('join', reg('moving', 'two')); await sender.request('join', reg('sender', 'two'));
  await delay(100);
  await sender.request('send', { agentId: 'codex:sender', to: 'codex:moving', text: 'new-channel wake', messageId: 'switch-test' });
  const received = await wait(() => frames.find(x => x.method === 'fixture/received'));
  assert.match(received.params.input[0].text, /new-channel wake/);
  await wait(() => broker.store.messages.some(x => x.messageId === 'switch-test' && x.delivered.includes('codex:moving')));
});
