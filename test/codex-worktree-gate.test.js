import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateTemp } from '../src/storage.js';
import { createServer } from 'node:http';

test('real Codex changes cwd in the same thread without permission overrides (local model fixture)',
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
    const child = spawn(process.env.TURNLINK_CODEX_EXECUTABLE || 'codex', ['app-server'], {
      cwd: project, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: join(home, '.codex'), TURNLINK_FIXTURE_KEY: 'fixture-only' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
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
      if (child.pid && child.exitCode === null && child.signalCode === null) await once(child, 'exit');
      model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
      rmSync(root, { recursive: true, force: true });
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
  });
