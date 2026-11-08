import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { privateTemp } from '../src/storage.js';
import { createBroker, brokerEnvironmentOptions, brokerEnvironmentCancellationVerifier, brokerEnvironmentOpenCodeCompletionVerifier, brokerEnvironmentOwnerEndpointDirectory } from '../src/broker.js';
import { ControlGateway } from '../src/control/gateway.js';
import { ControlStore } from '../src/control/store.js';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';
import { releasedWorktreeTransition } from '../src/worktree-task-binding.js';
import { makeOpenCodeTasks } from '../adapters/opencode-tasks.js';
import { CodexResourceJournal } from '../src/codex-resource-journal.js';
import { dispatchCodexDestinationStep, disposeCodexDestinationStep, observeCodexDestinationStepDisposal } from '../src/codex-step-dispatch.js';
import { cleanupCodexProvider, quiesceCodexMcp } from '../src/codex-resource-dispatch.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { sessionProof, digest } from '../src/config.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64), ADAPTER = '3'.repeat(64);

test('normal broker startup requires explicit independent OpenCode completion configuration for handoff', { skip: process.platform !== 'darwin' }, async t => {
  assert.equal(brokerEnvironmentOptions({}).ownerLeaseRequired, false);
  assert.throws(() => brokerEnvironmentOptions({ AGENT_CHANNEL_OPENCODE_OWNER_LEASE: 'yes' }), /must be 0 or 1/);
  assert.throws(() => brokerEnvironmentOwnerEndpointDirectory({}, { ownerLeaseRequired: true }), /requires a private endpoint directory/);
  assert.throws(() => brokerEnvironmentOwnerEndpointDirectory({ AGENT_CHANNEL_OPENCODE_ENDPOINT_DIRECTORY: '/private/tmp/example' }, {}), /requires owner lease/);
  assert.throws(() => brokerEnvironmentOpenCodeCompletionVerifier({}, { ownerLeaseRequired: true, receiverHandoff: true, worktreeGrants: true }), /Owner lease requires/);
  assert.throws(() => brokerEnvironmentOptions({ AGENT_CHANNEL_RECEIVER_HANDOFF: 'yes' }), /must be 0 or 1/);
  assert.throws(() => brokerEnvironmentOpenCodeCompletionVerifier({}, { receiverHandoff: true }), /requires an OpenCode completion verifier/);
  const directory = privateTemp('/private/tmp/tlocb-'), tokenFile = join(directory, 'completion.token'), socket = join(directory, 'completion.sock');
  const completionToken = '7'.repeat(64);
  writeFileSync(tokenFile, completionToken, { mode: 0o600 });
  const env = { AGENT_CHANNEL_OPENCODE_COMPLETION_SOCKET: socket, AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE: tokenFile };
  assert.throws(() => brokerEnvironmentOpenCodeCompletionVerifier(env, { receiverHandoff: true, worktreeGrants: true }, { host: completionToken }), /separate credential/);
  assert.throws(() => brokerEnvironmentOpenCodeCompletionVerifier(env, { receiverHandoff: false, worktreeGrants: true }), /requires receiver handoff/);
  const probe = createServer(); await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const address = `ws://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/broker.js'], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, ...env, AGENT_CHANNEL_STATE_DIR: directory, AGENT_CHANNEL_URL: address, AGENT_CHANNEL_TOKEN: HOST,
    AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_WORKTREE_GRANTS: '1', AGENT_CHANNEL_RECEIVER_HANDOFF: '1',
    AGENT_CHANNEL_TASKS: '1', AGENT_CHANNEL_WORKTREE_TASKS: '1', AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET: undefined,
    AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE: undefined,
  } });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; rmSync(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 300 && !errors.includes('listening on') && child.exitCode === null; i++) await delay(10);
  assert.match(errors, /listening on/);
  const client = new ChannelClient({ url: address, token: HOST, credentialDirectory: join(directory, 'keys') });
  t.after(() => client.close());
  const info = await client.request('control_info');
  assert.equal(info.taskWorktreesEnabled, true);
  assert.equal(info.worktreeExecutionEnabled, false);
});

test('broker startup exposes explicitly enabled worktree grants without enabling execution', async t => {
  assert.equal(brokerEnvironmentOptions({}).worktreeGrants, false);
  assert.equal(brokerEnvironmentOptions({}).managedRecords, false);
  assert.throws(() => brokerEnvironmentOptions({ AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS: 'yes' }), /must be 0 or 1/);
  assert.throws(() => createBroker({ ...brokerEnvironmentOptions({ AGENT_CHANNEL_MANAGED_WORKTREE_RECORDS: '1' }) }), /require the control plane/);
  assert.throws(() => brokerEnvironmentOptions({ AGENT_CHANNEL_WORKTREE_GRANTS: 'yes' }), /must be 0 or 1/);
  assert.throws(() => createBroker({ ...brokerEnvironmentOptions({ AGENT_CHANNEL_WORKTREE_GRANTS: '1' }) }), /require the control plane/);
  assert.equal(brokerEnvironmentCancellationVerifier({}, {}), undefined);
  assert.throws(() => brokerEnvironmentCancellationVerifier({ AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET: '/tmp/fixture' }, { worktreeGrants: true }), /requires worktree grants/);
  assert.throws(() => brokerEnvironmentCancellationVerifier({ AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET: '/tmp/fixture',
    AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE: '/tmp/fixture-token' }, {}), /requires worktree grants/);
  const directory = privateTemp(join(tmpdir(), 'turnlink-broker-cli-'));
  writeFileSync(join(directory, 'admin-token'), ADMIN, { mode: 0o600 });
  assert.throws(() => brokerEnvironmentCancellationVerifier({ AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET: join(directory, 'v.sock'),
    AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE: join(directory, 'admin-token') }, { worktreeGrants: true }, { admin: ADMIN }), /separate credential/);
  const probe = createServer(); await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const address = `ws://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/broker.js'], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'], env: {
    ...process.env, AGENT_CHANNEL_STATE_DIR: directory, AGENT_CHANNEL_URL: address, AGENT_CHANNEL_TOKEN: HOST,
    AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_WORKTREE_GRANTS: '1', AGENT_CHANNEL_CONTROL_EFFECTS: '0',
    AGENT_CHANNEL_TASKS: '0', AGENT_CHANNEL_CODEX_TASKS: '0',
    AGENT_CHANNEL_CODEX_CANCELLATION_SOCKET: undefined, AGENT_CHANNEL_CODEX_CANCELLATION_TOKEN_FILE: undefined,
    AGENT_CHANNEL_OPENCODE_COMPLETION_SOCKET: undefined, AGENT_CHANNEL_OPENCODE_COMPLETION_TOKEN_FILE: undefined,
    AGENT_CHANNEL_RECEIVER_HANDOFF: undefined, AGENT_CHANNEL_WORKTREE_TASKS: undefined,
  } });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; rmSync(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 300 && !errors.includes('listening on') && child.exitCode === null; i++) await delay(10);
  assert.match(errors, /listening on/);
  const client = new ChannelClient({ url: address, token: HOST, credentialDirectory: join(directory, 'keys') });
  t.after(() => client.close());
  const info = await client.request('control_info');
  assert.equal(info.worktreeGrantsEnabled, true);
  assert.equal(info.mcpEstablishmentGrantsEnabled, true);
  assert.equal(info.worktreeExecutionEnabled, false);
  assert.equal(info.mcpEstablishmentExecutionEnabled, false);
  const admin = new ChannelClient({ url: address, token: ADMIN, credentialDirectory: join(directory, 'keys') });
  t.after(() => admin.close());
  const sessionId = randomUUID(), agentId = `codex:${sessionId}`;
  const command = (connection, op, fields = {}, agent) => connection.request('control_command', {
    ...(agent ? { agentId: agent } : {}), command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  await command(admin, 'channel.configure');
  await admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  await client.request('join', { harness: 'codex', sessionId, name: 'cli-source', role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
  await client.subscribe(agentId);
  const taskID = (await command(admin, 'task.create', { title: 'CLI grant', instructions: 'Prepare', criteria: 'No execution' })).commandID;
  await command(client, 'task.claim', { taskID }, agentId);
  const plan = { id: randomUUID(), kind: 'mcp_runtime', harness: 'codex', processGeneration: randomUUID(), agentId,
    reservation: { generation: randomUUID(), revision: 1 }, from: '/source', to: '/destination', digest: 'a'.repeat(64),
    effects: { processes: true, network: true, credentials: true, filesystem: true, plugins: true } };
  const adapter = (op, fields) => client.request('control_adapter', { agentId, credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  const previewID = (await adapter('worktree.preview', { taskID, purpose: 'establish-mcp', mcpPlan: plan,
    from: plan.from, to: plan.to, configurationDigest: plan.digest })).commandID;
  await command(admin, 'worktree.approve', { taskID, previewID });
  await adapter('evidence.record', { entityID: taskID, kind: 'capability', nativeMcpRuntime: true });
  await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  const transitionID = (await adapter('worktree.begin', { taskID, previewID, claimGeneration: 1,
    configurationDigest: plan.digest, purpose: 'establish-mcp' })).commandID;
  const page = await client.request('control_query', { agentId, channel: 'dev', view: 'transitions', entityID: transitionID, offset: 0, limit: 1 });
  assert.equal(page.entries[0].status, 'prepared'); assert.deepEqual(page.entries[0].mcpPlan, plan);
});

test('a receiver handoff resets only its own cached task wakeups', () => {
  const gateway = Object.create(ControlGateway.prototype), received = [];
  const tasks = ['opencode:a', 'opencode:b'].map((claimant, index) => ({ id: `task_${index}`, channel: 'dev', status: 'claimed',
    claimant, claimGeneration: 1, attempt: 1, requiresWorktree: false, dependencies: [], priority: 0, createdAt: index }));
  let held = false;
  Object.assign(gateway, { taskDispatch: true, now: () => 1000, store: { snapshot: () => ({ channels: [{ id: 'dev' }], tasks, transitions: [] }) },
    receiverHeld: id => held && id === 'opencode:a', onTaskChanged: task => { received.push(task.claimant); return true; } });
  gateway.signalReadyTasks(); gateway.signalReadyTasks();
  assert.deepEqual(received, ['opencode:a', 'opencode:b']);
  gateway.forgetTaskSignals('opencode:a');
  gateway.signalReadyTasks(); gateway.signalReadyTasks();
  assert.deepEqual(received, ['opencode:a', 'opencode:b', 'opencode:a']);
  held = true; gateway.signalReadyTasks(); held = false; gateway.signalReadyTasks();
  assert.deepEqual(received, ['opencode:a', 'opencode:b', 'opencode:a', 'opencode:a']);
});
async function fixture(t, enabled = true, extra = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-control-broker-'));
  let now = 1000;
  const broker = createBroker({ directory: root, port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: enabled, now: () => now, ...extra });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const clients = [];
  const client = (token = HOST) => { const value = new ChannelClient({ ...options, token }); clients.push(value); return value; };
  const admin = client(ADMIN), a = client(), b = client(), c = client();
  const joinAgent = async (connection, sessionId, channel = 'dev') => {
    await connection.request('join', { harness: 'opencode', sessionId, name: sessionId, role: 'full project access', channel,
      project: { name: 'fixture', root: '/project' } });
    await connection.subscribe(`opencode:${sessionId}`);
  };
  await joinAgent(a, 'a'); await joinAgent(b, 'b'); await joinAgent(c, 'c');
  const run = (connection, agentId, op, fields = {}, channel = 'dev') => connection.request('control_command', {
    ...(agentId ? { agentId } : {}), command: { id: randomUUID(), op, channel, ...fields },
  });
  const query = (connection = admin, agentId, view = 'channel', fields = {}, channel = 'dev') => connection.request('control_query', {
    channel, view, ...(agentId ? { agentId } : {}), ...fields,
  });
  const enroll = () => admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  const appoint = async () => {
    await run(a, 'opencode:a', 'master.volunteer', { eligible: true });
    const result = await run(admin, undefined, 'master.appoint', { candidate: 'opencode:a' });
    const notice = (await query(a, 'opencode:a', 'notices')).entries.find(n => n.kind === 'offer');
    return { proposalID: result.commandID, notice };
  };
  t.after(async () => { clients.forEach(c => c.close()); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  if (enabled) await run(admin, undefined, 'channel.configure');
  return { broker, options, admin, a, b, c, client, run, query, enroll, appoint, joinAgent, advance: ms => { now += ms; }, get now() { return now; } };
}

test('control plane is opt-in and leaves baseline channel messaging available', async t => {
  const f = await fixture(t, false);
  assert.equal((await f.a.request('control_info')).enabled, false);
  await assert.rejects(f.run(f.admin, undefined, 'channel.configure'), /CONTROL_DISABLED/);
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'baseline', messageId: 'baseline' });
  assert.equal(message.text, 'baseline');
});

test('a quickly reconnected task receiver receives a fresh availability notification', async t => {
  const f = await fixture(t, true, { taskDispatch: true, sweepIntervalMs: 1000 });
  await f.enroll();
  await f.b.request('control_task_watch', { agentId: 'opencode:b', credential: ADAPTER });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Reconnect', instructions: 'Resume', criteria: 'Wake', requiresWorktree: false })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  // Let the scheduler cache the notification for the original receiver.
  await delay(1200);
  await f.b.unsubscribe('opencode:b');
  const replacement = f.client();
  await replacement.request('resume', { agentId: 'opencode:b' });
  await replacement.subscribe('opencode:b');
  const wakes = [];
  replacement.on('task_available', event => wakes.push(event));
  await replacement.request('control_task_watch', { agentId: 'opencode:b', credential: ADAPTER });
  for (let i = 0; i < 80 && !wakes.length; i++) await delay(25);
  assert.equal(wakes.length, 1, 'the new receiver must not inherit the prior socket’s cached wakeup');
});

test('coordinator messages are rejected if master authority changes before send', async t => {
  const f = await fixture(t); await f.enroll();
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_master_message_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const send = messageId => f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'fixture', messageId, masterGeneration: 1 });
  assert.ok((await send('master-current')).id);
  f.advance(-1);
  await assert.rejects(send('master-clock-regressed'), /CLOCK_REGRESSION/);
  f.advance(1);
  await f.run(f.admin, undefined, 'master.revoke');
  await assert.rejects(send('master-stale'), /STALE_MASTER/);
  assert.equal(f.broker.store.messages.some(message => message.messageId === 'master-stale'), false);
  assert.ok((await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'ordinary collaboration', messageId: 'ordinary-after-revoke' })).id);
});

test('authenticated lifecycle callbacks retain their captured uncertainty epoch across recovery', async t => {
  const f = await fixture(t, true, { taskDispatch: true }); await f.enroll();
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Epoch fixture', instructions: 'No stale callback recovery', criteria: 'Retained uncertainty', requiresWorktree: false })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const task = (await f.b.request('control_task_pull', { agentId: 'opencode:b', credential: ADAPTER, channel: 'dev', cwd: '/fixture', scopeDigest: 'a'.repeat(64) })).task;
  const callback = (op, fields = {}) => f.b.request('control_adapter', { agentId: 'opencode:b', credential: ADAPTER,
    command: { id: randomUUID(), op, channel: 'dev', taskID, attempt: task.attempt, ...fields } });
  await callback('task.admission', { outcome: 'uncertain', receiptID: randomUUID(), admissionID: task.nativeAdmissionID });
  for (const outcome of ['admitted', 'unadmitted', 'uncertain']) await assert.rejects(callback('task.admission', {
    outcome, receiptID: randomUUID(), admissionID: task.nativeAdmissionID, stopGeneration: 0 }), /STALE_STOP_GENERATION/);
  assert.equal((await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0].status, 'uncertain');
  await callback('task.admission', { outcome: 'admitted', receiptID: randomUUID(), admissionID: task.nativeAdmissionID, stopGeneration: 1 });
  await assert.rejects(callback('task.started', { evidenceID: randomUUID() }), /STALE_STOP_GENERATION/);
  await callback('task.started', { evidenceID: randomUUID(), stopGeneration: 1 });
  f.advance(1000); await assert.rejects(callback('task.progress', { stopGeneration: 0 }), /STALE_STOP_GENERATION/);
  await callback('task.progress', { stopGeneration: 1 });
  await callback('task.uncertain');
  await assert.rejects(callback('task.admission', { outcome: 'admitted', receiptID: randomUUID(), admissionID: task.nativeAdmissionID, stopGeneration: 1 }), /STALE_STOP_GENERATION/);
  const held = (await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0];
  assert.equal(held.status, 'uncertain'); assert.equal(held.stopGeneration, 2); assert.equal(held.stoppedEvidence, undefined);
});

