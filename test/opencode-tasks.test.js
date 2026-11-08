import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
  return { worker, reviewer, admin, run, query, native, state, runtime, errors, taskID: created.commandID, root, messages, options, ctx };
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

test('a task notification during an empty pull is retained for the next poll', async t => {
  const f = await fixture(t), runtime = f.runtime(), request = f.worker.request.bind(f.worker);
  let releasePull, pulling;
  const entered = new Promise(resolve => { pulling = resolve; });
  const release = new Promise(resolve => { releasePull = resolve; });
  t.after(() => releasePull());
  let first = true;
  f.worker.request = async (method, params) => {
    if (method === 'control_task_pull' && first) {
      first = false; pulling(); await release; return { task: null };
    }
    return request(method, params);
  };
  const poll = runtime.poll('worker');
  await entered;
  await runtime.watch('worker');
  await runtime.poll('worker');
  releasePull(); await poll;
  assert.equal(f.state.taskPending, true);
  await runtime.poll('worker');
  assert.deepEqual(f.errors, []);
  assert.equal(f.native.tasks, 1);
  assert.equal((await f.query('tasks'))[0].status, 'review');
});

test('an empty pull without a new notification clears the pending poll', async t => {
  const f = await fixture(t), runtime = f.runtime(), request = f.worker.request.bind(f.worker);
  f.worker.request = (method, params) => method === 'control_task_pull' ? Promise.resolve({ task: null }) : request(method, params);
  await runtime.poll('worker');
  assert.deepEqual(f.errors, []);
  assert.equal(f.state.taskPending, false);
  assert.equal(f.native.tasks, 0);
});

test('OpenCode callbacks carry a nonzero dispatch-journal epoch after evidence-backed reassignment', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker);
  const prior = (await request('control_task_pull', { agentId: 'opencode:worker', credential: '3'.repeat(64), channel: 'dev', cwd: f.root, scopeDigest: 'a'.repeat(64) })).task;
  for (const [op, fields] of [['task.uncertain', {}], ['task.stopped', { evidenceID: randomUUID(), stopGeneration: 1 }]]) {
    await request('control_adapter', { agentId: 'opencode:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev', op,
      taskID: f.taskID, attempt: prior.attempt, ...fields } });
  }
  await f.run(f.admin, 'task.reassign', { taskID: f.taskID }); await f.run(f.worker, 'task.claim', { taskID: f.taskID });
  const callbacks = [];
  f.worker.request = async (method, params) => {
    if (['task.admission', 'task.started', 'task.progress', 'task.stopped'].includes(params?.command?.op)) callbacks.push(params.command);
    return request(method, params);
  };
  await f.runtime().poll('worker'); assert.deepEqual(f.errors, []);
  assert.equal((await f.query('tasks'))[0].status, 'review'); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1);
  assert.deepEqual(new Set(callbacks.map(c => c.op)), new Set(['task.admission', 'task.started', 'task.progress', 'task.stopped']));
  assert.ok(callbacks.every(c => c.stopGeneration === 1));
});

