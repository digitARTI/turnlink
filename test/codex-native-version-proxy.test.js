import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';

// Opt-in only: the executable must be an externally isolated official
// app-server wrapper. This test never creates a native thread in a user store.
const executable = process.env.TURNLINK_OFFLINE_CODEX_EXECUTABLE;
test('isolated native Codex app-server publishes its version through the current proxy receiver',
  { skip: !executable, timeout: 45000 }, async t => {
    const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-native-version-')));
    const hostToken = '1'.repeat(64), adminToken = '2'.repeat(64), adapterToken = '3'.repeat(64);
    const credentialFile = join(root, 'adapter.token'); writeFileSync(credentialFile, adapterToken, { mode: 0o600 });
    const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: hostToken, adminSecret: adminToken, controlPlane: true });
    await once(broker.server, 'listening');
    const url = `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory = join(root, 'proofs');
    const admin = new ChannelClient({ url, token: adminToken, credentialDirectory });
    const participant = new ChannelClient({ url, token: hostToken, credentialDirectory });
    let proxy;
    t.after(async () => {
      if (proxy && proxy.exitCode === null && proxy.signalCode === null) { const stopped = once(proxy, 'exit'); proxy.kill(); await stopped; }
      participant.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true });
    });
    await admin.request('control_command', { command: { id: randomUUID(), op: 'channel.configure', channel: 'dev' } });
    await admin.request('control_enroll_adapter', { hostId: 'local', credential: adapterToken });
    proxy = spawn(process.execPath, [resolve('src/codex-proxy.js'), 'app-server'], { cwd: root, env: {
      PATH: process.env.PATH, AGENT_CHANNEL_CODEX_EXECUTABLE: executable, AGENT_CHANNEL_URL: url,
      AGENT_CHANNEL_TOKEN: hostToken, AGENT_CHANNEL_CREDENTIAL_DIR: credentialDirectory, AGENT_CHANNEL_STATE_DIR: join(root, 'state'),
      AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_HEALTH: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: credentialFile,
    }, stdio: ['pipe', 'pipe', 'pipe'] });
    proxy.stderr.resume();
    const frames = [];
    createInterface({ input: proxy.stdout }).on('line', line => { try { frames.push(JSON.parse(line)); } catch { /* Native non-protocol output is not evidence. */ } });
    const send = value => proxy.stdin.write(`${JSON.stringify(value)}\n`);
    const wait = async fn => { for (let i = 0; i < 200; i++) { if (proxy.exitCode !== null) throw new Error('Isolated native proxy exited'); const value = await fn(); if (value) return value; await delay(50); } throw new Error('Isolated native proxy timed out'); };
    const initializeID = randomUUID();
    send({ id: initializeID, method: 'initialize', params: { clientInfo: { name: 'synthetic/client', version: '987.654.321' } } });
    const initialized = await wait(() => frames.find(frame => frame.id === initializeID));
    assert.ok(initialized.result, 'native initialization must succeed');
    send({ method: 'initialized', params: {} });
    const startID = randomUUID();
    send({ id: startID, method: 'thread/start', params: { cwd: '/tmp', sandbox: 'read-only', approvalPolicy: 'on-request' } });
    const started = await wait(() => frames.find(frame => frame.id === startID));
    assert.ok(started.result?.thread?.id, 'native thread creation must succeed');
    const sessionId = started.result.thread.id, agentId = `codex:${sessionId}`;
    await participant.request('join', { harness: 'codex', sessionId, name: 'native-version', role: 'synthetic', channel: 'dev',
      project: { name: 'synthetic', root: '/tmp' } });
    const tool = new ToolSession(participant, { harness: 'codex', sessionId }); tool.agentId = agentId; tool.channel = 'dev';
    const entry = await wait(async () => {
      const result = await tool.call('channel_status', { channel: 'dev', view: 'health' });
      return result.entries.find(value => value.agentId === agentId && value.fresh && value.report?.nativeVersion);
    });
    assert.equal(entry.report.nativeVersion, '0.165.0');
    assert.equal(entry.coverage, 'observational');
    assert.ok(!JSON.stringify(entry).includes('synthetic/client'));
  });