test('authenticated review uncertainty holds master acceptance, pending notices and health hints until a fresh stop receipt', async t => {
  const f = await fixture(t, true, { taskDispatch: true }); await f.enroll();
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_review_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Review uncertainty', instructions: 'Keep native permissions', criteria: 'Fresh stop before acceptance', requiresWorktree: false })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const task = (await f.b.request('control_task_pull', { agentId: 'opencode:b', credential: ADAPTER, channel: 'dev', cwd: '/fixture', scopeDigest: 'a'.repeat(64) })).task;
  const report = (op, fields) => f.b.request('control_adapter', { agentId: 'opencode:b', credential: ADAPTER,
    command: { id: randomUUID(), op, channel: 'dev', taskID, attempt: task.attempt, ...fields } });
  await report('task.admission', { outcome: 'admitted', receiptID: randomUUID(), admissionID: task.nativeAdmissionID });
  await report('task.started', { evidenceID: randomUUID() });
  const artifact = randomUUID();
  await f.b.request('control_adapter', { agentId: 'opencode:b', credential: ADAPTER, command: { id: artifact, op: 'evidence.record', channel: 'dev', entityID: taskID, kind: 'artifact', attempt: task.attempt } });
  await report('task.stopped', { evidenceID: randomUUID() });
  await f.run(f.b, 'opencode:b', 'task.report', { taskID, summary: 'Report remains pending, not native stop proof', evidence: [artifact] });
  const pending = (await f.query(f.a, 'opencode:a', 'notices')).entries.find(n => n.kind === 'task_review'); assert.equal(pending.taskID, taskID);
  await f.b.request('control_health_report', { agentId: 'opencode:b', credential: ADAPTER, report: { version: 1, adapterVersion: '0.2.0', nativeStatus: 'idle', queuedMessages: 0, blockers: 0,
    features: { control: true, tasks: true, alerts: true, managedWorktrees: false } } });
  assert.equal((await f.query(f.admin, undefined, 'health')).entries.find(h => h.agentId === 'opencode:b').status, 'observed');
  await assert.rejects(report('task.uncertain', { attempt: task.attempt + 1 }), /STALE_TASK_ATTEMPT/);
  await assert.rejects(f.c.request('control_adapter', { agentId: 'opencode:c', credential: ADAPTER,
    command: { id: randomUUID(), op: 'task.uncertain', channel: 'dev', taskID, attempt: task.attempt } }), /STALE_TASK_ATTEMPT/);
  await report('task.uncertain', {});
  const held = (await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0];
  assert.equal(held.status, 'review'); assert.equal(held.stoppedEvidence, undefined); assert.deepEqual(held.result.evidence, [artifact]);
  await assert.rejects(f.run(f.a, 'opencode:a', 'task.review', { taskID, generation, accept: true, evidenceID: artifact }), /STOP_EVIDENCE_REQUIRED/);
  await assert.rejects(f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: pending.id, receiptID: 'msg_stale_review' }), /NOTICE_CANCELLED/);
  assert.equal((await f.query(f.a, 'opencode:a', 'notices')).entries.some(n => n.kind === 'task_review'), false);
  assert.equal((await f.b.request('control_alerts', { agentId: 'opencode:b', channel: 'dev' })).tasks.uncertain, 1);
  assert.equal((await f.a.request('control_alerts', { agentId: 'opencode:a', channel: 'dev' })).tasks.reviewForYou, 0);
  const health = (await f.query(f.admin, undefined, 'health')).entries.find(h => h.agentId === 'opencode:b');
  assert.equal(health.status, 'attention'); assert.equal(health.uncertainTasks, 1); assert.equal(health.report.nativeStatus, 'idle');
  await assert.rejects(report('task.stopped', { evidenceID: randomUUID(), stopGeneration: task.stopGeneration }), /STALE_STOP_GENERATION/);
  await assert.rejects(report('task.stopped', { evidenceID: randomUUID() }), /STALE_STOP_GENERATION/);
  await report('task.stopped', { evidenceID: randomUUID(), stopGeneration: held.stopGeneration });
  const restored = (await f.query(f.a, 'opencode:a', 'notices')).entries.find(n => n.kind === 'task_review'); assert.notEqual(restored.id, pending.id);
  await f.run(f.a, 'opencode:a', 'task.review', { taskID, generation, accept: true, evidenceID: artifact });
  assert.equal((await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0].status, 'completed');
  assert.ok((await f.query(f.admin, undefined, 'incidents')).entries.some(i => i.status === 'open'));
  await report('task.uncertain', {});
  const terminal = (await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0];
  assert.equal(terminal.status, 'completed'); assert.equal(terminal.terminalHold, true);
  const lateHealth = (await f.query(f.admin, undefined, 'health')).entries.find(h => h.agentId === 'opencode:b');
  assert.equal(lateHealth.report.nativeStatus, 'idle'); assert.equal(lateHealth.status, 'attention'); assert.equal(lateHealth.uncertainTasks, 1);
  await report('task.uncertain', {});
  await assert.rejects(report('task.stopped', { evidenceID: randomUUID(), holdGeneration: terminal.terminalHoldGeneration }), /STALE_TERMINAL_HOLD/);
  assert.deepEqual(await f.b.request('control_task_pull', { agentId: 'opencode:b', credential: ADAPTER, channel: 'dev', cwd: '/fixture', scopeDigest: 'a'.repeat(64) }), { task: null, held: true });
});

test('broker derives roles and refuses caller-selected operator, adapter or scheduler authority', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(f.a, 'opencode:a', 'channel.configure', { mode: 'automatic' }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.a, 'opencode:a', 'evidence.record', { entityID: randomUUID(), kind: 'idle' }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.admin, undefined, 'action.begin', { actionID: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.admin, undefined, 'action.revalidate', { actionID: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.a, 'opencode:a', 'action.reconcile', { actionID: randomUUID(), outcome: 'succeeded', evidenceID: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.a, 'opencode:a', 'master.volunteer', { eligible: true, actor: { kind: 'operator' } }), /Invalid request schema/);
  await assert.rejects(f.a.rpc('control_query', { agentId: 'opencode:b', proof: '0'.repeat(64), channel: 'dev', view: 'channel' }), /CONTROL_ACCESS_DENIED/);
  await f.run(f.admin, undefined, 'channel.configure', {}, 'other');
  await assert.rejects(f.query(f.a, 'opencode:a', 'tasks', {}, 'other'), /CONTROL_ACCESS_DENIED/);
});

test('adapter evidence needs separate enrollment, matching session proof and the actual receiver socket', async t => {
  const f = await fixture(t);
  const command = { id: randomUUID(), op: 'evidence.record', channel: 'dev', entityID: randomUUID(), kind: 'idle' };
  await assert.rejects(f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command }), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(f.admin.request('control_enroll_adapter', { hostId: 'local', credential: HOST }), /SEPARATE_ADAPTER_CREDENTIAL_REQUIRED/);
  await f.enroll();
  const sameHost = f.client();
  await assert.rejects(sameHost.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command }), /ADAPTER_RECEIVER_REQUIRED/);
  await f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command });
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  await assert.rejects(f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER,
    command: { ...command, id: randomUUID() } }), /ADAPTER_CREDENTIAL_REQUIRED/);
});

test('authority watch closes only its opted-in receiver on credential revocation', async t => {
  const f = await fixture(t); await f.enroll();
  const watch = { agentId: 'opencode:a', credential: ADAPTER, channel: 'dev' };
  await assert.rejects(f.a.request('control_authority_watch', { ...watch, credential: 'f'.repeat(64) }), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(f.client().request('control_authority_watch', watch), /ADAPTER_RECEIVER_REQUIRED/);
  assert.deepEqual(await f.a.request('control_authority_watch', watch), { watching: true });
  const closed = once(f.a, 'disconnected');
  const untouchedSocket = f.b.socket;
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  await closed;
  assert.equal(f.b.socket, untouchedSocket);
  await f.query(f.b, 'opencode:b', 'channel');
});

test('authority watch closes when its receiver unsubscribes', async t => {
  const f = await fixture(t); await f.enroll();
  await f.a.request('control_authority_watch', { agentId: 'opencode:a', credential: ADAPTER, channel: 'dev' });
  const closed = once(f.a, 'disconnected');
  await f.a.unsubscribe('opencode:a').catch(() => {});
  await closed;
});

test('master activation requires a durable native role-notice receipt; ordinary history stays participant-only', async t => {
  const f = await fixture(t); await f.enroll();
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: 'private peer exchange', messageId: 'private' });
  const { proposalID, notice } = await f.appoint();
  assert.match(notice.text, /not a replacement system prompt/);
  const accept = () => f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  await assert.rejects(accept(), /ROLE_NOTICE_NOT_ADMITTED/);
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_role_fixture' });
  await accept();
  const generation = (await f.query()).channel.active.generation;
  assert.equal((await f.query(f.a, 'opencode:a', 'messages', { generation })).entries[0].text, 'private peer exchange');
  assert.deepEqual(await f.a.request('history', { agentId: 'opencode:a', channel: 'dev' }), []);
  await assert.rejects(f.query(f.b, 'opencode:b', 'messages', { generation }), /MASTER_MESSAGE_ACCESS_REQUIRED/);
  await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'pause_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  await delay(75);
  assert.equal(f.broker.store.deliveryPauses, undefined, 'effects must remain disabled by default');
  assert.equal((await f.admin.request('control_info')).effectsEnabled, false);
  f.advance(120000);
  await assert.rejects(f.query(f.a, 'opencode:a', 'messages', { generation }), /MASTER_MESSAGE_ACCESS_REQUIRED/);
});

test('leaving and quickly rejoining never restores the old master generation', async t => {
  const f = await fixture(t); await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_role_fixture' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  await f.a.request('leave', { agentId: 'opencode:a' });
  await f.joinAgent(f.a, 'a');
  assert.equal((await f.query()).channel.active, null);
  await assert.rejects(f.query(f.a, 'opencode:a', 'messages', { generation }), /MASTER_MESSAGE_ACCESS_REQUIRED/);
  assert.ok(!(await f.query()).channel.volunteers.includes('opencode:a'));
});

test('bounded control pagination never returns another channel or credentials', async t => {
  const f = await fixture(t); await f.enroll();
  for (let i = 0; i < 4; i++) await f.run(f.admin, undefined, 'task.create', {
    title: `task ${i}`, instructions: 'x'.repeat(12000), criteria: 'evidence', requiresWorktree: false,
  });
  const page = await f.query(f.a, 'opencode:a', 'tasks', { limit: 100 });
  assert.ok(page.entries.length > 0 && page.entries.length < 4);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 49152);
  assert.ok(!JSON.stringify(page).includes(ADAPTER));
  const next = await f.query(f.a, 'opencode:a', 'tasks', { offset: page.next });
  assert.equal(next.entries.length + page.entries.length, 4);
});

test('opt-in broker effects pause, cancel only unoffered queued messages, and resume future delivery', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 50 });
  await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_effect_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const waitAction = async id => {
    for (let i = 0; i < 100; i++) {
      const receipt = f.broker.store.effectReceipts?.[id];
      if (receipt) return receipt;
      await delay(25);
    }
    throw new Error('Broker effect did not settle');
  };
  const pause = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'pause_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  assert.equal((await waitAction(pause.commandID)).outcome, 'succeeded');
  const seen = []; f.b.on('message', message => seen.push(message));
  const queued = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'queued', messageId: 'queued' });
  const held = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'held until resume', messageId: 'held' });
  assert.deepEqual(f.broker.store.messages.find(m => m.id === queued.id).offered, []);
  await delay(75); assert.equal(seen.length, 0);
  const cancel = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'cancel_queued', target: 'opencode:b', messageID: queued.id, evidence: 'not_applicable' });
  await delay(75); assert.equal(f.broker.store.effectReceipts[cancel.commandID], undefined);
  await f.run(f.admin, undefined, 'action.approve', { actionID: cancel.commandID });
  assert.equal((await waitAction(cancel.commandID)).outcome, 'succeeded');
  const resume = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'resume_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  await waitAction(resume.commandID);
  for (let i = 0; i < 100 && !seen.some(m => m.id === held.id); i++) await delay(25);
  assert.ok(seen.some(m => m.id === held.id));
  const pushed = once(f.b, 'message');
  await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'new delivery', messageId: 'new' });
  const [message] = await pushed; assert.equal(message.text, 'new delivery'); assert.equal(message.offered, undefined);
  assert.ok(!seen.some(m => m.id === queued.id));
  assert.deepEqual((await f.admin.request('control_info')).effectOperations, ['pause_delivery', 'resume_delivery', 'cancel_queued', 'retry_delivery', 'change_wake_policy', 'remove_member']);
});

test('an offered broker message cannot be cancelled by master assertion or human approval', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 50 });
  await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_effect_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'possibly admitted', messageId: 'offered' });
  const cancel = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'cancel_queued', target: 'opencode:b', messageID: message.id, evidence: 'known_unadmitted' });
  await f.run(f.admin, undefined, 'action.approve', { actionID: cancel.commandID });
  for (let i = 0; i < 100 && !f.broker.store.effectReceipts?.[cancel.commandID]; i++) await delay(25);
  assert.equal(f.broker.store.effectReceipts[cancel.commandID].outcome, 'failed');
  assert.equal(f.broker.store.messages.find(m => m.id === message.id).cancelled['opencode:b'], undefined);
});

test('real broker restart settles a committed effect receipt without reapplying its action', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 50,
    effectHooks: { afterEffect: () => { throw new Error('Simulated loss before SQLite settlement'); } } });
  await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_restart_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const action = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'pause_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  for (let i = 0; i < 100 && !f.broker.store.effectReceipts?.[action.commandID]; i++) await delay(25);
  const receipt = f.broker.store.effectReceipts[action.commandID]; assert.ok(receipt);
  await f.broker.close();
  let reapplied = false;
  const restarted = createBroker({ directory: join(f.options.credentialDirectory, '..'), port: 0, secret: HOST, adminSecret: ADMIN,
    now: () => 1000, controlPlane: true, controlEffects: true, effectHooks: { afterEffect: () => { reapplied = true; } } });
  await once(restarted.server, 'listening');
  const admin = new ChannelClient({ token: ADMIN, url: `ws://127.0.0.1:${restarted.server.address().port}` });
  t.after(async () => { admin.close(); await restarted.close(); });
  const actions = await admin.request('control_query', { channel: 'dev', view: 'actions' });
  assert.equal(actions.entries.find(a => a.id === action.commandID).status, 'succeeded');
  assert.equal(reapplied, false); assert.deepEqual(restarted.store.effectReceipts[action.commandID], receipt);
  admin.close(); await restarted.close();
});

