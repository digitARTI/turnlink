import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Exercise a real session against a local synthetic model, without touching the
// user's profile or making requests to a real provider.
export async function verifyDesktopSession({ executable, home, isolated, sharedTrap, cwd, tmp }) {
  const marker = join(sharedTrap, 'shared-store-sentinel');
  mkdirSync(sharedTrap, { recursive: true, mode: 0o700 });
  writeFileSync(marker, 'untouched\n', { mode: 0o600 });
  writeFileSync(join(sharedTrap, 'AGENTS.md'), 'SHARED_HOME_INSTRUCTION_TRAP_MUST_NOT_REACH_MODEL\n', { mode: 0o600 });
  writeFileSync(join(sharedTrap, 'config.toml'), 'model_provider = "shared_trap"\n', { mode: 0o600 });
  let modelRequests = 0, leakedInstruction = false;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url.startsWith('/v1/responses')) {
        response.writeHead(404); response.end(); return;
      }
      modelRequests++;
      leakedInstruction ||= Buffer.concat(chunks).includes('SHARED_HOME_INSTRUCTION_TRAP_MUST_NOT_REACH_MODEL');
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const id = randomUUID(), item = { id: `msg_${id}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Isolated fixture.', annotations: [] }] };
      const result = { id: `resp_${id}`, object: 'response', created_at: 1, status: 'completed', model: 'fixture', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('response.created', { response: { ...result, status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      event('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: 'Isolated fixture.' });
      event('response.output_item.done', { output_index: 0, item }); event('response.completed', { response: result }); response.end();
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let child;
  try {
    mkdirSync(isolated, { recursive: true, mode: 0o700 });
    writeFileSync(join(isolated, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n`, { mode: 0o600 });
    child = spawn(executable, ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, HOME: home, TMPDIR: tmp, CODEX_HOME: sharedTrap, CODEX_SQLITE_HOME: sharedTrap,
      TURNLINK_FIXTURE_KEY: 'local-fixture-only', NO_PROXY: '*', no_proxy: '*',
    } });
    child.stderr.resume();
    const pending = new Map(), notifications = []; let seq = 0;
    const fail = () => { for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Desktop app-server stopped')); } pending.clear(); };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
    createInterface({ input: child.stdout }).on('line', line => {
      let frame; try { frame = JSON.parse(line); } catch { return; }
      if (frame.method) { notifications.push(frame); return; }
      const entry = pending.get(frame.id); if (!entry) return;
      pending.delete(frame.id); clearTimeout(entry.timer);
      if (frame.error) entry.reject(new Error(`Desktop app-server rejected ${entry.method}`)); else entry.resolve(frame.result);
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Desktop app-server timed out: ${method}`)); }, 30000);
      pending.set(id, { method, resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    await rpc('initialize', { clientInfo: { name: 'turnlink-isolation-verifier', version: '1' } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    const thread = await rpc('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'on-request' });
    const turn = await rpc('turn/start', { threadId: thread.thread.id, input: [{ type: 'text', text: 'Run the isolation fixture.' }] });
    const deadline = Date.now() + 30000;
    while (!notifications.some(frame => frame.method === 'turn/completed' && frame.params?.turn?.id === turn.turn.id)) {
      if (Date.now() >= deadline) throw new Error('Desktop fixture turn timed out');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(notifications.find(frame => frame.method === 'turn/completed' && frame.params?.turn?.id === turn.turn.id).params.turn.status, 'completed');
    assert.ok(modelRequests > 0, 'fixture model was not called');
    assert.equal(leakedInstruction, false, 'shared-home instruction reached the model');
    child.stdin.end();
    const exited = once(child, 'exit'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
    const files = readdirSync(isolated, { recursive: true }).map(String);
    assert.ok(files.some(name => name.includes(thread.thread.id) && name.endsWith('.jsonl')), 'real session rollout was not stored in isolated home');
    assert.ok(files.some(name => /(?:^|\/)state_\d+\.sqlite$/.test(name)), 'session SQLite state was not stored in isolated home');
    assert.deepEqual(readdirSync(sharedTrap).sort(), ['AGENTS.md', 'config.toml', 'shared-store-sentinel'], 'shared home was modified during session');
    assert.equal(readFileSync(marker, 'utf8'), 'untouched\n');
    assert.equal(readFileSync(join(sharedTrap, 'AGENTS.md'), 'utf8'), 'SHARED_HOME_INSTRUCTION_TRAP_MUST_NOT_REACH_MODEL\n');
    assert.equal(readFileSync(join(sharedTrap, 'config.toml'), 'utf8'), 'model_provider = "shared_trap"\n');
    return { session: 'completed', rollout: true, sqlite: true, sharedHomeUnchanged: true, sharedInstructionExcluded: true };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await new Promise(resolve => server.close(resolve));
  }
}
