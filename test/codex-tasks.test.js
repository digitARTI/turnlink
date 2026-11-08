import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { digest } from '../src/config.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { makeCodexTasks, sameNativeWorktree } from '../src/codex-tasks.js';

test('Windows native cwd comparison uses actual directory identity and fails closed', () => {
  const first = String.raw`C:\Users\example\project`, second = String.raw`C:\Users\ExAmPlE\project`;
  const resolve = path => {
    if (path === first || path === second) return String.raw`C:\Users\ExAmPlE\project`;
    if (path === String.raw`C:\other`) return path;
    throw new Error('unavailable');
  };
  assert.equal(sameNativeWorktree(first, second, { platform: 'win32', canonicalize: resolve }), true);
  assert.equal(sameNativeWorktree(first, String.raw`C:\other`, { platform: 'win32', canonicalize: resolve }), false);
  assert.equal(sameNativeWorktree(first, String.raw`C:\missing`, { platform: 'win32', canonicalize: resolve }), false);
  assert.equal(sameNativeWorktree(first, second, { platform: 'darwin', canonicalize: resolve }), false);
  assert.equal(sameNativeWorktree('relative', second, { platform: 'win32', canonicalize: resolve }), false);
  assert.equal(sameNativeWorktree(undefined, second, { platform: 'win32', canonicalize: resolve }), false);
});

