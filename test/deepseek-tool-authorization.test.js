import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { assertAuthorizedToolCatalogue, filterApprovedToolCatalogue, readApprovedToolCatalogue, filterCodexResponsesTools, readApprovedCodexControl } from '../src/deepseek-tool-authorization.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('physical live test refuses provider tool catalogues outside the approved set', () => {
  const snapshot = JSON.parse(readFileSync(resolve('test/fixtures/approved-codex-stdio-tools.json'), 'utf8'));
  const permitted = snapshot.tools.map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters } }));
  assert.doesNotThrow(() => assertAuthorizedToolCatalogue(permitted));
  assert.throws(() => assertAuthorizedToolCatalogue([...permitted, { type: 'function', function: { name: 'channel_control' } }]));
  assert.throws(() => assertAuthorizedToolCatalogue([...permitted, { type: 'function', function: { name: 'write' } }]));
  assert.throws(() => assertAuthorizedToolCatalogue([{ type: 'namespace', name: 'mcp__turnlink' }]));
  assert.throws(() => assertAuthorizedToolCatalogue([{ ...permitted[0], function: { ...permitted[0].function, description: 'changed schema' } }]));
  assert.throws(() => assertAuthorizedToolCatalogue([]));
});

test('a separately approved exact catalogue filters unknown tools and rejects schema drift', t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-approved-tools-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'tools.json'), approved = [{ type: 'function', function: { name: 'read', description: 'synthetic', parameters: { type: 'object' } } }];
  const raw = JSON.stringify(approved), hash = createHash('sha256').update(raw).digest('hex');
  writeFileSync(file, raw, { mode: 0o600 });
  const loaded = readApprovedToolCatalogue(file, hash);
  assert.deepEqual(filterApprovedToolCatalogue([...approved, { type: 'function', function: { name: 'unapproved' } }], loaded), approved);
  assert.throws(() => filterApprovedToolCatalogue([{ ...approved[0], function: { ...approved[0].function, description: 'changed' } }], loaded), /changed/);
  assert.throws(() => filterApprovedToolCatalogue([...approved, ...approved], loaded), /Duplicate/);
  assert.throws(() => readApprovedToolCatalogue(file, '0'.repeat(64)), /hash mismatch/);
});

test('pinned Codex definitions match the actual MCP stdio server', async t => {
  const client = new Client({ name: 'tool-catalogue-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('src/mcp.js'), '--codex-stdio', '--control-plane'], stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  const definitions = (await client.listTools()).tools.filter(tool => ['channel_join', 'channel_send', 'channel_history', 'channel_status'].includes(tool.name));
  assert.equal(definitions.length, 4);
  const snapshot = JSON.parse(readFileSync(resolve('test/fixtures/approved-codex-stdio-tools.json'), 'utf8'));
  // Codex 0.165.0 strips these validation bounds when translating MCP schemas
  // to the provider catalogue; the exact translated snapshot remains pinned.
  const translated = value => Array.isArray(value) ? value.map(translated) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['minimum', 'maximum', 'minLength'].includes(key)).map(([key, item]) => [key, translated(item)])) : value;
  for (const definition of definitions) {
    const approved = snapshot.tools.find(tool => tool.name === definition.name);
    assert.equal(definition.description, approved.description);
    assert.deepEqual(translated(definition.inputSchema), approved.parameters);
  }
});

test('Codex Responses filtering removes unapproved tools and pins the MCP namespace', () => {
  const namespace = JSON.parse(readFileSync(resolve('test/fixtures/approved-codex-stdio-tools.json'), 'utf8'));
  const command = { type: 'function', name: 'exec_command', description: 'synthetic schema', parameters: { type: 'object' } };
  const other = { type: 'function', name: 'unapproved', parameters: { type: 'object' } };
  assert.deepEqual(filterCodexResponsesTools([other, namespace, command]), [namespace]);
  assert.throws(() => filterCodexResponsesTools([{ ...namespace, description: 'changed' }]), /namespace changed/);
  const changed = structuredClone(namespace); changed.tools[0].description = 'changed';
  assert.throws(() => filterCodexResponsesTools([changed]), /beyond the four/);
});

test('Codex control is filtered unless a separately pinned exact schema is supplied', t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-approved-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const namespace = JSON.parse(readFileSync(resolve('test/fixtures/approved-codex-stdio-tools.json'), 'utf8'));
  const tool = { type: 'function', name: 'channel_control', description: 'fixture', parameters: { type: 'object' } };
  const approved = { namespace: namespace.name, description: namespace.description, tool }, raw = JSON.stringify(approved);
  const file = join(root, 'control.json'); writeFileSync(file, raw, { mode: 0o600 });
  const hash = createHash('sha256').update(raw).digest('hex'), loaded = readApprovedCodexControl(file, hash);
  const offered = { ...namespace, tools: [...namespace.tools, tool, { type: 'function', name: 'unapproved' }] };
  assert.equal(filterCodexResponsesTools([offered])[0].tools.length, 4);
  assert.deepEqual(filterCodexResponsesTools([offered], loaded)[0].tools, [...namespace.tools, tool]);
  assert.throws(() => filterCodexResponsesTools([{ ...offered, tools: [...namespace.tools, { ...tool, description: 'changed' }] }], loaded), /schema changed/);
  assert.throws(() => readApprovedCodexControl(file, '0'.repeat(64)), /hash mismatch/);
});
