import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, rmSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';
import { digest } from '../src/config.js';

async function eventually(predicate) {
  for (let i = 0; i < 150; i++) {
    try { const value = await predicate(); if (value) return value; }
    catch (error) { if (error?.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH') throw error; }
    await delay(80);
  }
  throw new Error('Codex task proxy condition timed out');
}
async function fixture(t, extraEnv = {}, manual = false, brokerOverrides = {}) {
  const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-codex-task-proxy-'))), nativeFile = join(root, 'native-turns.json');
  const tokenFile = join(root, 'adapter.token'); writeFileSync(tokenFile, '3'.repeat(64), { mode: 0o600 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, taskDispatch: true, codexTasks: true,
    ...(manual ? { worktreeGrants: true, worktreeTaskDispatch: true, manualWorktreeOnly: true } : {}), ...brokerOverrides });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const participant = new ChannelClient(options), reviewer = new ChannelClient(options), admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  for (const client of [participant, reviewer, admin]) {
    const request = client.request.bind(client);
    client.request = async (...args) => {
      for (let attempt = 0; ; attempt++) {
        try { return await request(...args); }
        catch (error) {
          if (error?.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' || attempt >= 5) throw error;
          await delay(100 * (attempt + 1));
        }
      }
    };
  }
  const output = []; let child, errors = '';
  const run = (client, op, fields = {}) => client.request('control_command', { ...(client === admin ? {} : { agentId: client === participant ? 'codex:worker' : 'opencode:reviewer' }),
    command: { id: randomUUID(), op, channel: 'dev', ...fields } });
  const query = async view => (await admin.request('control_query', { channel: 'dev', view })).entries;
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const start = async (method = 'thread/start', cwd = root, envOverrides = {}, waitForReceiver = true) => {
    child = spawn(process.execPath, [resolve('src/codex-proxy.js'), resolve('test/fixtures/codex-tasks.js'), 'app-server'], {
      cwd, env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: options.url,
        AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory,
        AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_CODEX_TASKS: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: tokenFile,
        AGENT_CHANNEL_RPC_TIMEOUT_MS: '100', TURNLINK_TASK_FIXTURE_STATE: nativeFile, ...extraEnv, ...envOverrides }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.on('data', chunk => { errors += chunk; }); createInterface({ input: child.stdout }).on('line', line => output.push(JSON.parse(line)));
    if (extraEnv.TURNLINK_FIXTURE_INITIALIZE === '1') {
      const initID = randomUUID();
      send({ id: initID, method: 'initialize', params: { clientInfo: { name: 'fixture/client', version: '987.654.321' } } });
      await eventually(() => output.some(m => m.id === initID && m.result));
      send({ method: 'initialized', params: {} });
    }
    const id = randomUUID(); send({ id, method, params: { threadId: 'worker' } });
    await eventually(() => output.some(m => m.id === id));
    if (waitForReceiver) await eventually(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(m => m.agentId === 'codex:worker')?.connected);
  };
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill();
      await exited;
    }
  };
  t.after(async () => { await stop(); participant.close(); reviewer.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  await participant.request('join', { harness: 'codex', sessionId: 'worker', channel: 'dev', name: 'worker', role: 'existing role', project: { name: 'fixture', root } });
  await reviewer.request('join', { harness: 'opencode', sessionId: 'reviewer', channel: 'dev', name: 'reviewer', role: 'review', project: { name: 'fixture', root } });
  await reviewer.subscribe('opencode:reviewer');
  await run(admin, 'channel.configure'); await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
  await run(reviewer, 'master.volunteer', { eligible: true });
  const proposal = await run(admin, 'master.appoint', { candidate: 'opencode:reviewer' });
  const notice = (await reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries[0];
  await reviewer.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_reviewer_role' });
  await run(reviewer, 'master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
  await start();
  const task = await run(admin, 'task.create', { title: 'Proxy task', instructions: 'Return native fixture result', criteria: 'Native evidence and explicit report/acceptance', requiresWorktree: manual });
  const claim = () => run(participant, 'task.claim', { taskID: task.commandID });
  const nativeTurns = () => JSON.parse(readFileSync(nativeFile, 'utf8'));
  return { root, broker, admin, output, send, start, stop, query, run, claim, participant, reviewer, taskID: task.commandID, nativeTurns, get errors() { return errors; } };
}

test('Codex proxy exposes the correlated native version as fresh receiver health', async t => {
  const f = await fixture(t, { AGENT_CHANNEL_HEALTH: '1', TURNLINK_FIXTURE_INITIALIZE: '1' });
  const health = await eventually(async () => (await f.query('health')).find(item => item.agentId === 'codex:worker' && item.fresh && item.report?.nativeVersion));
  assert.equal(health.report.nativeVersion, '0.165.0');
  assert.equal(health.coverage, 'observational');
  assert.ok(!JSON.stringify(health).includes('fixture/client'), 'the raw client name must not be retained');
  const tools = new ToolSession(f.participant, { harness: 'codex', sessionId: 'worker' });
  tools.agentId = 'codex:worker'; tools.channel = 'dev';
  const own = await tools.call('channel_status', { channel: 'dev', view: 'health' });
  assert.equal(own.entries.length, 1);
  assert.equal(own.entries[0].fresh, true);
  assert.equal(own.entries[0].report.nativeVersion, '0.165.0');
});

test('Codex proxy leaves native version unknown when the server response does not match the client', async t => {
  const f = await fixture(t, { AGENT_CHANNEL_HEALTH: '1', TURNLINK_FIXTURE_INITIALIZE: '1', TURNLINK_FIXTURE_USER_AGENT: 'unrelated/9.9.9' });
  const health = await eventually(async () => (await f.query('health')).find(item => item.agentId === 'codex:worker' && item.fresh && item.report));
  assert.equal(health.report.nativeVersion, undefined);
});

for (const managed of [false, true]) test(`Codex proxy resumes a manually moved task using the operator-attested receipt${managed ? ' with managed worktree lifecycle' : ''}`, { timeout: process.platform === 'win32' ? 60000 : 30000 }, async t => {
  const f = await fixture(t, { AGENT_CHANNEL_CODEX_WORKTREE_TASKS: '1' }, true, { managedRecords: managed }); await f.claim();
  let destination = join(f.root, 'destination'), created, lifecycleSettings;
  const operatorState = join(f.root, 'operator-state');
  const cli = async (file, ...args) => {
    const child = spawn(process.execPath, [resolve(file), ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH,
      AGENT_CHANNEL_URL: `ws://127.0.0.1:${f.broker.server.address().port}`, AGENT_CHANNEL_TOKEN: '1'.repeat(64), AGENT_CHANNEL_STATE_DIR: operatorState } });
    let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    assert.equal((await once(child, 'close'))[0], 0, err); return JSON.parse(out);
  };
  if (managed) {
    await f.stop();
    const git = args => execFileSync('git', args, { cwd: f.root, stdio: 'ignore' });
    git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
    writeFileSync(join(f.root, 'source-file'), 'fixture\n'); git(['add', 'source-file']); git(['commit', '-m', 'fixture']);
    mkdirSync(operatorState, { mode: 0o700 }); writeFileSync(join(operatorState, 'admin-token'), '2'.repeat(64), { mode: 0o600 });
    lifecycleSettings = join(f.root, 'lifecycle-settings.json');
    writeFileSync(lifecycleSettings, JSON.stringify({ version: 1, agentId: 'codex:worker', channel: 'dev', repository: f.root,
      directory: join(f.root, 'worktree-state'), worktreeRoot: join(f.root, 'trees'), adapterCredentialFile: join(f.root, 'adapter.token'),
      credentialDirectory: join(f.root, 'proofs') }), { mode: 0o600 });
    const preview = await cli('src/manual-managed-worktree.js', 'preview-create', lifecycleSettings, f.taskID, '1');
    await cli('src/control-admin.js', 'managed-worktree-approve', 'dev', preview.id);
    created = await cli('src/manual-managed-worktree.js', 'create', lifecycleSettings, preview.id, preview.digest, '--confirm-no-active-use');
    destination = created.destination;
    assert.equal(readFileSync(join(destination, 'source-file'), 'utf8'), 'fixture\n');
    await f.start('thread/resume', f.root);
  } else mkdirSync(destination);
  const tools = new ToolSession(f.reviewer, { harness: 'opencode', sessionId: 'reviewer' });
  t.after(() => tools.clearSessionWatches());
  tools.agentId = 'opencode:reviewer'; tools.channel = 'dev';
  const previewID = (await tools.call('channel_manual_preview', { taskID: f.taskID, destination })).commandID;
  await f.run(f.admin, 'worktree.approve', { taskID: f.taskID, previewID });
  const preparation = await tools.call('channel_prepare_session', { taskID: f.taskID, previewID, messageId: 'codex-manual-prepare' });
  await eventually(() => f.broker.store.messages.find(message => message.id === preparation.id)?.delivered.includes('codex:worker'));
  const record = { type: 'turnlink.session_record.v2', taskID: f.taskID, previewID, session: 'codex:worker', source: f.root, destination,
    runtime: 'codex 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const recordMessage = await f.participant.request('send', { agentId: 'codex:worker', to: 'opencode:reviewer', text: JSON.stringify(record), messageId: 'codex-manual-record' });
  await eventually(() => f.broker.store.bindings['codex:worker'].manualResume?.status === 'armed');
  await f.stop();
  await eventually(() => f.broker.store.bindings['codex:worker'].manualResume?.status === 'detached');
  let destinationSubscribe = false;
  f.broker.server.on('connection', socket => socket.on('message', raw => {
    try { const frame = JSON.parse(raw.toString()); if (frame.method === 'subscribe' && frame.params?.agentId === 'codex:worker' && frame.params.observedCwd === destination) destinationSubscribe = true; } catch { /* Ignore non-protocol frames. */ }
  }));
  // A native resume can precede the agent's join. Its destination cwd may
  // postpone subscription, but must not erase the source-stop observation.
  await f.start('thread/resume', destination, {}, false);
  await eventually(() => destinationSubscribe);
  assert.equal(f.broker.store.bindings['codex:worker'].manualResume.status, 'detached');
  await f.participant.request('join', { harness: 'codex', sessionId: 'worker', channel: 'dev', name: 'worker', role: 'existing role', project: { name: 'fixture', root: destination } });
  await eventually(async () => (await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(member => member.agentId === 'codex:worker')?.connected);
  const historyID = randomUUID(); f.send({ id: historyID, method: 'thread/turns/list', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(frame => frame.id === historyID && frame.result));
  const request = await eventually(() => f.broker.store.messages.find(message => message.messageId === `turnlink-verify-${recordMessage.id}`))
    .catch(() => { throw new Error(`Comparison request missing; watch=${tools.sessionWatches?.get(previewID)?.lastError || 'waiting'}`); });
  const report = { type: 'turnlink.session_report.v2', taskID: f.taskID, previewID, session: 'codex:worker', recordID: recordMessage.id, requestID: request.id,
    runtime: 'codex 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
  await f.participant.request('send', { agentId: 'codex:worker', to: 'opencode:reviewer', text: JSON.stringify(report), messageId: 'codex-manual-report' });
  const receiptID = randomUUID();
  await f.admin.request('control_manual_resume_confirm', { channel: 'dev', taskID: f.taskID, previewID, recordID: recordMessage.id, requestID: request.id, receiptID, sourceStopped: true });
  const stopped = await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID && task.stoppedEvidence))
    .catch(async () => { throw new Error(`Task did not stop; status=${(await f.query('tasks')).find(task => task.id === f.taskID)?.status}; ${f.errors}`); });
  const artifact = (await f.query('evidence')).find(e => e.entityID === f.taskID && e.kind === 'artifact');
  assert.equal(stopped.status, 'uncertain'); assert.equal(artifact.artifact.sessionID, 'worker');
  await f.run(f.participant, 'task.report', { taskID: f.taskID, summary: 'Native fixture result reviewed', evidence: [artifact.id] });
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, accept: true, evidenceID: artifact.id });
  assert.equal((await f.query('tasks')).find(task => task.id === f.taskID).status, 'completed');
  if (managed) {
    await f.stop();
    const removal = await cli('src/manual-managed-worktree.js', 'preview-remove', lifecycleSettings, created.id);
    await cli('src/control-admin.js', 'managed-worktree-approve', 'dev', removal.id);
    const removed = await cli('src/manual-managed-worktree.js', 'remove', lifecycleSettings, removal.id, removal.digest, '--confirm-no-active-use');
    assert.equal(removed.phase, 'removed'); assert.equal(existsSync(destination), false);
  }
});

test('Codex proxy reconnects after a manual transfer to a different broker host', { timeout: 25000 }, async t => {
  const destinationToken = '7'.repeat(64), destinationAdapter = '8'.repeat(64), hosts = [
    { hostId: 'local', credential: '1'.repeat(64), channels: ['dev'], broadcast: true },
    { hostId: 'destination', credential: destinationToken, channels: ['dev'], broadcast: true },
  ];
  const f = await fixture(t, { AGENT_CHANNEL_CODEX_WORKTREE_TASKS: '1', TURNLINK_FIXTURE_COMPLETE_BEFORE_REPLY: '1' }, true, { hosts });
  await f.admin.request('control_enroll_adapter', { hostId: 'destination', credential: destinationAdapter });
  await f.claim();
  const destination = join(f.root, 'destination'); mkdirSync(destination);
  const tools = new ToolSession(f.reviewer, { harness: 'opencode', sessionId: 'reviewer' });
  t.after(() => tools.clearSessionWatches());
  tools.agentId = 'opencode:reviewer'; tools.channel = 'dev';
  const previewID = (await tools.call('channel_manual_preview', { taskID: f.taskID, destination })).commandID;
  await f.run(f.admin, 'worktree.approve', { taskID: f.taskID, previewID });
  const preparation = await tools.call('channel_prepare_session', { taskID: f.taskID, previewID, messageId: 'codex-host-prepare' });
  await eventually(() => f.broker.store.messages.find(message => message.id === preparation.id)?.delivered.includes('codex:worker'));
  const record = { type: 'turnlink.session_record.v2', taskID: f.taskID, previewID, session: 'codex:worker', source: f.root, destination,
    runtime: 'codex 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const saved = await f.participant.request('send', { agentId: 'codex:worker', to: 'opencode:reviewer', text: JSON.stringify(record), messageId: 'codex-host-record' });
  await eventually(() => f.broker.store.bindings['codex:worker'].manualResume?.status === 'armed');
  await eventually(() => f.broker.store.messages.find(message => message.messageId === `turnlink-armed-${saved.id}`)?.delivered.includes('codex:worker'));
  await eventually(() => f.nativeTurns().every(turn => ['completed', 'interrupted', 'failed'].includes(turn.status)));
  await f.stop();
  await eventually(() => f.broker.store.bindings['codex:worker'].manualResume?.status === 'detached');
  await f.admin.request('control_manual_resume_authorize_host', { channel: 'dev', taskID: f.taskID, previewID,
    targetHostId: 'destination', transferID: randomUUID(), sourceStopped: true });
  const targetProofs = join(f.root, 'destination-proofs'), tokenFile = join(f.root, 'destination-adapter.token');
  writeFileSync(tokenFile, destinationAdapter, { mode: 0o600 });
  const targetRequests = [];
  f.broker.server.on('connection', socket => {
    if (socket.principal?.hostId === 'destination') socket.on('message', data => {
      try { targetRequests.push(JSON.parse(data.toString()).method); } catch { /* Fixture diagnostics only. */ }
    });
  });
  await f.start('thread/resume', destination, { AGENT_CHANNEL_TOKEN: destinationToken, AGENT_CHANNEL_CREDENTIAL_DIR: targetProofs,
    AGENT_CHANNEL_ADAPTER_TOKEN_FILE: tokenFile }, false);
  await eventually(() => existsSync(join(targetProofs, digest('destination'), `${digest('codex:worker')}.key`)));
  const target = new ChannelClient({ url: `ws://127.0.0.1:${f.broker.server.address().port}`, token: destinationToken, credentialDirectory: targetProofs });
  t.after(() => target.close());
  await target.request('join', { harness: 'codex', sessionId: 'worker', channel: 'dev', name: 'worker', role: 'existing role',
    project: { name: 'fixture', root: destination } });
  await eventually(async () => (await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(member => member.agentId === 'codex:worker')?.connected);
  const request = await eventually(() => f.broker.store.messages.find(message => message.messageId === `turnlink-verify-${saved.id}`));
  const report = { type: 'turnlink.session_report.v2', taskID: f.taskID, previewID, session: 'codex:worker', recordID: saved.id, requestID: request.id,
    runtime: 'codex 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
  await target.request('send', { agentId: 'codex:worker', to: 'opencode:reviewer', text: JSON.stringify(report), messageId: 'codex-host-report' });
  await f.admin.request('control_manual_resume_confirm', { channel: 'dev', taskID: f.taskID, previewID, recordID: saved.id,
    requestID: request.id, receiptID: randomUUID(), sourceStopped: true });
  const stopped = await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID && task.stoppedEvidence))
    .catch(async () => { throw new Error(`Cross-host task did not stop; status=${(await f.query('tasks')).find(task => task.id === f.taskID)?.status}; ` +
      `sockets=${JSON.stringify([...f.broker.server.clients].map(socket => ({ host: socket.principal?.hostId, watches: [...(socket.taskWatches || [])] })))}; ` +
      `requests=${JSON.stringify(targetRequests)}; ` +
      `turns=${JSON.stringify(f.nativeTurns().map(turn => ({ id: turn.id, status: turn.status })))}; ` +
      `events=${JSON.stringify(f.output.slice(-12).map(value => ({ method: value.method, id: value.id })))}; ${f.errors}`); });
  assert.equal(stopped.status, 'uncertain');
  const artifact = (await f.query('evidence')).find(evidence => evidence.entityID === f.taskID && evidence.kind === 'artifact');
  await target.request('control_command', { agentId: 'codex:worker', command: { id: randomUUID(), channel: 'dev', op: 'task.report',
    taskID: f.taskID, summary: 'Native fixture result reviewed', evidence: [artifact.id] } });
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, accept: true, evidenceID: artifact.id });
  assert.equal((await f.query('tasks')).find(task => task.id === f.taskID).status, 'completed');
});

test('a Codex receiver resumed at the original source makes the stop observation uncertain', { timeout: 20000 }, async t => {
  const f = await fixture(t, { AGENT_CHANNEL_CODEX_WORKTREE_TASKS: '1' }, true); await f.claim();
  const destination = join(f.root, 'destination'); mkdirSync(destination);
  const tools = new ToolSession(f.reviewer, { harness: 'opencode', sessionId: 'reviewer' });
  tools.agentId = 'opencode:reviewer'; tools.channel = 'dev'; t.after(() => tools.clearSessionWatches());
  const previewID = (await tools.call('channel_manual_preview', { taskID: f.taskID, destination })).commandID;
  await f.run(f.admin, 'worktree.approve', { taskID: f.taskID, previewID });
  const prep = await tools.call('channel_prepare_session', { taskID: f.taskID, previewID, messageId: 'codex-source-reconnect-prep' });
  await eventually(() => f.broker.store.messages.find(message => message.id === prep.id)?.delivered.includes('codex:worker'));
  const record = { type: 'turnlink.session_record.v2', taskID: f.taskID, previewID, session: 'codex:worker', source: f.root, destination,
    runtime: 'codex 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const saved = await f.participant.request('send', { agentId: 'codex:worker', to: 'opencode:reviewer', text: JSON.stringify(record), messageId: 'codex-source-reconnect-record' });
  await eventually(() => f.broker.store.bindings['codex:worker'].manualResume?.status === 'armed');
  await eventually(() => f.broker.store.messages.find(message => message.messageId === `turnlink-armed-${saved.id}`)?.delivered.includes('codex:worker'));
  await f.stop(); await eventually(() => f.broker.store.bindings['codex:worker'].manualResume?.status === 'detached');
  await f.start('thread/resume', f.root);
  assert.equal(f.broker.store.bindings['codex:worker'].manualResume.status, 'uncertain');
});

test('Codex proxy executes a claimed task in the same native thread and keeps internal RPC receipts private', async t => {
  const f = await fixture(t); await f.claim();
  const stopped = await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID && task.stoppedEvidence));
  const artifact = (await f.query('evidence')).find(e => e.entityID === f.taskID && e.kind === 'artifact');
  assert.equal(artifact.artifact.sessionID, 'worker'); assert.equal(stopped.status, 'uncertain', 'native completion alone is not a participant report');
  const call = f.output.find(m => m.method === 'fixture/received' && m.params.input[0].text.includes('TURNLINK_TASK_BINDING:'));
  assert.deepEqual(Object.keys(call.params).sort(), ['input', 'method', 'threadId']);
  assert.equal(call.params.threadId, 'worker');
  assert.ok(!f.output.some(m => typeof m.id === 'string' && m.id.startsWith('turnlink-')));
  await f.run(f.participant, 'task.report', { taskID: f.taskID, summary: 'Native fixture result reviewed', evidence: [artifact.id] });
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, accept: true, evidenceID: artifact.id });
  assert.equal((await f.query('tasks')).find(t => t.id === f.taskID).status, 'completed');
});

for (const [label, override] of [['approval policy', { approvalPolicy: 'never' }], ['model', { model: 'fixture-other' }]])
  test(`an explicit native ${label} override invalidates the cached task selection before admission`, async t => {
  const f = await fixture(t);
  f.send({ id: 314, method: 'turn/start', params: { threadId: 'worker', ...override,
    input: [{ type: 'text', text: 'Synthetic user policy override' }] } });
  await eventually(() => f.output.some(value => value.id === 314));
  await eventually(() => f.nativeTurns().some(turn => turn.status === 'completed'));
  await f.claim();
  await delay(500);
  const task = (await f.query('tasks')).find(value => value.id === f.taskID);
  assert.equal(task.status, 'claimed');
  assert.equal(f.output.some(frame => frame.method === 'fixture/received' && JSON.stringify(frame).includes('TURNLINK_TASK_BINDING:')), false);
  f.send({ id: 315, method: 'thread/resume', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(value => value.id === 315 && value.result));
  const stopped = await eventually(async () => (await f.query('tasks')).find(value => value.id === f.taskID && value.stoppedEvidence));
  assert.equal(stopped.status, 'uncertain');
  });

test('a global native configuration mutation invalidates task selection even when a resume reply arrives late', async t => {
  const f = await fixture(t);
  f.send({ id: 316, method: 'thread/resume', params: { threadId: 'worker', fixtureDelayMs: 300 } });
  f.send({ id: 317, method: 'config/value/write', params: { keyPath: 'model', value: 'fixture-other', mergeStrategy: 'replace' } });
  await eventually(() => f.output.some(value => value.id === 317));
  await eventually(() => f.output.some(value => value.id === 316));
  await f.claim();
  await delay(500);
  assert.equal((await f.query('tasks')).find(value => value.id === f.taskID).status, 'claimed');
  assert.equal(f.output.some(frame => frame.method === 'fixture/received' && JSON.stringify(frame).includes('TURNLINK_TASK_BINDING:')), false);
  f.send({ id: 318, method: 'thread/resume', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(value => value.id === 318 && value.result));
  const stopped = await eventually(async () => (await f.query('tasks')).find(value => value.id === f.taskID && value.stoppedEvidence));
  assert.equal(stopped.status, 'uncertain');
});

test('a late global configuration response invalidates a resume observed while the mutation was pending', async t => {
  const f = await fixture(t);
  f.send({ id: 319, method: 'config/value/write', params: { keyPath: 'model', value: 'fixture-other', fixtureDelayMs: 300 } });
  f.send({ id: 320, method: 'thread/resume', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(value => value.id === 320));
  await eventually(() => f.output.some(value => value.id === 319));
  await f.claim();
  await delay(500);
  assert.equal((await f.query('tasks')).find(value => value.id === f.taskID).status, 'claimed');
  assert.equal(f.output.some(frame => frame.method === 'fixture/received' && JSON.stringify(frame).includes('TURNLINK_TASK_BINDING:')), false);
  f.send({ id: 321, method: 'thread/resume', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(value => value.id === 321 && value.result));
  const stopped = await eventually(async () => (await f.query('tasks')).find(value => value.id === f.taskID && value.stoppedEvidence));
  assert.equal(stopped.status, 'uncertain');
});

test('a completed human turn is not revived by its later start response', async t => {
  const f = await fixture(t, { TURNLINK_FIXTURE_COMPLETE_BEFORE_REPLY: '1' });
  f.send({ id: 42, method: 'turn/start', params: { threadId: 'worker', input: [{ type: 'text', text: 'Synthetic user request' }] } });
  await eventually(() => f.output.some(value => value.id === 42));
  await f.claim();
  const stopped = await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID && task.stoppedEvidence));
  assert.equal(stopped.status, 'uncertain');
});

test('real proxy/process restart reconciles a lost native admission response without starting the task twice', async t => {
  const f = await fixture(t, { TURNLINK_TASK_DROP_START_RESPONSE: '1' }); await f.claim();
  await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID)?.status === 'uncertain');
  await f.stop(); await f.start('thread/resume');
  await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID)?.stoppedEvidence);
  const managed = f.nativeTurns().filter(turn => turn.items[0].content[0].text.includes('TURNLINK_TASK_BINDING:'));
  assert.equal(managed.length, 1);
  assert.equal((await f.query('evidence')).filter(e => e.entityID === f.taskID && e.kind === 'artifact').length, 1);
});

