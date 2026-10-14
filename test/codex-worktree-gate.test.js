import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';
import { createServer } from 'node:http';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

test('real Codex proxy admits supplemental roles and changes cwd in the same thread without permission overrides (local model fixture)',
  { skip: process.env.TURNLINK_CODEX_INTEGRATION !== '1', timeout: 30000 }, async t => {
    const root = privateTemp(join(tmpdir(), 'turnlink-codex-worktree-'));
    const project = join(root, 'project'), worktree = join(root, 'worktree'), home = join(root, 'home');
    mkdirSync(project); mkdirSync(home); mkdirSync(join(home, '.codex'));
    writeFileSync(join(project, 'AGENTS.md'), 'PROJECT_WORKTREE_GATE: preserve project instructions.\n');
    execFileSync('git', ['init', project], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'add', 'AGENTS.md']);
    execFileSync('git', ['-C', project, '-c', 'user.name=Turnlink fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '-m', 'Isolated gate'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'worktree', 'add', '--detach', worktree], { stdio: 'ignore' });
    writeFileSync(join(home, '.codex', 'AGENTS.md'), 'GLOBAL_WORKTREE_GATE: preserve global instructions.\n');
    writeFileSync(join(worktree, 'AGENTS.md'), 'PROJECT_WORKTREE_GATE: preserve project instructions.\nWORKTREE_NEW_GATE: discover destination instructions.\n');
    let modelCalls = 0, lastInput = '';
    const model = createServer(async (req, res) => {
      const input = []; for await (const chunk of req) input.push(chunk);
      lastInput = Buffer.concat(input).toString(); // Synthetic fixture prompts only; never printed.
      modelCalls++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const item = { id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: 'Fixture completed.', annotations: [] }] };
      const response = { id: `resp_fixture_${modelCalls}`, object: 'response', created_at: 1, status: 'completed', model: 'fixture',
        output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: 'Fixture completed.' });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response }); res.end();
    });
    model.listen(0, '127.0.0.1'); await once(model, 'listening');
    writeFileSync(join(home, '.codex', 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\n`);
    const broker = createBroker({ port: 0, directory: join(root, 'broker'), secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true });
    await once(broker.server, 'listening');
    const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
    const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), participant = new ChannelClient(options);
    const adapterFile = join(root, 'adapter.token'); writeFileSync(adapterFile, '3'.repeat(64), { mode: 0o600 });
    const child = spawn(process.execPath, [resolve('src/codex-proxy.js'), 'app-server'], {
      cwd: project, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: join(home, '.codex'), TURNLINK_FIXTURE_KEY: 'fixture-only',
        AGENT_CHANNEL_CODEX_EXECUTABLE: process.env.TURNLINK_CODEX_EXECUTABLE || 'codex', AGENT_CHANNEL_URL: options.url,
        AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory,
        AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: adapterFile }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const childClosed = once(child, 'close');
    const pending = new Map(); let sequence = 0, diagnostics = '';
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    const rejectAll = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
    child.on('error', rejectAll); child.on('exit', () => rejectAll(new Error(`Codex fixture exited: ${diagnostics}`)));
    let completed;
    const turnDone = new Promise(resolve => { completed = resolve; });
    createInterface({ input: child.stdout }).on('line', line => {
      const message = JSON.parse(line), p = pending.get(message.id);
      if (message.method === 'turn/completed') completed(message.params.turn);
      if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(`Codex gate rejected ${p.method} (${message.error.code}): ${String(message.error.message).slice(0, 500)}`));
      else p.resolve(message.result);
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex gate timed out')); }, 10000);
      pending.set(id, { resolve, reject, timer, method }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    t.after(async () => {
      rejectAll(new Error('Fixture stopped')); child.kill();
      if (child.pid) await childClosed;
      model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
      admin.close(); participant.close(); await broker.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
    await rpc('initialize', { clientInfo: { name: 'turnlink_worktree_gate', version: '0.1.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const before = await rpc('thread/start', { cwd: realpathSync(project) });
    await rpc('turn/start', { threadId: before.thread.id, input: [{ type: 'text', text: 'Seed isolated worktree gate' }] });
    const turn = await turnDone; assert.equal(turn.status, 'completed'); assert.ok(modelCalls > 0);
    // A resume of an already loaded thread ignores cwd in 0.161.0; the supported transition is turn/start.cwd.
    const secondDone = new Promise(resolve => { completed = resolve; });
    await rpc('turn/start', { threadId: before.thread.id, cwd: realpathSync(worktree), input: [{ type: 'text', text: 'Verify destination instructions' }] });
    assert.equal((await secondDone).status, 'completed');
    const after = await rpc('thread/resume', { threadId: before.thread.id, excludeTurns: true });
    assert.equal(after.thread.id, before.thread.id);
    assert.equal(after.cwd, realpathSync(worktree));
    assert.equal(after.model, before.model);
    assert.deepEqual(after.approvalPolicy, before.approvalPolicy);
    assert.deepEqual(after.sandbox, before.sandbox);
    assert.ok(after.instructionSources?.some(path => path.endsWith('AGENTS.md')));
    assert.match(lastInput, /GLOBAL_WORKTREE_GATE/);
    assert.match(lastInput, /PROJECT_WORKTREE_GATE/);
    assert.match(lastInput, /WORKTREE_NEW_GATE/);
    const command = (op, fields = {}) => ({ id: randomUUID(), channel: 'gate', op, ...fields });
    await admin.request('control_command', { command: command('channel.configure') });
    await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
    const agentId = `codex:${before.thread.id}`;
    const registration = { harness: 'codex', sessionId: before.thread.id, channel: 'gate', name: 'gate-agent', role: 'implementation',
      project: { name: 'gate', root: realpathSync(worktree) } };
    await participant.request('join', registration);
    await participant.request('control_command', { agentId, command: command('master.volunteer', { eligible: true }) });
    const roleDone = new Promise(resolve => { completed = resolve; });
    const proposal = command('master.appoint', { candidate: agentId });
    await admin.request('control_command', { command: proposal });
    await delay(100); // Drain join maintenance before triggering the authenticated role offer.
    await participant.request('join', registration);
    await roleDone;
    let admitted = false;
    for (let i = 0; i < 100; i++) {
      if ((await admin.request('control_query', { channel: 'gate', view: 'events' })).entries.some(e => e.type === 'notice.accepted')) { admitted = true; break; }
      await delay(20);
    }
    assert.ok(admitted, 'real Codex must return a native role admission receipt');
    assert.match(lastInput, /Turnlink supplemental master role/);
    assert.match(lastInput, /GLOBAL_WORKTREE_GATE/); assert.match(lastInput, /PROJECT_WORKTREE_GATE/);
    await participant.request('control_command', { agentId, command: command('master.accept', { proposalID: proposal.id, promptVersion: 1 }) });
    assert.equal((await admin.request('control_query', { channel: 'gate', view: 'channel' })).channel.active.agentId, agentId);
    const roleState = await rpc('thread/resume', { threadId: before.thread.id, excludeTurns: true });
    assert.equal(roleState.thread.id, before.thread.id); assert.equal(roleState.model, after.model); assert.equal(roleState.cwd, after.cwd);
    assert.deepEqual(roleState.approvalPolicy, after.approvalPolicy); assert.deepEqual(roleState.sandbox, after.sandbox);
  });