async function fixture(t, { codexTasks = true, requiresWorktree = false } = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-tasks-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, taskDispatch: true, codexTasks });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const worker = new ChannelClient(options), reviewer = new ChannelClient(options), admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  const tokenFile = join(root, 'adapter.token'); writeFileSync(tokenFile, '3'.repeat(64), { mode: 0o600 });
  const runtimes = [];
  t.after(async () => { runtimes.forEach(r => r.close()); worker.close(); reviewer.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  for (const [client, harness, id] of [[worker, 'codex', 'worker'], [reviewer, 'opencode', 'reviewer']]) {
    await client.request('join', { harness, sessionId: id, name: id, channel: 'dev', role: 'existing-role', project: { name: 'fixture', root } });
    await client.subscribe(`${harness}:${id}`);
  }
  const run = (client, op, fields = {}) => client.request('control_command', { ...(client === admin ? {} : { agentId: client === worker ? 'codex:worker' : 'opencode:reviewer' }),
    command: { id: randomUUID(), op, channel: 'dev', ...fields } });
  await run(admin, 'channel.configure'); await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
  await run(reviewer, 'master.volunteer', { eligible: true });
  const proposal = await run(admin, 'master.appoint', { candidate: 'opencode:reviewer' });
  const notice = (await reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries[0];
  await reviewer.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_role' });
  await run(reviewer, 'master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
  const created = await run(admin, 'task.create', { title: 'Codex task', instructions: 'Produce a native result', criteria: 'Actual result and evidence', requiresWorktree });
  await run(worker, 'task.claim', { taskID: created.commandID });
  const state = { channel: 'dev', generation: 0, taskPending: true };
  const turns = [], selection = { cwd: root, model: 'fixture', modelProvider: 'fixture', sandbox: { type: 'readOnly' }, approvalPolicy: 'untrusted' };
  const native = { busy: false, blocked: false, fenced: false, rev: 0, starts: 0, reports: 0, loseAdmission: false, loseReport: false, finish: 'completed' };
  const errors = [], threads = new Map([['worker', state]]);
  const ports = { held: () => native.fenced, idle: () => !native.busy && !native.blocked && !native.fenced, revision: () => native.rev,
    read: async () => ({ thread: { id: 'worker', cwd: selection.cwd, turns }, selection, configuration: { instructions: 'private-fixture-instructions' }, revision: native.rev }),
    start: async (threadID, text, revision) => {
      assert.equal(threadID, 'worker'); assert.equal(revision, native.rev);
      const turn = { id: `turn_${turns.length}`, status: native.finish, items: [{ type: 'userMessage', content: [{ type: 'text', text }] },
        { type: 'agentMessage', text: 'private-native-result' }] };
      turns.push(turn); native.rev++;
      if (text.includes('TASK_RESULT_DATA\n')) {
        native.reports++; const data = JSON.parse(text.split('TASK_RESULT_DATA\n')[1]);
        await run(worker, 'task.report', { taskID: data.taskID, evidence: data.evidence, summary: 'Codex native result reported' });
        if (native.loseReport) throw new Error('lost report response');
      } else {
        native.starts++;
        if (native.loseAdmission) { native.loseAdmission = false; throw new Error('lost start response'); }
      }
      return { turn };
    } };
  const runtime = () => {
    const value = makeCodexTasks({ client: worker, threads, enabled: true, tokenFile, native: ports,
      credentialDirectory: options.credentialDirectory, log: error => errors.push(error) });
    runtimes.push(value); return value;
  };
  const query = async view => (await admin.request('control_query', { channel: 'dev', view })).entries;
  return { root, options, state, native, ports, selection, turns, runtime, query, errors, run, worker, reviewer, admin, taskID: created.commandID,
    journal: () => join(options.credentialDirectory, digest('local'), `${digest('codex:worker')}.codex-tasks.json`) };
}

test('opt-in Codex native task flow records turn evidence and requires participant report plus explicit master acceptance', async t => {
  const f = await fixture(t), runtime = f.runtime();
  await runtime.watch('worker'); await runtime.poll('worker'); assert.equal(f.native.starts, 1);
  await runtime.poll('worker'); assert.deepEqual(f.errors, []);
  const task = (await f.query('tasks'))[0]; assert.equal(task.status, 'review'); assert.ok(task.stoppedEvidence);
  const artifact = (await f.query('evidence')).find(e => task.result.evidence.includes(e.id));
  assert.equal(artifact.artifact.type, 'native_turn'); assert.equal(artifact.artifact.sessionID, 'worker');
  assert.equal(artifact.artifact.admissionID, task.nativeAdmissionID); assert.equal(f.native.reports, 1);
  const journal = readFileSync(f.journal(), 'utf8'); assert.ok(!journal.includes('private-native-result')); assert.ok(!journal.includes('private-fixture-instructions'));
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, evidenceID: artifact.id, accept: true });
  assert.equal((await f.query('tasks'))[0].status, 'completed');
  assert.deepEqual(f.selection.sandbox, { type: 'readOnly' }); assert.equal(f.selection.approvalPolicy, 'untrusted');
});

test('a task notification during an empty pull is retained for the next poll', async t => {
  const f = await fixture(t), runtime = f.runtime(), guarded = f.worker.requestGuarded.bind(f.worker);
  let first = true;
  f.worker.requestGuarded = async (method, params, guard) => {
    if (method === 'control_task_pull' && first) {
      first = false;
      runtime.notify('worker');
      return { task: null };
    }
    return guarded(method, params, guard);
  };
  await runtime.poll('worker');
  assert.equal(f.state.taskPending, true, 'a later wake must survive an earlier empty pull');
  await runtime.poll('worker');
  assert.equal(f.native.starts, 1);
});

test('receiver generation change during reconnect prevents a stale task pull', async t => {
  const f = await fixture(t), runtime = f.runtime(), connect = f.worker.connect.bind(f.worker);
  let calls = 0;
  f.worker.connect = async () => {
    if (++calls === 2) f.state.generation++;
    return connect();
  };
  await runtime.poll('worker');
  assert.ok(calls >= 2, 'the receiver changed between the snapshot and broker send');
  assert.equal((await f.query('tasks'))[0].status, 'claimed', 'stale work must not be dispatched by the broker');
  assert.equal(f.native.starts, 0);
  assert.equal(f.errors.at(-1)?.code, 'STALE_TASK_CLAIM');
});

test('receiver loss after broker pull discards the reply and does not start native work', async t => {
  const f = await fixture(t), runtime = f.runtime(), rpc = f.worker.rpc.bind(f.worker);
  f.worker.rpc = async (...args) => {
    const result = await rpc(...args);
    if (args[0] === 'control_task_pull') f.state.generation++;
    return result;
  };
  await runtime.poll('worker');
  assert.equal((await f.query('tasks'))[0].status, 'dispatching', 'the broker may already have committed the pull');
  assert.equal(f.native.starts, 0, 'a stale response must not start native work');
  assert.equal(f.errors.at(-1)?.code, 'STALE_TASK_CLAIM');
});

test('Codex callbacks carry a nonzero dispatch-journal epoch after evidence-backed reassignment', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker);
  const prior = (await request('control_task_pull', { agentId: 'codex:worker', credential: '3'.repeat(64), channel: 'dev', cwd: f.root, scopeDigest: 'a'.repeat(64) })).task;
  for (const [op, fields] of [['task.uncertain', {}], ['task.stopped', { evidenceID: randomUUID(), stopGeneration: 1 }]]) {
    await request('control_adapter', { agentId: 'codex:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev', op,
      taskID: f.taskID, attempt: prior.attempt, ...fields } });
  }
  await f.run(f.admin, 'task.reassign', { taskID: f.taskID }); await f.run(f.worker, 'task.claim', { taskID: f.taskID });
  const callbacks = [];
  const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => {
    if (['task.admission', 'task.started', 'task.progress', 'task.stopped'].includes(params?.command?.op)) callbacks.push(params.command);
    return guarded(method, params, guard);
  };
  const runtime = f.runtime(); await runtime.poll('worker'); await runtime.poll('worker'); assert.deepEqual(f.errors, []);
  assert.equal((await f.query('tasks'))[0].status, 'review'); assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 1);
  assert.deepEqual(new Set(callbacks.map(c => c.op)), new Set(['task.admission', 'task.started', 'task.progress', 'task.stopped']));
  assert.ok(callbacks.every(c => c.stopGeneration === 1));
});

