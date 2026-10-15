import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

async function eventually(predicate) {
  for (let i = 0; i < 150; i++) { const value = await predicate(); if (value) return value; await delay(40); }
  throw new Error('Codex task proxy condition timed out');
}
async function fixture(t, extraEnv = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-task-proxy-')), nativeFile = join(root, 'native-turns.json');
  const tokenFile = join(root, 'adapter.token'); writeFileSync(tokenFile, '3'.repeat(64), { mode: 0o600 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, taskDispatch: true, codexTasks: true });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const participant = new ChannelClient(options), reviewer = new ChannelClient(options), admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  const output = []; let child;
  const run = (client, op, fields = {}) => client.request('control_command', { ...(client === admin ? {} : { agentId: client === participant ? 'codex:worker' : 'opencode:reviewer' }),
    command: { id: randomUUID(), op, channel: 'dev', ...fields } });
  const query = async view => (await admin.request('control_query', { channel: 'dev', view })).entries;
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const start = async (method = 'thread/start') => {
    child = spawn(process.execPath, [resolve('src/codex-proxy.js'), resolve('test/fixtures/codex-tasks.js'), 'app-server'], {
      cwd: root, env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: options.url,
        AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory,
        AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_CODEX_TASKS: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: tokenFile,
        AGENT_CHANNEL_RPC_TIMEOUT_MS: '100', TURNLINK_TASK_FIXTURE_STATE: nativeFile, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume(); createInterface({ input: child.stdout }).on('line', line => output.push(JSON.parse(line)));
    const id = randomUUID(); send({ id, method, params: { threadId: 'worker' } });
    await eventually(() => output.some(m => m.id === id));
    await eventually(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(m => m.agentId === 'codex:worker')?.connected);
  };
  const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } };
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
  const task = await run(admin, 'task.create', { title: 'Proxy task', instructions: 'Return native fixture result', criteria: 'Native evidence and explicit report/acceptance', requiresWorktree: false });
  const claim = () => run(participant, 'task.claim', { taskID: task.commandID });
  const nativeTurns = () => JSON.parse(readFileSync(nativeFile, 'utf8'));
  return { output, send, start, stop, query, run, claim, participant, reviewer, taskID: task.commandID, nativeTurns };
}

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