test('worktree grants are receiver-bound, claim-fenced and cannot be issued by model or operator tools', async t => {
  const f = await fixture(t, true, { worktreeGrants: true }); await f.enroll();
  const task = await f.run(f.admin, undefined, 'task.create', { title: 'isolated task', instructions: 'work', criteria: 'tests', requiresWorktree: true });
  await f.run(f.a, 'opencode:a', 'task.claim', { taskID: task.commandID });
  const digest = 'a'.repeat(64), preview = { id: randomUUID(), channel: 'dev', op: 'worktree.preview', taskID: task.commandID,
    from: '/project', to: '/worktree', configurationDigest: digest,
    binding: { harness: 'opencode', projectID: 'project', sourceAuthorityDigest: digest, destinationAuthorityDigest: digest,
      sources: [{ path: '/project/AGENTS.md', digest }] } };
  const adapter = command => f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command });
  await adapter(preview);
  assert.equal((await f.query(f.b, 'opencode:b', 'previews')).entries.length, 0);
  const begin = { id: randomUUID(), channel: 'dev', op: 'worktree.begin', taskID: task.commandID, previewID: preview.id,
    claimGeneration: 1, configurationDigest: digest, authorityDigest: digest };
  await assert.rejects(adapter(begin), /STALE_WORKTREE_PREVIEW/);
  await f.run(f.admin, undefined, 'worktree.approve', { taskID: task.commandID, previewID: preview.id });
  for (const kind of ['capability', 'idle']) await adapter({ id: randomUUID(), channel: 'dev', op: 'evidence.record', entityID: task.commandID, kind,
    ...(kind === 'capability' ? { sameConversationWorktree: true } : {}) });
  await assert.rejects(f.run(f.a, 'opencode:a', 'worktree.begin', { ...begin, id: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.admin.request('control_command', { command: begin }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.client().request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command: begin }), /ADAPTER_RECEIVER_REQUIRED/);
  await adapter(begin);
  const grant = (await f.query(f.a, 'opencode:a', 'transitions')).entries.find(g => g.id === begin.id);
  const authorization = { agentId: 'opencode:a', channel: 'dev', credential: ADAPTER, grant };
  const authorize = (connection = f.a, fields = {}) => connection.request('control_worktree_authorize', { ...authorization, ...fields });
  const first = await authorize(); assert.deepEqual(first.grant, grant);
  f.advance(1); assert.equal((await authorize()).checkedAt, first.checkedAt + 1, 'authorization is freshly evaluated, not a command receipt');
  f.advance(1000); // Refill the real host request bucket under the fixture clock.
  await assert.rejects(authorize(f.client()), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(authorize(f.a, { credential: 'f'.repeat(64) }), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(authorize(f.admin, { proof: 'a'.repeat(64) }), /ADAPTER_HOST_REQUIRED/);
  await assert.rejects(authorize(f.b, { agentId: 'opencode:b' }), /TRANSITION_IDENTITY_MISMATCH/);
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  await assert.rejects(authorize(), /ADAPTER_CREDENTIAL_REQUIRED/);
  await f.enroll(); assert.deepEqual((await authorize()).grant, grant);
  f.advance(1000);
  const replacement = f.client();
  await assert.rejects(replacement.subscribe('opencode:a'), /Session already has a receiver/);
  await f.a.unsubscribe('opencode:a');
  await replacement.subscribe('opencode:a');
  await assert.rejects(authorize(), /ADAPTER_RECEIVER_REQUIRED/);
  assert.deepEqual((await authorize(replacement)).grant, grant);
  await replacement.unsubscribe('opencode:a');
  await f.a.subscribe('opencode:a'); assert.deepEqual((await authorize()).grant, grant);
  for (const changes of [{ to: '/elsewhere' }, { claimGeneration: 2 }, { configurationDigest: 'b'.repeat(64) }, { previewID: randomUUID() }])
    await assert.rejects(authorize(f.a, { grant: { ...grant, ...changes } }), /STALE_WORKTREE_GRANT/);
  f.advance(10001); await assert.rejects(authorize(), /IDLE_EVIDENCE_REQUIRED/);
  assert.deepEqual((await authorize(f.a, { action: 'observe-worktree' })).grant, grant, 'recovery observation does not require stale idle evidence');
  await adapter({ id: randomUUID(), channel: 'dev', op: 'evidence.record', entityID: task.commandID, kind: 'idle' });
  assert.deepEqual((await authorize()).grant, grant);
  await assert.rejects(f.run(f.a, 'opencode:a', 'task.release', { taskID: task.commandID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  const settlement = { id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: begin.id, outcome: 'moved', actualLocation: '/elsewhere',
    configurationDigest: digest, authorityDigest: digest, receiptID: randomUUID() };
  await assert.rejects(adapter(settlement), /UNEXPECTED_WORKTREE_LOCATION/);
  await adapter({ ...settlement, actualLocation: '/worktree' });
  assert.equal((await f.query(f.a, 'opencode:a', 'transitions')).entries[0].status, 'moved');
  await assert.rejects(authorize(), /WORKTREE_TRANSITION_NOT_PENDING/);
  await assert.rejects(authorize(f.a, { action: 'observe-worktree' }), /WORKTREE_TRANSITION_NOT_PENDING/);
  assert.equal((await f.a.request('control_info')).worktreeExecutionEnabled, false);
});

test('manual resume requires agent comparison, destination receiver and an operator stop attestation', async t => {
  const f = await fixture(t, true, { worktreeGrants: true, managedRecords: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true, sweepIntervalMs: 50 }); await f.enroll();
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_preparation_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Manual move', instructions: 'fixture', criteria: 'fixture', requiresWorktree: true })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const controlClient = f.client();
  assert.equal((await controlClient.request('resume', { agentId: 'opencode:a' })).registered, true);
  let tools = new ToolSession(controlClient, { harness: 'opencode', sessionId: 'a' });
  tools.agentId = 'opencode:a'; tools.channel = 'dev';
  const previewID = (await tools.call('channel_manual_preview', { taskID, destination: '/worktree' })).commandID;
  const preview = (await f.query(f.admin, undefined, 'previews', { entityID: previewID })).entries[0];
  assert.equal(preview.manualResume, true); assert.equal(preview.from, '/project'); assert.equal(preview.binding, undefined);
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  await assert.rejects(f.b.request('control_adapter', { agentId: 'opencode:b', credential: ADAPTER, command: {
    id: randomUUID(), channel: 'dev', op: 'worktree.begin', taskID, previewID, claimGeneration: 1,
    configurationDigest: preview.configurationDigest, authorityDigest: 'a'.repeat(64),
  } }), /STALE_WORKTREE_PREVIEW/);
  const preparation = await tools.call('channel_prepare_session', { taskID, previewID, messageId: 'prepare-fixture' });
  await f.b.request('ack', { agentId: 'opencode:b', id: preparation.id });
  const record = JSON.stringify({ type: 'turnlink.session_record.v2', taskID, previewID, session: 'opencode:b', source: '/project', destination: '/worktree',
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved work; background job needs operator review' });
  const sourceClient = Object.create(f.b), sourceRequest = f.b.request.bind(f.b);
  let loseRecordReply = true;
  sourceClient.request = async (method, params) => {
    const result = await sourceRequest(method, params);
    if (method === 'send' && params.messageId === 'record-fixture' && loseRecordReply) {
      loseRecordReply = false; throw new Error('synthetic lost reply');
    }
    return result;
  };
  const sourceTools = new ToolSession(sourceClient, { harness: 'opencode', sessionId: 'b', restoreWatchesOnJoin: true });
  sourceTools.agentId = 'opencode:b'; sourceTools.channel = 'dev';
  const sendRecord = () => sourceTools.call('channel_send', { to: 'opencode:a', text: record, messageId: 'record-fixture' });
  f.advance(10000);
  await assert.rejects(sendRecord(), /synthetic lost reply/);
  f.advance(10000);
  const recordMessage = await sendRecord();
  assert.equal(recordMessage.privateRecordSaved, true);
  assert.equal(f.broker.store.messages.filter(message => message.messageId === 'record-fixture').length, 1);
  const beforeMove = await f.b.request('history', { agentId: 'opencode:b', channel: 'dev' });
  assert.equal(beforeMove.some(message => message.messageId === `turnlink-verify-${recordMessage.id}`), false);
  tools.clearSessionWatches(); controlClient.close();
  const restartedControl = f.client();
  assert.equal((await restartedControl.request('resume', { agentId: 'opencode:a' })).registered, true);
  tools = new ToolSession(restartedControl, { harness: 'opencode', sessionId: 'a', restoreWatchesOnJoin: true });
  f.advance(1000);
  await tools.call('channel_join', { harness: 'opencode', sessionId: 'a', name: 'a', role: 'full project access', channel: 'dev',
    project: { name: 'fixture', root: '/project' } });
  for (let attempt = 0; attempt < 50 && !tools.sessionWatches?.has(previewID); attempt++) { f.advance(1000); await delay(20); }
  assert.equal(tools.sessionWatches?.has(previewID), true);
  for (let attempt = 0; attempt < 50 && f.broker.store.bindings['opencode:b'].manualResume?.status !== 'armed'; attempt++) { f.advance(1000); await delay(20); }
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume?.status, 'armed');
  await f.b.unsubscribe('opencode:b');
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume.status, 'detached');
  const lifecycle = f.client(); t.after(() => lifecycle.close());
  assert.equal((await lifecycle.request('resume', { agentId: 'opencode:b' })).registered, true);
  await assert.rejects(lifecycle.subscribe('opencode:b', { manualWorktreeHost: true }), /MANUAL_WORKTREE_SESSION_UNAVAILABLE/);
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume.status, 'detached', 'worktree review must not change an in-flight manual move');
  const coordinatorRequest = restartedControl.request.bind(restartedControl);
  let comparisonSends = 0;
  restartedControl.request = async (method, params) => {
    if (method === 'send' && params.messageId === `turnlink-verify-${recordMessage.id}`) {
      comparisonSends++;
      const result = await coordinatorRequest(method, params);
      restartedControl.emit('presence', {});
      if (comparisonSends === 1) throw new Error('synthetic lost comparison reply');
      return result;
    }
    return coordinatorRequest(method, params);
  };
  const resumed = f.client();
  assert.equal((await resumed.request('resume', { agentId: 'opencode:b' })).registered, true);
  await resumed.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev',
    project: { name: 'fixture', root: '/worktree' } });
  await resumed.subscribe('opencode:b');
  let request;
  for (let attempt = 0; attempt < 50 && !request; attempt++) {
    f.advance(1000); await delay(20);
    request = (await resumed.request('history', { agentId: 'opencode:b', channel: 'dev' })).find(message => message.messageId === `turnlink-verify-${recordMessage.id}`);
  }
  assert.ok(request, 'the destination rejoin should trigger a comparison request');
  for (let attempt = 0; attempt < 50 && tools.sessionWatches?.has(previewID); attempt++) { f.advance(1000); await delay(20); }
  assert.equal(tools.sessionWatches?.has(previewID) ?? false, false, 'history resolves the lost reply');
  assert.equal(comparisonSends, 1, 'a concurrent presence event must not repeat an uncertain send');
  assert.equal(f.broker.store.messages.filter(message => message.messageId === `turnlink-verify-${recordMessage.id}`).length, 1);
  const afterRequest = new ToolSession(restartedControl, { harness: 'opencode', sessionId: 'a' });
  afterRequest.agentId = 'opencode:a'; afterRequest.channel = 'dev';
  f.advance(1000);
  await afterRequest.restoreSessionWatches();
  assert.equal(afterRequest.sessionWatches?.has(previewID) ?? false, false, 'an already queued comparison must not be repeated');
  assert.equal((await tools.call('channel_session_status', { taskID, previewID })).status, 'awaiting_report');
  const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: 'opencode:b', recordID: recordMessage.id, requestID: request.id,
    runtime: 'opencode 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'unknown', work: 'match' } };
  await resumed.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(report), messageId: 'report-fixture' });
  f.advance(1000);
  assert.equal((await tools.call('channel_session_status', { taskID, previewID })).status, 'incomplete');
  await resumed.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...report, recordID: randomUUID() }), messageId: 'invalid-report-fixture' });
  f.advance(1000);
  assert.equal((await tools.call('channel_session_status', { taskID, previewID })).status, 'invalid_report');
  const receiptID = randomUUID(), confirm = { channel: 'dev', taskID, previewID, recordID: recordMessage.id, requestID: request.id, receiptID, sourceStopped: true };
  await assert.rejects(f.admin.request('control_manual_resume_confirm', confirm), /MANUAL_RESUME_UNAVAILABLE/);
  const complete = { ...report, checks: { ...report.checks, permissions: 'match' } };
  await resumed.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(complete), messageId: 'complete-report-fixture' });
  f.advance(1000);
  const pull = () => resumed.request('control_task_pull', { agentId: 'opencode:b', credential: ADAPTER, channel: 'dev', cwd: '/worktree', scopeDigest: 'a'.repeat(64) });
  assert.equal((await pull()).task, null, 'the agent report alone cannot attest that the source was stopped');
  await assert.rejects(restartedControl.request('control_manual_resume_confirm', confirm), /MANUAL_RESUME_UNAVAILABLE/);
  const operatorReview = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
  assert.equal(operatorReview.report.status, 'reported_match');
  assert.equal(operatorReview.sourceRecord.work, 'saved work; background job needs operator review');
  await assert.rejects(f.b.request('control_manual_resume_review', { channel: 'dev', taskID, previewID }), /MANUAL_RESUME_UNAVAILABLE/);
  await resumed.request('control_task_watch', { agentId: 'opencode:b', credential: ADAPTER });
  let available = 0;
  resumed.on('task_available', ({ agentId }) => { if (agentId === 'opencode:b') available++; });
  const brokerRoot = join(f.options.credentialDirectory, '..');
  writeFileSync(join(brokerRoot, 'admin-token'), ADMIN, { mode: 0o600, flag: 'wx' });
  const selectionFile = join(brokerRoot, 'manual-selection.json');
  const selection = spawn(process.execPath, ['src/control-admin.js', 'manual-resume-select', 'dev', selectionFile], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: f.options.url, AGENT_CHANNEL_STATE_DIR: brokerRoot },
  });
  let selectionOutput = '', selectionErrors = '';
  selection.stdout.on('data', chunk => { selectionOutput += chunk; }); selection.stderr.on('data', chunk => { selectionErrors += chunk; });
  assert.equal((await once(selection, 'close'))[0], 0, selectionErrors);
  assert.equal(JSON.parse(selectionOutput).review.previewID, previewID);
  assert.equal(JSON.parse(selectionOutput).review.sourceRecord.work, 'saved work; background job needs operator review');
  assert.equal(JSON.parse(selectionOutput).guidance.step, 'confirm');
  assert.match(JSON.parse(selectionOutput).limitations.join(' '), /not independent proof/);
  const cli = spawn(process.execPath, ['src/control-admin.js', 'manual-resume-confirm-selected', selectionFile, receiptID], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: f.options.url, AGENT_CHANNEL_STATE_DIR: brokerRoot },
  });
  let output = '', errors = '';
  cli.stdout.on('data', chunk => { output += chunk; }); cli.stderr.on('data', chunk => { errors += chunk; });
  assert.equal((await once(cli, 'close'))[0], 0, errors);
  assert.match(errors, /pending external actions or background work/);
  assert.match(errors, /not independent proof/);
  assert.equal(JSON.parse(output).sourceStopEvidence, 'operator_attestation');
  for (let attempt = 0; attempt < 50 && !available; attempt++) await delay(20);
  await delay(150); // The scheduler must not duplicate the confirmation wake.
  assert.equal(available, 1, 'confirming the manual move wakes the task receiver');
  assert.equal((await f.admin.request('control_manual_resume_confirm', confirm)).receiptID, receiptID, 'the same receipt may be retried');
  const nativeMessages = [], nativeCalls = [], runtimeErrors = [], abort = new AbortController();
  t.after(() => abort.abort());
  const sessionState = { generation: 0, taskPending: true, tools: { agentId: 'opencode:b' }, controlChannel: 'dev', blocked: new Set() };
  const ctx = { agent: { get: async () => ({ data: { id: 'plan', permissions: [] } }) },
    model: { default: async () => ({ data: { id: 'fixture', providerID: 'fixture' } }) }, tool: { list: async () => [] },
    session: { wait: async () => {}, context: async () => nativeMessages, prompt: async input => {
      nativeCalls.push(input.metadata.source); nativeMessages.push({ id: input.id, type: 'user', text: input.text, metadata: input.metadata });
      if (input.metadata.source === 'turnlink-task') nativeMessages.push({ id: 'assistant_1', type: 'assistant', time: { completed: 1 }, finish: 'stop', content: [] });
      else { const data = JSON.parse(input.text.split('TASK_RESULT_DATA\n')[1]); await f.run(resumed, 'opencode:b', 'task.report', { taskID: data.taskID, evidence: data.evidence, summary: 'Manual task completed' }); }
      return { id: input.id, sessionID: 'b' };
    } } };
  const runtime = makeOpenCodeTasks({ ctx, channel: resumed, sessions: new Map([['b', sessionState]]),
    options: { tasks: true, worktreeTasks: true, credentialDirectory: f.options.credentialDirectory }, signal: abort.signal,
    ownSession: async () => ({ id: 'b', agent: 'plan', location: { directory: '/worktree' }, permissions: [] }),
    refreshBlockers: async () => true, credential: () => ADAPTER, log: error => runtimeErrors.push(error) });
  f.advance(1000); await runtime.poll('b');
  f.advance(1000); sessionState.taskPending = true; await runtime.poll('b');
  assert.deepEqual(runtimeErrors, []); assert.deepEqual(nativeCalls, ['turnlink-task', 'turnlink-task-result']);
  const dispatched = (await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0];
  assert.equal(dispatched.status, 'review');
  assert.equal(await releasedWorktreeTransition({ client: resumed, agentId: 'opencode:b', channel: 'dev', credential: ADAPTER, task: dispatched }), receiptID);
  assert.equal((await f.admin.request('control_manual_resume_confirm', confirm)).replayed, true, 'an exact receipt remains inspectable after dispatch');
  await f.run(f.a, 'opencode:a', 'task.review', { taskID, generation: 1, evidenceID: dispatched.result.evidence[0], accept: true });
  assert.equal((await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0].status, 'completed');
  const history = await resumed.request('history', { agentId: 'opencode:b', channel: 'dev' });
  assert.ok(history.some(message => message.messageId === 'prepare-fixture' && message.to === 'opencode:b' && message.text.includes('/worktree')));
  assert.equal(history.find(message => message.messageId === 'record-fixture')?.text, record);
  assert.ok(history.some(message => message.id === request.id && message.to === 'opencode:b' && message.text.includes('comparison after a manual move')));
  const workerTools = new ToolSession(resumed, { harness: 'opencode', sessionId: 'b' });
  workerTools.agentId = 'opencode:b'; workerTools.channel = 'dev';
  const older = await workerTools.call('channel_history', { channel: 'dev', limit: 1, offset: 5 });
  assert.equal(older[0]?.messageId, 'record-fixture');
  for (const message of history.filter(value => value.recipients.includes('opencode:b') && !value.delivered.includes('opencode:b')))
    await resumed.request('ack', { agentId: 'opencode:b', id: message.id });
  f.advance(1000);
  const nextTask = (await f.run(f.admin, undefined, 'task.create', { title: 'Next move', instructions: 'fixture', criteria: 'fixture', requiresWorktree: true })).commandID;
  await f.run(resumed, 'opencode:b', 'task.claim', { taskID: nextTask });
  const nextPreview = (await tools.call('channel_manual_preview', { taskID: nextTask, destination: '/worktree-next' })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID: nextTask, previewID: nextPreview });
  const nextPreparation = await tools.call('channel_prepare_session', { taskID: nextTask, previewID: nextPreview, messageId: 'next-prepare' });
  await resumed.request('ack', { agentId: 'opencode:b', id: nextPreparation.id });
  const nextRecord = { type: 'turnlink.session_record.v2', taskID: nextTask, previewID: nextPreview, session: 'opencode:b',
    source: '/worktree', destination: '/worktree-next', runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  await resumed.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(nextRecord), messageId: 'next-record' });
  for (let attempt = 0; attempt < 50 && f.broker.store.bindings['opencode:b'].manualResume?.taskID !== nextTask; attempt++) { f.advance(1000); await delay(20); }
  const binding = f.broker.store.bindings['opencode:b'];
  assert.equal(binding.manualResume.taskID, nextTask); assert.equal(binding.manualResume.status, 'armed');
  assert.equal(binding.manualResumeHistory.at(-1).receiptID, receiptID, 'the previous manual receipt remains available');
});

