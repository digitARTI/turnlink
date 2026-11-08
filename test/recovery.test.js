import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { privateTemp as mkdtempSync } from '../src/storage.js';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { applyConfiguration, rollbackConfiguration } from '../deploy/config-transaction.js';
import { atomicWrite } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { AdmissionLedger } from '../src/admissions.js';
import { ToolSession } from '../src/tools.js';
import { diagnosticCode } from '../src/diagnostics.js';

const TOKEN = '1'.repeat(64), ADMIN = '2'.repeat(64);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(15); }
  throw new Error('Recovery condition timed out');
}
function temp(t, cleanup = true) {
  const directory = mkdtempSync(join(tmpdir(), 'turnlink-recovery-'));
  if (cleanup) t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}
const reg = id => ({ harness: 'codex', sessionId: id, channel: 'development', name: id, role: 'fixture', project: { name: 'test', root: '/test' } });

test('configuration transaction rolls back the first file when the second write fails', t => {
  const root = temp(t), a = join(root, 'a.json'), b = join(root, 'b.toml'), journal = join(root, 'journal.json');
  writeFileSync(a, 'original-a', { mode: 0o600 }); writeFileSync(b, 'original-b', { mode: 0o600 });
  let failed = false;
  assert.throws(() => applyConfiguration(journal, [{ path: a, content: 'new-a' }, { path: b, content: 'new-b' }], (path, data) => {
    if (path === b && !failed) { failed = true; throw new Error('second write failed'); } atomicWrite(path, data);
  }), /second write/);
  assert.equal(readFileSync(a, 'utf8'), 'original-a'); assert.equal(readFileSync(b, 'utf8'), 'original-b');
  assert.equal(JSON.parse(readFileSync(journal, 'utf8')).status, 'rolled_back');
});

test('rollback preserves external user edits and reports a conflict', t => {
  const root = temp(t), a = join(root, 'a.json'), journal = join(root, 'journal.json');
  writeFileSync(a, 'original', { mode: 0o600 }); applyConfiguration(journal, [{ path: a, content: 'installed' }]);
  atomicWrite(a, 'user edit after install');
  const result = rollbackConfiguration(journal);
  assert.equal(result.restored, false); assert.equal(readFileSync(a, 'utf8'), 'user edit after install');
});

test('staged legacy migration generates fresh credentials, quarantines pending work and leaves source untouched', async t => {
  const root = temp(t), source = join(root, 'source.json'), destination = join(root, 'new-state');
  const a = { ...reg('a'), agentId: 'codex:a' }, b = { ...reg('b'), agentId: 'codex:b' };
  const legacy = { version: 2, agents: { 'codex:a': a, 'codex:b': b }, messages: [{
    id: '00000000-0000-4000-8000-000000000001', messageId: 'old-task', channel: 'development', from: a,
    text: 'legacy pending task', createdAt: new Date().toISOString(), recipients: ['codex:b'], delivered: [], cancelled: {},
  }] };
  writeFileSync(source, JSON.stringify(legacy), { mode: 0o600 });
  const original = readFileSync(source, 'utf8');
  const child = spawn(process.execPath, ['src/migrate-v2.js', source, destination, 'codex:a=alpha', 'codex:b=beta'], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; });
  assert.equal((await once(child, 'exit'))[0], 0);
  const migrated = JSON.parse(readFileSync(join(destination, 'store.json'), 'utf8'));
  assert.equal(migrated.version, 3); assert.equal(migrated.bindings['codex:b'].hostId, 'beta');
  assert.equal(migrated.messages[0].cancelled['codex:b'], 'legacy_migration_review');
  const key = readFileSync(join(destination, 'alpha.token'), 'utf8');
  assert.equal(key.length, 64); assert.notEqual(key, TOKEN); assert.ok(!output.includes(key));
  assert.equal(readFileSync(source, 'utf8'), original);
});

test('MCP tools reject missing or model-chosen session bindings', async () => {
  let called = false; const client = { request: async () => { called = true; } };
  await assert.rejects(new ToolSession(client).call('channel_join', reg('a')), /Harness-supplied/);
  await assert.rejects(new ToolSession(client, { harness: 'codex', sessionId: 'actual' }).call('channel_join', reg('invented')), /Wrong session/);
  assert.equal(called, false);
});

