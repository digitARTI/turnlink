import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateTemp } from '../src/storage.js';
import { createClaudeMonitorSpool } from '../src/claude-monitor-spool.js';
import { claudeMonitorEvents } from '../src/claude-monitor-events.js';

test('monitor splits escaped and Unicode text into reconstructable bounded events', () => {
  const text = ('🙂\\\n"ab').repeat(250);
  const events = claudeMonitorEvents({ id: 'fixture', text, from: { name: 'sender', agentId: 'codex:sender' }, channel: 'dev' });
  assert.ok(events.length > 1);
  assert.equal(events.map(event => event.text).join(''), text);
  assert.deepEqual(events.map(event => event.part), events.map((_, index) => index + 1));
  assert.ok(events.every(event => event.parts === events.length && Buffer.byteLength(JSON.stringify(event)) < 700));
});

test('Claude monitor delivers peer text and replays until explicit MCP acknowledgement', { timeout: process.platform === 'win32' ? 90000 : 15000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-claude-monitor-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64) });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`, session = 'claude-fixture';
  const env = { ...process.env, AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: '1'.repeat(64), AGENT_CHANNEL_SESSION_ID: session, CLAUDE_CODE_SESSION_ID: session,
    AGENT_CHANNEL_CREDENTIAL_DIR: join(root, 'proofs'), AGENT_CHANNEL_STATE_DIR: join(root, 'state'), AGENT_CHANNEL_CLAUDE_MONITOR: '1' };
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.js'), '--claude-channel'], env, stderr: 'pipe' });
  const mcp = new Client({ name: 'fixture', version: '1' });
  const sender = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') });
  let monitor;
  const stopMonitor = async () => { if (monitor && monitor.exitCode === null && monitor.signalCode === null) { const done = once(monitor, 'exit'); monitor.kill(); await done; } };
  t.after(async () => { await stopMonitor(); await mcp.close(); sender.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  await mcp.connect(transport);
  assert.equal(mcp.getServerCapabilities().experimental?.['claude/channel'], undefined);
  const joined = await mcp.callTool({ name: 'channel_join', arguments: { harness: 'claude', sessionId: session,
    name: 'claude', role: 'test', channel: 'dev', project: { name: 'test', root } } });
  assert.ok(!joined.isError);
  const initial = JSON.parse(joined.content[0].text); assert.equal(initial.monitor.status, 'inactive'); assert.match(initial.monitor.command, /--session-env/);
  await sender.request('join', { harness: 'codex', sessionId: 'sender', name: 'sender', role: 'test', channel: 'dev', project: { name: 'test', root } });
  const message = await sender.request('send', { agentId: 'codex:sender', to: `claude:${session}`, text: 'line one\nline two', messageId: 'monitor-fixture' });
  const startMonitor = () => {
    monitor = spawn(process.execPath, [resolve('src/claude-monitor.js'), '--session-env', '--state-dir', join(root, 'state')], { env: { ...env, AGENT_CHANNEL_STATE_DIR: join(root, 'other') }, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = createInterface({ input: monitor.stdout }); return once(lines, 'line').then(([line]) => JSON.parse(line));
  };
  const first = await startMonitor();
  const rejoined = await mcp.callTool({ name: 'channel_join', arguments: { harness: 'claude', sessionId: session,
    name: 'claude', role: 'test', channel: 'dev', project: { name: 'test', root } } });
  assert.equal(JSON.parse(rejoined.content[0].text).monitor.status, 'active');
  assert.equal(first.id, message.id); assert.equal(first.text, 'line one\nline two'); assert.equal(first.from, 'sender');
  assert.deepEqual(Object.keys(first).slice(0, 2), ['id', 'text']);
  assert.deepEqual(broker.store.messages[0].delivered, []);
  await stopMonitor();
  assert.equal(createClaudeMonitorSpool(join(root, 'state'), session).monitorStatus(), 'inactive');
  const replay = await startMonitor(); assert.equal(replay.id, first.id);
  const acknowledged = await mcp.callTool({ name: 'channel_ack', arguments: { id: message.id } });
  assert.ok(!acknowledged.isError); assert.deepEqual(broker.store.messages[0].delivered, [`claude:${session}`]);
  await delay(100); assert.deepEqual(createClaudeMonitorSpool(join(root, 'state'), session).read(), []);
  const longText = 'Long message with accents à and emoji 🙂. '.repeat(45);
  const parts = [], partTimes = [];
  const receivedParts = new Promise(resolve => {
    const lines = createInterface({ input: monitor.stdout });
    lines.on('line', line => {
      const event = JSON.parse(line);
      parts.push(event);
      partTimes.push(Date.now());
      if (parts.length === event.parts) { lines.close(); resolve(); }
    });
  });
  const longMessage = await sender.request('send', { agentId: 'codex:sender', to: `claude:${session}`, text: longText, messageId: 'monitor-long-fixture' });
  await receivedParts;
  assert.ok(parts.length > 1); assert.ok(parts.every(part => part.id === longMessage.id));
  assert.equal(parts.map(part => part.text).join(''), longText);
  assert.ok(partTimes.slice(1).every((time, index) => time - partTimes[index] >= 250), 'parts must be separated to avoid notification batching');
  assert.ok(!(await mcp.callTool({ name: 'channel_ack', arguments: { id: longMessage.id } })).isError);
  const moved = await mcp.callTool({ name: 'channel_join', arguments: { harness: 'claude', sessionId: session,
    name: 'claude', role: 'test', channel: 'other', project: { name: 'test', root } } });
  assert.ok(!moved.isError); assert.equal(JSON.parse(moved.content[0].text).monitor.status, 'active');
  await sender.request('join', { harness: 'codex', sessionId: 'sender', name: 'sender', role: 'test', channel: 'other', project: { name: 'test', root } });
  const nextLine = once(createInterface({ input: monitor.stdout }), 'line');
  const next = await sender.request('send', { agentId: 'codex:sender', to: `claude:${session}`, text: 'new channel', messageId: 'monitor-switch' });
  const [line] = await nextLine; assert.equal(JSON.parse(line).id, next.id); assert.equal(JSON.parse(line).text, 'new channel');
  const stopped = once(monitor, 'exit');
  const left = await mcp.callTool({ name: 'channel_leave', arguments: {} }); assert.ok(!left.isError);
  await stopped;
  assert.equal(createClaudeMonitorSpool(join(root, 'state'), session).monitorStatus(), 'inactive');
});
