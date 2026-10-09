import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { once } from 'node:events';
import { privateTemp } from '../src/storage.js';
import { codexStdioSession } from '../src/session-binding.js';
import { createBroker } from '../src/broker.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const one = '00000000-0000-4000-8000-000000000001', two = '00000000-0000-4000-8000-000000000002';
const meta = id => ({ threadId: id, sessionId: id, windowId: 'synthetic-window', 'x-codex-turn-metadata': {} });
test('Codex stdio binding accepts only coherent outer framework session metadata', () => {
  assert.equal(codexStdioSession(meta(one)), one);
  assert.throws(() => codexStdioSession({ threadId: one, sessionId: one }), /missing or inconsistent/);
  assert.throws(() => codexStdioSession({ ...meta(one), sessionId: two }), /missing or inconsistent/);
  assert.throws(() => codexStdioSession(meta(one), two), /disagree/);
});
test('tool-argument shaped identity is never treated as Codex outer metadata', () => {
  assert.throws(() => codexStdioSession({ arguments: meta(one) }), /missing or inconsistent/);
  assert.throws(() => codexStdioSession({ ...meta(one), threadId: '../victim' }), /missing or inconsistent/);
});
test('metadata-bound MCP isolates sessions in one process and rejects model identity overrides', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-metadata-binding-'));
  const token = '1'.repeat(64), admin = '2'.repeat(64);
  const broker = createBroker({ port: 0, directory: join(root, 'broker'), secret: token, adminSecret: admin });
  await once(broker.server, 'listening');
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.js'), '--codex-stdio'],
    env: { ...process.env, CODEX_THREAD_ID: '', AGENT_CHANNEL_SESSION_ID: '', AGENT_CHANNEL_TOKEN: token,
      AGENT_CHANNEL_URL: `ws://127.0.0.1:${broker.server.address().port}`, AGENT_CHANNEL_CREDENTIAL_DIR: join(root, 'keys') }, stderr: 'pipe' });
  const mcp = new Client({ name: 'synthetic-codex', version: '1' });
  t.after(async () => { await mcp.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  await mcp.connect(transport);
  const schema = (await mcp.listTools()).tools.find(tool => tool.name === 'channel_join').inputSchema;
  assert.ok(!schema.properties.sessionId); assert.ok(!schema.properties.harness);
  const args = name => ({ name, role: 'test', channel: 'development', project: { name: 'fixture', root: '/fixture' } });
  const result = await mcp.callTool({ name: 'channel_join', arguments: args('first'), _meta: meta(one) });
  assert.ok(!result.isError);
  assert.equal(JSON.parse(result.content[0].text).agent.sessionId, one);
  const denied = await mcp.callTool({ name: 'channel_join', arguments: { ...args('spoof'), sessionId: two }, _meta: meta(one) });
  assert.ok(denied.isError);
  assert.ok((await mcp.callTool({ name: 'channel_join', arguments: args('missing') })).isError);
  const second = await mcp.callTool({ name: 'channel_join', arguments: args('second'), _meta: meta(two) });
  assert.ok(!second.isError);
  assert.equal(broker.store.agents[`codex:${one}`].name, 'first');
  assert.equal(broker.store.agents[`codex:${two}`].name, 'second');
});