test('diagnostics never echo provider bodies, prompts or credential-shaped text', () => {
  const error = new Error(`Bearer ${TOKEN} private prompt`);
  assert.equal(diagnosticCode(error), 'INTERNAL_OR_TRANSPORT_ERROR');
  error.status = 403; assert.equal(diagnosticCode(error), 'HTTP_403');
});

test('proxy rejects a recursive executable before creating child processes', async () => {
  const child = spawn(process.execPath, ['src/codex-proxy.js', '--version'], {
    cwd: resolve('.'), env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: resolve('src/codex-proxy.js') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stderr.on('data', data => { output += data; });
  assert.equal((await once(child, 'exit'))[0], 1); assert.match(output, /recursive/);
});

async function proxySetup(t, text) {
  const root = temp(t, false);
  const broker = createBroker({ port: 0, directory: join(root, 'broker'), secret: TOKEN, adminSecret: ADMIN });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`, keys = join(root, 'keys');
  const client = new ChannelClient({ url, token: TOKEN, credentialDirectory: keys });
  const launch = () => {
    const child = spawn(process.execPath, ['src/codex-proxy.js', 'test/fixtures/codex.js', 'app-server'], {
      cwd: resolve('.'), env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: url,
        AGENT_CHANNEL_TOKEN: TOKEN, AGENT_CHANNEL_CREDENTIAL_DIR: keys, AGENT_CHANNEL_RPC_TIMEOUT_MS: '80' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = []; createInterface({ input: child.stdout }).on('line', line => output.push(JSON.parse(line)));
    child.stderr.on('data', () => {});
    return { child, output, send: data => child.stdin.write(`${JSON.stringify(data)}\n`) };
  };
  let active = launch();
  t.after(async () => {
    if (active.child.exitCode === null && active.child.signalCode === null) { const exit = once(active.child, 'exit'); active.child.kill(); await exit; }
    client.close(); await broker.close(); rmSync(root, { recursive: true, force: true });
  });
  const initialize = async proxy => {
    proxy.send({ id: 1, method: 'initialize', params: {} }); await until(() => proxy.output.some(m => m.id === 1));
    proxy.send({ id: 2, method: 'thread/start', params: { fixtureId: 'thread-b' } }); await until(() => proxy.output.some(m => m.id === 2));
  };
  await initialize(active); await client.request('join', reg('sender')); await client.request('join', reg('thread-b'));
  await until(() => broker.server.clients.size >= 2);
  await delay(100);
  const message = await client.request('send', { agentId: 'codex:sender', to: 'codex:thread-b', text, messageId: 'timeout-proof' });
  return { broker, client, message, get active() { return active; }, ledger: () => new AdmissionLedger('local', 'codex:thread-b', keys),
    restart: async () => {
      const exit = once(active.child, 'exit'); active.child.kill(); await exit;
      await until(() => !broker.server.clients.size || broker.store.agents['codex:thread-b'].reservationExpiresAt != null);
      active = launch(); await initialize(active); await delay(150);
    },
  };
}

test('late Codex admission response is suppressed and reconciled without reinjection', async t => {
  const s = await proxySetup(t, 'delay-admission');
  await until(() => s.ledger().get(s.message.id)?.state === 'uncertain');
  s.active.send({ id: 3, method: 'fixture/release-admission', params: {} });
  await until(() => s.broker.store.messages[0].delivered.length === 1);
  assert.equal(s.active.output.filter(m => m.method === 'fixture/received').length, 1);
  assert.ok(!s.active.output.some(m => String(m.id).startsWith('turnlink-internal-')));
  assert.equal(s.ledger().get(s.message.id).state, 'accepted');
});

test('uncertain admission survives proxy restart and is never blindly retried', async t => {
  const s = await proxySetup(t, 'never-respond');
  await until(() => s.ledger().get(s.message.id)?.state === 'uncertain');
  await s.restart();
  assert.equal(s.active.output.filter(m => m.method === 'fixture/received').length, 0);
  assert.equal(s.broker.store.messages[0].delivered.length, 0);
  assert.equal(s.ledger().get(s.message.id).state, 'uncertain');
});
