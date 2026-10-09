import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { privateTemp as mkdtempSync } from '../src/storage.js';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const TOKEN = '1'.repeat(64), ADMIN = '2'.repeat(64);
const binary = resolve('dist/agent-channel-codex.exe');
const skipped = process.platform !== 'win32';
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Windows launcher condition timed out'); }
function prepare(t, url = 'ws://127.0.0.1:47321', cleanup = true) {
  assert.ok(existsSync(binary), 'Compile the native launcher before running Windows tests');
  const root = mkdtempSync(join(tmpdir(), 'turnlink windows spaces '));
  if (cleanup) t.after(() => rmSync(root, { recursive: true, force: true }));
  const launcher = join(root, 'launcher.exe'), tokenFile = join(root, 'host.token');
  copyFileSync(binary, launcher); writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  writeFileSync(join(root, 'launcher.json'), JSON.stringify({ node: process.execPath, root: resolve('.'), codex: process.execPath, url, tokenFile }));
  return { root, launcher };
}

test('Windows native launcher preserves argument boundaries, stdout and nonzero exit status', { skip: skipped }, async t => {
  const { root, launcher } = prepare(t);
  const fixture = join(root, 'echo with spaces.cjs');
  writeFileSync(fixture, 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),tokenPresent:!!process.env.AGENT_CHANNEL_TOKEN})); process.exit(7);');
  const args = ['path with spaces', '"quoted"', 'back\\slash', '--flag=value'];
  const child = spawn(launcher, [fixture, ...args], { env: { ...process.env, AGENT_CHANNEL_TOKEN: 'stale-inherited-value' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b.toString(); });
  assert.equal((await once(child, 'exit'))[0], 7);
  assert.deepEqual(JSON.parse(output), { args, tokenPresent: false });
});

test('Windows native launcher uses its configured credential file and performs v2 idle delivery', { skip: skipped }, async t => {
  const { root, launcher } = prepare(t, 'ws://127.0.0.1:47321', false);
  const broker = createBroker({ port: 0, directory: join(root, 'broker'), secret: TOKEN, adminSecret: ADMIN });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`, keys = join(root, 'keys');
  const configPath = join(root, 'launcher.json'), config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.url = url; writeFileSync(configPath, JSON.stringify(config));
  const child = spawn(launcher, [resolve('test/fixtures/codex.js'), 'app-server'], {
    env: { ...process.env, AGENT_CHANNEL_TOKEN: 'stale-inherited-value', AGENT_CHANNEL_URL: 'ws://127.0.0.1:9', AGENT_CHANNEL_CREDENTIAL_DIR: keys },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = new ChannelClient({ url, token: TOKEN, credentialDirectory: keys });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    client.close(); await broker.close(); rmSync(root, { recursive: true, force: true });
  });
  const messages = []; createInterface({ input: child.stdout }).on('line', line => messages.push(JSON.parse(line)));
  child.stderr.on('data', () => {});
  child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: {} })}\n`);
  await until(() => messages.some(m => m.id === 1));
  child.stdin.write(`${JSON.stringify({ id: 2, method: 'thread/start', params: { fixtureId: 'thread-b' } })}\n`);
  await until(() => messages.some(m => m.id === 2));
  const reg = id => ({ harness: 'codex', sessionId: id, name: id, role: 'fixture', channel: 'development', project: { name: 'test', root } });
  await client.request('join', reg('sender')); await client.request('join', reg('thread-b'));
  await new Promise(r => setTimeout(r, 200));
  await client.request('send', { agentId: 'codex:sender', to: 'codex:thread-b', text: 'windows v2 wake', messageId: 'windows-v2' });
  await until(() => messages.some(m => m.method === 'fixture/received'));
  assert.equal(messages.find(m => m.method === 'fixture/received').params.method, 'turn/start');
});