test('late terminal uncertainty retains Codex journals and refuses pull without replaying turns or report wakes', async t => {
  const f = await fixture(t), runtime = f.runtime(); await runtime.watch('worker'); await runtime.poll('worker'); await runtime.poll('worker');
  const task = (await f.query('tasks'))[0];
  await f.run(f.reviewer, 'task.review', { taskID: f.taskID, generation: 1, evidenceID: task.result.evidence[0], accept: true });
  await f.worker.request('control_adapter', { agentId: 'codex:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev',
    op: 'task.uncertain', taskID: f.taskID, attempt: task.attempt } });
  const original = readFileSync(f.journal(), 'utf8');
  for (let i = 0; i < 2; i++) {
    const restarted = f.runtime(); restarted.notify('worker'); await restarted.poll('worker');
    assert.equal(readFileSync(f.journal(), 'utf8'), original); assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 1);
  }
  const queued = (await f.run(f.admin, 'task.create', { title: 'Next', instructions: 'Wait for hold', criteria: 'No admission', requiresWorktree: false })).commandID;
  await f.run(f.worker, 'task.claim', { taskID: queued });
  assert.deepEqual(await f.worker.request('control_task_pull', { agentId: 'codex:worker', credential: '3'.repeat(64), channel: 'dev', cwd: f.root, scopeDigest: 'a'.repeat(64) }), { task: null, held: true });
  assert.equal((await f.query('tasks')).find(t => t.id === queued).status, 'claimed');
  assert.equal((await f.query('tasks')).find(t => t.id === f.taskID).terminalHold, true); assert.deepEqual(f.errors, []);
});

for (const boundary of ['artifact', 'stopped']) test(`Codex preserves the old observation epoch across ${boundary} uncertainty and journal reconstruction`, async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let injected = false;
  const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => {
    const result = await guarded(method, params, guard);
    if (!injected && (boundary === 'artifact' ? params?.command?.kind === 'artifact' : params?.command?.op === 'task.stopped')) {
      injected = true; const task = (await f.query('tasks'))[0];
      await request('control_adapter', { agentId: 'codex:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev',
        op: 'task.uncertain', taskID: f.taskID, attempt: task.attempt } });
    }
    return result;
  };
  const runtime = f.runtime(); await runtime.poll('worker'); await runtime.poll('worker'); assert.ok(injected);
  const original = readFileSync(f.journal(), 'utf8');
  for (let i = 0; i < 2; i++) {
    const restarted = f.runtime(); restarted.notify('worker'); await restarted.poll('worker');
    assert.equal(readFileSync(f.journal(), 'utf8'), original); assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 0);
  }
  const task = (await f.query('tasks'))[0]; assert.equal(task.stopGeneration, 1); assert.equal(task.stoppedEvidence, undefined);
  assert.equal(JSON.parse(original).records[0].task.stopGeneration, 0);
  if (boundary === 'artifact') assert.equal(f.errors.at(-1).code, 'STALE_STOP_GENERATION'); else assert.deepEqual(f.errors, []);
});

