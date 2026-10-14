import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { admissionID } from '../adapters/opencode-runtime.js';
import { randomUUID } from 'node:crypto';

test('real OpenCode V2 service loads tools, wakes, steers, blocks and reconnects (local model fixture)',
  { skip: process.env.TURNLINK_OPENCODE_INTEGRATION !== '1', timeout: 90000 }, async t => {
    const root = privateTemp(join(tmpdir(), 'turnlink-opencode-service-'));
    const project = join(root, 'project'); mkdirSync(project);
    const home = join(root, 'home'); mkdirSync(home);
    const token = '1'.repeat(64), tokenFile = join(root, 'host.token'), adapterTokenFile = join(root, 'adapter.token');
    writeFileSync(tokenFile, token, { mode: 0o600 });
    writeFileSync(adapterTokenFile, '3'.repeat(64), { mode: 0o600 });
    const broker = createBroker({ port: 0, secret: token, adminSecret: '2'.repeat(64), directory: join(root, 'broker'), controlPlane: true });
    await once(broker.server, 'listening');
    const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, tokenFile, credentialDirectory: join(root, 'credentials'), control: true, adapterTokenFile };
    const sender = new ChannelClient(options);
    const admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
    const controlCommand = (op, fields = {}) => ({ id: randomUUID(), op, channel: 'development', ...fields });
    await admin.request('control_command', { command: controlCommand('channel.configure') });
    await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
    const roleAcceptanceID = randomUUID();
    let releaseBusy;
    let busyReached = false;
    const requests = [];
    const model = createServer(async (req, res) => {
      try {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
        const last = body.messages.at(-1);
        const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
        let delta = { content: 'Fixture completed.' }, finish = 'stop';
        if (last.role === 'user' && text.includes('TURNLINK_JOIN')) {
          delta = { tool_calls: [{ index: 0, id: 'call_join', type: 'function', function: { name: 'channel_join',
            arguments: JSON.stringify({ channel: 'development', name: 'receiver', role: 'fixture', project: { name: 'fixture' } }) } }] };
          finish = 'tool_calls';
        }
        if (last.role === 'user' && text.includes('TURNLINK_VOLUNTEER')) {
          delta = { tool_calls: [{ index: 0, id: 'call_volunteer', type: 'function', function: { name: 'channel_control',
            arguments: JSON.stringify({ command: controlCommand('master.volunteer', { eligible: true }) }) } }] };
          finish = 'tool_calls';
        }
        const assignmentID = text.match(/Assignment: ([a-f0-9-]{36})/)?.[1];
        if (last.role === 'user' && assignmentID && text.includes('Turnlink supplemental master role')) {
          delta = { tool_calls: [{ index: 0, id: 'call_role_accept', type: 'function', function: { name: 'channel_control',
            arguments: JSON.stringify({ command: { ...controlCommand('master.accept', { proposalID: assignmentID, promptVersion: 1 }), id: roleAcceptanceID } }) } }] };
          finish = 'tool_calls';
        }
        if (last.role === 'user' && text.includes('TURNLINK_BUSY')) {
          busyReached = true;
          await new Promise(resolve => { releaseBusy = resolve; });
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta, finish_reason) => ({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
          choices: [{ index: 0, delta, finish_reason }] });
        res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }, null))}\n\n`);
        res.write(`data: ${JSON.stringify(chunk({}, finish))}\n\n`);
        res.end('data: [DONE]\n\n');
      } catch (error) { res.writeHead(500); res.end(String(error)); }
    });
    model.listen(0, '127.0.0.1'); await once(model, 'listening');
    const config = {
      model: 'fixture/test', snapshots: false,
      permissions: [{ action: '*', resource: '*', effect: 'allow' }, { action: 'turnlink.fixture', resource: '*', effect: 'ask' }],
      plugins: [{ package: pathToFileURL(resolve('adapters/opencode')).href, options }],
      providers: { fixture: { env: ['TURNLINK_FIXTURE_KEY'], package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1` },
        models: { test: { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 2048 } } } } },
    };
    writeFileSync(join(project, 'opencode.json'), JSON.stringify(config));
    writeFileSync(join(project, 'AGENTS.md'), 'PROJECT_WORKTREE_GATE: preserve project instructions.\n');
    mkdirSync(join(home, 'config', 'opencode'), { recursive: true });
    writeFileSync(join(home, 'config', 'opencode', 'AGENTS.md'), 'GLOBAL_WORKTREE_GATE: preserve global instructions.\n');
    execFileSync('git', ['init', project], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'add', 'opencode.json', 'AGENTS.md']);
    execFileSync('git', ['-C', project, '-c', 'user.name=Turnlink fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '-m', 'Isolated worktree gate'], { stdio: 'ignore' });
    // Reserve a port; the child uses an isolated HOME/XDG configuration and never the managed service.
    const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.env.TURNLINK_OPENCODE_EXECUTABLE || 'opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--print-logs'], {
      cwd: project, env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), XDG_DATA_HOME: join(home, 'data'),
        XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'), TURNLINK_FIXTURE_KEY: 'fixture-only', OPENCODE_LOG_LEVEL: 'ERROR' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '', password, childError;
    child.on('error', error => { childError = error; });
    const collect = chunk => {
      logs = (logs + chunk).slice(-65536);
      password = logs.match(/server password (\S+)/)?.[1] || password;
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const diagnostics = () => {
      const path = join(home, 'data', 'opencode', 'log', 'opencode.log');
      const logPaths = readdirSync(home, { recursive: true }).filter(p => p.endsWith('.log')).map(p => join(home, p));
      return (logs + (existsSync(path) ? readFileSync(path, 'utf8') : '') + logPaths.map(p => readFileSync(p, 'utf8')).join('\n'))
        .split('\n').filter(line => /password|ERROR|WARN|plugin|Turnlink/.test(line)).slice(-12).join('\n').replace(/server password \S+/g, 'server password [redacted]');
    };
    t.after(async () => {
      releaseBusy?.(); sender.close(); admin.close(); child.kill();
      if (child.pid && child.exitCode === null && child.signalCode === null) await once(child, 'exit');
      model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
      await broker.close(); rmSync(root, { recursive: true, force: true });
    });
    const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(project),
        ...(password ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([t.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}\n${diagnostics()}`);
      if (response.status === 204) return undefined;
      const value = await response.json();
      return value.data ?? value;
    };
    const wait = async (check, iterations = 300) => {
      for (let i = 0; i < iterations; i++) {
        t.signal.throwIfAborted();
        if (childError) throw childError;
        if (child.exitCode !== null) throw new Error(`OpenCode exited: ${diagnostics()}`);
        if (await check()) return;
        await delay(50);
      }
      throw new Error(`Real-service condition timed out; model requests=${requests.length}; tools=${JSON.stringify(requests.at(-1)?.tools?.map(t => t.function.name))}; tool results=${JSON.stringify(requests.at(-1)?.messages.filter(m => m.role === 'tool'))}\n${diagnostics()}`);
    };
    await wait(async () => { try { return !!await api('/api/info'); } catch { return false; } });
    const session = await api('/api/session', { location: { directory: project }, title: 'Turnlink fixture', agent: 'plan',
      permissions: [{ action: 'edit', resource: '*', effect: 'deny' }] });
    const prefix = `/api/session/${session.id}`;
    await api(`${prefix}/prompt`, { text: 'TURNLINK_JOIN' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const loaded = await api('/api/config');
    assert.ok(JSON.stringify(loaded).includes('adapters/opencode'), JSON.stringify(loaded));
    await wait(async () => JSON.stringify(await api('/api/plugin')).includes('turnlink'));
    const pluginStatus = (await api('/api/plugin')).find(p => p.id === 'turnlink');
    assert.equal(pluginStatus?.state.status, 'active', JSON.stringify(pluginStatus));
    await wait(() => !!broker.store.agents[`opencode:${session.id}`]);
    await api(`/api/experimental/session/${session.id}/wait`, {});
    await sender.request('join', { harness: 'codex', sessionId: 'sender', name: 'sender', channel: 'development', role: 'fixture', project: { name: 'fixture', root } });
    const send = text => sender.request('send', { agentId: 'codex:sender', to: `opencode:${session.id}`, text, messageId: text });
    const delivered = id => broker.store.messages.find(m => m.id === id)?.delivered.includes(`opencode:${session.id}`);
    assert.deepEqual(await api(`${prefix}/permission`), []);
    assert.deepEqual(await api(`${prefix}/form`), []);
    assert.equal(broker.store.agents[`opencode:${session.id}`].disconnectedAt, null);
    const wake = await send('idle wake fixture'); await wait(() => delivered(wake.id));
    await api(`/api/experimental/session/${session.id}/wait`, {});
    assert.ok(requests.some(r => JSON.stringify(r.messages).includes('idle wake fixture')));
    const selected = await api(prefix); assert.equal(selected.agent, 'plan');
    const retry = await api(`${prefix}/prompt`, { id: admissionID(session.id, wake.id), text: 'duplicate must not replace original', delivery: 'steer' });
    assert.equal(retry.id, admissionID(session.id, wake.id));
    await api(`${prefix}/prompt`, { text: 'TURNLINK_BUSY' }); await wait(() => busyReached);
    const busy = await send('busy steering fixture'); await wait(() => delivered(busy.id));
    const inbox = await api(`${prefix}/inbox`);
    assert.ok(inbox.some(item => item.id === admissionID(session.id, busy.id) && item.delivery === 'steer'));
    releaseBusy(); await api(`/api/experimental/session/${session.id}/wait`, {});
    assert.ok(requests.some(r => JSON.stringify(r.messages).includes('busy steering fixture')));
    const permission = await api(`${prefix}/permission`, { action: 'turnlink.fixture', resources: ['blocked'] });
    assert.equal(permission.effect, 'ask');
    const blocked = await send('permission blocked fixture'); await delay(2300); assert.equal(delivered(blocked.id), false);
    await api(`${prefix}/permission/${permission.id}/reply`, { decision: 'once' }); await wait(() => delivered(blocked.id));
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const form = await api(`${prefix}/form`, { title: 'Fixture question', fields: [{ key: 'confirm', type: 'boolean' }] });
    // Allow the live event to reach the plugin; no generic form-list API exists on the server plugin context.
    await delay(100);
    const question = await send('question blocked fixture'); await delay(2300); assert.equal(delivered(question.id), false);
    await api(`${prefix}/form/${form.id}/reply`, { answer: { confirm: true } }); await wait(() => delivered(question.id));
    await api(`/api/experimental/session/${session.id}/wait`, {});
    // Break the receiver socket without changing membership; the broker replays on reconnect.
    const senderPort = sender.socket._socket.localPort;
    for (const receiver of broker.server.clients) if (receiver._socket.remotePort !== senderPort) receiver.terminate();
    const reconnect = await send('reconnect fixture'); await wait(() => delivered(reconnect.id));
    await api(`/api/experimental/session/${session.id}/wait`, {});
    assert.ok(requests.some(r => JSON.stringify(r.messages).includes('reconnect fixture')));
    await api(`${prefix}/prompt`, { text: 'TURNLINK_VOLUNTEER' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    await wait(async () => (await admin.request('control_query', { channel: 'development', view: 'channel' })).channel.volunteers.includes(`opencode:${session.id}`));
    await admin.request('control_command', { command: controlCommand('master.appoint', { candidate: `opencode:${session.id}` }) });
    // Background adapter polling (not model inbox polling) admits the supplemental role notice and the fixture explicitly accepts it.
    await wait(async () => (await admin.request('control_query', { channel: 'development', view: 'channel' })).channel.active?.agentId === `opencode:${session.id}`, 900);
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const roleSession = await api(prefix);
    assert.equal(roleSession.agent, 'plan'); assert.deepEqual(roleSession.permissions, session.permissions);
    const roleRequest = requests.find(r => JSON.stringify(r.messages).includes('Turnlink supplemental master role'));
    assert.ok(roleRequest); assert.match(JSON.stringify(roleRequest.messages), /GLOBAL_WORKTREE_GATE/); assert.match(JSON.stringify(roleRequest.messages), /PROJECT_WORKTREE_GATE/);
    await admin.request('control_command', { command: controlCommand('master.revoke') });
    const beforeMove = await api(prefix);
    const worktree = await api('/api/worktree', { projectID: beforeMove.projectID, name: 'turnlink-gate' });
    await api(`${prefix}/move`, { directory: worktree.directory, delivery: 'queue' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const afterMove = await api(prefix);
    assert.equal(afterMove.id, beforeMove.id);
    assert.equal(afterMove.location.directory, worktree.directory);
    assert.equal(afterMove.agent, beforeMove.agent);
    assert.deepEqual(afterMove.model, beforeMove.model);
    assert.deepEqual(afterMove.permissions, beforeMove.permissions);
    await api(`${prefix}/prompt`, { text: 'WORKTREE_GATE_VERIFY' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const request = requests.find(r => JSON.stringify(r.messages).includes('WORKTREE_GATE_VERIFY'));
    assert.match(JSON.stringify(request.messages), /PROJECT_WORKTREE_GATE/);
    assert.match(JSON.stringify(request.messages), /GLOBAL_WORKTREE_GATE/);
    // The existing adapter deliberately detaches on move; continuity still needs an explicit task-transition implementation.
  });
