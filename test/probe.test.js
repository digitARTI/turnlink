import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('binding probe reads MCP process identity and never dumps credential values', async t => {
  const sessionId = '00000000-0000-4000-8000-000000000001', secret = 'a'.repeat(64);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/binding-probe.js')],
    env: { ...process.env, CODEX_THREAD_ID: sessionId, AGENT_CHANNEL_SESSION_ID: 'not-an-id', AGENT_CHANNEL_TOKEN: secret }, stderr: 'pipe' });
  const client = new Client({ name: 'probe-test', version: '1' });
  t.after(() => client.close()); await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].annotations.readOnlyHint, true);
  const result = await client.callTool({ name: 'turnlink_binding_probe', arguments: {},
    _meta: { threadId: sessionId, credential: secret, [secret]: 'opaque-value' } });
  const output = result.content[0].text, report = JSON.parse(output);
  assert.equal(report.codexThreadId, sessionId); assert.equal(report.explicitSessionId, null);
  assert.equal(report.validatedIdCandidates.threadId, sessionId);
  assert.ok(!output.includes(secret)); assert.ok(!output.includes('opaque-value'));
});
