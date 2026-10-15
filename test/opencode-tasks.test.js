import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, unlinkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { digest } from '../src/config.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { makeOpenCodeTasks } from '../adapters/opencode-tasks.js';

async function fixture(t, { enabled = true, requiresWorktree = false, master = true, scheduleDelayMs } = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-live-tasks-')), broker = createBroker({ directory: join(root, 'broker'), port: 0,
    secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true, taskDispatch: enabled, sweepIntervalMs: 25 });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const worker = new ChannelClient(options), reviewer = new ChannelClient(options), admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  const controller = new AbortController();
  t.after(async () => { controller.abort(); worker.close(); reviewer.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  for (const [client, id] of [[worker, 'worker'], [reviewer, 'reviewer']]) {
    await client.request('join', { harness: 'opencode', sessionId: id, name: id, channel: 'dev', role: 'existing-role', project: { name: 'fixture', root } });
    await client.subscribe(`opencode:${id}`);
  }
  const run = (client, op, fields = {}) => client.request('control_command', { ...(client === admin ? {} : { agentId: client === worker ? 'opencode:worker' : 'opencode:reviewer' }),
    command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  await run(admin, 'channel.configure'); await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
  if (master) {
    await run(reviewer, 'master.volunteer', { eligible: true });
    const proposal = await run(admin, 'master.appoint', { candidate: 'opencode:reviewer' });
    const notice = (await reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries[0];
    await reviewer.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_role' });
    await run(reviewer, 'master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
  }
  const created = await run(admin, 'task.create', { title: 'Task', instructions: 'Produce a native result', criteria: 'Result and evidence', requiresWorktree,
    ...(scheduleDelayMs ? { schedule: { at: Date.now() + scheduleDelayMs, missed: 'ask', maxLatenessMs: 5000 } } : {}) });
  await run(worker, 'task.claim', { taskID: created.commandID });
  const messages = [], native = { busy: false, blocked: false, tasks: 0, reports: 0, loseAdmission: false, permissions: [] };
  const state = { tools: { agentId: 'opencode:worker' }, controlChannel: 'dev', generation: 0, taskPending: true, blocked: new Set() };
  const session = () => ({ id: 'worker', agent: 'plan', location: { directory: root }, permissions: native.permissions });
  const ctx = {
    agent: { get: async () => ({ data: { id: 'plan', permissions: [] } }) }, model: { default: async () => ({ data: { id: 'fixture', providerID: 'fixture' } }) },
    tool: { list: async () => [{ id: 'read', description: 'read', input: {} }] },
    session: { wait: async () => { if (native.busy) throw new Error('native busy'); }, context: async () => messages,
      prompt: async input => {
        if (!messages.some(m => m.id === input.id)) {
          messages.push({ id: input.id, type: 'user', text: input.text, metadata: input.metadata });
          if (input.metadata.source === 'turnlink-task') {
            native.tasks++; messages.push({ id: `assistant_${native.tasks}`, type: 'assistant', time: { completed: 100 }, finish: 'stop', content: [{ type: 'text', text: 'private-native-result' }] });
            if (native.loseAdmission) { native.loseAdmission = false; throw new Error('lost native admission response'); }
          } else {
            native.reports++; const data = JSON.parse(input.text.split('TASK_RESULT_DATA\n')[1]);
            await run(worker, 'task.report', { taskID: data.taskID, evidence: data.evidence, summary: 'Result reported with adapter evidence' });
          }
        }
        return { id: input.id, sessionID: 'worker' };
      } },
  };
  const sessions = new Map([['worker', state]]), errors = [];
  const runtime = () => makeOpenCodeTasks({ ctx, channel: worker, sessions, options: { tasks: true, credentialDirectory: options.credentialDirectory },
    signal: controller.signal, ownSession: async () => session(), refreshBlockers: async () => !native.blocked, credential: () => '3'.repeat(64), log: error => errors.push(error) });
  const query = async view => (await admin.request('control_query', { channel: 'dev', view })).entries;
  return { worker, reviewer, admin, run, query, native, state, runtime, errors, taskID: created.commandID, root, messages, options };
}

test('authenticated task execution reaches review only after adapter artifact/stop evidence and explicit participant report', async t => {
  const f = await fixture(t); await f.runtime().poll('worker');
  assert.deepEqual(f.errors, []); const task = (await f.query('tasks'))[0];
  assert.equal(task.status, 'review'); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1); assert.ok(task.stoppedEvidence);
  const artifact = (await f.query('evidence')).find(e => e.id === task.result.evidence[0]);
  assert.equal(artifact.artifact.fromMessageID, task.nativeAdmissionID); assert.equal(artifact.artifact.sessionID, 'worker');
  const journal = readFileSync(join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`), 'utf8');
  assert.ok(!journal.includes('private-native-result'));
  const notices = await f.reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' });
  assert.equal(notices.entries.filter(n => n.kind === 'task_review').length, 1);
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, evidenceID: artifact.id, accept: true });
  assert.equal((await f.query('tasks'))[0].status, 'completed');
});

test('lost native admission response recovers with the exact native key after adapter restart, without duplicate execution', async t => {
  const f = await fixture(t); f.native.loseAdmission = true;
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  delete f.state.taskJournal; await f.runtime().poll('worker');
  assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
});

test('lost artifact acknowledgement reuses the immutable artifact even when later native context advances', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let lost = false;
  f.worker.request = async (method, params) => {
    const result = await request(method, params);
    if (!lost && params?.command?.kind === 'artifact') { lost = true; throw new Error('lost artifact acknowledgement'); }
    return result;
  };
  await f.runtime().poll('worker'); const original = (await f.query('evidence')).find(e => e.kind === 'artifact');
  f.messages.push({ id: 'other-user', type: 'user' }, { id: 'other-assistant', type: 'assistant', time: { completed: 200 }, finish: 'stop', content: [] });
  delete f.state.taskJournal; await f.runtime().poll('worker');
  assert.equal(f.native.tasks, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
  assert.deepEqual((await f.query('evidence')).filter(e => e.kind === 'artifact'), [original]);
});

test('busy conversations and native blockers defer execution without answering or bypassing them', async t => {
  const f = await fixture(t); f.native.busy = true; await f.runtime().poll('worker');
  assert.equal(f.native.tasks, 0); assert.equal((await f.query('tasks'))[0].status, 'claimed');
  f.native.busy = false; f.native.blocked = true; await f.runtime().poll('worker'); assert.equal(f.native.tasks, 0);
  f.native.blocked = false; await f.runtime().poll('worker'); assert.equal(f.native.tasks, 1);
});

test('scope changes after durable dispatch prevent native execution and retain uncertainty rather than reassigning blindly', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker);
  f.worker.request = async (method, params) => {
    const result = await request(method, params);
    if (method === 'control_task_pull' && result.task) f.native.permissions = [{ action: 'edit', resource: '*', effect: 'deny' }];
    return result;
  };
  await f.runtime().poll('worker'); assert.equal(f.native.tasks, 0); assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  await assert.rejects(f.run(f.reviewer, 'task.reassign', { taskID: f.taskID, generation: 1 }), /STOP_EVIDENCE_REQUIRED/);
});

test('already claimed authorized work executes without a master, but never self-completes', async t => {
  const f = await fixture(t, { master: false }); await f.runtime().poll('worker');
  assert.equal(f.native.tasks, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
  await assert.rejects(f.run(f.worker, 'task.review', { taskID: f.taskID, generation: 1, evidenceID: (await f.query('tasks'))[0].result.evidence[0], accept: true }), /ROLE_NOTICE_NOT_ADMITTED/);
});

test('default-off dispatch and required worktrees cannot be bypassed by the task runner', async t => {
  for (const options of [{ enabled: false }, { requiresWorktree: true }]) await t.test(JSON.stringify(options), async t => {
    const f = await fixture(t, options); await f.runtime().poll('worker');
    assert.equal(f.native.tasks, 0); assert.equal((await f.query('tasks'))[0].status, 'claimed');
  });
});

test('scheduled claimed work receives a passive due notification without waking or polling a model', async t => {
  const f = await fixture(t, { scheduleDelayMs: 500 }), runtime = f.runtime();
  await runtime.watch('worker'); await runtime.poll('worker');
  assert.equal(f.native.tasks, 0); assert.equal(f.state.taskPending, false);
  const [event] = await once(f.worker, 'task_available');
  assert.equal(event.agentId, 'opencode:worker'); assert.equal(f.native.tasks, 0);
  f.state.taskPending = true; await runtime.poll('worker'); assert.equal(f.native.tasks, 1);
});

test('a replacement/late master receives pending evidence-backed review rather than losing completion work', async t => {
  const f = await fixture(t, { master: false }); await f.runtime().poll('worker');
  await f.run(f.reviewer, 'master.volunteer', { eligible: true });
  const proposal = await f.run(f.admin, 'master.appoint', { candidate: 'opencode:reviewer' });
  const pending = await f.reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' });
  const offer = pending.entries.find(n => n.kind === 'offer');
  await f.reviewer.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: offer.id, receiptID: 'msg_new_master' });
  await f.run(f.reviewer, 'master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
  const notices = await f.reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' });
  assert.equal(notices.entries.filter(n => n.kind === 'task_review').length, 1);
});

test('task pull requires the enrolled credential and exact receiver, not just participant or operator authority', async t => {
  const f = await fixture(t), params = { agentId: 'opencode:worker', channel: 'dev', cwd: f.root, scopeDigest: 'a'.repeat(64) };
  await assert.rejects(f.worker.request('control_task_pull', { ...params, credential: '4'.repeat(64) }));
  await assert.rejects(f.reviewer.request('control_task_pull', { ...params, credential: '3'.repeat(64) }));
  await assert.rejects(f.admin.request('control_task_pull', { ...params, credential: '3'.repeat(64) }));
  assert.equal((await f.query('tasks'))[0].status, 'claimed');
});

test('the enabled task gate still rejects an authenticated Codex receiver and advertises no worktree execution', async t => {
  const f = await fixture(t), codex = new ChannelClient(f.options);
  t.after(() => codex.close());
  await codex.request('join', { harness: 'codex', sessionId: 'codex-worker', name: 'codex-worker', channel: 'dev',
    role: 'existing-role', project: { name: 'fixture', root: f.root } });
  await codex.subscribe('codex:codex-worker');
  await assert.rejects(codex.request('control_task_pull', { agentId: 'codex:codex-worker', credential: '3'.repeat(64),
    channel: 'dev', cwd: f.root, scopeDigest: 'a'.repeat(64) }), /TASK_DISPATCH_DISABLED/);
  const capabilities = await f.admin.request('control_query', { channel: 'dev', view: 'channel' });
  assert.equal(capabilities.taskDispatchEnabled, true);
  assert.deepEqual(capabilities.taskExecutionHarnesses, ['opencode']);
  assert.equal(capabilities.taskWorktreesEnabled, false);
  assert.equal(capabilities.worktreeExecutionEnabled, false);
  assert.equal((await f.query('tasks'))[0].status, 'claimed');
});

test('lost stop acknowledgement recovers without repeating execution or duplicating stop evidence', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let lost = false;
  f.worker.request = async (method, params) => {
    const result = await request(method, params);
    if (!lost && params?.command?.op === 'task.stopped') { lost = true; throw new Error('lost stop acknowledgement'); }
    return result;
  };
  await f.runtime().poll('worker');
  const before = (await f.query('tasks'))[0]; assert.ok(before.stoppedEvidence); assert.equal(f.native.reports, 0);
  delete f.state.taskJournal; await f.runtime().poll('worker');
  const after = (await f.query('tasks'))[0];
  assert.equal(after.status, 'review'); assert.equal(after.stoppedEvidence, before.stoppedEvidence);
  assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1);
  assert.equal((await f.query('evidence')).filter(e => e.kind === 'stopped').length, 1);
});

test('missing local journal for an admitted attempt fails closed rather than creating a new execution', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let lost = false;
  f.worker.request = async (method, params) => {
    const result = await request(method, params);
    if (!lost && params?.command?.op === 'task.admission' && params.command.outcome === 'admitted') {
      lost = true; throw new Error('lost admitted acknowledgement');
    }
    return result;
  };
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].admission, 'admitted');
  unlinkSync(join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`));
  delete f.state.taskJournal; await f.runtime().poll('worker');
  assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 0);
  assert.equal(f.errors.at(-1).code, 'TASK_RECOVERY_REQUIRED');
});