test('a replacement coordinator cannot orphan an existing manual observation', async t => {
  const f = await fixture(t, true, { worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true });
  await f.enroll();
  const first = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: first.notice.id, receiptID: 'msg_original_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID: first.proposalID, promptVersion: 1 });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Coordinator change', instructions: 'Preserve recovery', criteria: 'No orphan', requiresWorktree: true })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const tools = new ToolSession(f.a, { harness: 'opencode', sessionId: 'a' });
  tools.agentId = 'opencode:a'; tools.channel = 'dev';
  const previewID = (await tools.call('channel_manual_preview', { taskID, destination: '/destination' })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  const prep = await tools.call('channel_prepare_session', { taskID, previewID, messageId: 'handover-prep' });
  tools.clearSessionWatches();
  await f.b.request('ack', { agentId: 'opencode:b', id: prep.id });
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: 'opencode:b', source: '/project', destination: '/destination',
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'handover-record' });
  const arm = { agentId: 'opencode:a', channel: 'dev', taskID, previewID };
  await f.a.request('control_manual_resume_arm', arm);
  await f.b.unsubscribe('opencode:b');
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume.status, 'detached');
  await f.run(f.admin, undefined, 'master.revoke');
  await f.run(f.c, 'opencode:c', 'master.volunteer', { eligible: true });
  const next = await f.run(f.admin, undefined, 'master.appoint', { candidate: 'opencode:c' });
  const notice = (await f.query(f.c, 'opencode:c', 'notices')).entries.find(value => value.kind === 'offer' && value.entityID === next.commandID)
    || (await f.query(f.c, 'opencode:c', 'notices')).entries.find(value => value.kind === 'offer');
  await f.c.request('control_notice_ack', { agentId: 'opencode:c', credential: ADAPTER, id: notice.id, receiptID: 'msg_replacement_role' });
  await f.run(f.c, 'opencode:c', 'master.accept', { proposalID: next.commandID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  await assert.rejects(f.run(f.c, 'opencode:c', 'worktree.session_require', { generation, taskID, previewID }), /MANUAL_RESUME_COORDINATOR_HELD/);
  assert.equal((await f.query(f.admin, undefined, 'previews', { entityID: previewID })).entries[0].sessionCoordinator, 'opencode:a');
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume.status, 'detached');
  const review = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
  assert.equal(review.status, 'detached');
  await f.run(f.admin, undefined, 'master.revoke');
  const restored = await f.run(f.admin, undefined, 'master.appoint', { candidate: 'opencode:a' });
  const restoredNotice = (await f.query(f.a, 'opencode:a', 'notices')).entries.find(value => value.kind === 'offer' && value.id !== first.notice.id);
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: restoredNotice.id, receiptID: 'msg_restored_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID: restored.commandID, promptVersion: 1 });
  assert.equal((await f.a.request('control_manual_resume_status', arm)).status, 'detached');
  f.advance(5000);
  const reset = { channel: 'dev', taskID, previewID, recordID: review.recordID };
  await assert.rejects(f.admin.request('control_manual_resume_reset', reset), /MANUAL_RESUME_UNAVAILABLE/);
  await f.b.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev',
    project: { name: 'fixture', root: '/project' } });
  await f.b.subscribe('opencode:b');
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume.status, 'uncertain');
  await assert.rejects(f.c.request('control_manual_resume_reset', reset), /MANUAL_RESUME_UNAVAILABLE/);
  const brokerRoot = join(f.options.credentialDirectory, '..'), selectionFile = join(brokerRoot, 'reset-selection.json');
  writeFileSync(join(brokerRoot, 'admin-token'), ADMIN, { mode: 0o600, flag: 'wx' });
  const runCli = async args => {
    const child = spawn(process.execPath, ['src/control-admin.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: f.options.url, AGENT_CHANNEL_STATE_DIR: brokerRoot } });
    let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    assert.equal((await once(child, 'close'))[0], 0, err); return JSON.parse(out);
  };
  assert.equal((await runCli(['manual-resume-select', 'dev', selectionFile, 'b'])).review.previewID, previewID);
  assert.equal((await runCli(['manual-resume-reset-selected', selectionFile])).requiresNewPreview, true);
  await assert.rejects(f.a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_PREVIEW_RETIRED/);
  f.advance(5000);
  await f.run(f.admin, undefined, 'master.revoke');
  const replacement = await f.run(f.admin, undefined, 'master.appoint', { candidate: 'opencode:c' });
  const replacementNotice = (await f.query(f.c, 'opencode:c', 'notices')).entries.find(value => value.kind === 'offer' && value.id !== notice.id);
  await f.c.request('control_notice_ack', { agentId: 'opencode:c', credential: ADAPTER, id: replacementNotice.id, receiptID: 'msg_second_replacement_role' });
  await f.run(f.c, 'opencode:c', 'master.accept', { proposalID: replacement.commandID, promptVersion: 1 });
  f.advance(5000);
  const nextTools = new ToolSession(f.c, { harness: 'opencode', sessionId: 'c' });
  nextTools.agentId = 'opencode:c'; nextTools.channel = 'dev';
  const nextPreviewID = (await nextTools.call('channel_manual_preview', { taskID, destination: '/destination' })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID: nextPreviewID });
  const nextPrep = await nextTools.call('channel_prepare_session', { taskID, previewID: nextPreviewID, messageId: 'handover-new-prep' });
  nextTools.clearSessionWatches();
  for (const message of f.broker.store.messages.filter(value => value.recipients.includes('opencode:b') && !value.delivered.includes('opencode:b') && !value.cancelled['opencode:b']))
    await f.b.request('ack', { agentId: 'opencode:b', id: message.id });
  assert.ok(nextPrep.id);
  const nextRecord = { ...record, previewID: nextPreviewID };
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: JSON.stringify(nextRecord), messageId: 'handover-new-record' });
  assert.equal((await f.c.request('control_manual_resume_arm', { agentId: 'opencode:c', channel: 'dev', taskID, previewID: nextPreviewID })).status, 'armed');
});