test('actual native approval responses and human interruption pass unchanged; stopped tasks do not auto-wake', async t => {
  const f = await fixture(t, { TURNLINK_TASK_HOLD_TURN: '1' });
  f.send({ id: 10, method: 'fixture/approval', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(m => m.id === 999));
  // The synthetic editor method is unaudited; refresh native selection before
  // claiming, without answering the real outstanding approval request.
  f.send({ id: 12, method: 'thread/resume', params: { threadId: 'worker' } });
  await eventually(() => f.output.some(m => m.id === 12)); await f.claim(); await delay(300);
  assert.equal(f.output.some(m => m.method === 'fixture/received'), false);
  f.send({ id: 999, result: { decision: 'decline' } });
  await eventually(() => f.output.some(m => m.method === 'fixture/approval-replied'));
  const started = await eventually(() => f.output.find(m => m.method === 'turn/started'));
  f.send({ id: 11, method: 'turn/interrupt', params: { threadId: 'worker', turnId: started.params.turn.id } });
  await eventually(() => f.output.some(m => m.id === 11));
  await eventually(async () => (await f.query('tasks')).find(task => task.id === f.taskID)?.stoppedEvidence);
  await delay(100);
  assert.equal(f.nativeTurns().length, 1, 'a human-stopped task must not trigger a report turn automatically');
  assert.equal((await f.query('evidence')).find(e => e.entityID === f.taskID && e.kind === 'artifact').artifact.finish, 'interrupted');
});