test('Codex zero-generation stop retries preserve legacy journal/command fingerprints after a lost receipt', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let lost = false;
  const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => {
    if (params?.command?.op === 'task.stopped') assert.equal(Object.hasOwn(params.command, 'stopGeneration'), false);
    const result = await guarded(method, params, guard);
    if (!lost && params?.command?.op === 'task.stopped') { lost = true; throw new Error('lost legacy stop acknowledgement'); }
    return result;
  };
  const runtime = f.runtime(); await runtime.poll('worker'); await runtime.poll('worker');
  const before = (await f.query('tasks'))[0]; assert.ok(before.stoppedEvidence); assert.equal(f.native.reports, 0);
  const legacy = JSON.parse(readFileSync(f.journal(), 'utf8')); for (const record of legacy.records) delete record.task.stopGeneration;
  writeFileSync(f.journal(), JSON.stringify(legacy), { mode: 0o600 });
  await f.runtime().poll('worker');
  const after = (await f.query('tasks'))[0]; assert.equal(after.status, 'review'); assert.equal(after.stoppedEvidence, before.stoppedEvidence);
  assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 1);
  assert.equal((await f.query('evidence')).filter(e => e.kind === 'stopped').length, 1);
});

test('lost Codex admission response recovers only the exactly marked native turn after restart, never resends start', async t => {
  const f = await fixture(t); f.native.loseAdmission = true;
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  const read = f.ports.read;
  f.ports.read = async () => {
    const record = JSON.parse(readFileSync(f.journal(), 'utf8')).records[0];
    assert.equal(record.observationGeneration, 1, 'capture is durable before collecting the exact native turn');
    return read();
  };
  await f.runtime().poll('worker'); assert.equal(f.native.starts, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
  const record = JSON.parse(readFileSync(f.journal(), 'utf8')).records[0];
  assert.equal(record.task.stopGeneration, 0); assert.equal(record.observationGeneration, 1);
});

for (const boundary of ['additional uncertainty', 'foreign receipt', 'cached proof', 'during observation']) test(`Codex admission recovery refuses ${boundary} rather than retagging proof`, async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); f.native.loseAdmission = true; let injected = false;
  const uncertain = async () => {
    const task = (await f.query('tasks'))[0];
    await request('control_adapter', { agentId: 'codex:worker', credential: '3'.repeat(64), command: { id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: task.id, attempt: task.attempt } });
  };
  const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => {
    if (boundary === 'foreign receipt' && params?.command?.op === 'task.admission' && params.command.outcome === 'uncertain') {
      return guarded(method, { ...params, command: { ...params.command, receiptID: randomUUID() } }, guard);
    }
    if (boundary === 'during observation' && !injected && params?.command?.op === 'task.admission' && params.command.outcome === 'admitted') {
      injected = true; await uncertain();
    }
    return guarded(method, params, guard);
  };
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].stopGeneration, 1);
  if (boundary === 'additional uncertainty') await uncertain();
  if (boundary === 'cached proof') {
    const saved = JSON.parse(readFileSync(f.journal(), 'utf8')); saved.records[0].artifact = { digest: 'a'.repeat(64), finish: 'completed' };
    writeFileSync(f.journal(), JSON.stringify(saved), { mode: 0o600 });
  }
  const before = readFileSync(f.journal(), 'utf8'); f.state.taskPending = true; await f.runtime().poll('worker');
  if (boundary !== 'during observation') assert.equal(readFileSync(f.journal(), 'utf8'), before);
  else {
    assert.ok(injected); const record = JSON.parse(readFileSync(f.journal(), 'utf8')).records[0];
    assert.equal(record.task.stopGeneration, 0); assert.equal(record.observationGeneration, 1);
    assert.equal(f.errors.at(-1).code, 'STALE_STOP_GENERATION');
  }
  const retained = readFileSync(f.journal(), 'utf8'); f.state.taskPending = true; await f.runtime().poll('worker');
  assert.equal(readFileSync(f.journal(), 'utf8'), retained); assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 0);
  assert.equal((await f.query('tasks'))[0].stoppedEvidence, undefined);
});