for (const scenario of ['normal', 'reassigned', 'new_record', 'second_takeover']) test(`an operator can recover a completed host transfer with a new coordinator and the original record (${scenario})`, async t => {
  const reassigned = scenario === 'reassigned', newRecord = scenario === 'new_record', secondTakeover = scenario === 'second_takeover';
  const targetToken = '4'.repeat(64), targetAdapter = '5'.repeat(64);
  const hosts = [{ hostId: 'local', credential: HOST, channels: ['*'], broadcast: true },
    { hostId: 'destination', credential: targetToken, channels: ['dev'], broadcast: true }];
  const f = await fixture(t, true, { hosts, worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true });
  await f.enroll(); await f.admin.request('control_enroll_adapter', { hostId: 'destination', credential: targetAdapter });
  const first = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: first.notice.id, receiptID: 'msg_takeover_old' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID: first.proposalID, promptVersion: 1 });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Coordinator recovery', instructions: 'Resume safely', criteria: 'Preserve the record', requiresWorktree: true })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const old = new ToolSession(f.a, { harness: 'opencode', sessionId: 'a' }); old.agentId = 'opencode:a'; old.channel = 'dev';
  t.after(() => old.clearSessionWatches());
  const previewID = (await old.call('channel_manual_preview', { taskID, destination: '/destination' })).commandID;
  const recoveryRoot = join(f.options.credentialDirectory, '..'), recoverySelection = join(recoveryRoot, 'manual-takeover-selection.json');
  writeFileSync(join(recoveryRoot, 'admin-token'), ADMIN, { mode: 0o600, flag: 'wx' });
  writeFileSync(recoverySelection, JSON.stringify({ version: 1, channel: 'dev', taskID, previewID }), { mode: 0o600, flag: 'wx' });
  const runSelected = async (op, expectSuccess = true) => {
    const child = spawn(process.execPath, ['src/control-admin.js', op, recoverySelection], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: f.options.url, AGENT_CHANNEL_STATE_DIR: recoveryRoot } });
    let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    const code = (await once(child, 'close'))[0];
    if (!expectSuccess) { assert.notEqual(code, 0); return err; }
    assert.equal(code, 0, err); return JSON.parse(out);
  };
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  const prep = await old.call('channel_prepare_session', { taskID, previewID, messageId: 'takeover-prep' }); old.clearSessionWatches();
  await f.b.request('ack', { agentId: 'opencode:b', id: prep.id });
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: 'opencode:b', source: '/project', destination: '/destination',
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'takeover-original' });
  await f.a.request('control_manual_resume_arm', { agentId: 'opencode:a', channel: 'dev', taskID, previewID });
  await f.b.unsubscribe('opencode:b');
  await f.admin.request('control_manual_resume_authorize_host', { channel: 'dev', taskID, previewID, targetHostId: 'destination', transferID: randomUUID(), sourceStopped: true });
  let target = f.client(targetToken); t.after(() => target.close());
  await target.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev', project: { name: 'fixture', root: '/destination' } });
  await target.subscribe('opencode:b');
  f.advance(5000);
  await f.run(f.admin, undefined, 'master.revoke');
  assert.match(await runSelected('manual-resume-takeover-selected', false), /active coordinator/i);
  await f.run(f.c, 'opencode:c', 'master.volunteer', { eligible: true });
  const appointed = await f.run(f.admin, undefined, 'master.appoint', { candidate: 'opencode:c' });
  const notice = (await f.query(f.c, 'opencode:c', 'notices')).entries.find(value => value.kind === 'offer');
  await f.c.request('control_notice_ack', { agentId: 'opencode:c', credential: ADAPTER, id: notice.id, receiptID: 'msg_takeover_new' });
  await f.run(f.c, 'opencode:c', 'master.accept', { proposalID: appointed.commandID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  let replacement = new ToolSession(f.c, { harness: 'opencode', sessionId: 'c' }); replacement.agentId = 'opencode:c'; replacement.channel = 'dev';
  t.after(() => replacement.clearSessionWatches());
  f.advance(5000);
  const asked = await replacement.call('channel_request_session_takeover', { taskID, previewID, messageId: 'takeover-request' });
  assert.match(asked.text, /original JSON text unchanged/);
  const changed = await target.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: JSON.stringify({ ...record, work: 'changed' }), messageId: 'takeover-changed' });
  const prepareTakeover = () => f.admin.request('control_manual_resume_takeover_prepare', { channel: 'dev', taskID, previewID, nextCoordinator: 'opencode:c' });
  await assert.rejects(prepareTakeover(), /MANUAL_RESUME_UNAVAILABLE/);
  const takeover = { channel: 'dev', taskID, previewID, takeoverID: randomUUID(), previousCoordinator: 'opencode:a', nextCoordinator: 'opencode:c',
    previousRecordID: saved.id, nextRecordID: changed.id, generation };
  await assert.rejects(f.admin.request('control_manual_resume_takeover', takeover), /MANUAL_RESUME_UNAVAILABLE/);
  const copy = await target.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: JSON.stringify(record), messageId: 'takeover-copy' });
  takeover.nextRecordID = copy.id;
  f.advance(5000);
  const proposed = await prepareTakeover();
  assert.equal(proposed.previousRecordID, saved.id); assert.equal(proposed.nextRecordID, copy.id); assert.equal(proposed.generation, generation);
  await assert.rejects(f.c.request('control_manual_resume_takeover', takeover), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.run(f.admin, undefined, 'worktree.session_takeover', { generation, taskID, previewID, previousCoordinator: 'opencode:a', nextCoordinator: 'opencode:c' }), /CONTROL_OPERATION_DISABLED/);
  const apply = ControlStore.prototype.apply; let injected = false;
  ControlStore.prototype.apply = function(command, ...args) {
    if (command.op === 'worktree.session_takeover') throw new Error('synthetic failure before control commit');
    return apply.call(this, command, ...args);
  };
  t.after(() => { ControlStore.prototype.apply = apply; });
  await assert.rejects(f.admin.request('control_manual_resume_takeover', takeover), /synthetic failure before control commit/);
  ControlStore.prototype.apply = apply;
  const cancellation = { channel: 'dev', taskID, previewID, takeoverID: takeover.takeoverID };
  if (scenario === 'normal') {
    await f.run(f.admin, undefined, 'master.revoke');
    assert.equal((await f.query()).channel.active, null);
  }
  assert.equal((await runSelected('manual-resume-takeover-cancel-selected')).cancelled, true);
  assert.equal((await f.admin.request('control_manual_resume_takeover_cancel', cancellation)).replayed, true);
  await assert.rejects(f.admin.request('control_manual_resume_takeover', takeover), /MANUAL_RESUME_UNAVAILABLE/);
  if (scenario === 'normal') {
    const again = await f.run(f.admin, undefined, 'master.appoint', { candidate: 'opencode:c' });
    const fresh = (await f.query(f.c, 'opencode:c', 'notices')).entries.find(value => value.kind === 'offer' && value.id !== notice.id);
    await f.c.request('control_notice_ack', { agentId: 'opencode:c', credential: ADAPTER, id: fresh.id, receiptID: 'msg_takeover_reappointed' });
    await f.run(f.c, 'opencode:c', 'master.accept', { proposalID: again.commandID, promptVersion: 1 });
    takeover.generation = (await f.query()).channel.active.generation;
  }
  takeover.takeoverID = randomUUID(); f.advance(5000);
  ControlStore.prototype.apply = function(command, ...args) {
    const result = apply.call(this, command, ...args);
    if (!injected && command.op === 'worktree.session_takeover') { injected = true; throw new Error('synthetic lost reply after control commit'); }
    return result;
  };
  await assert.rejects(f.admin.request('control_manual_resume_takeover', takeover), /synthetic lost reply/);
  ControlStore.prototype.apply = apply;
  assert.equal(f.broker.store.bindings['opencode:b'].manualResume.pendingTakeover.id, takeover.takeoverID);
  assert.equal((await prepareTakeover()).takeoverID, takeover.takeoverID);
  await assert.rejects(f.c.request('control_manual_resume_takeover_prepare', { channel: 'dev', taskID, previewID }), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.admin.request('control_manual_resume_takeover_cancel', { ...cancellation, takeoverID: takeover.takeoverID }), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID }), /MANUAL_RESUME_UNAVAILABLE/);
  const beforeRecovery = await target.request('control_task_pull', { agentId: 'opencode:b', credential: targetAdapter, channel: 'dev', cwd: '/destination', scopeDigest: 'a'.repeat(64) });
  assert.equal(beforeRecovery.task, null, 'a partially committed takeover cannot authorize work');
  let later;
  if (newRecord) later = await target.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: JSON.stringify({ ...record, work: 'different' }), messageId: 'takeover-later-record' });
  if (reassigned) await f.run(f.admin, undefined, 'task.reassign', { taskID });
  await f.broker.close(); for (const client of [f.a, f.b, f.c, f.admin, target]) client.close();
  const restarted = createBroker({ directory: join(f.options.credentialDirectory, '..'), port: Number(new URL(f.options.url).port),
    secret: HOST, adminSecret: ADMIN, controlPlane: true, now: () => f.now, hosts,
    worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true });
  t.after(() => restarted.close()); await once(restarted.server, 'listening');
  f.broker = restarted; f.admin = f.client(ADMIN); f.c = f.client(); target = f.client(targetToken); replacement.client = f.c;
  assert.equal((await prepareTakeover()).takeoverID, takeover.takeoverID);
  if (reassigned) {
    await f.run(f.admin, undefined, 'master.revoke');
    assert.equal((await f.query(f.admin)).channel.active, null);
  }
  assert.equal((await runSelected('manual-resume-takeover-selected')).recordID, copy.id,
    'a committed takeover can finish without copied IDs after restart even while the coordinator is offline');
  if (reassigned) {
    assert.equal((await f.admin.request('control_manual_resume_takeover', takeover)).replayed, true);
    assert.equal((await prepareTakeover()).takeoverID, takeover.takeoverID);
    assert.equal((await f.query(f.admin, undefined, 'tasks', { entityID: taskID })).entries[0].status, 'open');
    return;
  }
  await f.c.request('resume', { agentId: 'opencode:c' }); await f.c.subscribe('opencode:c');
  await target.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev', project: { name: 'fixture', root: '/destination' } });
  await target.subscribe('opencode:b'); f.advance(5000);
  assert.equal((await f.admin.request('control_manual_resume_takeover', takeover)).replayed, true);
  assert.equal((await runSelected('manual-resume-takeover-selected')).replayed, true);
  assert.match(await runSelected('manual-resume-takeover-cancel-selected', false), /no pending takeover/i);
  assert.equal((await prepareTakeover()).takeoverID, takeover.takeoverID, 'a lost success response can be retried without copying an ID');
  await assert.rejects(f.admin.request('control_manual_resume_takeover', { ...takeover, nextRecordID: changed.id }), /MANUAL_RESUME_UNAVAILABLE/);
  const pull = () => target.request('control_task_pull', { agentId: 'opencode:b', credential: targetAdapter, channel: 'dev', cwd: '/destination', scopeDigest: 'a'.repeat(64) });
  assert.equal((await pull()).task, null, 'takeover alone must not authorize work');
  f.advance(5000);
  let reportRecord = copy, reportCoordinator = 'opencode:c';
  if (secondTakeover) {
    f.a = f.client(); await f.a.request('resume', { agentId: 'opencode:a' }); await f.a.subscribe('opencode:a');
    await f.run(f.admin, undefined, 'master.revoke');
    const second = await f.run(f.admin, undefined, 'master.appoint', { candidate: 'opencode:a' });
    const secondNotice = (await f.query(f.a, 'opencode:a', 'notices')).entries.find(value => value.kind === 'offer' && value.id !== first.notice.id);
    await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: secondNotice.id, receiptID: 'msg_takeover_second' });
    await f.run(f.a, 'opencode:a', 'master.accept', { proposalID: second.commandID, promptVersion: 1 });
    replacement.clearSessionWatches(); replacement = new ToolSession(f.a, { harness: 'opencode', sessionId: 'a' });
    replacement.agentId = 'opencode:a'; replacement.channel = 'dev'; f.advance(5000);
    await replacement.call('channel_request_session_takeover', { taskID, previewID, messageId: 'takeover-second-request' });
    reportRecord = await target.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'takeover-second-copy' });
    const secondProposal = await f.admin.request('control_manual_resume_takeover_prepare', { channel: 'dev', taskID, previewID, nextCoordinator: 'opencode:a' });
    assert.equal(secondProposal.nextCoordinator, 'opencode:a');
    assert.equal((await runSelected('manual-resume-takeover-selected')).coordinator, 'opencode:a');
    assert.equal((await runSelected('manual-resume-takeover-selected')).replayed, true);
    const review = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
    assert.equal(review.takeovers.length, 2); assert.equal(review.takeovers[1].previousRecordID, copy.id);
    reportCoordinator = 'opencode:a'; f.advance(5000);
  }
  if (newRecord) {
    const badRequest = await replacement.call('channel_verify_session', { taskID, previewID, messageId: 'takeover-changed-verify' });
    const badReport = { type: 'turnlink.session_report.v2', taskID, previewID, session: 'opencode:b', recordID: later.id, requestID: badRequest.id,
      runtime: 'opencode 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
    await target.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: JSON.stringify(badReport), messageId: 'takeover-changed-report' });
    const changedReview = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
    assert.equal(changedReview.report.reason, 'record_differs_from_baseline');
    assert.deepEqual(changedReview.sourceRecord, record, 'the operator sees the authorized baseline, not the later changed record');
    assert.equal((await replacement.call('channel_session_status', { taskID, previewID })).reason, 'record_differs_from_baseline');
    await assert.rejects(f.admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: later.id,
      requestID: badRequest.id, receiptID: randomUUID(), sourceStopped: true }), /MANUAL_RESUME_UNAVAILABLE/);
    assert.equal((await pull()).task, null, 'a changed baseline cannot be accepted as the original');
    reportRecord = await target.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: JSON.stringify(record), messageId: 'takeover-identical-recopy' });
    f.advance(5000);
  }
  const request = await replacement.call('channel_verify_session', { taskID, previewID, messageId: 'takeover-verify' });
  const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: 'opencode:b', recordID: reportRecord.id, requestID: request.id,
    runtime: 'opencode 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
  await target.request('send', { agentId: 'opencode:b', to: reportCoordinator, text: JSON.stringify(report), messageId: 'takeover-report' });
  assert.equal((await replacement.call('channel_session_status', { taskID, previewID })).status, 'reported_match');
  const confirm = { channel: 'dev', taskID, previewID, recordID: reportRecord.id, requestID: request.id, receiptID: randomUUID(), sourceStopped: true };
  await f.admin.request('control_manual_resume_confirm', confirm);
  if (newRecord || secondTakeover) {
    const review = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
    if (newRecord) assert.equal(review.baselineRecordID, copy.id);
    if (secondTakeover) assert.equal(review.takeovers.length, 2);
    assert.equal(review.recordID, reportRecord.id);
    assert.equal((await f.admin.request('control_manual_resume_confirm', confirm)).replayed, true);
    await restarted.close(); for (const client of [f.admin, f.a, f.c, target]) client.close();
    const again = createBroker({ directory: join(f.options.credentialDirectory, '..'), port: Number(new URL(f.options.url).port),
      secret: HOST, adminSecret: ADMIN, controlPlane: true, now: () => f.now, hosts,
      worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true });
    t.after(() => again.close()); await once(again.server, 'listening');
    f.admin = f.client(ADMIN); f.c = f.client(); target = f.client(targetToken);
    const resumedCoordinator = secondTakeover ? (f.a = f.client()) : f.c;
    await resumedCoordinator.request('resume', { agentId: reportCoordinator }); await resumedCoordinator.subscribe(reportCoordinator);
    await target.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev', project: { name: 'fixture', root: '/destination' } });
    await target.subscribe('opencode:b'); f.advance(5000);
    const restored = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
    if (newRecord) assert.equal(restored.baselineRecordID, copy.id);
    if (secondTakeover) assert.equal(restored.takeovers.length, 2);
    assert.equal(restored.recordID, reportRecord.id);
    assert.equal((await f.admin.request('control_manual_resume_confirm', confirm)).replayed, true);
  }
  assert.equal((await pull()).task?.status, 'dispatching');
});

test('manual resume rearms only from the original receiver after a broker restart', async t => {
  const settings = { worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true };
  const f = await fixture(t, true, settings); await f.enroll();
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_restart_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Recovery', instructions: 'Recover', criteria: 'No false stop', requiresWorktree: true })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const coordinator = new ToolSession(f.a, { harness: 'opencode', sessionId: 'a' });
  coordinator.agentId = 'opencode:a'; coordinator.channel = 'dev';
  const previewID = (await coordinator.call('channel_manual_preview', { taskID, destination: '/destination' })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  const preparation = await coordinator.call('channel_prepare_session', { taskID, previewID, messageId: 'restart-prepare' });
  coordinator.clearSessionWatches();
  await f.b.request('ack', { agentId: 'opencode:b', id: preparation.id });
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: 'opencode:b', source: '/project', destination: '/destination',
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const recordMessage = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'restart-record' });
  const arm = { agentId: 'opencode:a', channel: 'dev', taskID, previewID };
  f.advance(1000);
  assert.equal((await f.a.request('control_manual_resume_arm', arm)).status, 'armed');
  await f.broker.close();
  for (const client of [f.a, f.b, f.c, f.admin]) client.close();

  let now = 10000;
  const restarted = createBroker({ directory: join(f.options.credentialDirectory, '..'), port: Number(new URL(f.options.url).port), secret: HOST,
    adminSecret: ADMIN, controlPlane: true, now: () => now, ...settings });
  await once(restarted.server, 'listening');
  const a = new ChannelClient({ ...f.options, token: HOST }), b = new ChannelClient({ ...f.options, token: HOST });
  t.after(async () => { a.close(); b.close(); await restarted.close(); });
  assert.equal(restarted.store.bindings['opencode:b'].manualResume.status, 'uncertain');
  await a.request('resume', { agentId: 'opencode:a' }); await a.subscribe('opencode:a');
  await b.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev',
    project: { name: 'fixture', root: '/destination' } });
  await b.subscribe('opencode:b');
  now += 1000;
  await assert.rejects(a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal(restarted.store.bindings['opencode:b'].manualResume.status, 'uncertain');
  assert.equal((await b.request('control_task_pull', { agentId: 'opencode:b', credential: ADAPTER, channel: 'dev', cwd: '/destination',
    scopeDigest: 'a'.repeat(64) })).task, null, 'an uncertain source must not authorize task execution');
  await b.unsubscribe('opencode:b');
  await b.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev',
    project: { name: 'fixture', root: '/project' } });
  await b.subscribe('opencode:b');
  for (const message of restarted.store.messages.filter(value => value.recipients.includes('opencode:b') && !value.delivered.includes('opencode:b') && !value.cancelled['opencode:b']))
    await b.request('ack', { agentId: 'opencode:b', id: message.id });
  now += 1000;
  await assert.rejects(a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  const refreshed = await b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'restart-record-refreshed' });
  assert.equal((await a.request('control_manual_resume_arm', arm)).status, 'armed');
  assert.notEqual(refreshed.id, recordMessage.id);
  assert.equal(restarted.store.bindings['opencode:b'].manualResume.recordID, refreshed.id);
  await b.unsubscribe('opencode:b');
  assert.equal(restarted.store.bindings['opencode:b'].manualResume.status, 'detached');
});

