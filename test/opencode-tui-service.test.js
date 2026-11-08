import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateTemp } from '../src/storage.js';

test('real isolated OpenCode CLI loads the passive alert entry and renders a broker incident without a model wake', {
  skip: process.env.TURNLINK_OPENCODE_TUI_INTEGRATION !== '1' || process.platform === 'win32', timeout: 60000,
}, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-native-tui-')), project = join(root, 'project'), home = join(root, 'home'), wrapper = join(root, 'plugin');
  for (const directory of [project, home, wrapper]) mkdirSync(directory);
  const tokenFile = join(root, 'host.token'); writeFileSync(tokenFile, '1'.repeat(64), { mode: 0o600 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true }); await once(broker.server, 'listening');
  const brokerURL = `ws://127.0.0.1:${broker.server.address().port}`, admin = new ChannelClient({ url: brokerURL, token: '2'.repeat(64) });
  for (const [op, fields] of [['channel.configure', {}], ['incident.open', { category: 'connectivity' }]])
    await admin.request('control_command', { command: { id: randomUUID(), op, channel: 'native-ui', ...fields } });
  let requests = 0;
  const model = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks)); requests++;
    const last = input.messages.at(-1), text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    let delta = { content: 'Joined the isolated test channel.' }, finish = 'stop';
    if (last.role === 'user' && text.includes('TURNLINK_NATIVE_UI_JOIN')) {
      delta = { tool_calls: [{ index: 0, id: 'call_native_ui_join', type: 'function', function: { name: 'channel_join', arguments: JSON.stringify({
        channel: 'native-ui', name: 'native-ui', role: 'Isolated CLI fixture', project: { name: 'fixture' },
      }) } }] }; finish = 'tool_calls';
    }
    const chunk = (value, finish_reason) => ({ id: 'fixture-native-ui', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason }] });
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }, null))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk({}, finish))}\n\n`); res.end('data: [DONE]\n\n');
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const record = join(root, 'ui-evidence.jsonl');
  writeFileSync(join(wrapper, 'package.json'), JSON.stringify({ name: 'turnlink-native-ui-fixture', type: 'module', exports: { '.': './index.js', './tui': './tui.js' } }));
  writeFileSync(join(wrapper, 'index.js'), `export { default } from ${JSON.stringify(pathToFileURL(resolve('adapters/opencode.js')).href)};`);
  // The wrapper observes actual native UI API calls without changing any client,
  // permission, selection or prompt API. No terminal bytes reach test output.
  writeFileSync(join(wrapper, 'tui.js'), `
    import { Plugin } from '@opencode/plugin/tui';
    import { appendFileSync } from 'node:fs';
    import { setupOpenCodeAlertsUI } from ${JSON.stringify(pathToFileURL(resolve('adapters/opencode-tui-runtime.js')).href)};
    const write = data => appendFileSync(${JSON.stringify(record)}, JSON.stringify(data) + '\\n', { mode: 0o600 });
    export default Plugin.define({ id: 'turnlink.cli.fixture', setup(ctx) {
      write({ type: 'loaded', optedIn: ctx.options.alerts === true });
      return setupOpenCodeAlertsUI({ ...ctx, ui: { ...ctx.ui, toast: { ...ctx.ui.toast, show(value) {
        write({ type: 'toast', message: value.message, variant: value.variant }); return ctx.ui.toast.show(value);
      } } } });
    } });
  `);
  writeFileSync(join(project, 'opencode.json'), JSON.stringify({ model: 'fixture/test', default_agent: 'plan', snapshots: false,
    permissions: [{ action: '*', resource: '*', effect: 'allow' }, { action: 'edit', resource: '*', effect: 'deny' }],
    plugins: [{ package: pathToFileURL(wrapper).href, options: { url: brokerURL, tokenFile, credentialDirectory: join(root, 'proofs'), control: true, alerts: true } }],
    providers: { fixture: { env: ['TURNLINK_FIXTURE_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1` },
      models: { test: { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 2048 } } } } } }));
  mkdirSync(join(home, 'config', 'opencode'), { recursive: true });
  writeFileSync(join(home, 'config', 'opencode', 'cli.json'), JSON.stringify({ $schema: 'https://opencode.ai/v2/cli.json',
    plugins: [{ package: pathToFileURL(wrapper).href, options: { alerts: true } }], highlights: false }));
  execFileSync('git', ['init', project], { stdio: 'ignore' });
  const child = spawn('python3', [fileURLToPath(new URL('./fixtures/opencode-tui.py', import.meta.url)), join(root, 'terminal.bin'),
    process.env.TURNLINK_OPENCODE_EXECUTABLE || 'opencode', '--standalone', '--prompt', 'TURNLINK_NATIVE_UI_JOIN', project], {
    cwd: project, env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'), TERM: 'xterm-256color', COLORTERM: 'truecolor',
      TURNLINK_FIXTURE_KEY: 'fixture-only', OPENCODE_LOG_LEVEL: 'ERROR' }, stdio: ['ignore', 'ignore', 'ignore'],
  });
  let childError; child.on('error', error => { childError = error; });
  t.after(async () => {
    child.kill('SIGTERM'); if (child.pid && child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    admin.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await broker.close(); rmSync(root, { recursive: true, force: true });
  });
  const rows = () => existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  let rendered;
  for (let i = 0; i < 450; i++) {
    t.signal.throwIfAborted(); if (childError) throw childError;
    if (child.exitCode !== null) throw new Error(`Private native CLI fixture exited (${child.exitCode}); no terminal transcript was uploaded`);
    rendered = rows().find(row => row.type === 'toast' && row.message.includes('Open channel incidents: 1'));
    if (rendered) break;
    await delay(100);
  }
  assert.equal(rows().find(row => row.type === 'loaded')?.optedIn, true, 'native CLI must pass the explicit alert opt-in');
  assert.ok(rendered, 'native CLI did not render the incident alert within the bounded fixture timeout');
  const before = requests; await delay(2500); assert.equal(requests, before, 'passive alert refresh cannot wake the model');
  assert.equal(rows().filter(row => row.type === 'toast' && row.message.includes('Open channel incidents: 1')).length, 1);
  assert.equal(broker.store.messages.length, 0); assert.equal(Object.values(broker.store.agents).length, 1);
});
