import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { taskPrecondition, channelPrecondition } from '../src/control/contracts.js';

const operator = { kind: 'operator' }, scheduler = { kind: 'scheduler' };
const participant = agentId => ({ kind: 'participant', agentId });
const adapter = agentId => ({ kind: 'adapter', agentId });
const a = 'opencode:first', b = 'codex:second';
function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-task-precondition-'));
  let store = new ControlStore(root);
  const members = [{ agentId: a, harness: 'opencode', channel: 'dev', connected: true }, { agentId: b, harness: 'codex', channel: 'dev', connected: true }];
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const context = actor => ({ actor, members, now: 1000 });
  const run = (op, fields = {}, actor = operator) => {
    const command = { id: randomUUID(), channel: 'dev', op, ...fields }; store.apply(command, context(actor)); return command.id;
  };
  run('channel.configure');
  const taskID = run('task.create', { title: 'Exact task', instructions: 'Preserve claims', criteria: 'No cleanup grant', requiresWorktree: false });
  run('task.claim', { taskID }, participant(a));
  const task = () => store.snapshot().tasks.find(value => value.id === taskID);
  const prepare = () => {
    const capabilityEvidenceID = run('evidence.record', { entityID: taskID, kind: 'capability' }, adapter(a));
    run('evidence.record', { entityID: taskID, kind: 'idle' }, adapter(a));
    run('task.prepare', { taskID, capabilityEvidenceID }, scheduler);
    run('task.admission', { taskID, attempt: task().attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(a));
    run('task.started', { taskID, attempt: task().attempt, evidenceID: randomUUID() }, adapter(a));
  };
  return { run, taskID, task, context, prepare, get store() { return store; }, restart: () => { store.close(); store = new ControlStore(root); } };
}

test('task preview fence is stable across key order but binds all task values and is not participant authority', t => {
  const f = fixture(t), task = f.task(), expected = taskPrecondition(task);
  assert.deepEqual(taskPrecondition(Object.fromEntries(Object.entries(task).reverse())), expected);
  for (const fields of [{ claimant: b }, { attempt: task.attempt + 1 }, { claimGeneration: task.claimGeneration + 1 }, { status: 'uncertain' }, { admission: 'uncertain' }])
    assert.notEqual(taskPrecondition({ ...task, ...fields }).digest, expected.digest);
  assert.throws(() => f.store.apply({ id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID: f.taskID }, f.context(participant(a)), undefined, expected), /OPERATOR_REQUIRED/);
  assert.throws(() => f.store.apply({ id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID: f.taskID }, f.context(operator), undefined, { ...expected, taskID: randomUUID() }), /INVALID_TASK_PRECONDITION/);
});

test('a changed claimant with unchanged channel policy refuses stale reassignment inside the transaction', t => {
  const f = fixture(t), expected = taskPrecondition(f.task()), channel = channelPrecondition(f.store.snapshot().channels[0]);
  f.run('task.release', { taskID: f.taskID }, participant(a)); f.run('task.claim', { taskID: f.taskID }, participant(b));
  assert.deepEqual(channelPrecondition(f.store.snapshot().channels[0]), channel);
  const before = f.store.snapshot(), command = { id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID: f.taskID };
  assert.throws(() => f.store.apply(command, f.context(operator), channel, expected), /PRECONDITION_FAILED/);
  assert.deepEqual(f.store.snapshot(), before); assert.equal(f.store.commandReceipt('dev', command.id).known, false);
  f.store.apply(command, f.context(operator), channel, taskPrecondition(f.task()));
  assert.equal(f.task().status, 'open'); assert.equal(f.task().claimant, null);
});

test('exact committed reassignment receipt survives restart and cannot release a later claim on retry', t => {
  const f = fixture(t), expected = taskPrecondition(f.task()), command = { id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID: f.taskID };
  const first = f.store.apply(command, f.context(operator), undefined, expected);
  f.run('task.claim', { taskID: f.taskID }, participant(b)); const next = f.task(); f.restart();
  const retry = f.store.apply(command, f.context(operator), undefined, expected);
  assert.equal(retry.replayed, true); assert.deepEqual(retry.eventIDs, first.eventIDs); assert.deepEqual(f.task(), next);
});