for (const [label, destination] of [['POSIX', '/destination'], ['Windows', String.raw`C:\Users\example\AppData\Local\Temp\Turnlink Destination`]]) test(`an operator can transfer a stopped manual session to one authorized ${label} host`, async t => {
  const targetToken = '4'.repeat(64), targetAdapter = '5'.repeat(64), otherToken = '6'.repeat(64);
  const hosts = [
    { hostId: 'local', credential: HOST, channels: ['*'], broadcast: true },
    { hostId: 'destination', credential: targetToken, channels: ['dev'], broadcast: true },
    { hostId: 'other', credential: otherToken, channels: ['dev'], broadcast: true },
  ];
  const f = await fixture(t, true, { hosts, worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true });
  await f.enroll(); await f.admin.request('control_enroll_adapter', { hostId: 'destination', credential: targetAdapter });
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_cross_host_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Cross-host', instructions: 'Resume', criteria: 'Verify', requiresWorktree: true })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const coordinator = new ToolSession(f.a, { harness: 'opencode', sessionId: 'a' });
  coordinator.agentId = 'opencode:a'; coordinator.channel = 'dev';
  if (label === 'Windows') {
    await assert.rejects(coordinator.call('channel_manual_preview', { taskID, destination: String.raw`\project` }),
      error => error.code === 'MANUAL_PATH_NOT_FULLY_QUALIFIED');
    f.advance(1000);
  }
  const previewID = (await coordinator.call('channel_manual_preview', { taskID, destination })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  const preparation = await coordinator.call('channel_prepare_session', { taskID, previewID, messageId: 'cross-host-prepare' });
  coordinator.clearSessionWatches(); await f.b.request('ack', { agentId: 'opencode:b', id: preparation.id });
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: 'opencode:b', source: '/project', destination: destination,
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  const arm = { agentId: 'opencode:a', channel: 'dev', taskID, previewID }, transferID = randomUUID();
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...record, runtime: null }), messageId: 'cross-host-unknown-runtime' });
  await assert.rejects(f.a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  for (const field of ['model', 'provider', 'permissions', 'work']) {
    f.advance(1000);
    await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...record, [field]: null }), messageId: `cross-host-unknown-${field}` });
    await assert.rejects(f.a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  }
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...record, runtime: 'codex 1.0.0' }), messageId: 'cross-host-wrong-runtime' });
  await assert.rejects(f.a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...record, type: 'turnlink.session_record.v1' }), messageId: 'cross-host-legacy-record' });
  await assert.rejects(f.a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  let saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cross-host-record' });
  const authorize = { channel: 'dev', taskID, previewID, targetHostId: 'destination', transferID, sourceStopped: true };
  f.advance(1000); await f.a.request('control_manual_resume_arm', arm);
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...record, work: null }), messageId: 'cross-host-incomplete-after-arm' });
  const incompleteStatus = await f.a.request('control_manual_resume_status', arm);
  assert.equal(incompleteStatus.status, 'armed');
  assert.equal(incompleteStatus.baselineMatches, false, 'an incomplete newer record cannot match the armed baseline');
  await assert.rejects(f.a.request('control_manual_resume_arm', arm), /MANUAL_RESUME_UNAVAILABLE/);
  f.advance(1000);
  saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cross-host-restored-record' });
  await f.a.request('control_manual_resume_arm', arm);
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', authorize), /MANUAL_RESUME_UNAVAILABLE/);
  const pending = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'Finish this input before stopping', messageId: 'cross-host-pending' });
  assert.ok(f.broker.store.messages.find(message => message.id === pending.id).offered.includes('opencode:b'));
  await f.b.unsubscribe('opencode:b');
  await assert.rejects(f.a.request('control_manual_resume_authorize_host', authorize), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', authorize), /MANUAL_RESUME_UNAVAILABLE/);
  await f.b.subscribe('opencode:b'); await f.b.request('ack', { agentId: 'opencode:b', id: pending.id });
  f.advance(1000);
  saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cross-host-after-pending' });
  await f.a.request('control_manual_resume_arm', arm);
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify({ ...record, model: 'unknown' }), messageId: 'cross-host-invalid-refresh' });
  await f.b.unsubscribe('opencode:b');
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', authorize), /MANUAL_RESUME_UNAVAILABLE/);
  await f.b.subscribe('opencode:b'); f.advance(1000);
  saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cross-host-valid-refresh' });
  await f.a.request('control_manual_resume_arm', arm); await f.b.unsubscribe('opencode:b');
  for (let i = 0; i < 31; i++) { f.advance(10000); await f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op: 'master.renew', generation: 1 } }); }
  assert.ok(f.broker.store.agents['opencode:b'], 'an approved manual move must retain the stopped session while the operator prepares the destination');
  const brokerRoot = join(f.options.credentialDirectory, '..'), selectionFile = join(brokerRoot, 'manual-selection.json');
  writeFileSync(join(brokerRoot, 'admin-token'), ADMIN, { mode: 0o600, flag: 'wx' });
  const runCli = async args => {
    const child = spawn(process.execPath, ['src/control-admin.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: f.options.url, AGENT_CHANNEL_STATE_DIR: brokerRoot } });
    let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    assert.equal((await once(child, 'close'))[0], 0, err); return JSON.parse(out);
  };
  assert.equal((await runCli(['manual-resume-select', 'dev', selectionFile])).review.previewID, previewID);
  assert.equal((await runCli(['manual-resume-review-selected', selectionFile])).to, destination);
  assert.equal((await runCli(['manual-resume-authorize-selected', selectionFile, 'destination', transferID])).status, 'pending');
  await assert.rejects(f.admin.request('control_manual_resume_reset', { channel: 'dev', taskID, previewID, recordID: saved.id }), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal((await f.admin.request('control_manual_resume_authorize_host', authorize)).replayed, true);
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', { ...authorize, targetHostId: 'other' }), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.b.request('resume', { agentId: 'opencode:b' }), /transfer pending/);
  const cancel = { channel: 'dev', taskID, previewID, transferID };
  assert.equal((await runCli(['manual-resume-cancel-selected', selectionFile])).status, 'uncertain');
  assert.equal((await f.admin.request('control_manual_resume_cancel_host', cancel)).replayed, true);
  await f.b.subscribe('opencode:b'); f.advance(1000);
  saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cross-host-refreshed' });
  assert.equal((await f.a.request('control_manual_resume_arm', arm)).status, 'armed');
  await f.b.unsubscribe('opencode:b');
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', authorize), /MANUAL_RESUME_UNAVAILABLE/);
  const nextTransfer = await runCli(['manual-resume-authorize-selected', selectionFile, 'destination']);
  assert.equal(nextTransfer.status, 'pending'); assert.notEqual(nextTransfer.transferID, transferID);
  authorize.transferID = nextTransfer.transferID;
  await assert.rejects(f.admin.request('control_manual_resume_cancel_host', cancel), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal((await runCli(['manual-resume-cancel-selected', selectionFile])).status, 'uncertain');
  await f.b.subscribe('opencode:b'); f.advance(1000);
  saved = await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cross-host-refreshed-again' });
  assert.equal((await f.a.request('control_manual_resume_arm', arm)).status, 'armed');
  const observation = f.broker.store.bindings['opencode:b'].manualResume, priorCancellations = observation.hostTransferCancellations;
  observation.hostTransferCancellations = [...priorCancellations, ...Array.from({ length: 31 }, () => randomUUID())];
  const exhaustedReview = await runCli(['manual-resume-review-selected', selectionFile]);
  assert.equal(exhaustedReview.hostTransferAttemptsExhausted, true); assert.equal(exhaustedReview.guidance.step, 'reset_preview');
  await f.b.unsubscribe('opencode:b');
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', { ...authorize, transferID: randomUUID() }), /MANUAL_RESUME_UNAVAILABLE/);
  observation.hostTransferCancellations = priorCancellations;
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', { ...authorize, transferID }), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.admin.request('control_manual_resume_authorize_host', authorize), /MANUAL_RESUME_UNAVAILABLE/);
  const finalTransfer = await runCli(['manual-resume-authorize-selected', selectionFile, 'destination']);
  assert.notEqual(finalTransfer.transferID, transferID); assert.notEqual(finalTransfer.transferID, nextTransfer.transferID);
  authorize.transferID = finalTransfer.transferID;
  await assert.rejects(f.admin.request('control_manual_resume_cancel_host', cancel), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(f.admin.request('control_manual_resume_cancel_host', { ...cancel, transferID: nextTransfer.transferID }), /MANUAL_RESUME_UNAVAILABLE/);
  for (let i = 0; i < 31; i++) { f.advance(10000); await f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op: 'master.renew', generation: 1 } }); }
  assert.ok(f.broker.store.agents['opencode:b'], 'an authorized host transfer must retain its session while pending');
  let runningBroker = f.broker, restartNow = f.now, target, other;
  const joinTarget = root => ({ harness: 'opencode', sessionId: 'b', name: 'b', role: 'full project access', channel: 'dev', project: { name: 'fixture', root } });
  const brokers = [];
  t.after(async () => { for (const broker of brokers) await broker.close(); });
  const restart = async (overrides = {}) => {
    await runningBroker.close();
    for (const client of [f.a, f.b, f.c, f.admin, target, other].filter(Boolean)) client.close();
    runningBroker = createBroker({ directory: join(f.options.credentialDirectory, '..'), port: Number(new URL(f.options.url).port),
      secret: HOST, adminSecret: ADMIN, controlPlane: true, now: () => restartNow, hosts,
      worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true, ...overrides });
    brokers.push(runningBroker); await once(runningBroker.server, 'listening');
    f.advance = milliseconds => { restartNow += milliseconds; };
    f.a = f.client(); f.b = f.client(); f.admin = f.client(ADMIN);
    await f.a.request('resume', { agentId: 'opencode:a' }); await f.a.subscribe('opencode:a');
    coordinator.client = f.a;
    target = f.client(targetToken); other = f.client(otherToken);
  };
  await restart({ manualWorktreeOnly: false, worktreeTaskDispatch: false });
  await assert.rejects(target.request('join', joinTarget(destination)), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal(runningBroker.store.bindings['opencode:b'].hostId, 'local');
  await restart();
  assert.equal(runningBroker.store.bindings['opencode:b'].manualResume.hostTransfer.status, 'pending');
  assert.deepEqual(runningBroker.store.bindings['opencode:b'].manualResume.hostTransferCancellations, [transferID, nextTransfer.transferID]);
  await assert.rejects(f.admin.request('control_manual_resume_cancel_host', cancel), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal((await f.admin.request('control_manual_resume_authorize_host', authorize)).replayed, true);
  f.advance(1000);
  await assert.rejects(other.request('join', joinTarget(destination)), /MANUAL_RESUME_UNAVAILABLE/);
  await assert.rejects(target.request('join', joinTarget('/wrong')), /MANUAL_RESUME_UNAVAILABLE/);
  if (label === 'Windows') {
    await assert.rejects(target.request('join', joinTarget(destination.replaceAll('\\', '/'))), /MANUAL_RESUME_UNAVAILABLE/);
    await assert.rejects(target.request('join', joinTarget(destination.toLowerCase())), /MANUAL_RESUME_UNAVAILABLE/);
  }
  const copiedProof = sessionProof('local', 'opencode:b', f.options.credentialDirectory, false);
  await assert.rejects(target.rpc('join', { ...joinTarget(destination), proof: copiedProof }), /MANUAL_RESUME_UNAVAILABLE/);
  const targetProof = sessionProof('destination', 'opencode:b', f.options.credentialDirectory, false);
  await assert.rejects(target.rpc('subscribe', { agentId: 'opencode:b', proof: targetProof }), /MANUAL_RESUME_JOIN_REQUIRED/);
  assert.equal(runningBroker.store.bindings['opencode:b'].hostId, 'local');
  assert.equal((await target.request('join', joinTarget(destination))).agent.hostId, 'destination');
  const transferredProofHash = runningBroker.store.bindings['opencode:b'].proofHash;
  assert.equal((await target.request('join', joinTarget(destination))).agent.hostId, 'destination');
  assert.equal(runningBroker.store.bindings['opencode:b'].proofHash, transferredProofHash, 'an exact join retry must not rotate the proof again');
  await target.subscribe('opencode:b');
  assert.equal(runningBroker.store.bindings['opencode:b'].manualResume.hostTransfer.status, 'completed');
  await restart();
  assert.equal(runningBroker.store.bindings['opencode:b'].manualResume.hostTransfer.status, 'completed');
  const proofFile = join(f.options.credentialDirectory, digest('destination'), `${digest('opencode:b')}.key`);
  const backupFile = `${proofFile}.synthetic-backup`;
  renameSync(proofFile, backupFile);
  writeFileSync(proofFile, 'incomplete', { mode: 0o600, flag: 'wx' });
  await assert.rejects(target.request('join', joinTarget(destination)), /Credentials must be/);
  unlinkSync(proofFile);
  await assert.rejects(target.request('join', joinTarget(destination)), /Session ownership denied/);
  assert.equal(runningBroker.store.bindings['opencode:b'].proofHash, transferredProofHash, 'a missing or partial destination proof cannot replace the stored owner');
  unlinkSync(proofFile); renameSync(backupFile, proofFile);
  assert.equal((await target.request('join', joinTarget(destination))).agent.hostId, 'destination');
  await target.subscribe('opencode:b');
  assert.equal((await f.admin.request('control_manual_resume_authorize_host', authorize)).status, 'completed');
  await assert.rejects(f.admin.request('control_manual_resume_cancel_host', { ...cancel, transferID: authorize.transferID }), /MANUAL_RESUME_UNAVAILABLE/);
  assert.ok((await target.request('history', { agentId: 'opencode:b', channel: 'dev' })).some(message => message.id === saved.id));
  await assert.rejects(f.b.request('join', joinTarget('/project')), /Session ownership denied/);
  f.advance(1000);
  const pull = () => target.request('control_task_pull', { agentId: 'opencode:b', credential: targetAdapter, channel: 'dev', cwd: destination, scopeDigest: 'a'.repeat(64) });
  assert.equal((await pull()).task, null, 'host transfer alone does not authorize the task');
  // The original coordinator has restarted after ownership moved. Restore its
  // watch from retained history and require it to ask the destination itself.
  t.after(() => coordinator.clearSessionWatches());
  await coordinator.restoreSessionWatches();
  let request;
  for (let attempt = 0; attempt < 100 && !request; attempt++) {
    request = runningBroker.store.messages.find(message => message.from.agentId === 'opencode:a' && message.to === 'opencode:b' &&
      message.text.startsWith('Turnlink requests a session comparison after a manual move.') && message.text.includes(previewID));
    if (!request) { f.advance(1000); await delay(20); }
  }
  assert.ok(request, 'the restored coordinator requests a destination comparison');
  assert.equal((await pull()).task, null, 'restoring the watch alone does not authorize the task');
  const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: 'opencode:b', recordID: saved.id, requestID: request.id,
    runtime: 'opencode 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
  report.checks.runtime = 'different'; report.runtime = 'opencode 2.0.0';
  await target.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(report), messageId: 'cross-host-version-differs' });
  await assert.rejects(f.admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: saved.id, requestID: request.id,
    receiptID: randomUUID(), sourceStopped: true }), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal((await pull()).task, null);
  report.checks.runtime = 'match';
  await target.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(report), messageId: 'cross-host-version-false-match' });
  const mismatchReview = await f.admin.request('control_manual_resume_review', { channel: 'dev', taskID, previewID });
  assert.equal(mismatchReview.report.reason, 'runtime_values_do_not_match');
  assert.deepEqual(mismatchReview.report.runtime, { source: 'opencode 1.0.0', destination: 'opencode 2.0.0' });
  await assert.rejects(f.admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: saved.id, requestID: request.id,
    receiptID: randomUUID(), sourceStopped: true }), /MANUAL_RESUME_UNAVAILABLE/);
  report.runtime = 'OpenCode v1.0.0';
  await target.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(report), messageId: 'cross-host-report' });
  f.advance(1000);
  await f.admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: saved.id, requestID: request.id,
    receiptID: randomUUID(), sourceStopped: true });
  assert.equal((await pull()).task?.status, 'dispatching');
});