test('late terminal uncertainty retains OpenCode journals and refuses pull without replaying native work/reporting', async t => {
  const f = await fixture(t); await f.runtime().poll('worker');
  const task = (await f.query('tasks'))[0];
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, evidenceID: task.result.evidence[0], accept: true });
  await f.worker.request('control_adapter', { agentId: 'opencode:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev',
    op: 'task.uncertain', taskID: f.taskID, attempt: task.attempt } });
  const path = join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`), original = readFileSync(path, 'utf8');
  for (let i = 0; i < 2; i++) {
    delete f.state.taskJournal; f.state.taskPending = true; await f.runtime().poll('worker');
    assert.equal(readFileSync(path, 'utf8'), original); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1);
  }
  const queued = (await f.run(f.admin, 'task.create', { title: 'Next', instructions: 'Wait for hold', criteria: 'No admission', requiresWorktree: false })).commandID;
  await f.run(f.worker, 'task.claim', { taskID: queued });
  assert.deepEqual(await f.worker.request('control_task_pull', { agentId: 'opencode:worker', credential: '3'.repeat(64), channel: 'dev', cwd: f.root, scopeDigest: 'a'.repeat(64) }), { task: null, held: true });
  assert.equal((await f.query('tasks')).find(t => t.id === queued).status, 'claimed');
  assert.equal((await f.query('tasks')).find(t => t.id === f.taskID).terminalHold, true); assert.deepEqual(f.errors, []);
});

for (const boundary of ['artifact', 'stopped']) test(`OpenCode preserves the old observation epoch across ${boundary} uncertainty and journal reconstruction`, async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let injected = false;
  f.worker.request = async (method, params) => {
    const result = await request(method, params);
    if (!injected && (boundary === 'artifact' ? params?.command?.kind === 'artifact' : params?.command?.op === 'task.stopped')) {
      injected = true; const task = (await f.query('tasks'))[0];
      await request('control_adapter', { agentId: 'opencode:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev',
        op: 'task.uncertain', taskID: f.taskID, attempt: task.attempt } });
    }
    return result;
  };
  await f.runtime().poll('worker'); assert.ok(injected);
  const path = join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`), original = readFileSync(path, 'utf8');
  for (let i = 0; i < 2; i++) {
    delete f.state.taskJournal; f.state.taskPending = true; await f.runtime().poll('worker');
    assert.equal(readFileSync(path, 'utf8'), original); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 0);
  }
  const task = (await f.query('tasks'))[0]; assert.equal(task.stopGeneration, 1); assert.equal(task.stoppedEvidence, undefined);
  assert.equal(JSON.parse(original).records[0].task.stopGeneration, 0);
  if (boundary === 'artifact') assert.equal(f.errors.at(-1).code, 'STALE_STOP_GENERATION'); else assert.deepEqual(f.errors, []);
});

test('lost native admission response recovers with the exact native key after adapter restart, without duplicate execution', async t => {
  const f = await fixture(t); f.native.loseAdmission = true;
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  const context = f.ctx.session.context;
  f.ctx.session.context = async (...args) => {
    const record = JSON.parse(readFileSync(join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`), 'utf8')).records[0];
    assert.equal(record.observationGeneration, 1, 'capture is durable before collecting native segment evidence');
    return context(...args);
  };
  delete f.state.taskJournal; await f.runtime().poll('worker');
  assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
  const record = JSON.parse(readFileSync(join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`), 'utf8')).records[0];
  assert.equal(record.task.stopGeneration, 0); assert.equal(record.observationGeneration, 1);
});

test('repeated OpenCode lost-admission responses replay the original uncertainty receipt without retagging it', async t => {
  const f = await fixture(t); f.native.loseAdmission = true; await f.runtime().poll('worker');
  const prompt = f.ctx.session.prompt; f.ctx.session.prompt = async () => { throw new Error('second lost native response'); };
  delete f.state.taskJournal; await f.runtime().poll('worker');
  assert.equal((await f.query('tasks'))[0].stopGeneration, 1); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 0);
  assert.ok(!f.errors.some(e => e.code === 'COMMAND_ID_REUSE' || e.code === 'STALE_STOP_GENERATION'));
  f.ctx.session.prompt = prompt; delete f.state.taskJournal; await f.runtime().poll('worker');
  assert.equal((await f.query('tasks'))[0].status, 'review'); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 1);
});

