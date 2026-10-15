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
import { makeCodexTasks } from '../src/codex-tasks.js';

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

test('lost Codex admission response recovers only the exactly marked native turn after restart, never resends start', async t => {
  const f = await fixture(t); f.native.loseAdmission = true;
  await f.runtime().poll('worker'); assert.equal((await f.query('tasks'))[0].status, 'uncertain');
  await f.runtime().poll('worker'); assert.equal(f.native.starts, 1); assert.equal((await f.query('tasks'))[0].status, 'review');
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
    f.worker.request = async (method, params) => { const result = await request(method, params); if (method === 'control_task_pull') f.selection.approvalPolicy = 'never'; return result; };
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
  f.worker.request = async (method, params) => {
    const result = await request(method, params);
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