test('a pending host transfer can be cancelled after the task is reassigned', async t => {
  const targetToken = '4'.repeat(64), hosts = [
    { hostId: 'local', credential: HOST, channels: ['*'], broadcast: true },
    { hostId: 'destination', credential: targetToken, channels: ['dev'], broadcast: true },
  ];
  const f = await fixture(t, true, { hosts, worktreeGrants: true, manualWorktreeOnly: true, taskDispatch: true, worktreeTaskDispatch: true });
  await f.enroll();
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_cancel_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Reassign', instructions: 'Fixture', criteria: 'Safe cancel', requiresWorktree: true })).commandID;
  await f.run(f.b, 'opencode:b', 'task.claim', { taskID });
  const coordinator = new ToolSession(f.a, { harness: 'opencode', sessionId: 'a' });
  coordinator.agentId = 'opencode:a'; coordinator.channel = 'dev';
  const previewID = (await coordinator.call('channel_manual_preview', { taskID, destination: '/destination' })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  const preparation = await coordinator.call('channel_prepare_session', { taskID, previewID, messageId: 'cancel-prepare' });
  coordinator.clearSessionWatches(); await f.b.request('ack', { agentId: 'opencode:b', id: preparation.id });
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: 'opencode:b', source: '/project', destination: '/destination',
    runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'saved' };
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:a', text: JSON.stringify(record), messageId: 'cancel-record' });
  f.advance(1000);
  await f.a.request('control_manual_resume_arm', { agentId: 'opencode:a', channel: 'dev', taskID, previewID });
  await f.b.unsubscribe('opencode:b');
  const transferID = randomUUID(), host = { channel: 'dev', taskID, previewID, transferID };
  await f.admin.request('control_manual_resume_authorize_host', { ...host, targetHostId: 'destination', sourceStopped: true });
  await f.run(f.a, 'opencode:a', 'task.reassign', { taskID, generation: 1 });
  const target = f.client(targetToken);
  await assert.rejects(target.request('join', { harness: 'opencode', sessionId: 'b', name: 'b', role: 'fixture', channel: 'dev',
    project: { name: 'fixture', root: '/destination' } }), /MANUAL_RESUME_UNAVAILABLE/);
  assert.equal((await f.admin.request('control_manual_resume_cancel_host', host)).status, 'uncertain');
  assert.equal((await f.b.request('resume', { agentId: 'opencode:b' })).registered, true);
  assert.equal(f.broker.store.bindings['opencode:b'].hostId, 'local');
  f.advance(300001); f.broker.sweep();
  assert.equal(f.broker.store.agents['opencode:b'], undefined, 'a cancelled transfer with no current claim may expire normally');
});

test('uncertain worktree recovery observation remains receiver-bound and cannot authorize movement', async t => {
  const f = await fixture(t, true, { worktreeGrants: true }); await f.enroll();
  const task = await f.run(f.admin, undefined, 'task.create', { title: 'recovery', instructions: 'inspect', criteria: 'hold', requiresWorktree: true });
  await f.run(f.a, 'opencode:a', 'task.claim', { taskID: task.commandID });
  const digest = 'a'.repeat(64), preview = { id: randomUUID(), channel: 'dev', op: 'worktree.preview', taskID: task.commandID,
    from: '/project', to: '/worktree', configurationDigest: digest,
    binding: { harness: 'opencode', projectID: 'project', sourceAuthorityDigest: digest, destinationAuthorityDigest: digest,
      sources: [{ path: '/project/AGENTS.md', digest }] } };
  const adapter = command => f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command });
  await adapter(preview); await f.run(f.admin, undefined, 'worktree.approve', { taskID: task.commandID, previewID: preview.id });
  for (const kind of ['capability', 'idle']) await adapter({ id: randomUUID(), channel: 'dev', op: 'evidence.record', entityID: task.commandID, kind,
    ...(kind === 'capability' ? { sameConversationWorktree: true } : {}) });
  const begin = { id: randomUUID(), channel: 'dev', op: 'worktree.begin', taskID: task.commandID, previewID: preview.id,
    claimGeneration: 1, configurationDigest: digest, authorityDigest: digest };
  await adapter(begin);
  const original = (await f.query(f.a, 'opencode:a', 'transitions')).entries.find(g => g.id === begin.id);
  await adapter({ id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: begin.id, outcome: 'uncertain',
    actualLocation: '/project', configurationDigest: digest, authorityDigest: digest, receiptID: randomUUID() });
  const grant = (await f.query(f.a, 'opencode:a', 'transitions')).entries.find(g => g.id === begin.id);
  const params = { agentId: 'opencode:a', channel: 'dev', credential: ADAPTER, grant, action: 'observe-worktree' };
  await assert.rejects(f.a.request('control_worktree_authorize', { ...params, grant: original }), /STALE_WORKTREE_GRANT/);
  await assert.rejects(f.client().request('control_worktree_authorize', params), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...params, credential: 'f'.repeat(64) }), /ADAPTER_CREDENTIAL_REQUIRED/);
  assert.deepEqual((await f.a.request('control_worktree_authorize', params)).grant, grant);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...params, action: undefined }), /WORKTREE_TRANSITION_NOT_PENDING/);
  assert.equal((await f.query(f.a, 'opencode:a', 'transitions')).entries.find(g => g.id === begin.id).status, 'uncertain');
  assert.equal((await f.a.request('control_info')).worktreeExecutionEnabled, false);
});

test('worktree grant transport is disabled by default, including for enrolled adapters', async t => {
  const f = await fixture(t); await f.enroll();
  await assert.rejects(f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command: { id: randomUUID(), channel: 'dev',
    op: 'worktree.begin', taskID: randomUUID(), previewID: randomUUID(), claimGeneration: 1,
    configurationDigest: 'a'.repeat(64), authorityDigest: 'a'.repeat(64) } }), /WORKTREE_GRANTS_DISABLED/);
  await assert.rejects(f.a.request('control_worktree_authorize', { agentId: 'opencode:a', channel: 'dev', credential: ADAPTER, grant: {} }), /WORKTREE_GRANTS_DISABLED/);
});

test('receiver-authenticated recovery pulls bind retry evidence and expose current wake policy', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 20 }); await f.enroll();
  const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_recovery_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const policy = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'change_wake_policy', target: 'opencode:b', evidence: 'not_applicable', wakePolicy: 'queue' });
  for (let i = 0; i < 100 && !f.broker.store.effectReceipts?.[policy.commandID]; i++) await delay(10);
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'recovery', messageId: 'recovery' });
  const evidenceID = randomUUID();
  await f.b.request('control_adapter', { agentId: 'opencode:b', credential: ADAPTER, command: { id: evidenceID, op: 'evidence.record', channel: 'dev', entityID: message.id, kind: 'native_idempotent', admissionID: 'msg_fixture_recovery' } });
  const action = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'retry_delivery', target: 'opencode:b', evidence: 'native_idempotent', messageID: message.id, evidenceID, admissionID: 'msg_fixture_recovery' });
  for (let i = 0; i < 100 && !f.broker.store.effectReceipts?.[action.commandID]; i++) await delay(10);
  await assert.rejects(f.a.request('control_delivery_pull', { agentId: 'opencode:b', credential: ADAPTER, messageID: message.id }), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.b.request('control_delivery_pull', { agentId: 'opencode:b', credential: '9'.repeat(64), messageID: message.id }), /ADAPTER_CREDENTIAL_REQUIRED/);
  const grant = await f.b.request('control_delivery_pull', { agentId: 'opencode:b', credential: ADAPTER, messageID: message.id });
  assert.equal(grant.policy, 'queue'); assert.equal(grant.retry.id, action.commandID); assert.equal(grant.retry.admissionID, 'msg_fixture_recovery');
  f.broker.store.messages.find(m => m.id === message.id).cancelled['opencode:b'] = 'released';
  assert.equal((await f.b.request('control_delivery_pull', { agentId: 'opencode:b', credential: ADAPTER, messageID: message.id })).retry, null);
  delete f.broker.store.messages.find(m => m.id === message.id).cancelled['opencode:b'];
  await f.b.request('control_delivery_finish', { agentId: 'opencode:b', credential: ADAPTER, actionID: action.commandID, outcome: 'admitted', admissionID: 'msg_fixture_recovery' });
  assert.equal(f.broker.store.deliveryRetries[action.commandID].outcome, 'admitted');
  assert.equal((await f.b.request('control_delivery_pull', { agentId: 'opencode:b', credential: ADAPTER, messageID: message.id })).retry, null);
  const record = (await f.query(f.admin, undefined, 'evidence')).entries.filter(e => e.entityID === message.id).at(-1);
  assert.equal(record.kind, 'admitted'); assert.equal(record.admissionID, 'msg_fixture_recovery');
  // Reconstruct the crash window after SQLite native evidence committed and before the legacy result persisted.
  delete f.broker.store.deliveryRetries[action.commandID].outcome;
  delete f.broker.store.deliveryRetries[action.commandID].evidenceID;
  delete f.broker.store.deliveryRetries[action.commandID].admissionID;
  await assert.rejects(f.b.request('control_delivery_finish', { agentId: 'opencode:b', credential: ADAPTER, actionID: action.commandID, outcome: 'uncertain', admissionID: 'msg_fixture_recovery' }), /EFFECT_RECEIPT_CONFLICT/);
  await f.b.request('control_delivery_pull', { agentId: 'opencode:b', credential: ADAPTER, messageID: message.id });
  assert.equal(f.broker.store.deliveryRetries[action.commandID].outcome, 'admitted');
  assert.equal(f.broker.store.deliveryRetries[action.commandID].evidenceID, record.id);
});

