import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const executable = process.env.TURNLINK_TUI_CODEX_EXECUTABLE;
test('installed Codex TUI receives a message through the Turnlink launcher', { skip: !executable || process.platform === 'win32', timeout: 60000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-native-tui-'));
  const model = spawn('/usr/bin/python3', [resolve('test/fixtures/codex-agent-model.py')], { env: {
    PATH: '/usr/bin:/bin', TURNLINK_CODEX_FIXTURE_PORT: '0', TURNLINK_CODEX_FIXTURE_COMMAND: join(root, 'no-command'),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  model.stderr.resume();
  const modelLines = createInterface({ input: model.stdout }); const [portLine] = await once(modelLines, 'line'); modelLines.close();
  const port = Number(portLine); assert.ok(port > 0);
  writeFileSync(join(root, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[features]\nplugins = false\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`);
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64) });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const client = new ChannelClient(options);
  const useDaemon = process.env.TURNLINK_TUI_USE_DAEMON === '1';
  const fixturePath = [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter);
  const daemonEnv = { HOME: root, CODEX_HOME: root, CODEX_SQLITE_HOME: root, PATH: fixturePath, TERM: 'xterm-256color', TURNLINK_FIXTURE_KEY: 'fixture-only' };
  if (useDaemon) {
    const start = spawnSync(executable, ['app-server', 'daemon', 'start'], { env: daemonEnv, cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(start.status, 0, `isolated daemon startup: ${start.stderr}`);
  }
  const startTui = (args = []) => spawn('/usr/bin/python3', [resolve('test/fixtures/codex-tui-pty.py'), process.execPath, resolve('src/codex-tui.js'), ...args], {
    cwd: root, env: { HOME: root, CODEX_HOME: root, CODEX_SQLITE_HOME: root, PATH: fixturePath, TERM: 'xterm-256color',
      TURNLINK_FIXTURE_KEY: 'fixture-only', AGENT_CHANNEL_CODEX_EXECUTABLE: executable, AGENT_CHANNEL_URL: options.url,
      AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory, AGENT_CHANNEL_STATE_DIR: join(root, 'state'),
      TURNLINK_TUI_FIXTURE_OUTPUT: join(root, 'screen.log'),
      ...(useDaemon ? { AGENT_CHANNEL_CODEX_DAEMON_PROXY: '1' } : {}) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '', tui = startTui();
  const observe = child => child.stderr.on('data', chunk => { errors += chunk.toString(); });
  observe(tui);
  t.after(async () => {
    for (const child of [tui, model]) if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    if (useDaemon) spawnSync(executable, ['app-server', 'daemon', 'stop'], { env: daemonEnv, cwd: root, timeout: 15000 });
    client.close(); await broker.close(); rmSync(root, { recursive: true, force: true });
  });
  const diagnostic = () => errors.slice(-1000) + (existsSync(join(root, 'screen.log')) ? readFileSync(join(root, 'screen.log'), 'utf8').slice(-2000) : '') + (existsSync(join(root, 'app-server-daemon', 'daemon.stderr.log')) ? readFileSync(join(root, 'app-server-daemon', 'daemon.stderr.log'), 'utf8').slice(-2000) : '');
  const wait = async predicate => { for (let i = 0; i < 500; i++) { if (tui.exitCode !== null) throw new Error(`TUI exited: ${diagnostic()}`); const result = predicate(); if (result) return result; await delay(50); } throw new Error(`TUI timed out: ${diagnostic()}`); };
  const agentId = await wait(() => Object.keys(broker.store.bindings).find(id => id.startsWith('codex:')));
  const sessionId = agentId.slice('codex:'.length);
  const registration = (id, name) => ({ harness: 'codex', sessionId: id, name, role: 'test', channel: 'dev', project: { name: 'test', root } });
  await client.request('join', registration(sessionId, 'native-tui'));
  await client.request('join', registration('sender', 'sender'));
  await client.request('send', { agentId: 'codex:sender', to: agentId, text: 'synthetic TUI wake', messageId: 'native-tui-wake' });
  await wait(() => broker.store.messages.some(message => message.delivered.includes(agentId)));
  const exited = once(tui, 'exit'); tui.kill(); await exited;
  for (let i = 0; i < 100 && broker.store.agents[agentId]?.disconnectedAt === null; i++) await delay(50);
  assert.notEqual(broker.store.agents[agentId]?.disconnectedAt, null);
  tui = startTui(['resume', sessionId]); observe(tui);
  await wait(() => broker.store.agents[agentId]?.disconnectedAt === null);
  await client.request('send', { agentId: 'codex:sender', to: agentId, text: 'synthetic resumed wake', messageId: 'native-tui-resumed' });
  await wait(() => broker.store.messages.some(message => message.messageId === 'native-tui-resumed' && message.delivered.includes(agentId)));
  await client.request('join', { ...registration(sessionId, 'native-tui'), channel: 'other' });
  await client.request('join', { ...registration('sender', 'sender'), channel: 'other' });
  await client.request('send', { agentId: 'codex:sender', to: agentId, text: 'synthetic switched wake', messageId: 'native-tui-switched' });
  await wait(() => broker.store.messages.some(message => message.messageId === 'native-tui-switched' && message.delivered.includes(agentId)));
});
