import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';
import { makeOpenCodeTasks } from '../adapters/opencode-tasks.js';

const eventually = async fn => {
  for (let attempt = 0; attempt < 100; attempt++) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('Manual managed worktree fixture timed out');
};

for (const harness of ['opencode', 'codex']) test(`operator-supervised ${harness} CLI creates and cleans an approved worktree with separate bound confirmations`, { timeout: process.platform === 'win32' ? 90000 : 30000 }, async t => {
  const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-manual-managed-'))), repository = join(root, 'repo');
  const agentId = `${harness}:worker`;
  mkdirSync(repository, { mode: 0o700 });
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: 'ignore' });
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  writeFileSync(join(repository, 'file'), 'fixture\n'); git(['add', 'file']); git(['commit', '-m', 'fixture']);
  writeFileSync(join(repository, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nprintf invoked > hook-fired\n', { mode: 0o755 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, managedRecords: true, worktreeGrants: true, taskDispatch: true, worktreeTaskDispatch: true, manualWorktreeOnly: true });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`, proofs = join(root, 'proofs');
  const admin = new ChannelClient({ url, token: '2'.repeat(64), credentialDirectory: proofs });
  const participant = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: proofs });
  const coordinator = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: proofs });
  for (const client of [admin, participant, coordinator]) {
    const request = client.request.bind(client);
    client.request = async (...args) => {
      for (let attempt = 0; ; attempt++) {
        try { return await request(...args); }
        catch (error) {
          if (error.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' || attempt >= 8) throw error;
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    };
  }
  t.after(async () => { admin.close(); participant.close(); coordinator.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const run = (client, op, fields = {}, agentId) => client.request('control_command', { ...(agentId ? { agentId } : {}),
    command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  await run(admin, 'channel.configure');
  await participant.request('join', { harness, sessionId: 'worker', channel: 'dev', name: 'worker', role: 'fixture',
    project: { name: 'fixture', root: repository } });
  await participant.subscribe(agentId);
  await admin.request('control_enroll_adapter', { hostId: participant.hostId, credential: '3'.repeat(64) });
  if (harness === 'opencode') {
    await coordinator.request('join', { harness: 'opencode', sessionId: 'manager', channel: 'dev', name: 'manager', role: 'fixture', project: { name: 'fixture', root: repository } });
    await coordinator.subscribe('opencode:manager');
    await run(coordinator, 'master.volunteer', { eligible: true }, 'opencode:manager');
    const appointment = await run(admin, 'master.appoint', { candidate: 'opencode:manager' });
    const notice = (await coordinator.request('control_query', { agentId: 'opencode:manager', channel: 'dev', view: 'notices' })).entries[0];
    await coordinator.request('control_notice_ack', { agentId: 'opencode:manager', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_managed_manager' });
    await run(coordinator, 'master.accept', { proposalID: appointment.commandID, promptVersion: 1 }, 'opencode:manager');
  }
  const taskID = (await run(admin, 'task.create', { title: 'Fixture', instructions: 'Fixture', criteria: 'Fixture', requiresWorktree: harness === 'opencode' })).commandID;
  await run(participant, 'task.claim', { taskID }, agentId);
  const adapter = join(root, 'adapter.token'), settingsFile = join(root, 'settings.json');
  mkdirSync(join(root, 'client'), { mode: 0o700 });
  writeFileSync(join(root, 'client', 'admin-token'), '2'.repeat(64), { mode: 0o600 });
  writeFileSync(adapter, '3'.repeat(64), { mode: 0o600 });
  writeFileSync(settingsFile, JSON.stringify({ version: 1, agentId, channel: 'dev', repository,
    directory: join(root, 'state'), worktreeRoot: join(root, 'trees'), adapterCredentialFile: adapter, credentialDirectory: proofs }), { mode: 0o600 });
  const cli = async (operation, ...args) => {
    const child = spawn(process.execPath, ['src/manual-managed-worktree.js', operation, settingsFile, ...args], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: '1'.repeat(64), AGENT_CHANNEL_STATE_DIR: join(root, 'client') } });
    let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    const [code] = await once(child, 'close'); return { code, out, err };
  };
  const busy = await cli('preview-create', taskID, '1');
  assert.notEqual(busy.code, 0, 'an active receiver cannot be displaced');
  assert.match(busy.err, /MANUAL_WORKTREE_RECEIVER_BUSY/);
  await participant.unsubscribe(agentId);
  const previewResult = await cli('preview-create', taskID, '1'); assert.equal(previewResult.code, 0, previewResult.err);
  const preview = JSON.parse(previewResult.out);
  const approve = value => run(admin, 'managed.approve', { previewID: value.id, digest: value.digest });
  await approve(preview);
  assert.notEqual((await cli('create', preview.id, preview.digest)).code, 0, 'explicit confirmation is required');
  const adminFile = join(root, 'client', 'admin-token');
  renameSync(adminFile, `${adminFile}.saved`);
  assert.notEqual((await cli('create', preview.id, preview.digest, '--confirm-no-active-use')).code, 0, 'the operator credential is required');
  renameSync(`${adminFile}.saved`, adminFile);
  assert.equal((await admin.request('control_query', { channel: 'dev', view: 'managedPreviews', entityID: preview.id, limit: 1 })).entries[0].status, 'approved');
  const createdResult = await cli('create', preview.id, preview.digest, '--confirm-no-active-use'); assert.equal(createdResult.code, 0, createdResult.err);
  const created = JSON.parse(createdResult.out);
  assert.equal(readFileSync(join(created.destination, 'file'), 'utf8'), 'fixture\n');
  assert.equal(existsSync(join(created.destination, 'hook-fired')), false, 'repository hooks must not run during creation');
  assert.equal(created.coordination.manualAttestation.previewID, preview.id);
  const createdRecord = (await admin.request('control_query', { channel: 'dev', view: 'managedPreviews', entityID: preview.id, limit: 1 })).entries[0];
  assert.equal(createdRecord.manualConfirmation.id, created.coordination.manualAttestation.confirmationID);
  if (harness === 'opencode') {
    // Exercise the accepted manual session move and task path on the very same
    // worktree, with the native OpenCode API represented by a deterministic fixture.
    await participant.subscribe(agentId);
    const tools = new ToolSession(coordinator, { harness: 'opencode', sessionId: 'manager' });
    tools.agentId = 'opencode:manager'; tools.channel = 'dev'; t.after(() => tools.clearSessionWatches());
    const moveID = (await tools.call('channel_manual_preview', { taskID, destination: created.destination })).commandID;
    await run(admin, 'worktree.approve', { taskID, previewID: moveID });
    const preparation = await tools.call('channel_prepare_session', { taskID, previewID: moveID, messageId: 'managed-move-prepare' });
    await participant.request('ack', { agentId, id: preparation.id });
    const record = { type: 'turnlink.session_record.v2', taskID, previewID: moveID, session: agentId, source: repository,
      destination: created.destination, runtime: 'opencode 1.0.0', model: 'fixture', provider: 'fixture', permissions: 'fixture', work: 'saved' };
    const saved = await participant.request('send', { agentId, to: 'opencode:manager', text: JSON.stringify(record), messageId: 'managed-move-record' });
    await eventually(() => broker.store.bindings[agentId]?.manualResume?.status === 'armed');
    await participant.unsubscribe(agentId);
    await participant.request('join', { harness, sessionId: 'worker', channel: 'dev', name: 'worker', role: 'fixture', project: { name: 'fixture', root: created.destination } });
    await participant.subscribe(agentId);
    const request = await eventually(() => broker.store.messages.find(message => message.messageId === `turnlink-verify-${saved.id}`));
    const report = { type: 'turnlink.session_report.v2', taskID, previewID: moveID, session: agentId, recordID: saved.id, requestID: request.id,
      runtime: 'opencode 1.0.0', checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
    await participant.request('send', { agentId, to: 'opencode:manager', text: JSON.stringify(report), messageId: 'managed-move-report' });
    await admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID: moveID, recordID: saved.id, requestID: request.id, receiptID: randomUUID(), sourceStopped: true });
    const messages = [], calls = [], controller = new AbortController(); t.after(() => controller.abort());
    const state = { generation: 0, taskPending: true, tools: { agentId }, controlChannel: 'dev', blocked: new Set() };
    const ctx = { agent: { get: async () => ({ data: { id: 'plan', permissions: [] } }) }, model: { default: async () => ({ data: { id: 'fixture', providerID: 'fixture' } }) },
      tool: { list: async () => [] }, session: { wait: async () => {}, context: async () => messages, prompt: async input => {
        calls.push(input.metadata.source); messages.push({ id: input.id, type: 'user', text: input.text, metadata: input.metadata });
        if (input.metadata.source === 'turnlink-task') messages.push({ id: 'assistant_1', type: 'assistant', time: { completed: 1 }, finish: 'stop', content: [] });
        else { const data = JSON.parse(input.text.split('TASK_RESULT_DATA\n')[1]); await run(participant, 'task.report', { taskID: data.taskID, evidence: data.evidence, summary: 'Fixture completed' }, agentId); }
        return { id: input.id, sessionID: 'worker' };
      } } };
    const errors = [];
    const runtime = makeOpenCodeTasks({ ctx, channel: participant, sessions: new Map([['worker', state]]),
      options: { tasks: true, worktreeTasks: true, credentialDirectory: proofs }, signal: controller.signal,
      ownSession: async () => ({ id: 'worker', agent: 'plan', location: { directory: created.destination }, permissions: [] }),
      refreshBlockers: async () => true, credential: () => '3'.repeat(64), log: error => errors.push(error) });
    await runtime.poll('worker'); state.taskPending = true; await runtime.poll('worker');
    assert.deepEqual(errors, []); assert.deepEqual(calls, ['turnlink-task', 'turnlink-task-result']);
    const task = (await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID, limit: 1 })).entries[0];
    assert.equal(task.status, 'review');
    await run(coordinator, 'task.review', { taskID, generation: 1, evidenceID: task.result.evidence[0], accept: true }, 'opencode:manager');
    assert.equal((await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID, limit: 1 })).entries[0].status, 'completed');
    await participant.unsubscribe(agentId);
  }
  writeFileSync(join(created.destination, 'file'), 'unsaved work\n');
  const dirty = await cli('preview-remove', created.id);
  assert.notEqual(dirty.code, 0); assert.match(dirty.err, /DIRTY_WORKTREE/);
  assert.equal(readFileSync(join(created.destination, 'file'), 'utf8'), 'unsaved work\n');
  writeFileSync(join(created.destination, 'file'), 'fixture\n');
  const removalResult = await cli('preview-remove', created.id); assert.equal(removalResult.code, 0, removalResult.err);
  const removal = JSON.parse(removalResult.out); await approve(removal);
  assert.notEqual((await cli('remove', removal.id, preview.digest, '--confirm-no-active-use')).code, 0, 'a confirmation cannot be reused for another preview');
  const removedResult = await cli('remove', removal.id, removal.digest, '--confirm-no-active-use'); assert.equal(removedResult.code, 0, removedResult.err);
  const removed = JSON.parse(removedResult.out);
  assert.equal(removed.coordination.manualAttestation.previewID, removal.id);
  const removalRecord = (await admin.request('control_query', { channel: 'dev', view: 'managedPreviews', entityID: removal.id, limit: 1 })).entries[0];
  assert.equal(removalRecord.manualConfirmation.id, removed.coordination.manualAttestation.confirmationID);
  assert.equal(existsSync(created.destination), false);
});