test('provider-establishment grants are receiver-authenticated, separately scoped and never movement readiness', async t => {
  const f = await fixture(t, true, { worktreeGrants: true }); await f.enroll();
  const sessionId = randomUUID(), agentId = `codex:${sessionId}`;
  await f.a.request('join', { harness: 'codex', sessionId, name: 'provider-context', role: 'contract fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
  await f.a.subscribe(agentId);
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Context only', instructions: 'No movement', criteria: 'Scoped approval' })).commandID;
  await f.run(f.a, agentId, 'task.claim', { taskID });
  const plan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: randomUUID(), agentId, reservation: { generation: randomUUID(), revision: 1 },
    from: '/source', to: '/destination', providerID: 'selected-provider', family: 'configured', digest: 'a'.repeat(64) };
  const adapter = (op, fields) => f.a.request('control_adapter', { agentId, credential: ADAPTER, command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  const previewID = (await adapter('worktree.preview', { taskID, purpose: 'establish-provider', providerPlan: plan, from: plan.from, to: plan.to, configurationDigest: plan.digest })).commandID;
  const begin = { taskID, previewID, claimGeneration: 1, configurationDigest: plan.digest, purpose: 'establish-provider' };
  await assert.rejects(adapter('worktree.begin', begin), /STALE_WORKTREE_PREVIEW/);
  await assert.rejects(f.run(f.a, agentId, 'worktree.approve', { taskID, previewID }), /CONTROL_OPERATION_DISABLED/);
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  await adapter('evidence.record', { entityID: taskID, kind: 'capability', sameConversationWorktree: false, nativeProviderFactory: true });
  await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  const id = (await adapter('worktree.begin', begin)).commandID;
  const grant = (await f.query(f.a, agentId, 'transitions')).entries.find(g => g.id === id);
  const authorization = { agentId, channel: 'dev', credential: ADAPTER, grant };
  assert.deepEqual((await f.a.request('control_worktree_authorize', authorization)).grant, grant);
  await assert.rejects(f.client().request('control_worktree_authorize', authorization), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(adapter('worktree.settle', { transitionID: id, outcome: 'moved', actualLocation: plan.to,
    configurationDigest: plan.digest, authorityDigest: 'a'.repeat(64), receiptID: randomUUID() }), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  const resourceReceipt = { transitionID: id, planID: plan.id, reservation: plan.reservation, resourceID: randomUUID(), processGeneration: plan.processGeneration, kind: 'provider_factory', phase: 'constructed' };
  await adapter('worktree.settle', { transitionID: id, purpose: 'establish-provider', outcome: 'established', actualLocation: plan.from,
    configurationDigest: plan.digest, receiptID: randomUUID(), resourceReceipt });
  await assert.rejects(f.run(f.a, agentId, 'task.release', { taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  const info = await f.a.request('control_info');
  assert.equal(info.providerEstablishmentGrantsEnabled, true); assert.equal(info.providerEstablishmentExecutionEnabled, false); assert.equal(info.worktreeExecutionEnabled, false);
});

for (const modelApproval of [false, true]) test(`source shutdown scopes require explicit approval and the enrolled receiver: model=${modelApproval}`, async t => {
  const f = await fixture(t, true, { worktreeGrants: true }); await f.enroll();
  const sessionId = randomUUID(), agentId = `codex:${sessionId}`;
  await f.a.request('join', { harness: 'codex', sessionId, name: 'source-close', role: 'contract fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
  await f.a.subscribe(agentId);
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'Source shutdown', instructions: 'Scoped effect', criteria: 'Exact approval' })).commandID;
  await f.run(f.a, agentId, 'task.claim', { taskID });
  const reservation = { generation: randomUUID(), revision: 1 }, processGeneration = randomUUID();
  const adapter = (op, fields) => f.a.request('control_adapter', { agentId, credential: ADAPTER, command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  const providerPlan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration, agentId, reservation,
    from: '/source', to: '/destination', providerID: 'fixture', family: 'configured', digest: 'b'.repeat(64) };
  const mcpPlan = { id: randomUUID(), kind: 'mcp_runtime', harness: 'codex', processGeneration, agentId, reservation,
    from: '/source', to: '/destination', digest: 'a'.repeat(64), effects: { processes: true, network: true, credentials: true,
      filesystem: true, plugins: true, bindingCapture: true, pluginCapture: true, skillCapture: true, stepPreparation: true } };
  async function establish(plan, purpose) {
    await adapter('evidence.record', { entityID: taskID, kind: 'capability', nativeMcpRuntime: true, nativeProviderFactory: true });
    await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
    const previewID = (await adapter('worktree.preview', { taskID, from: plan.from, to: plan.to,
      configurationDigest: plan.digest, purpose, ...(purpose === 'establish-mcp' ? { mcpPlan: plan } : { providerPlan: plan }) })).commandID;
    await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
    const id = (await adapter('worktree.begin', { taskID, previewID, claimGeneration: 1, configurationDigest: plan.digest, purpose })).commandID;
    const resource = { transitionID: id, planID: plan.id, reservation, resourceID: randomUUID(), processGeneration,
      kind: plan.kind, phase: 'constructed' };
    await adapter('worktree.settle', { transitionID: id, purpose, outcome: 'established', actualLocation: plan.from,
      configurationDigest: plan.digest, receiptID: randomUUID(), resourceReceipt: resource });
    f.advance(1000); return { id, resource };
  }
  const provider = await establish(providerPlan, 'establish-provider');
  const mcp = await establish(mcpPlan, 'establish-mcp');
  await adapter('evidence.record', { entityID: taskID, kind: 'capability', nativeMcpRuntime: true, nativeModelShutdown: true, sameConversationWorktree: true });
  await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  const authority = 'c'.repeat(64), binding = { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authority,
    destinationAuthorityDigest: authority, sources: [{ path: '/source/config', digest: authority }] };
  const destinationOwners = { mcpTransitionID: mcp.id, providerTransitionID: provider.id,
    mcpResourceID: mcp.resource.resourceID, providerResourceID: provider.resource.resourceID, stepID: randomUUID() };
  const previewID = (await adapter('worktree.preview', { taskID, from: '/source', to: '/destination', configurationDigest: authority,
    binding, destinationOwners, sourceMcpShutdown: true, ...(modelApproval ? { sourceModelShutdown: true } : {}) })).commandID;
  const begin = { taskID, previewID, claimGeneration: 1, configurationDigest: authority, authorityDigest: authority };
  await assert.rejects(adapter('worktree.begin', begin), /STALE_WORKTREE_PREVIEW/);
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  const id = (await adapter('worktree.begin', begin)).commandID;
  const grant = (await f.query(f.a, agentId, 'transitions')).entries.find(value => value.id === id);
  const request = { agentId, channel: 'dev', credential: ADAPTER, grant, action: 'shutdown-source-mcp' };
  f.advance(1000);
  assert.deepEqual((await f.a.request('control_worktree_authorize', request)).grant, grant);
  await assert.rejects(f.client().request('control_worktree_authorize', request), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...request, credential: 'f'.repeat(64) }), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...request, grant: { ...grant, sourceMcpShutdown: undefined, sourceModelShutdown: undefined } }), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.deepEqual((await f.a.request('control_worktree_authorize', { ...request, action: 'observe-source-mcp-shutdown' })).grant, grant);
  const modelRequest = { ...request, action: 'shutdown-source-model' };
  if (modelApproval) {
    assert.deepEqual((await f.a.request('control_worktree_authorize', modelRequest)).grant, grant);
    await assert.rejects(f.client().request('control_worktree_authorize', modelRequest), /ADAPTER_RECEIVER_REQUIRED/);
    await assert.rejects(f.a.request('control_worktree_authorize', { ...modelRequest, grant: { ...grant, sourceModelShutdown: undefined } }), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  } else await assert.rejects(f.a.request('control_worktree_authorize', modelRequest), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
});

test('MCP establishment grant requires the enrolled receiver and stays distinct from movement', async t => {
  let verifiedReceipt, verifications = 0, leaseMode = 'valid', leaseChecks = 0, leaseReleases = 0, finishLate;
  const f = await fixture(t, true, { worktreeGrants: true, mcpCleanupVerifier: async () => {
    verifications++;
    if (!verifiedReceipt) return verifiedReceipt;
    if (leaseMode === 'late') await new Promise(resolve => { finishLate = resolve; });
    const proof = structuredClone(verifiedReceipt);
    if (leaseMode !== 'missing') Object.defineProperty(proof, codexVerifierLease, { value: {
      check() { leaseChecks++; if (leaseMode === 'expired') throw new Error('lease lost'); if (leaseMode === 'async') return Promise.resolve(); if (leaseMode === 'false') return false; },
      release() { leaseReleases++; },
    } });
    return proof;
  } }); await f.enroll();
  const sessionId = randomUUID(), agentId = `codex:${sessionId}`;
  await f.a.request('join', { harness: 'codex', sessionId, name: 'mcp-context', role: 'contract fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
  await f.a.subscribe(agentId);
  const taskID = (await f.run(f.admin, undefined, 'task.create', { title: 'MCP target', instructions: 'No movement', criteria: 'Scoped approval' })).commandID;
  await f.run(f.a, agentId, 'task.claim', { taskID });
  const plan = { id: randomUUID(), kind: 'mcp_runtime', harness: 'codex', processGeneration: randomUUID(), agentId,
    reservation: { generation: randomUUID(), revision: 1 }, from: '/source', to: '/destination', digest: 'a'.repeat(64),
    effects: { processes: true, network: true, credentials: true, filesystem: true, plugins: true,
      bindingCapture: true, pluginCapture: true, skillCapture: true, stepPreparation: true } };
  const adapter = (op, fields) => f.a.request('control_adapter', { agentId, credential: ADAPTER, command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  const previewID = (await adapter('worktree.preview', { taskID, purpose: 'establish-mcp', mcpPlan: plan, from: plan.from, to: plan.to, configurationDigest: plan.digest })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID });
  await adapter('evidence.record', { entityID: taskID, kind: 'capability', nativeMcpRuntime: true });
  await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  const id = (await adapter('worktree.begin', { taskID, previewID, claimGeneration: 1, configurationDigest: plan.digest, purpose: 'establish-mcp' })).commandID;
  const grant = (await f.query(f.a, agentId, 'transitions')).entries.find(g => g.id === id);
  const authorization = { agentId, channel: 'dev', credential: ADAPTER, grant };
  assert.deepEqual((await f.a.request('control_worktree_authorize', authorization)).grant, grant);
  await assert.rejects(f.client().request('control_worktree_authorize', authorization), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...authorization, action: 'observe-provider' }), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  const resourceReceipt = { transitionID: id, planID: plan.id, reservation: plan.reservation, resourceID: randomUUID(), processGeneration: plan.processGeneration, kind: 'mcp_runtime', phase: 'constructed' };
  await adapter('worktree.settle', { transitionID: id, purpose: 'establish-mcp', outcome: 'established', actualLocation: plan.from,
    configurationDigest: plan.digest, receiptID: randomUUID(), resourceReceipt });
  f.advance(1000); // Refill the broker's per-host request bucket for the additional owner checks.
  const providerPlan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: plan.processGeneration,
    agentId, reservation: plan.reservation, from: plan.from, to: plan.to, providerID: 'fixture', family: 'configured', digest: 'b'.repeat(64) };
  const providerPreview = (await adapter('worktree.preview', { taskID, purpose: 'establish-provider', providerPlan,
    from: plan.from, to: plan.to, configurationDigest: providerPlan.digest })).commandID;
  await f.run(f.admin, undefined, 'worktree.approve', { taskID, previewID: providerPreview });
  await adapter('evidence.record', { entityID: taskID, kind: 'capability', nativeProviderFactory: true });
  await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  const providerID = (await adapter('worktree.begin', { taskID, previewID: providerPreview, claimGeneration: 1,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider' })).commandID;
  const providerReceipt = { transitionID: providerID, planID: providerPlan.id, reservation: plan.reservation,
    resourceID: randomUUID(), processGeneration: plan.processGeneration, kind: 'provider_factory', phase: 'constructed' };
  await adapter('worktree.settle', { transitionID: providerID, purpose: 'establish-provider', outcome: 'established',
    actualLocation: plan.from, configurationDigest: providerPlan.digest, receiptID: randomUUID(), resourceReceipt: providerReceipt });
  const owners = (await f.query(f.a, agentId, 'transitions')).entries;
  const mcpOwner = owners.find(value => value.id === id), providerOwner = owners.find(value => value.id === providerID);
  const observe = { agentId, channel: 'dev', credential: ADAPTER, action: 'observe-destination-owners', grant: mcpOwner, peerGrant: providerOwner };
  const observed = await f.a.request('control_worktree_authorize', observe);
  assert.deepEqual(observed.mcpGrant, mcpOwner); assert.deepEqual(observed.providerGrant, providerOwner);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...observe, action: 'prepare-destination-step' }), /WORKTREE_CAPABILITY_REQUIRED/);
  await adapter('evidence.record', { entityID: taskID, kind: 'capability', nativeMcpRuntime: true, nativeProviderFactory: true });
  await adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  const step = await f.a.request('control_worktree_authorize', { ...observe, action: 'prepare-destination-step' });
  assert.equal(step.purpose, 'prepare-destination-step'); assert.deepEqual(step.mcpGrant, mcpOwner); assert.deepEqual(step.providerGrant, providerOwner);
  const recoveredOwners = await f.a.request('control_worktree_authorize', { ...observe, action: 'observe-destination-step' });
  assert.deepEqual(recoveredOwners.mcpGrant, mcpOwner); assert.deepEqual(recoveredOwners.providerGrant, providerOwner);
  f.advance(1000);
  const disposal = await f.a.request('control_worktree_authorize', { ...observe, action: 'dispose-destination-step' });
  assert.equal(disposal.purpose, 'dispose-destination-step'); assert.deepEqual(disposal.mcpGrant, mcpOwner); assert.deepEqual(disposal.providerGrant, providerOwner);
  await assert.rejects(f.client().request('control_worktree_authorize', { ...observe, action: 'dispose-destination-step' }), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.client().request('control_worktree_authorize', { ...observe, action: 'observe-destination-step' }), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.client().request('control_worktree_authorize', observe), /ADAPTER_RECEIVER_REQUIRED/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...observe, peerGrant: { ...providerOwner,
    resourceReceipt: { ...providerReceipt, resourceID: randomUUID() } } }), /STALE_WORKTREE_GRANT/);
  f.advance(1000); // Refill the host bucket before testing owner cleanup and recovery refusal.
  const journalRoot = privateTemp(join(tmpdir(), 'turnlink-broker-disposal-'));
  t.after(() => rmSync(journalRoot, { recursive: true, force: true }));
  const journal = new CodexResourceJournal(f.a.hostId, agentId, journalRoot);
  const addOwner = established => {
    const { resourceReceipt: receipt, settledAt: _settledAt, actualLocation: _actualLocation, receiptID, ...rest } = established;
    const grant = { ...rest, status: 'prepared' }, selected = grant.mcpPlan ?? grant.providerPlan;
    const base = { taskID, claimGeneration: 1, previewID: grant.previewID, transitionID: grant.id, receiptID,
      channel: 'dev', plan: selected, phase: 'previewing' };
    const settlement = { id: receiptID, op: 'worktree.settle', channel: 'dev', transitionID: grant.id, purpose: grant.purpose,
      outcome: 'established', actualLocation: plan.from, configurationDigest: selected.digest, receiptID, resourceReceipt: receipt };
    journal.put(base); journal.put({ ...base, phase: 'previewed' }); journal.put({ ...base, phase: 'authorizing' });
    journal.put({ ...base, phase: 'prepared', grant }); journal.put({ ...base, phase: 'dispatching', grant });
    journal.put({ ...base, phase: 'observed', grant, receipt, settlement }); journal.put({ ...base, phase: 'settled', grant, receipt, settlement });
  };
  await journal.exclusive(async () => { addOwner(mcpOwner); addOwner(providerOwner); });
  let retained, disposed, acknowledgements = 0, disposalCalls = 0;
  const native = { supportsMcpStepPreparation: true, supportsMcpStepDisposal: true,
    assertRetainedDestinationOwners() {}, assertRetainedStepDisposal() {}, validateDestination: async () => {}, preflightDestinationStep: async () => true,
    markCompletedStepUncertain() {}, markCompletedStepDisposalUncertain() {}, markCompletedResourceStopUncertain() {},
    prepareDestinationStep: async args => (retained = { operationID: args.operationID, candidateID: args.candidateId,
      stepID: randomUUID(), mcpResourceID: resourceReceipt.resourceID, providerResourceID: providerReceipt.resourceID, status: 'retained' }),
    disposeDestinationStep: async args => { disposalCalls++; disposed = { ...retained, disposalID: args.disposalID, status: 'disposed' }; throw new Error('simulated lost native reply'); },
    observeDestinationStepDisposal: async ({ step: owned, disposal: pending }) => {
      assert.equal(pending.disposalID, disposed.disposalID);
      await f.a.request('control_worktree_authorize', { agentId, channel: 'dev', credential: ADAPTER,
        action: 'observe-destination-step', grant: owned.mcpGrant, peerGrant: owned.providerGrant });
      return { status: 'disposed', receipt: disposed };
    },
    acknowledgeRecordedStepDisposal: (value, actualJournal) => {
      assert.equal(actualJournal, journal); assert.deepEqual(value.disposal.receipt, disposed);
      assert.ok(actualJournal.entries().some(row => row.cleanup?.phase === 'dispatching' || row.quiescence?.phase === 'dispatching')); acknowledgements++;
    },
    cleanupProvider: async (grant, reservation, cleanupID) => {
      await f.a.request('control_worktree_authorize', { agentId, channel: 'dev', credential: ADAPTER, grant, action: 'cleanup-provider' });
      return { cleanupID, resource: grant.resourceReceipt, sourceCwd: plan.from, kind: 'provider_factory', phase: 'owner_released' };
    },
    quiesceMcp: async (grant, reservation, shutdownID) => {
      await f.a.request('control_worktree_authorize', { agentId, channel: 'dev', credential: ADAPTER, grant, action: 'cleanup-mcp' });
      return { shutdownID, resource: grant.resourceReceipt, status: 'quiesced' };
    } };
  const args = { client: f.a, credential: async () => ADAPTER, native, journal, agentId, mcpTransitionID: id,
    providerTransitionID: providerID, candidateId: randomUUID(), signal: new AbortController().signal, guard() {} };
  assert.equal((await dispatchCodexDestinationStep(args)).receipt.status, 'retained');
  await assert.rejects(disposeCodexDestinationStep(args), /CODEX_STEP_DISPOSAL_UNCERTAIN/);
  f.advance(1000);
  assert.equal((await observeCodexDestinationStepDisposal(args)).receipt.status, 'disposed');
  assert.equal(disposalCalls, 1);
  await assert.rejects(f.run(f.a, agentId, 'task.release', { taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  f.advance(1000);
  assert.equal((await quiesceCodexMcp({ ...args, transitionID: id })).receipt.status, 'quiesced');
  const providerCleanup = (await cleanupCodexProvider({ ...args, transitionID: providerID })).receipt;
  assert.equal(providerCleanup.phase, 'owner_released'); assert.equal(acknowledgements, 2);
  assert.equal((await f.query(f.a, agentId, 'transitions')).entries.find(value => value.id === id).status, 'established');
  f.advance(1000);
  await assert.rejects(f.a.request('control_worktree_authorize', observe), /WORKTREE_TRANSITION_NOT_PENDING/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...observe, action: 'prepare-destination-step' }), /WORKTREE_TRANSITION_NOT_PENDING/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...observe, action: 'observe-destination-step' }), /WORKTREE_TRANSITION_NOT_PENDING/);
  await assert.rejects(f.a.request('control_worktree_authorize', { ...observe, action: 'dispose-destination-step' }), /WORKTREE_TRANSITION_NOT_PENDING/);
  await assert.rejects(f.run(f.a, agentId, 'task.release', { taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  const info = await f.a.request('control_info');
  assert.equal(info.mcpEstablishmentGrantsEnabled, true); assert.equal(info.mcpEstablishmentExecutionEnabled, false); assert.equal(info.worktreeExecutionEnabled, false);
  const cleanupReceipt = { cleanupID: randomUUID(), resource: resourceReceipt, sourceCwd: plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  const cleanup = { transitionID: id, purpose: 'establish-mcp', outcome: 'failed', actualLocation: plan.from,
    configurationDigest: plan.digest, receiptID: randomUUID(), cleanupReceipt };
  await assert.rejects(adapter('worktree.settle', cleanup), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  await assert.rejects(f.run(f.a, agentId, 'task.release', { taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  verifiedReceipt = cleanupReceipt;
  const command = { id: randomUUID(), channel: 'dev', op: 'worktree.settle', ...cleanup };
  const request = { agentId, credential: ADAPTER, command };
  leaseMode = 'missing';
  await assert.rejects(f.a.request('control_adapter', request), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  leaseMode = 'expired';
  await assert.rejects(f.a.request('control_adapter', request), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  leaseMode = 'async';
  await assert.rejects(f.a.request('control_adapter', request), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  leaseMode = 'false';
  await assert.rejects(f.a.request('control_adapter', request), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  assert.equal(leaseReleases, 3);
  leaseMode = 'late';
  await assert.rejects(f.a.request('control_adapter', request), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  assert.equal(typeof finishLate, 'function'); finishLate();
  for (let attempt = 0; attempt < 100 && leaseReleases !== 4; attempt++) await delay(10);
  assert.equal(leaseReleases, 4, 'a proof arriving after timeout must release its lease');
  assert.equal((await f.query(f.a, agentId, 'transitions')).entries.find(value => value.id === id).status, 'established');
  await assert.rejects(f.run(f.a, agentId, 'task.release', { taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  leaseMode = 'valid';
  assert.equal((await f.a.request('control_adapter', request)).replayed, false);
  assert.equal((await f.a.request('control_adapter', request)).replayed, true);
  assert.equal(leaseChecks, 4); assert.equal(leaseReleases, 5);
  assert.equal(verifications, 7, 'a committed retry must not invoke the native verifier again');
  await assert.rejects(f.a.request('control_adapter', { ...request, command: { ...command, receiptID: randomUUID() } }), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  await f.run(f.a, agentId, 'task.release', { taskID });
});