for (const invalidate of [false, true]) test(`Codex rechecks stop eligibility after native snapshot reads before sending a deferred report notice (uncertainty: ${invalidate})`, async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker);
  const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => {
    const result = await guarded(method, params, guard);
    if (params?.command?.op === 'task.stopped') f.native.busy = true;
    return result;
  };
  await f.runtime().poll('worker'); await f.runtime().poll('worker');
  const before = readFileSync(f.journal(), 'utf8');
  assert.equal(JSON.parse(before).records[0].phase, 'reporting');
  assert.ok((await f.query('tasks'))[0].stoppedEvidence);
  f.native.busy = false;
  const read = f.ports.read;
  let injected = false;
  f.ports.read = async () => {
    if (!injected) {
      injected = true;
      if (invalidate) {
        const task = (await f.query('tasks'))[0];
        await request('control_adapter', { agentId: 'codex:worker', credential: '3'.repeat(64), command: {
          id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: task.id, attempt: task.attempt } });
      }
    }
    return read();
  };
  f.state.taskPending = true; await f.runtime().poll('worker');
  assert.ok(injected); assert.equal(f.native.starts, 1); assert.deepEqual(f.errors, []);
  if (!invalidate) {
    assert.equal(f.native.reports, 1); assert.equal((await f.query('tasks'))[0].status, 'review'); return;
  }
  assert.equal(f.native.reports, 0);
  assert.equal(f.state.taskPending, false); assert.equal(readFileSync(f.journal(), 'utf8'), before);
  const task = (await f.query('tasks'))[0];
  assert.equal(task.status, 'uncertain'); assert.equal(task.stoppedEvidence, undefined);
});

test('unknown Codex admission with no matching native turn remains uncertain and never blindly replays', async t => {
  const f = await fixture(t); f.native.loseAdmission = true;
  await f.runtime().poll('worker'); const lost = f.turns.splice(0);
  const runtime = f.runtime(); await runtime.poll('worker'); assert.equal(f.state.taskPending, false);
  assert.equal((await f.query('tasks'))[0].status, 'uncertain'); assert.equal(f.native.starts, 1);
  f.turns.push(...lost); runtime.notify('worker'); await runtime.poll('worker');
  assert.equal(f.native.starts, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
});

test('busy, blocked and transition-fenced native threads cannot admit claimed tasks', async t => {
  const f = await fixture(t), runtime = f.runtime();
  for (const flag of ['busy', 'blocked', 'fenced']) { f.native[flag] = true; await runtime.poll('worker'); assert.equal(f.native.starts, 0); f.native[flag] = false; }
  await runtime.poll('worker'); assert.equal(f.native.starts, 1);
});

test('changed native scope prevents start; interrupted native execution records stop but does not re-wake the human-stopped thread', async t => {
  await t.test('scope drift', async t => {
    const f = await fixture(t), request = f.worker.request.bind(f.worker);
    const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => { const result = await guarded(method, params, guard); if (method === 'control_task_pull') f.selection.approvalPolicy = 'never'; return result; };
    await f.runtime().poll('worker'); assert.equal(f.native.starts, 0); assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  });
  await t.test('human stop', async t => {
    const f = await fixture(t), runtime = f.runtime(); f.native.finish = 'interrupted';
    await runtime.poll('worker'); await runtime.poll('worker');
    assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 0); assert.ok((await f.query('tasks'))[0].stoppedEvidence);
  });
});