for (const boundary of ['additional uncertainty', 'foreign receipt', 'cached proof', 'during observation']) test(`OpenCode admission recovery refuses ${boundary} rather than retagging proof`, async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); f.native.loseAdmission = true; let injected = false;
  const uncertain = async () => {
    const task = (await f.query('tasks'))[0];
    await request('control_adapter', { agentId: 'opencode:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: task.id, attempt: task.attempt } });
  };
  f.worker.request = async (method, params) => {
    if (boundary === 'foreign receipt' && params?.command?.op === 'task.admission' && params.command.outcome === 'uncertain') {
      return request(method, { ...params, command: { ...params.command, receiptID: randomUUID() } });
    }
    if (boundary === 'during observation' && !injected && params?.command?.op === 'task.admission' && params.command.outcome === 'admitted') {
      injected = true; await uncertain();
    }
    return request(method, params);
  };
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].stopGeneration, 1);
  const path = join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`);
  if (boundary === 'additional uncertainty') await uncertain();
  if (boundary === 'cached proof') {
    const saved = JSON.parse(readFileSync(path, 'utf8')); saved.records[0].outputDigest = 'a'.repeat(64);
    writeFileSync(path, JSON.stringify(saved), { mode: 0o600 });
  }
  const before = readFileSync(path, 'utf8'); delete f.state.taskJournal; f.state.taskPending = true; await f.runtime().poll('worker');
  if (boundary !== 'during observation') assert.equal(readFileSync(path, 'utf8'), before);
  else {
    assert.ok(injected); const record = JSON.parse(readFileSync(path, 'utf8')).records[0];
    assert.equal(record.task.stopGeneration, 0); assert.equal(record.observationGeneration, 1);
    assert.equal(f.errors.at(-1).code, 'STALE_STOP_GENERATION');
  }
  const retained = readFileSync(path, 'utf8'); delete f.state.taskJournal; f.state.taskPending = true; await f.runtime().poll('worker');
  assert.equal(readFileSync(path, 'utf8'), retained); assert.equal(f.native.tasks, 1); assert.equal(f.native.reports, 0);
  assert.equal((await f.query('tasks'))[0].stoppedEvidence, undefined);
});

for (const invalidate of [false, true]) test(`OpenCode rechecks stop eligibility after native scope reads before retrying a report notice (uncertainty: ${invalidate})`, async t => {
  const f = await fixture(t), prompt = f.ctx.session.prompt;
  f.ctx.session.prompt = async input => {
    if (input.metadata.source === 'turnlink-task-result') throw new Error('report notice not submitted');
    return prompt(input);
  };
  await f.runtime().poll('worker');
  const path = join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`);
  const before = readFileSync(path, 'utf8');
  assert.equal(JSON.parse(before).records[0].phase, 'reporting');
  assert.ok((await f.query('tasks'))[0].stoppedEvidence);
  f.ctx.session.prompt = prompt;
  const list = f.ctx.tool.list;
  let injected = false;
  f.ctx.tool.list = async () => {
    if (!injected) {
      injected = true;
      if (invalidate) {
        const task = (await f.query('tasks'))[0];
        await f.worker.request('control_adapter', { agentId: 'opencode:worker', credential: '3'.repeat(64), command: {
          id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: task.id, attempt: task.attempt } });
      }
    }
    return list();
  };
  delete f.state.taskJournal; f.state.taskPending = true; await f.runtime().poll('worker');
  assert.ok(injected); assert.equal(f.native.tasks, 1);
  if (!invalidate) {
    assert.equal(f.native.reports, 1); assert.equal((await f.query('tasks'))[0].status, 'review'); return;
  }
  assert.equal(f.native.reports, 0);
  assert.equal(f.state.taskPending, false); assert.equal(readFileSync(path, 'utf8'), before);
  const task = (await f.query('tasks'))[0];
  assert.equal(task.status, 'uncertain'); assert.equal(task.stoppedEvidence, undefined);
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
    if (params?.command?.op === 'task.stopped') assert.equal(Object.hasOwn(params.command, 'stopGeneration'), false, 'zero-generation retries preserve the pre-upgrade fingerprint');
    const result = await request(method, params);
    if (!lost && params?.command?.op === 'task.stopped') { lost = true; throw new Error('lost stop acknowledgement'); }
    return result;
  };
  await f.runtime().poll('worker');
  const before = (await f.query('tasks'))[0]; assert.ok(before.stoppedEvidence); assert.equal(f.native.reports, 0);
  const path = join(f.root, 'proofs', digest('local'), `${digest('opencode:worker')}.tasks.json`);
  const legacy = JSON.parse(readFileSync(path, 'utf8')); for (const record of legacy.records) delete record.task.stopGeneration;
  writeFileSync(path, JSON.stringify(legacy), { mode: 0o600 });
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