test('matching task snapshot is not stop proof; fresh uncertainty revokes an old marker while retaining all evidence', t => {
  const f = fixture(t); f.run('channel.configure', { capacity: 1 }); f.prepare();
  const command = () => ({ id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID: f.taskID });
  assert.throws(() => f.store.apply(command(), f.context(operator), undefined, taskPrecondition(f.task())), /STOP_EVIDENCE_REQUIRED/);
  const oldStop = randomUUID(); f.run('task.stopped', { taskID: f.taskID, attempt: f.task().attempt, evidenceID: oldStop }, adapter(a));
  const expected = taskPrecondition(f.task());
  f.run('task.uncertain', { taskID: f.taskID, attempt: f.task().attempt }, adapter(a));
  assert.equal(f.task().stoppedEvidence, undefined);
  assert.ok(f.store.snapshot().evidence.some(e => e.id === oldStop && e.kind === 'stopped'));
  assert.throws(() => f.store.apply(command(), f.context(operator), undefined, expected), /PRECONDITION_FAILED/);
  assert.throws(() => f.store.apply(command(), f.context(operator), undefined, taskPrecondition(f.task())), /STOP_EVIDENCE_REQUIRED/);
  f.restart(); assert.equal(f.task().stoppedEvidence, undefined);
  const queued = f.run('task.create', { title: 'Other claim', instructions: 'Respect capacity', criteria: 'No guessed release', requiresWorktree: false });
  f.run('task.claim', { taskID: queued }, participant(b));
  const capabilityEvidenceID = f.run('evidence.record', { entityID: queued, kind: 'capability' }, adapter(b));
  f.run('evidence.record', { entityID: queued, kind: 'idle' }, adapter(b));
  assert.throws(() => f.run('task.prepare', { taskID: queued, capabilityEvidenceID }, scheduler), /CHANNEL_CAPACITY/);
  const fresh = randomUUID(); f.run('task.stopped', { taskID: f.taskID, attempt: f.task().attempt, evidenceID: fresh, stopGeneration: f.task().stopGeneration }, adapter(a));
  f.store.apply(command(), f.context(operator), undefined, taskPrecondition(f.task()));
  assert.equal(f.task().claimant, null); assert.equal(f.task().status, 'open');
  assert.ok(f.store.snapshot().evidence.some(e => e.id === oldStop)); assert.ok(f.store.snapshot().evidence.some(e => e.id === fresh));
  assert.ok(f.store.snapshot().incidents.some(i => i.status === 'open'), 'reassignment does not resolve admission incidents');
  f.run('task.prepare', { taskID: queued, capabilityEvidenceID }, scheduler);
  assert.equal(f.store.snapshot().tasks.find(t => t.id === queued).status, 'dispatching');
});

test('missed-schedule decision also binds the preview task claim, not only channel policy', t => {
  const f = fixture(t);
  const taskID = f.run('task.create', { title: 'Scheduled', instructions: 'Ask', criteria: 'Exact claimant', requiresWorktree: false, schedule: { at: 1, missed: 'ask', maxLatenessMs: 5 } });
  const original = f.store.snapshot().tasks.find(t => t.id === taskID), expected = taskPrecondition(original);
  f.run('task.claim', { taskID }, participant(b));
  const command = { id: randomUUID(), channel: 'dev', op: 'task.missed', taskID, run: false };
  assert.throws(() => f.store.apply(command, f.context(operator), undefined, expected), /PRECONDITION_FAILED/);
  const current = f.store.snapshot().tasks.find(t => t.id === taskID); assert.equal(current.status, 'claimed');
  f.store.apply(command, f.context(operator), undefined, taskPrecondition(current));
  assert.equal(f.store.snapshot().tasks.find(t => t.id === taskID).status, 'cancelled');
});