test('missing Codex journal for an admitted attempt cannot create a second native turn', async t => {
  const f = await fixture(t), runtime = f.runtime(); await runtime.poll('worker'); unlinkSync(f.journal());
  await f.runtime().poll('worker'); assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 0);
  assert.equal((await f.query('tasks'))[0].status, 'uncertain'); assert.equal(f.errors.at(-1).code, 'TASK_RECOVERY_REQUIRED');
});

test('Codex dispatch requires its separate broker switch and never permits worktree tasks', async t => {
  for (const options of [{ codexTasks: false }, { requiresWorktree: true }]) await t.test(JSON.stringify(options), async t => {
    const f = await fixture(t, options); await f.runtime().poll('worker'); assert.equal(f.native.starts, 0); assert.equal((await f.query('tasks'))[0].status, 'claimed');
  });
});

test('lost artifact acknowledgement reuses frozen Codex evidence instead of hashing later native changes', async t => {
  const f = await fixture(t), request = f.worker.request.bind(f.worker); let lost = false;
  const guarded = f.worker.requestGuarded.bind(f.worker); f.worker.requestGuarded = async (method, params, guard) => {
    const result = await guarded(method, params, guard);
    if (!lost && params?.command?.kind === 'artifact') { lost = true; throw new Error('lost artifact acknowledgement'); }
    return result;
  };
  const runtime = f.runtime(); await runtime.poll('worker'); await runtime.poll('worker');
  const original = (await f.query('evidence')).find(e => e.kind === 'artifact');
  f.turns[0].items.push({ type: 'agentMessage', text: 'later native observation' });
  await f.runtime().poll('worker');
  assert.equal(f.native.starts, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
  assert.deepEqual((await f.query('evidence')).filter(e => e.kind === 'artifact'), [original]);
});

test('uncertain report notice never repeats a native mutation or counts as participant completion', async t => {
  const f = await fixture(t), runtime = f.runtime(); f.native.loseReport = true;
  await runtime.poll('worker'); await runtime.poll('worker'); runtime.notify('worker'); await f.runtime().poll('worker');
  assert.equal(f.native.starts, 1); assert.equal(f.native.reports, 1);
  assert.equal((await f.query('tasks'))[0].status, 'review', 'only the explicit participant report advances to review, never completion');
});

test('native progress observations deduplicate unchanged turns and scope loss blocks stop/completion evidence', async t => {
  const f = await fixture(t), runtime = f.runtime(); f.native.finish = 'inProgress';
  await runtime.poll('worker'); await runtime.poll('worker'); await runtime.poll('worker');
  assert.equal((await f.query('events')).filter(e => e.type === 'task.progress').length, 1);
  f.ports.read = async () => ({ thread: { id: 'worker', cwd: f.root, turns: f.turns }, selection: null, configuration: {}, revision: f.native.rev });
  await runtime.poll('worker');
  assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  assert.equal((await f.query('evidence')).some(e => e.kind === 'stopped'), false); assert.equal(f.native.reports, 0);
});

test('a native lifecycle race during an observational read defers without quarantining or replaying task execution', async t => {
  const f = await fixture(t), runtime = f.runtime(); await runtime.poll('worker');
  const read = f.ports.read; let raced = false;
  f.ports.read = async () => {
    if (!raced) { raced = true; const error = new Error('native turn completed during read'); error.code = 'NATIVE_SNAPSHOT_CHANGED'; throw error; }
    return read();
  };
  await runtime.poll('worker'); assert.equal((await f.query('tasks'))[0].status, 'dispatching');
  await runtime.poll('worker'); assert.equal((await f.query('tasks'))[0].status, 'review'); assert.equal(f.native.starts, 1);
});

test('an older prepared journal reconciles an already visible exact native turn instead of starting it again', async t => {
  const f = await fixture(t); await f.runtime().poll('worker');
  const saved = JSON.parse(readFileSync(f.journal(), 'utf8'));
  saved.records[0].phase = 'prepared'; delete saved.records[0].turnID;
  writeFileSync(f.journal(), JSON.stringify(saved), { mode: 0o600 });
  await f.runtime().poll('worker');
  assert.equal(f.native.starts, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
});
