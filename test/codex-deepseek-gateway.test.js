import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { privateTemp } from '../src/storage.js';
import { startCodexDeepSeekGateway } from './fixtures/codex-deepseek-gateway.js';

test('Codex gateway keeps the provider key local and sends only pinned tool schemas', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-provider-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const authFile = join(root, 'auth.json'), token = 'a'.repeat(64), requests = [];
  writeFileSync(authFile, JSON.stringify({ deepseek: { type: 'api', key: 'synthetic-provider-key' } }), { mode: 0o600 });
  const namespace = JSON.parse(readFileSync(resolve('test/fixtures/approved-codex-stdio-tools.json'), 'utf8'));
  const command = { type: 'function', name: 'exec_command', description: 'synthetic', parameters: { type: 'object' } };
  const mock = async (url, options) => { requests.push({ url, options }); return new Response('data: fixture\n\n', { headers: { 'content-type': 'text/event-stream' } }); };
  const source = await startCodexDeepSeekGateway({ accessToken: token, authFile, fetchImpl: mock });
  const destination = await startCodexDeepSeekGateway({ accessToken: token, authFile, fetchImpl: mock });
  t.after(async () => { await source.close(); await destination.close(); });
  const invoke = gateway => fetch(`http://127.0.0.1:${gateway.port}/v1/responses`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'ignored', input: 'synthetic', tools: [namespace, command, { type: 'function', name: 'unapproved' }] }) });
  assert.equal((await invoke(source)).status, 200); assert.equal((await invoke(destination)).status, 200);
  const [first, second] = requests.map(value => JSON.parse(value.options.body));
  assert.deepEqual(first.tools.map(tool => tool.name), ['mcp__turnlink']);
  assert.deepEqual(second.tools.map(tool => tool.name), ['mcp__turnlink']);
  assert.equal(first.model, 'deepseek-flash'); assert.equal(requests[0].url, 'https://api.deepseek.com/responses');
  assert.equal(requests[0].options.headers.authorization, 'Bearer synthetic-provider-key');
  assert.ok(!JSON.stringify(first).includes('synthetic-provider-key'));
});
