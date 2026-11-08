import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { privateTemp } from '../src/storage.js';
import { createServer } from 'node:http';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeWorktreeSnapshotReader } from '../src/worktree-snapshot.js';
import { makeCodexSnapshotSource } from '../src/native-snapshot-source.js';
import { CodexAdmissionFence } from '../src/codex-admission-fence.js';

test('real Codex proxy preserves governance/cwd and completes the native MCP task flow in the same thread (local model fixture)',
  { skip: process.env.TURNLINK_CODEX_INTEGRATION !== '1', timeout: 45000 }, async t => {
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
    const taskToolCalls = [];
    const model = createServer(async (req, res) => {
      const input = []; for await (const chunk of req) input.push(chunk);
      lastInput = Buffer.concat(input).toString(); // Synthetic fixture prompts only; never printed.
      modelCalls++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let item = { id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: 'Fixture completed.', annotations: [] }] };
      const request = JSON.parse(lastInput), inputItems = request.input || [];
      const userIndex = inputItems.findLastIndex(m => m.role === 'user' &&
        !m.content?.some(p => p.text?.startsWith('Turnlink supplemental role notice:')));
      const userText = (inputItems[userIndex]?.content || []).map(p => p.text || '').join('\n');
      const currentItems = inputItems.slice(userIndex + 1);
      const called = name => currentItems.some(i => i.type === 'function_call' && i.name?.endsWith(name));
      const choose = (name, args) => {
        const catalogue = request.tools?.flatMap(t => t.type === 'namespace' ? t.tools.map(tool => ({ ...tool, namespace: t.name })) : [t]);
        const tool = catalogue?.find(t => t.name?.endsWith(name));
        assert.ok(tool, `Native Codex fixture needs ${name}: ${JSON.stringify(request.tools?.map(t => ({ type: t.type, name: t.name, tools: t.tools?.map(x => x.name) })))}`);
        taskToolCalls.push({ name, args });
        item = { type: 'function_call', id: `fc_task_${modelCalls}`, call_id: `call_task_${modelCalls}`, name: tool.name,
          ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify(args), status: 'completed' };
      };
      const claimID = userText.match(/TURNLINK_TASK_CLAIM:([a-f0-9-]{36})/)?.[1];
      const reporting = userText.includes('TASK_RESULT_DATA\n'), reviewing = userText.includes('TASK_REVIEW_DATA\n');
      if (claimID || reporting || reviewing) {
        if (claimID && !called('channel_join')) choose('channel_join', { channel: 'gate', name: 'gate-agent', role: 'implementation', project: { name: 'gate', root: realpathSync(worktree) } });
        else if (!called('channel_control')) {
          const data = claimID ? { taskID: claimID } : JSON.parse(userText.split(reporting ? 'TASK_RESULT_DATA\n' : 'TASK_REVIEW_DATA\n')[1]);
          const command = claimID ? { op: 'task.claim', taskID: data.taskID } : reporting ?
            { op: 'task.report', taskID: data.taskID, evidence: data.evidence, summary: 'Fixture native result produced and turn evidence attached.' } :
            { op: 'task.review', taskID: data.taskID, evidenceID: data.evidenceID, generation: data.generation, accept: true };
          choose('channel_control', { command: { id: randomUUID(), channel: 'gate', ...command } });
        }
      }
      const response = { id: `resp_fixture_${modelCalls}`, object: 'response', created_at: 1, status: 'completed', model: 'fixture',
        output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
      event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      if (item.type === 'message') event('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: 'Fixture completed.' });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response }); res.end();
    });
    model.listen(0, '127.0.0.1'); await once(model, 'listening');
    writeFileSync(join(home, '.codex', 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\n`);
    const broker = createBroker({ port: 0, directory: join(root, 'broker'), secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
      controlPlane: true, taskDispatch: true, codexTasks: true });
    await once(broker.server, 'listening');
    const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
    const hostFile = join(root, 'host.token'); writeFileSync(hostFile, options.token, { mode: 0o600 });
    appendFileSync(join(home, '.codex', 'config.toml'), `\n[mcp_servers.turnlink]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([resolve('src/mcp.js'), '--codex-stdio', '--control-plane'])}\n` +
      `[mcp_servers.turnlink.env]\nAGENT_CHANNEL_URL = ${JSON.stringify(options.url)}\nAGENT_CHANNEL_TOKEN_FILE = ${JSON.stringify(hostFile)}\nAGENT_CHANNEL_CREDENTIAL_DIR = ${JSON.stringify(options.credentialDirectory)}\n`);
    const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), participant = new ChannelClient(options);
    const adapterFile = join(root, 'adapter.token'); writeFileSync(adapterFile, '3'.repeat(64), { mode: 0o600 });
    const child = spawn(process.execPath, [resolve('src/codex-proxy.js'), 'app-server'], {
      cwd: project, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: join(home, '.codex'), TURNLINK_FIXTURE_KEY: 'fixture-only',
        AGENT_CHANNEL_CODEX_EXECUTABLE: process.env.TURNLINK_CODEX_EXECUTABLE || 'codex', AGENT_CHANNEL_URL: options.url,
        AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory,
        AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_CODEX_TASKS: '1', AGENT_CHANNEL_HEALTH: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: adapterFile }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const childClosed = once(child, 'close');
    const pending = new Map(), nativeRequests = []; let sequence = 0, diagnostics = '';
    const nativeActivity = { known: false, idle: true, blocked: false, flushing: false };
    const nativeFence = new CodexAdmissionFence({ write: line => child.stdin.write(`${line}\n`), activity: () => nativeActivity,
      reply: message => { const p = pending.get(message.id); if (p) { pending.delete(message.id); clearTimeout(p.timer); p.reject(new Error('Native fixture admission rejected')); } } });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    const rejectAll = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
    child.on('error', rejectAll); child.on('exit', () => rejectAll(new Error(`Codex fixture exited: ${diagnostics}`)));
    let completed;
    const turnDone = new Promise(resolve => { completed = resolve; });
    createInterface({ input: child.stdout }).on('line', line => {
      const message = JSON.parse(line), p = pending.get(message.id);
      if (message.id !== undefined && message.method) nativeRequests.push({ method: message.method, keys: Object.keys(message.params || {}), schema: message.params?.requestedSchema });
      nativeFence.observe(message);
      if (message.id !== undefined && message.method === 'mcpServer/elicitation/request') {
        // The isolated test operator explicitly approves only its known local
        // fixture server. The production proxy must forward this decision unchanged.
        assert.equal(message.params.serverName, 'turnlink');
        assert.deepEqual(message.params.requestedSchema, { type: 'object', properties: {} });
        nativeFence.editor(JSON.stringify({ id: message.id, result: { action: 'accept', content: {} } }));
      }
      if (message.result?.thread?.id) nativeActivity.known = true;
      if (message.method === 'turn/started') nativeActivity.idle = false;
      if (message.method === 'turn/completed') nativeActivity.idle = true;
      if (message.method === 'turn/completed') completed(message.params.turn);
      if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(`Codex gate rejected ${p.method} (${message.error.code}): ${String(message.error.message).slice(0, 500)}`));
      else p.resolve(message.result);
    });
    const rpc = (method, params, token) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex gate timed out')); }, 10000);
      pending.set(id, { resolve, reject, timer, method });
      const frame = { id, method, params }; token ? nativeFence.internal(frame, token) : nativeFence.editor(JSON.stringify(frame));
    });
    t.after(async () => {
      nativeFence.close(); rejectAll(new Error('Fixture stopped')); child.kill();
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
    const source = makeCodexSnapshotSource({ threadID: before.thread.id,
      readThread: () => rpc('thread/resume', { threadId: before.thread.id, excludeTurns: true }),
      readTools: async () => JSON.parse(lastInput).tools,
      readConfiguration: async () => {
        const result = await rpc('config/read', { includeLayers: true });
        assert.ok(result.config, 'native config/read must expose effective configuration'); return result.config;
      },
      readInstructions: async () => ({ nativeInstructions: JSON.parse(lastInput).instructions }),
      // The isolated fixture owns all admissions and has awaited turn/completed. This is observational, not production native exclusion.
      readActivity: async () => ({ idle: true, blocked: false, revision: modelCalls }) });
    const discovery = new NativeWorktreeSnapshotReader({ harness: 'codex', sessionID: before.thread.id, native: source,
      home, globalDirectory: join(home, '.codex') });
    const pair = await discovery.inspectPair(realpathSync(worktree));
    assert.equal(pair.source.agentId, `codex:${before.thread.id}`); assert.equal(pair.executionEligible, false);
    assert.ok(pair.instructionCandidates.destination.some(path => path === realpathSync(join(worktree, 'AGENTS.md'))));
    assert.ok(!JSON.stringify(pair).includes('fixture-only'));
    // A resume of an already loaded thread ignores cwd in 0.161.0; the supported transition is turn/start.cwd.
    const secondDone = new Promise(resolve => { completed = resolve; });
    let heldResume;
    await nativeFence.exclusive(before.thread.id, async ({ token }) => {
      await rpc('turn/start', { threadId: before.thread.id, cwd: realpathSync(worktree), input: [{ type: 'text', text: 'Verify destination instructions' }] }, token);
      heldResume = rpc('thread/resume', { threadId: before.thread.id, excludeTurns: true });
      assert.equal(nativeFence.queue.length, 1, 'competing native mutations must remain behind the owning turn');
      assert.equal((await secondDone).status, 'completed');
    });
    assert.equal((await heldResume).thread.id, before.thread.id);
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
    const taskCommand = command('task.create', { title: 'Native Codex task', instructions: 'Return a fixture result without modifying files or cwd.',
      criteria: 'Native turn evidence, explicit participant report and master acceptance.', requiresWorktree: false });
    await admin.request('control_command', { command: taskCommand });
    await rpc('turn/start', { threadId: before.thread.id, input: [{ type: 'text', text: `TURNLINK_TASK_CLAIM:${taskCommand.id}` }] });
    let managed;
    for (let i = 0; i < 250; i++) {
      managed = (await admin.request('control_query', { channel: 'gate', view: 'tasks' })).entries.find(t => t.id === taskCommand.id);
      if (managed?.status === 'completed') break;
      await delay(40);
    }
    assert.ok(managed?.stoppedEvidence, `Codex task needs adapter stop evidence, status=${managed?.status}; calls=${taskToolCalls.length}; nativeRequests=${JSON.stringify(nativeRequests.map(r => r.method))}; diagnostics=${diagnostics}`);
    const artifact = (await admin.request('control_query', { channel: 'gate', view: 'evidence' })).entries.find(e => e.entityID === managed.id && e.kind === 'artifact');
    assert.equal(artifact.artifact.type, 'native_turn'); assert.equal(artifact.artifact.sessionID, before.thread.id);
    assert.equal(artifact.artifact.admissionID, managed.nativeAdmissionID); assert.equal(artifact.artifact.finish, 'completed');
    assert.equal(managed.status, 'completed');
    for (const op of ['task.claim', 'task.report', 'task.review']) assert.ok(taskToolCalls.some(c => c.args.command?.op === op), `${op} must originate through native model/MCP tooling`);
    const nativeTask = (await rpc('thread/read', { threadId: before.thread.id, includeTurns: true })).thread.turns.find(turn => turn.id === artifact.artifact.turnID);
    assert.equal(nativeTask.status, 'completed');
    assert.ok(nativeTask.items.some(item => item.type === 'userMessage' && item.content.some(part => part.text?.includes(`TURNLINK_TASK_BINDING:${managed.nativeAdmissionID}`))));
    assert.ok(nativeTask.items.some(item => item.type === 'agentMessage' && item.text.includes('Fixture completed.')));
    assert.match(lastInput, /GLOBAL_WORKTREE_GATE/); assert.match(lastInput, /PROJECT_WORKTREE_GATE/);
    const taskState = await rpc('thread/resume', { threadId: before.thread.id, excludeTurns: true });
    assert.equal(taskState.thread.id, roleState.thread.id); assert.equal(taskState.cwd, roleState.cwd); assert.equal(taskState.model, roleState.model);
    assert.deepEqual(taskState.sandbox, roleState.sandbox); assert.deepEqual(taskState.approvalPolicy, roleState.approvalPolicy);
    let health;
    for (let i = 0; i < 150; i++) {
      health = (await admin.request('control_query', { channel: 'gate', view: 'health' })).entries.find(h => h.agentId === `codex:${before.thread.id}`);
      if (health?.report) break;
      await delay(20);
    }
    assert.equal(health?.coverage, 'observational'); assert.equal(health?.fresh, true);
    assert.equal(health.report.features.tasks, true); assert.equal(health.report.features.managedWorktrees, false);
  });
