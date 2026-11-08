import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, chmodSync, symlinkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { MASTER_LEASE_MS, RETENTION_MS, Command } from '../src/control/contracts.js';
import { masterInstructions, actionDecision } from '../src/control/policy.js';
import { readyTasks } from '../src/control/reducer.js';
import { projectChannelAlerts } from '../src/control/alert-contracts.js';
import { lifecycleDigest } from '../src/control/worktree-lifecycle-contracts.js';
import { worktreeApprovalForPreview } from '../src/control-admin-approval.js';

const human = { kind: 'operator' }, scheduler = { kind: 'scheduler' };
const peer = agentId => ({ kind: 'participant', agentId });
const adapter = agentId => ({ kind: 'adapter', agentId });
const a = 'opencode:a', b = 'codex:b', c = 'claude:c';
test('manual previews require fully qualified Windows paths', t => {
  const f = fixture(t), generation = f.appoint(), taskID = f.task({ requiresWorktree: true });
  f.run('task.claim', { taskID }, peer(b));
  for (const path of ['/destination', String.raw`C:\Users\Test\Project With Spaces`, String.raw`\\server\share\project`])
    assert.doesNotThrow(() => f.run('worktree.manual_preview', { generation, taskID, from: '/source', to: path }, peer(a)), path);
  for (const path of [String.raw`\project`, String.raw`\\server`]) {
    assert.throws(() => f.run('worktree.manual_preview', { generation, taskID, from: '/source', to: path }, peer(a)), /MANUAL_PATH_NOT_FULLY_QUALIFIED/);
    assert.throws(() => f.run('worktree.manual_preview', { generation, taskID, from: path, to: '/destination' }, peer(a)), /MANUAL_PATH_NOT_FULLY_QUALIFIED/);
  }
  assert.throws(() => f.run('worktree.manual_preview', { generation, taskID, from: '/source', to: String.raw`C:project` }, peer(a)));
  const legacy = Command.parse({ id: randomUUID(), op: 'worktree.manual_preview', channel: 'dev', generation, taskID, from: '/source', to: String.raw`\legacy` });
  const actor = peer(a), fingerprint = createHash('sha256').update(JSON.stringify({ command: legacy, actor })).digest('hex');
  const priorResult = { commandID: legacy.id, channel: 'dev', eventIDs: [] };
  f.store.db.prepare('INSERT INTO commands(id, fingerprint, result) VALUES(?,?,?)').run(legacy.id, fingerprint, JSON.stringify(priorResult));
  assert.deepEqual(f.store.apply(legacy, { actor, members: f.members, now: 1000 }), { ...priorResult, replayed: true },
    'legacy receipts remain replayable even though new ambiguous paths are refused');
});
function fixture(t, options = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-control-'));
  let store = new ControlStore(root, options), now = 1000;
  const members = [{ agentId: a, channel: 'dev', harness: 'opencode', connected: true },
    { agentId: b, channel: 'dev', harness: 'codex', connected: true }, { agentId: c, channel: 'dev', harness: 'claude', connected: true }];
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const run = (op, fields = {}, actor = human, channel = 'dev') => {
    const command = { id: randomUUID(), op, channel, ...fields };
    const context = { actor, members, now };
    const result = store.apply(command, context); return { ...command, result, context };
  };
  run('channel.configure');
  const state = () => store.snapshot();
  const channel = () => state().channels.find(ch => ch.id === 'dev');
  const appoint = (candidate = a) => {
    run('master.volunteer', { eligible: true }, peer(candidate));
    const proposal = run('master.appoint', { candidate });
    run('master.accept', { proposalID: proposal.id, promptVersion: 1 }, peer(candidate));
    return channel().active.generation;
  };
  const task = fields => run('task.create', { title: 'Fixture task', instructions: 'Implement isolated fixture', criteria: 'Supply test evidence', requiresWorktree: false, ...fields }).id;
  const evidence = (taskID, kind, fields = {}, agentId = b) => run('evidence.record', { entityID: taskID, kind, ...fields }, adapter(agentId)).id;
  const prepare = (taskID, agentId = b, worktree = false) => {
    const capabilityEvidenceID = evidence(taskID, 'capability', { sameConversationWorktree: worktree }, agentId);
    evidence(taskID, 'idle', {}, agentId);
    run('task.prepare', { taskID, capabilityEvidenceID }, scheduler);
    return state().tasks.find(task => task.id === taskID).attempt;
  };
  return { root, run, state, channel, appoint, task, evidence, prepare, members,
    advance: ms => { now += ms; }, restart: () => { store.close(); store = new ControlStore(root, options); },
    get store() { return store; } };
}

function acceptedTask(f) {
  const generation = f.appoint(), taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  f.run('task.admission', { taskID, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
  f.run('task.started', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
  const artifact = f.evidence(taskID, 'artifact', { attempt }), evidenceID = randomUUID();
  const stopped = f.run('task.stopped', { taskID, attempt, evidenceID }, adapter(b));
  f.run('task.report', { taskID, summary: 'Accepted result remains historical', evidence: [artifact] }, peer(b));
  f.run('task.review', { taskID, generation, accept: true, evidenceID: artifact }, peer(a));
  return { taskID, attempt, artifact, stopped };
}

test('control defaults and strict commands preserve role separation', t => {
  const f = fixture(t);
  assert.equal(f.channel().mode, 'safe'); assert.equal(f.channel().electionsEnabled, true);
  assert.throws(() => f.run('channel.configure', { mode: 'automatic' }, peer(a)), /OPERATOR_REQUIRED/);
  assert.throws(() => Command.parse({ id: randomUUID(), op: 'master.appoint', channel: 'dev', candidate: a, actor: human }), /Unrecognized/);
  assert.throws(() => f.run('action.request', { generation: 0, operation: 'remove_member', target: b, evidence: 'not_applicable' }, peer(a)), /STALE_MASTER/);
});

test('session preparation requirement is master-bound, durable and cannot be hidden as schema 34', t => {
  const f = fixture(t), generation = f.appoint(), taskID = f.task({ requiresWorktree: true });
  f.run('task.claim', { taskID }, peer(b));
  const digest = 'a'.repeat(64), preview = f.run('worktree.preview', { taskID, from: '/source', to: '/destination', configurationDigest: digest,
    binding: { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: digest, destinationAuthorityDigest: digest,
      sources: [{ path: '/source/AGENTS.md', digest }] } }, adapter(b));
  f.run('worktree.approve', { taskID, previewID: preview.id });
  assert.throws(() => f.run('worktree.session_require', { generation, taskID, previewID: preview.id }, peer(b)), /STALE_MASTER/);
  f.run('worktree.session_require', { generation, taskID, previewID: preview.id }, peer(a));
  f.restart();
  assert.equal(f.state().previews.find(value => value.id === preview.id).sessionCoordinator, a);
  f.store.db.exec('PRAGMA user_version=34');
  f.store.close();
  try { assert.throws(() => new ControlStore(f.root), /UNSUPPORTED_CONTROL_SCHEMA/); }
  finally { const db = new DatabaseSync(join(f.root, 'control.db')); db.exec('PRAGMA user_version=36'); db.close(); }
  f.restart();
});

for (const stopFirst of [false, true]) {
  test(`review-phase uncertainty preserves the report, revokes stop/capacity authority and cancels only pending review hints (stop first: ${stopFirst})`, t => {
    const f = fixture(t), generation = f.appoint(); f.run('channel.configure', { capacity: 1 });
    const taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
    f.run('task.admission', { taskID, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
    f.run('task.started', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
    const artifact = f.evidence(taskID, 'artifact', { attempt });
    const stoppedID = randomUUID(); let stopped;
    if (stopFirst) stopped = f.run('task.stopped', { taskID, attempt, evidenceID: stoppedID }, adapter(b));
    f.run('task.report', { taskID, summary: 'Retained participant result, not stop proof', evidence: [artifact] }, peer(b));
    if (!stopFirst) stopped = f.run('task.stopped', { taskID, attempt, evidenceID: stoppedID }, adapter(b));
    const original = f.state().tasks.find(v => v.id === taskID), report = original.result;
    const pending = f.store.notices('dev', a).entries.find(n => n.kind === 'task_review'); assert.equal(pending.taskID, taskID);
    assert.throws(() => f.run('task.uncertain', { taskID, attempt: attempt + 1 }, adapter(b)), /STALE_TASK_ATTEMPT/);
    assert.throws(() => f.run('task.uncertain', { taskID, attempt }, peer(b)), /STALE_TASK_ATTEMPT/);
    assert.equal(f.state().tasks.find(v => v.id === taskID).stoppedEvidence, stoppedID);
    f.run('task.uncertain', { taskID, attempt }, adapter(b));
    const held = f.state().tasks.find(v => v.id === taskID);
    assert.equal(held.status, 'review'); assert.equal(held.stoppedEvidence, undefined); assert.deepEqual(held.result, report);
    assert.ok(f.state().evidence.some(e => e.id === stoppedID));
    assert.equal(f.store.notices('dev', a).entries.filter(n => n.kind === 'task_review').length, 0);
    assert.equal(f.store.db.prepare('SELECT status FROM notices WHERE id=?').get(pending.id).status, 'cancelled');
    assert.throws(() => f.store.acceptNotice('dev', a, pending.id, 'msg_stale_review', 1000), /NOTICE_CANCELLED/);
    const workerHints = projectChannelAlerts(f.state(), f.channel(), b, 1000);
    assert.equal(workerHints.tasks.uncertain, 1); assert.equal(workerHints.tasks.awaitingReview, 1);
    assert.equal(projectChannelAlerts(f.state(), f.channel(), a, 1000, true).tasks.reviewForYou, 0);
    assert.throws(() => f.run('task.review', { taskID, generation, accept: true, evidenceID: artifact }, peer(a)), /STOP_EVIDENCE_REQUIRED/);
    const { result, context, ...oldCommand } = stopped;
    assert.equal(f.store.apply(oldCommand, context).replayed, true);
    assert.equal(f.state().tasks.find(v => v.id === taskID).stoppedEvidence, undefined, 'old command receipt cannot reinstate its stop marker');
    assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: stoppedID, stopGeneration: held.stopGeneration }, adapter(b)), /Duplicate control entity/);
    const queued = f.task(); f.run('task.claim', { taskID: queued }, peer(a));
    assert.throws(() => f.prepare(queued, a), /CHANNEL_CAPACITY/);
    f.restart(); assert.deepEqual(f.state().tasks.find(v => v.id === taskID).result, report);
    assert.equal(f.state().tasks.find(v => v.id === taskID).stoppedEvidence, undefined);
    const fresh = randomUUID(); f.run('task.stopped', { taskID, attempt, evidenceID: fresh, stopGeneration: held.stopGeneration }, adapter(b));
    const restored = f.state().tasks.find(v => v.id === taskID); assert.equal(restored.status, 'review'); assert.deepEqual(restored.result, report);
    const nextNotice = f.store.notices('dev', a).entries.find(n => n.kind === 'task_review');
    assert.equal(nextNotice.taskID, taskID); assert.notEqual(nextNotice.id, pending.id);
    assert.equal(f.store.db.prepare('SELECT status FROM notices WHERE id=?').get(pending.id).status, 'cancelled');
    f.prepare(queued, a);
    f.run('task.review', { taskID, generation, accept: true, evidenceID: artifact }, peer(a));
    assert.equal(f.state().tasks.find(v => v.id === taskID).status, 'completed');
    assert.ok(f.state().incidents.some(i => i.entityID === taskID && i.status === 'open'), 'review does not resolve the admission incident');
  });
}

test('schema-8 review-notice migration preserves bytes and conservatively cancels legacy hints without parsing prompt text', t => {
  const f = fixture(t); f.appoint();
  const reported = () => {
    const taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
    f.run('task.admission', { taskID, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
    f.run('task.started', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
    const artifact = f.evidence(taskID, 'artifact', { attempt });
    f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
    f.run('task.report', { taskID, summary: 'Keep exact report', evidence: [artifact] }, peer(b)); return { taskID, attempt };
  };
  const first = reported(), second = reported();
  const notices = f.store.notices('dev', a).entries.filter(n => n.kind === 'task_review');
  const legacy = notices.find(n => n.taskID === first.taskID); delete legacy.sequence; delete legacy.taskID;
  f.store.db.prepare('UPDATE notices SET body=? WHERE id=?').run(JSON.stringify(legacy), legacy.id);
  const raw = f.store.db.prepare('SELECT body FROM control_state').get().body;
  const body = f.store.db.prepare('SELECT body FROM notices WHERE id=?').get(legacy.id).body;
  f.store.db.exec('PRAGMA user_version=8'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store.db.prepare('SELECT body FROM control_state').get().body, raw);
  assert.equal(f.store.db.prepare('SELECT body FROM notices WHERE id=?').get(legacy.id).body, body);
  f.run('task.uncertain', first, adapter(b));
  assert.equal(f.store.db.prepare('SELECT status FROM notices WHERE id=?').get(legacy.id).status, 'cancelled');
  assert.equal(f.store.notices('dev', a).entries.filter(n => n.kind === 'task_review')[0].taskID, second.taskID);
  assert.equal(f.state().tasks.find(v => v.id === second.taskID).status, 'review');
});

test('review uncertainty and pending-hint cancellation roll back together and retry under the same command ID', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit: () => { if (fail) throw new Error('review commit fault'); } }); f.appoint();
  const taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  f.run('task.admission', { taskID, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
  f.run('task.started', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
  const artifact = f.evidence(taskID, 'artifact', { attempt });
  f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
  f.run('task.report', { taskID, summary: 'Atomic review hold', evidence: [artifact] }, peer(b));
  const before = f.state(), notices = f.store.notices('dev', a), id = randomUUID();
  fail = true;
  assert.throws(() => f.run('task.uncertain', { id, taskID, attempt }, adapter(b)), /review commit fault/);
  fail = false;
  assert.deepEqual(f.state(), before); assert.deepEqual(f.store.notices('dev', a), notices);
  assert.equal(f.store.commandReceipt('dev', id).known, false);
  f.run('task.uncertain', { id, taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(v => v.id === taskID).stoppedEvidence, undefined);
  assert.equal(f.store.notices('dev', a).entries.some(n => n.kind === 'task_review'), false);
  assert.equal(f.store.commandReceipt('dev', id).known, true);
});

test('late completion uncertainty preserves acceptance and old stop evidence but retains capacity across replay/restart', t => {
  const f = fixture(t); f.run('channel.configure', { capacity: 1 });
  const { taskID, attempt, stopped } = acceptedTask(f), completed = f.state().tasks.find(t => t.id === taskID);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const held = f.state().tasks.find(t => t.id === taskID);
  assert.equal(held.status, 'completed'); assert.equal(held.terminalHold, true); assert.equal(held.stoppedEvidence, completed.stoppedEvidence);
  assert.deepEqual(held.result, completed.result); assert.equal(f.store.storageStatus().unresolved.tasks, 1);
  assert.equal(projectChannelAlerts(f.state(), f.channel(), b, 1000).tasks.uncertain, 1);
  const { result, context, ...command } = stopped;
  assert.equal(f.store.apply(command, context).replayed, true);
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: completed.stoppedEvidence, holdGeneration: held.terminalHoldGeneration }, adapter(b)), /Duplicate control entity/);
  assert.throws(() => f.run('task.uncertain', { taskID, attempt: attempt + 1 }, adapter(b)), /STALE_TASK_ATTEMPT/);
  const queued = f.task(); f.run('task.claim', { taskID: queued }, peer(a));
  assert.throws(() => f.prepare(queued, a), /CHANNEL_CAPACITY/);
  f.restart(); assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
  const fresh = randomUUID(); f.run('task.stopped', { taskID, attempt, evidenceID: fresh, holdGeneration: held.terminalHoldGeneration }, adapter(b));
  const settled = f.state().tasks.find(t => t.id === taskID);
  assert.equal(settled.status, 'completed'); assert.equal(settled.terminalHold, false); assert.deepEqual(settled.result, completed.result);
  assert.equal(settled.stoppedEvidence, fresh); assert.ok(f.state().evidence.some(e => e.id === completed.stoppedEvidence));
  assert.equal(f.store.events('dev').entries.filter(e => e.type === 'task.completed').length, 1);
  assert.ok(f.state().incidents.some(i => i.entityID === taskID && i.status === 'open'));
  f.prepare(queued, a);
});

test('new dependent dispatch cannot use an accepted producer with a later terminal stop hold', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f);
  const dependent = f.task({ dependencies: [taskID] }); f.run('task.claim', { taskID: dependent }, peer(a));
  assert.equal(readyTasks(f.state(), 'dev', 1000)[0].id, dependent);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  assert.deepEqual(readyTasks(f.state(), 'dev', 1000), []);
  assert.throws(() => f.prepare(dependent, a), /DEPENDENCIES_NOT_COMPLETE/);
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
  f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration }, adapter(b));
  f.prepare(dependent, a); assert.equal(f.state().tasks.find(t => t.id === dependent).status, 'dispatching');
});

test('late uncertainty after a dispatched cancellation overrides historical unadmitted release authority without undoing cancellation', t => {
  const f = fixture(t), taskID = f.task({ schedule: { at: 1000, missed: 'ask', maxLatenessMs: 5 } });
  f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  f.run('task.admission', { taskID, attempt, outcome: 'unadmitted', receiptID: randomUUID() }, adapter(b));
  f.run('task.missed', { taskID, run: false });
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const task = f.state().tasks.find(t => t.id === taskID);
  assert.equal(task.status, 'cancelled'); assert.equal(task.admission, 'unadmitted'); assert.equal(task.terminalHold, true);
  const queued = f.task(); f.run('task.claim', { taskID: queued }, peer(b));
  assert.throws(() => f.prepare(queued), /CONVERSATION_CAPACITY/);
  f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: task.terminalHoldGeneration }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).status, 'cancelled');
  f.prepare(queued);
});

test('an adapter cannot attach a terminal execution hold to a cancelled task that was never dispatched', t => {
  const f = fixture(t), taskID = f.task({ schedule: { at: 1000, missed: 'ask', maxLatenessMs: 5 } });
  f.run('task.claim', { taskID }, peer(b)); f.run('task.missed', { taskID, run: false });
  assert.throws(() => f.run('task.uncertain', { taskID, attempt: 0 }, adapter(b)), /TASK_NOT_ACTIVE/);
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, false);
});

test('schema-9 migration preserves old completed state bytes and does not infer a native cleanup grant', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f), legacy = JSON.parse(f.store.db.prepare('SELECT body FROM control_state').get().body);
  for (const task of legacy.tasks) { delete task.terminalHold; delete task.terminalHoldGeneration; }
  const body = JSON.stringify(legacy); f.store.db.prepare('UPDATE control_state SET body=?').run(body);
  f.store.db.exec('PRAGMA user_version=9'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store.db.prepare('SELECT body FROM control_state').get().body, body);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
});

test('late terminal hold invalidates already-approved managed effects for the same conversation', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f), queued = f.task();
  f.run('task.claim', { taskID: queued }, peer(b));
  const id = randomUUID(), preview = { id, resourceID: id, kind: 'create', phase: 'preview', agentId: b, taskID: queued,
    claimGeneration: 1, repository: '/repo', common: '/repo/.git', destination: `/managed/${id}/tree`, revision: 'a'.repeat(40), createdAt: 1000, expiresAt: 2000 };
  f.run('managed.preview', { hostId: 'host', preview }, adapter(b));
  const digest = lifecycleDigest(preview); f.run('managed.approve', { previewID: id, digest });
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  assert.throws(() => f.run('managed.begin', { previewID: id, digest }, adapter(b)), /EXECUTION_MAY_BE_ACTIVE/);
  assert.equal(f.state().managedPreviews.find(v => v.id === id).status, 'approved');
  f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration }, adapter(b));
  f.run('managed.begin', { previewID: id, digest }, adapter(b));
  assert.equal(f.state().managedPreviews.find(v => v.id === id).status, 'executing');
});

test('terminal stop callbacks bind the observed hold generation, not merely task ID and attempt', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const first = f.state().tasks.find(t => t.id === taskID); assert.equal(first.terminalHoldGeneration, 1);
  const delayed = { id: randomUUID(), op: 'task.stopped', channel: 'dev', taskID, attempt, evidenceID: randomUUID(), holdGeneration: first.terminalHoldGeneration };
  const uncertaintyID = randomUUID(); f.run('task.uncertain', { id: uncertaintyID, taskID, attempt }, adapter(b));
  f.restart(); assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration, 2);
  const before = f.state();
  assert.throws(() => f.store.apply(delayed, { actor: adapter(b), members: f.members, now: 1000 }), /STALE_TERMINAL_HOLD/);
  assert.deepEqual(f.state(), before); assert.equal(f.store.commandReceipt('dev', delayed.id).known, false);
  f.run('task.uncertain', { id: uncertaintyID, taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration, 2, 'uncertainty receipt retry is not a new generation');
  const fresh = f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: 2 }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, false);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const { context, result, ...oldStop } = fresh;
  assert.equal(f.store.apply(oldStop, context).replayed, true);
  const held = f.state().tasks.find(t => t.id === taskID);
  assert.equal(held.terminalHold, true); assert.equal(held.terminalHoldGeneration, 3); assert.equal(held.status, 'completed');
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: 2 }, adapter(b)), /STALE_TERMINAL_HOLD/);
  f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: 3 }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration, 3, 'settlement never resets the generation');
});

test('terminal stop refuses missing, future, zero and foreign-actor generations without recording a receipt', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f); f.run('task.uncertain', { taskID, attempt }, adapter(b));
  for (const holdGeneration of [undefined, 0, 2, Number.MAX_SAFE_INTEGER]) {
    const id = randomUUID();
    assert.throws(() => f.run('task.stopped', { id, taskID, attempt, evidenceID: randomUUID(), ...(holdGeneration === undefined ? {} : { holdGeneration }) }, adapter(b)), /STALE_TERMINAL_HOLD/);
    assert.equal(f.store.commandReceipt('dev', id).known, false);
  }
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: 1 }, adapter(a)), /STALE_TASK_ATTEMPT/);
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
});

test('legacy schema-10 terminal holds remain unbound and retained after byte-preserving migration', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f); f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const legacy = JSON.parse(f.store.db.prepare('SELECT body FROM control_state').get().body);
  for (const task of legacy.tasks) delete task.terminalHoldGeneration;
  const body = JSON.stringify(legacy); f.store.db.prepare('UPDATE control_state SET body=?').run(body); f.store.db.exec('PRAGMA user_version=10'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store.db.prepare('SELECT body FROM control_state').get().body, body);
  const held = f.state().tasks.find(t => t.id === taskID); assert.equal(held.terminalHold, true); assert.equal(held.terminalHoldGeneration, 0);
  for (const holdGeneration of [undefined, 0, 1]) assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), ...(holdGeneration === undefined ? {} : { holdGeneration }) }, adapter(b)), /STALE_TERMINAL_HOLD/);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true, 'a new refusal records no release');
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration, 1);
});

test('exhausted terminal hold generations saturate in quarantine rather than wrapping or authorizing settlement', t => {
  const f = fixture(t), { taskID, attempt } = acceptedTask(f), state = f.state();
  state.tasks.find(t => t.id === taskID).terminalHoldGeneration = Number.MAX_SAFE_INTEGER - 1;
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  for (let i = 0; i < 2; i++) f.run('task.uncertain', { taskID, attempt }, adapter(b));
  f.restart(); const held = f.state().tasks.find(t => t.id === taskID);
  assert.equal(held.terminalHold, true); assert.equal(held.terminalHoldGeneration, Number.MAX_SAFE_INTEGER);
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), holdGeneration: held.terminalHoldGeneration }, adapter(b)), /STALE_TERMINAL_HOLD/);
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
});

test('hold generation, uncertainty event and command receipt roll back together', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit: () => { if (fail) throw new Error('generation commit fault'); } }), { taskID, attempt } = acceptedTask(f), id = randomUUID();
  fail = true; assert.throws(() => f.run('task.uncertain', { id, taskID, attempt }, adapter(b)), /generation commit fault/); fail = false;
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration, 0); assert.equal(f.store.commandReceipt('dev', id).known, false);
  f.run('task.uncertain', { id, taskID, attempt }, adapter(b)); f.run('task.uncertain', { id, taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHoldGeneration, 1);
  assert.equal(f.store.events('dev').entries.filter(e => e.type === 'task.uncertain' && e.entityID === taskID).length, 1);
});

for (const review of [false, true]) test(`stop generation rejects callbacks crossing successive uncertainty commands (review: ${review})`, t => {
  const f = fixture(t), generation = f.appoint(), taskID = f.task();
  f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  f.run('task.admission', { taskID, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
  f.run('task.started', { taskID, attempt, evidenceID: randomUUID() }, adapter(b));
  const artifact = f.evidence(taskID, 'artifact', { attempt });
  if (review) f.run('task.report', { taskID, summary: 'Preserved report', evidence: [artifact] }, peer(b));
  const current = () => f.state().tasks.find(t => t.id === taskID);
  const first = f.run('task.uncertain', { taskID, attempt }, adapter(b));
  assert.equal(current().stopGeneration, 1);
  const { context, result, ...retry } = first; f.store.apply(retry, context);
  assert.equal(current().stopGeneration, 1, 'exact command replay cannot advance twice');
  f.run('task.uncertain', { taskID, attempt }, adapter(b)); f.restart();
  assert.equal(current().stopGeneration, 2);
  for (const stopGeneration of [undefined, 0, 1, 3, Number.MAX_SAFE_INTEGER]) {
    const id = randomUUID(), before = f.state();
    assert.throws(() => f.run('task.stopped', { id, taskID, attempt, evidenceID: randomUUID(), stopGeneration }, adapter(b)), /STALE_STOP_GENERATION/);
    assert.deepEqual(f.state(), before); assert.equal(f.store.commandReceipt('dev', id).known, false);
  }
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), stopGeneration: 2 }, adapter(a)), /STALE_TASK_ATTEMPT/);
  assert.equal(current().stoppedEvidence, undefined);
  const stopped = f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), stopGeneration: 2 }, adapter(b));
  assert.ok(current().stoppedEvidence); assert.equal(current().stopGeneration, 2);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const { context: oldContext, result: oldResult, ...oldStop } = stopped;
  assert.equal(f.store.apply(oldStop, oldContext).replayed, true); assert.equal(current().stoppedEvidence, undefined);
  assert.equal(current().stopGeneration, 3);
  if (review) {
    assert.equal(current().result.summary, 'Preserved report');
    assert.throws(() => f.run('task.review', { taskID, generation, accept: true, evidenceID: artifact }, peer(a)), /STOP_EVIDENCE_REQUIRED/);
  } else assert.throws(() => f.run('task.reassign', { taskID }, human), /STOP_EVIDENCE_REQUIRED/);
  f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), stopGeneration: 3 }, adapter(b));
  if (review) f.run('task.review', { taskID, generation, accept: true, evidenceID: artifact }, peer(a));
  else f.run('task.reassign', { taskID }, human);
  assert.equal(current().stopGeneration, 3, 'review/reassignment never resets the counter');
  if (!review) {
    f.run('task.claim', { taskID }, peer(b)); const nextAttempt = f.prepare(taskID);
    assert.equal(current().stopGeneration, 3, 'new dispatch never resets the counter');
    assert.throws(() => f.run('task.stopped', { taskID, attempt: nextAttempt, evidenceID: randomUUID() }, adapter(b)), /STALE_STOP_GENERATION/);
    f.run('task.stopped', { taskID, attempt: nextAttempt, evidenceID: randomUUID(), stopGeneration: 3 }, adapter(b));
  }
});

test('schema-11 migration retains old bytes and receipts without claiming historical stop freshness', t => {
  const f = fixture(t), { taskID, attempt, stopped } = acceptedTask(f);
  const legacy = f.state(); for (const task of legacy.tasks) delete task.stopGeneration;
  const body = JSON.stringify(legacy); f.store.db.prepare('UPDATE control_state SET body=?').run(body);
  f.store.db.exec('PRAGMA user_version=11'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store.db.prepare('SELECT body FROM control_state').get().body, body);
  assert.equal(f.state().tasks.find(t => t.id === taskID).stopGeneration, 0);
  const { context, result, ...command } = stopped; assert.equal(f.store.apply(command, context).replayed, true);
  assert.equal(f.state().tasks.find(t => t.id === taskID).status, 'completed');
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).terminalHold, true);
});

test('stop-generation exhaustion stays quarantined and failed uncertainty commits preserve the epoch', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit: () => { if (fail) throw new Error('stop epoch commit fault'); } });
  const taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID), id = randomUUID();
  const before = f.state(); fail = true;
  assert.throws(() => f.run('task.uncertain', { id, taskID, attempt }, adapter(b)), /stop epoch commit fault/); fail = false;
  assert.deepEqual(f.state(), before); assert.equal(f.store.commandReceipt('dev', id).known, false);
  f.run('task.uncertain', { id, taskID, attempt }, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).stopGeneration, 1);
  const exhausted = f.state(); exhausted.tasks.find(t => t.id === taskID).stopGeneration = Number.MAX_SAFE_INTEGER - 1;
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(exhausted));
  for (let i = 0; i < 2; i++) f.run('task.uncertain', { taskID, attempt }, adapter(b));
  f.restart(); assert.equal(f.state().tasks.find(t => t.id === taskID).stopGeneration, Number.MAX_SAFE_INTEGER);
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), stopGeneration: Number.MAX_SAFE_INTEGER }, adapter(b)), /STALE_STOP_GENERATION/);
});

test('admission, start and progress callbacks cannot cross explicit uncertainty epochs or manufacture dispatchability', t => {
  const f = fixture(t), taskID = f.task(); f.run('task.claim', { taskID }, peer(b));
  const capabilityEvidenceID = f.evidence(taskID, 'capability'); f.evidence(taskID, 'idle');
  f.run('task.prepare', { taskID, capabilityEvidenceID, cwd: '/fixture', scopeDigest: 'a'.repeat(64) }, scheduler);
  const task = () => f.state().tasks.find(t => t.id === taskID), attempt = task().attempt, admissionID = task().nativeAdmissionID;
  f.run('task.uncertain', { taskID, attempt }, adapter(b)); f.restart();
  for (const outcome of ['admitted', 'unadmitted', 'uncertain']) for (const stopGeneration of [undefined, 0, 2]) {
    const before = f.state(), events = f.store.events('dev'), id = randomUUID();
    assert.throws(() => f.run('task.admission', { id, taskID, attempt, outcome, admissionID, receiptID: randomUUID(), stopGeneration }, adapter(b)), /STALE_STOP_GENERATION/);
    assert.deepEqual(f.state(), before); assert.deepEqual(f.store.events('dev'), events); assert.equal(f.store.commandReceipt('dev', id).known, false);
  }
  assert.equal(task().status, 'uncertain'); assert.equal(task().admission, 'none');
  assert.throws(() => f.run('task.reassign', { taskID }), /STOP_EVIDENCE_REQUIRED/);
  // Matching epoch only preserves the existing exact-admission reconciliation
  // contract; it is not a fresh native observation or release attestation.
  const admitted = f.run('task.admission', { taskID, attempt, outcome: 'admitted', admissionID, receiptID: randomUUID(), stopGeneration: 1 }, adapter(b));
  for (const stopGeneration of [undefined, 0, 2]) {
    assert.throws(() => f.run('task.started', { taskID, attempt, evidenceID: randomUUID(), stopGeneration }, adapter(b)), /STALE_STOP_GENERATION/);
  }
  f.run('task.started', { taskID, attempt, evidenceID: randomUUID(), stopGeneration: 1 }, adapter(b));
  f.advance(1000); const beforeProgress = task().lastProgressAt;
  for (const stopGeneration of [undefined, 0, 2]) {
    assert.throws(() => f.run('task.progress', { taskID, attempt, stopGeneration }, adapter(b)), /STALE_STOP_GENERATION/);
    assert.equal(task().lastProgressAt, beforeProgress);
  }
  f.run('task.progress', { taskID, attempt, stopGeneration: 1 }, adapter(b)); assert.ok(task().lastProgressAt > beforeProgress);
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const { result, context, ...oldAdmission } = admitted, held = f.state();
  assert.equal(f.store.apply(oldAdmission, context).replayed, true); assert.deepEqual(f.state(), held);
  for (const op of ['task.admission', 'task.started', 'task.progress']) {
    const fields = op === 'task.admission' ? { outcome: 'admitted', admissionID, receiptID: randomUUID() } : op === 'task.started' ? { evidenceID: randomUUID() } : {};
    assert.throws(() => f.run(op, { taskID, attempt, stopGeneration: 1, ...fields }, adapter(b)), /STALE_STOP_GENERATION/);
  }
  assert.equal(task().status, 'uncertain'); assert.equal(task().stopGeneration, 2); assert.equal(task().stoppedEvidence, undefined);
});

test('schema-12 callback-fence migration preserves state and historical command receipts byte-for-byte', t => {
  const f = fixture(t), taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  const admission = f.run('task.admission', { taskID, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
  f.run('task.uncertain', { taskID, attempt }, adapter(b));
  const body = f.store.db.prepare('SELECT body FROM control_state').get().body;
  const receipt = f.store.db.prepare('SELECT result FROM commands WHERE id=?').get(admission.id).result;
  f.store.db.exec('PRAGMA user_version=12'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store.db.prepare('SELECT body FROM control_state').get().body, body);
  assert.equal(f.store.db.prepare('SELECT result FROM commands WHERE id=?').get(admission.id).result, receipt);
  const { result, context, ...oldCommand } = admission; assert.equal(f.store.apply(oldCommand, context).replayed, true);
  assert.equal(f.state().tasks.find(t => t.id === taskID).status, 'uncertain');
});

test('matched admission callback rollback preserves uncertainty and permits only an exact later retry', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit: () => { if (fail) throw new Error('admission epoch commit fault'); } }), taskID = f.task();
  f.run('task.claim', { taskID }, peer(b));
  const capabilityEvidenceID = f.evidence(taskID, 'capability'); f.evidence(taskID, 'idle');
  f.run('task.prepare', { taskID, capabilityEvidenceID, cwd: '/fixture', scopeDigest: 'a'.repeat(64) }, scheduler);
  const task = f.state().tasks.find(t => t.id === taskID), attempt = task.attempt;
  f.run('task.uncertain', { taskID, attempt }, adapter(b)); const before = f.state(), id = randomUUID(), receiptID = randomUUID();
  const fields = { id, taskID, attempt, outcome: 'admitted', receiptID, admissionID: task.nativeAdmissionID, stopGeneration: 1 };
  fail = true; assert.throws(() => f.run('task.admission', fields, adapter(b)), /admission epoch commit fault/); fail = false;
  assert.deepEqual(f.state(), before); assert.equal(f.store.commandReceipt('dev', id).known, false);
  f.run('task.admission', fields, adapter(b)); f.run('task.admission', fields, adapter(b));
  assert.equal(f.state().tasks.find(t => t.id === taskID).stopGeneration, 1);
  assert.equal(f.state().evidence.filter(e => e.id === receiptID).length, 1);
});

test('exhausted stop epochs reject admission, start and progress callbacks without new receipts', t => {
  const f = fixture(t), taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  const state = f.state(); state.tasks.find(t => t.id === taskID).stopGeneration = Number.MAX_SAFE_INTEGER;
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state)); f.restart();
  for (const op of ['task.admission', 'task.started', 'task.progress']) {
    const id = randomUUID(), fields = op === 'task.admission' ? { outcome: 'unadmitted', receiptID: randomUUID() } : op === 'task.started' ? { evidenceID: randomUUID() } : {};
    assert.throws(() => f.run(op, { id, taskID, attempt, stopGeneration: Number.MAX_SAFE_INTEGER, ...fields }, adapter(b)), /STALE_STOP_GENERATION/);
    assert.equal(f.store.commandReceipt('dev', id).known, false); assert.deepEqual(f.state(), state);
  }
});

test('uncertain admission advances the callback epoch once and refuses all pre-outcome lifecycle callbacks', t => {
  const f = fixture(t), taskID = f.task(); f.run('task.claim', { taskID }, peer(b));
  const capabilityEvidenceID = f.evidence(taskID, 'capability'); f.evidence(taskID, 'idle');
  f.run('task.prepare', { taskID, capabilityEvidenceID, cwd: '/fixture', scopeDigest: 'a'.repeat(64) }, scheduler);
  const current = () => f.state().tasks.find(t => t.id === taskID), attempt = current().attempt, admissionID = current().nativeAdmissionID;
  const uncertain = f.run('task.admission', { taskID, attempt, outcome: 'uncertain', receiptID: randomUUID(), admissionID }, adapter(b));
  const { result, context, ...retry } = uncertain; f.store.apply(retry, context); f.restart();
  assert.equal(current().stopGeneration, 1); assert.equal(current().status, 'uncertain');
  for (const op of ['task.admission', 'task.started', 'task.progress', 'task.stopped']) for (const stopGeneration of [undefined, 0, 2]) {
    const id = randomUUID(), before = f.state(), fields = op === 'task.admission' ? { outcome: 'admitted', admissionID, receiptID: randomUUID() } :
      op === 'task.progress' ? {} : { evidenceID: randomUUID() };
    assert.throws(() => f.run(op, { id, taskID, attempt, stopGeneration, ...fields }, adapter(b)), /STALE_STOP_GENERATION/);
    assert.deepEqual(f.state(), before); assert.equal(f.store.commandReceipt('dev', id).known, false);
  }
  f.run('task.admission', { taskID, attempt, outcome: 'admitted', admissionID, receiptID: randomUUID(), stopGeneration: 1 }, adapter(b));
  f.run('task.admission', { taskID, attempt, outcome: 'uncertain', admissionID, receiptID: randomUUID(), stopGeneration: 1 }, adapter(b));
  assert.equal(current().stopGeneration, 2);
  f.store.apply(retry, context); assert.equal(current().stopGeneration, 2, 'old uncertain receipt cannot roll back or advance a later epoch');
});

test('admission-uncertainty epoch, evidence, event and receipt roll back together and saturate in refusal', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit: () => { if (fail) throw new Error('admission uncertainty fault'); } }), taskID = f.task();
  f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID), id = randomUUID(), receiptID = randomUUID(), before = f.state();
  fail = true; assert.throws(() => f.run('task.admission', { id, taskID, attempt, outcome: 'uncertain', receiptID }, adapter(b)), /admission uncertainty fault/); fail = false;
  assert.deepEqual(f.state(), before); assert.equal(f.store.commandReceipt('dev', id).known, false);
  const exhausted = f.state(); exhausted.tasks.find(t => t.id === taskID).stopGeneration = Number.MAX_SAFE_INTEGER - 1;
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(exhausted));
  f.run('task.admission', { id, taskID, attempt, outcome: 'uncertain', receiptID, stopGeneration: Number.MAX_SAFE_INTEGER - 1 }, adapter(b));
  f.restart(); assert.equal(f.state().tasks.find(t => t.id === taskID).stopGeneration, Number.MAX_SAFE_INTEGER);
  assert.throws(() => f.run('task.stopped', { taskID, attempt, evidenceID: randomUUID(), stopGeneration: Number.MAX_SAFE_INTEGER }, adapter(b)), /STALE_STOP_GENERATION/);
});

test('schema-13 migration preserves historical admission receipts without inventing retroactive epochs', t => {
  const f = fixture(t), taskID = f.task(); f.run('task.claim', { taskID }, peer(b)); const attempt = f.prepare(taskID);
  const receipt = f.run('task.admission', { taskID, attempt, outcome: 'uncertain', receiptID: randomUUID() }, adapter(b));
  const legacy = f.state(); legacy.tasks.find(t => t.id === taskID).stopGeneration = 0;
  const body = JSON.stringify(legacy); f.store.db.prepare('UPDATE control_state SET body=?').run(body); f.store.db.exec('PRAGMA user_version=13');
  const oldReceipt = f.store.db.prepare('SELECT result FROM commands WHERE id=?').get(receipt.id).result; f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store.db.prepare('SELECT body FROM control_state').get().body, body);
  assert.equal(f.store.db.prepare('SELECT result FROM commands WHERE id=?').get(receipt.id).result, oldReceipt);
  const { result, context, ...retry } = receipt; assert.equal(f.store.apply(retry, context).replayed, true);
  assert.equal(f.state().tasks.find(t => t.id === taskID).stopGeneration, 0);
});

test('master replacement keeps the old master until exact proposal acceptance, then fences it', t => {
  const f = fixture(t), generation = f.appoint();
  f.run('master.volunteer', { eligible: true }, peer(b));
  const proposed = f.run('master.appoint', { candidate: b });
  assert.equal(f.channel().active.agentId, a);
  assert.throws(() => f.run('master.accept', { proposalID: proposed.id, promptVersion: 1 }, peer(a)), /STALE_PROPOSAL/);
  f.run('master.accept', { proposalID: proposed.id, promptVersion: 1 }, peer(b));
  assert.equal(f.channel().active.agentId, b); assert.ok(f.channel().active.generation > generation);
  assert.throws(() => f.run('master.resign', { generation }, peer(a)), /STALE_MASTER/);
  const prompt = masterInstructions(f.channel().active, 'dev');
  assert.match(prompt, /not a replacement system prompt/); assert.match(prompt, /existing project access remains unchanged/);
});

test('master lease renewal belongs to connected adapters and survives restart without extension', t => {
  const f = fixture(t), generation = f.appoint();
  assert.throws(() => f.run('master.renew', { generation }, peer(a)), /ADAPTER_REQUIRED/);
  f.advance(30000); f.run('master.renew', { generation }, adapter(a));
  const expiresAt = f.channel().active.expiresAt; f.restart(); assert.equal(f.channel().active.expiresAt, expiresAt);
  f.advance(MASTER_LEASE_MS); f.run('clock.tick', {}, scheduler); assert.equal(f.channel().active, null);
  assert.throws(() => f.run('master.renew', { generation }, adapter(a)), /STALE_MASTER/);
});

test('elections freeze the electorate, reject duplicate votes and require absolute majority', t => {
  const f = fixture(t);
  f.run('master.volunteer', { eligible: true }, peer(a));
  const election = f.run('election.start', {}, peer(b));
  f.run('election.vote', { electionID: election.id, candidate: a }, peer(a));
  assert.equal(f.channel().proposal, null);
  assert.throws(() => f.run('election.vote', { electionID: election.id, candidate: a }, peer(a)), /BALLOT_ALREADY_CAST/);
  f.members.push({ agentId: 'codex:new', channel: 'dev', harness: 'codex', connected: true });
  assert.throws(() => f.run('election.vote', { electionID: election.id, candidate: a }, peer('codex:new')), /INVALID_BALLOT/);
  f.run('election.vote', { electionID: election.id, candidate: a }, peer(b));
  assert.equal(f.channel().active, null); assert.equal(f.channel().proposal.agentId, a);
});

test('ties expire without a master and human appointment invalidates an election', t => {
  const f = fixture(t);
  for (const id of [a, b]) f.run('master.volunteer', { eligible: true }, peer(id));
  const first = f.run('election.start', {}, peer(a));
  f.run('election.vote', { electionID: first.id, candidate: a }, peer(a));
  f.run('election.vote', { electionID: first.id, candidate: b }, peer(b));
  f.advance(60000); f.run('clock.tick', {}, scheduler);
  assert.equal(f.channel().active, null); assert.equal(f.channel().election, null);
  assert.ok(f.store.events('dev').entries.some(e => e.type === 'election.inconclusive'));
  const second = f.run('election.start', {}, peer(a)); f.run('master.appoint', { candidate: b });
  assert.throws(() => f.run('election.vote', { electionID: second.id, candidate: a }, peer(a)), /STALE_ELECTION/);
});

test('master authority and elections are isolated by channel, not project role labels', t => {
  const f = fixture(t), generation = f.appoint(); f.run('channel.configure', {}, human, 'other');
  assert.throws(() => f.run('incident.resolve', { incidentID: randomUUID(), generation, evidenceID: randomUUID() }, peer(a), 'other'), /ELIGIBLE_MEMBER_REQUIRED/);
  const before = f.state();
  assert.throws(() => f.run('master.appoint', { candidate: b }, peer(a)), /OPERATOR_REQUIRED/);
  assert.deepEqual(f.state(), before);
});

test('three-way recovery policy is enforced again at execution and stale grants never execute', t => {
  const f = fixture(t), generation = f.appoint();
  const action = f.run('action.request', { generation, operation: 'remove_member', target: b, evidence: 'not_applicable' }, peer(a));
  assert.equal(f.state().actions[0].status, 'awaiting_approval');
  f.run('action.approve', { actionID: action.id });
  f.run('channel.configure', { mode: 'approval' });
  assert.throws(() => f.run('action.begin', { actionID: action.id }, scheduler), /STALE_POLICY/);
  const fresh = f.run('action.request', { generation, operation: 'pause_delivery', target: b, evidence: 'not_applicable' }, peer(a));
  f.run('action.approve', { actionID: fresh.id }); f.run('action.begin', { actionID: fresh.id }, scheduler);
  f.run('action.finish', { actionID: fresh.id, outcome: 'succeeded', evidenceID: randomUUID() }, adapter(b));
  assert.equal(f.state().actions[1].status, 'succeeded');
  assert.equal(actionDecision('automatic', 'remove_member', 'not_applicable'), 'approved');
});

test('recovery evidence cannot be asserted by a master and newer uncertainty invalidates old evidence', t => {
  const f = fixture(t), generation = f.appoint(), messageID = randomUUID();
  const fields = { generation, operation: 'retry_delivery', target: b, messageID, evidence: 'known_unadmitted' };
  assert.throws(() => f.run('action.request', fields, peer(a)), /EVIDENCE_REQUIRED/);
  assert.throws(() => f.run('evidence.record', { entityID: messageID, kind: 'unadmitted' }, peer(a)), /ADAPTER_REQUIRED/);
  const evidenceID = f.evidence(messageID, 'unadmitted');
  const request = f.run('action.request', { ...fields, evidenceID }, peer(a));
  f.evidence(messageID, 'uncertain');
  assert.throws(() => f.run('action.begin', { actionID: request.id }, scheduler), /EVIDENCE_REQUIRED/);
  assert.throws(() => f.run('action.request', { ...fields, evidence: 'ambiguous' }, peer(a)), /EVIDENCE_REQUIRED/);
});

test('native-idempotent retries require the exact adapter admission key', t => {
  const f = fixture(t), generation = f.appoint(), messageID = randomUUID();
  const evidenceID = f.evidence(messageID, 'native_idempotent', { admissionID: 'msg_fixture' });
  const fields = { generation, operation: 'retry_delivery', target: b, messageID, evidence: 'native_idempotent', evidenceID };
  assert.throws(() => f.run('action.request', { ...fields, admissionID: 'msg_wrong' }, peer(a)), /ADMISSION_KEY_REQUIRED/);
  const action = f.run('action.request', { ...fields, admissionID: 'msg_fixture' }, peer(a));
  f.run('action.begin', { actionID: action.id }, scheduler);
  assert.equal(f.state().actions[0].status, 'executing');
});

test('tasks require voluntary claims, queue multiple claims but enforce one execution, and defer Claude', t => {
  const f = fixture(t), first = f.task(), second = f.task();
  assert.throws(() => f.run('task.claim', { taskID: first }, peer(c)), /HARNESS_EXECUTION_DEFERRED/);
  f.run('task.claim', { taskID: first }, peer(b));
  f.run('task.claim', { taskID: second }, peer(b));
  f.prepare(first);
  assert.throws(() => f.prepare(second), /CONVERSATION_CAPACITY/);
  assert.throws(() => f.run('task.claim', { taskID: first }, peer(a)), /TASK_ALREADY_CLAIMED/);
  assert.throws(() => f.run('task.release', { taskID: first }, peer(b)), /EXECUTION_MAY_BE_ACTIVE/);
});

test('scheduler continues authorized work without a master but needs fresh idle/capability evidence', t => {
  const f = fixture(t), id = f.task(); f.run('task.claim', { taskID: id }, peer(b));
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID: randomUUID() }, scheduler), /VERIFIED_CAPABILITY_REQUIRED/);
  const evidenceID = f.evidence(id, 'capability'); f.evidence(id, 'idle'); f.advance(10001);
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID: evidenceID }, scheduler), /IDLE_EVIDENCE_REQUIRED/);
  f.evidence(id, 'idle'); f.run('task.prepare', { taskID: id, capabilityEvidenceID: evidenceID }, scheduler);
  assert.equal(f.state().tasks[0].status, 'dispatching'); assert.equal(f.channel().active, null);
});

test('worktree preview approval binds to the claim and cannot be recycled after release', t => {
  const f = fixture(t), id = f.task({ requiresWorktree: true }); f.run('task.claim', { taskID: id }, peer(b));
  const capabilityEvidenceID = f.evidence(id, 'capability', { sameConversationWorktree: true }); f.evidence(id, 'idle');
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID }, scheduler), /WORKTREE_PREVIEW_APPROVAL_REQUIRED/);
  const preview = f.run('worktree.preview', { taskID: id, from: '/project', to: '/worktree', configurationDigest: 'a'.repeat(64) }, adapter(b));
  f.run('worktree.approve', { taskID: id, previewID: preview.id });
  f.run('task.release', { taskID: id }, peer(b)); f.run('task.claim', { taskID: id }, peer(b));
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID }, scheduler), /WORKTREE_PREVIEW_APPROVAL_REQUIRED/);
});

test('a worktree task cannot prepare from approval alone before its matching movement has settled', t => {
  const f = fixture(t), id = f.task({ requiresWorktree: true }); f.run('task.claim', { taskID: id }, peer(b));
  const capabilityEvidenceID = f.evidence(id, 'capability', { sameConversationWorktree: true }); f.evidence(id, 'idle');
  const preview = f.run('worktree.preview', { taskID: id, from: '/project', to: '/worktree', configurationDigest: 'a'.repeat(64) }, adapter(b));
  f.run('worktree.approve', { taskID: id, previewID: preview.id });
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID, cwd: '/worktree', scopeDigest: 'b'.repeat(64) }, scheduler), /WORKTREE_TRANSITION_REQUIRED/);
  assert.equal(f.state().tasks.find(task => task.id === id).status, 'claimed');
});

test('worktree task preparation binds the settled transition to its exact preview and destination', t => {
  const f = fixture(t), id = f.task({ requiresWorktree: true }); f.run('task.claim', { taskID: id }, peer(b));
  const authority = 'b'.repeat(64), configurationDigest = 'a'.repeat(64);
  const capabilityEvidenceID = f.evidence(id, 'capability', { sameConversationWorktree: true }); f.evidence(id, 'idle');
  const binding = { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authority, destinationAuthorityDigest: authority,
    sources: [{ path: '/project/AGENTS.md', digest: authority }] };
  const preview = f.run('worktree.preview', { taskID: id, from: '/project', to: '/worktree', configurationDigest, binding }, adapter(b));
  f.run('worktree.approve', { taskID: id, previewID: preview.id });
  const transition = f.run('worktree.begin', { taskID: id, previewID: preview.id, claimGeneration: 1, configurationDigest, authorityDigest: authority }, adapter(b));
  f.run('worktree.settle', { transitionID: transition.id, outcome: 'moved', actualLocation: '/worktree', configurationDigest,
    authorityDigest: authority, receiptID: randomUUID() }, adapter(b));
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID, cwd: '/project', scopeDigest: authority }, scheduler), /WORKTREE_TRANSITION_REQUIRED/);
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID }, scheduler), /WORKTREE_TRANSITION_REQUIRED/);
  f.run('task.prepare', { taskID: id, capabilityEvidenceID, cwd: '/worktree', scopeDigest: authority }, scheduler);
  assert.equal(f.state().tasks.find(task => task.id === id).status, 'dispatching');
});

test('Codex checkpoint config hash requires explicit approval and remains bound to the grant', t => {
  const f = fixture(t), id = f.task({ requiresWorktree: true }); f.run('task.claim', { taskID: id }, peer(b));
  const authority = 'b'.repeat(64), configurationDigest = 'a'.repeat(64), checkpointConfigSha256 = 'c'.repeat(64);
  f.evidence(id, 'capability', { sameConversationWorktree: true }); f.evidence(id, 'idle');
  const binding = { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authority, destinationAuthorityDigest: authority,
    sources: [{ path: '/project/AGENTS.md', digest: authority }], checkpointConfigSha256 };
  const preview = f.run('worktree.preview', { taskID: id, from: '/project', to: '/worktree', configurationDigest, binding }, adapter(b));
  assert.throws(() => f.run('worktree.approve', { taskID: id, previewID: preview.id }), /CHECKPOINT_CONFIG_ACK_REQUIRED/);
  assert.throws(() => f.run('worktree.approve', { taskID: id, previewID: preview.id, checkpointConfigSha256: 'd'.repeat(64) }), /CHECKPOINT_CONFIG_ACK_REQUIRED/);
  const review = worktreeApprovalForPreview(f.state().previews.find(value => value.id === preview.id));
  f.run(review.op, { taskID: review.taskID, previewID: review.previewID, checkpointConfigSha256: review.checkpointConfigSha256 });
  const begin = { taskID: id, previewID: preview.id, claimGeneration: 1, configurationDigest, authorityDigest: authority };
  assert.throws(() => f.run('worktree.begin', begin, adapter(b)), /CHECKPOINT_CONFIG_CHANGED/);
  const transition = f.run('worktree.begin', { ...begin, checkpointConfigSha256 }, adapter(b));
  assert.equal(f.state().transitions.find(value => value.id === transition.id).checkpointConfigSha256, checkpointConfigSha256);
  assert.throws(() => f.run('worktree.settle', { transitionID: transition.id, outcome: 'moved', actualLocation: '/worktree',
    configurationDigest, authorityDigest: authority, receiptID: randomUUID() }, adapter(b)), /CHECKPOINT_POLICY_UNVERIFIED/);
  f.restart(); assert.equal(f.state().transitions.find(value => value.id === transition.id).checkpointConfigSha256, checkpointConfigSha256);
});

test('a newer worktree preview cannot reuse a previous movement receipt', t => {
  const f = fixture(t), id = f.task({ requiresWorktree: true }); f.run('task.claim', { taskID: id }, peer(b));
  const authority = 'b'.repeat(64), configurationDigest = 'a'.repeat(64);
  const capabilityEvidenceID = f.evidence(id, 'capability', { sameConversationWorktree: true }); f.evidence(id, 'idle');
  const binding = { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authority, destinationAuthorityDigest: authority,
    sources: [{ path: '/project/AGENTS.md', digest: authority }] };
  const fields = { taskID: id, from: '/project', to: '/worktree', configurationDigest, binding };
  const first = f.run('worktree.preview', fields, adapter(b)); f.run('worktree.approve', { taskID: id, previewID: first.id });
  const transition = f.run('worktree.begin', { taskID: id, previewID: first.id, claimGeneration: 1, configurationDigest, authorityDigest: authority }, adapter(b));
  f.run('worktree.settle', { transitionID: transition.id, outcome: 'moved', actualLocation: '/worktree', configurationDigest,
    authorityDigest: authority, receiptID: randomUUID() }, adapter(b));
  const next = f.run('worktree.preview', fields, adapter(b)); f.run('worktree.approve', { taskID: id, previewID: next.id });
  assert.throws(() => f.run('task.prepare', { taskID: id, capabilityEvidenceID, cwd: '/worktree', scopeDigest: authority }, scheduler), /WORKTREE_TRANSITION_REQUIRED/);
});

test('admission is not completion; reports require evidence and review requires execution-stop evidence', t => {
  const f = fixture(t), generation = f.appoint(), id = f.task(); f.run('task.claim', { taskID: id }, peer(b));
  const attempt = f.prepare(id);
  f.run('task.admission', { taskID: id, attempt, outcome: 'admitted', receiptID: randomUUID() }, adapter(b));
  assert.equal(f.state().tasks[0].status, 'dispatching');
  f.run('task.started', { taskID: id, attempt, evidenceID: randomUUID() }, adapter(b));
  const artifact = f.evidence(id, 'artifact', { attempt });
  f.run('task.report', { taskID: id, summary: 'Fixture passed', evidence: [artifact] }, peer(b));
  assert.throws(() => f.run('task.review', { taskID: id, generation, accept: true, evidenceID: artifact }, peer(a)), /STOP_EVIDENCE_REQUIRED/);
  f.run('task.stopped', { taskID: id, attempt, evidenceID: randomUUID() }, adapter(b));
  f.run('task.review', { taskID: id, generation, accept: true, evidenceID: artifact }, peer(a));
  assert.equal(f.state().tasks[0].status, 'completed');
});

test('disconnect is not stop evidence; reassignment fences old attempts', t => {
  const f = fixture(t), id = f.task(); f.run('task.claim', { taskID: id }, peer(b)); const attempt = f.prepare(id);
  f.run('task.admission', { taskID: id, attempt, outcome: 'uncertain', receiptID: randomUUID() }, adapter(b));
  f.members.find(m => m.agentId === b).connected = false;
  assert.throws(() => f.run('task.reassign', { taskID: id }), /STOP_EVIDENCE_REQUIRED/);
  f.run('task.stopped', { taskID: id, attempt, evidenceID: randomUUID(), stopGeneration: 1 }, adapter(b));
  f.run('task.reassign', { taskID: id });
  assert.throws(() => f.run('task.started', { taskID: id, attempt, evidenceID: randomUUID() }, adapter(b)), /STALE_TASK_ATTEMPT/);
});

test('dependencies, priorities, deadlines and per-task missed-start decisions are explicit', t => {
  const f = fixture(t), first = f.task(), second = f.task({ dependencies: [first], priority: 100 });
  f.run('task.claim', { taskID: second }, peer(b));
  assert.throws(() => f.prepare(second), /DEPENDENCIES_NOT_COMPLETE/);
  assert.deepEqual(readyTasks(f.state(), 'dev', 1000), []);
  f.run('task.release', { taskID: second }, peer(b));
  const scheduled = f.task({ schedule: { at: 2000, missed: 'ask', maxLatenessMs: 1000 }, deadlineAt: 10000 });
  f.run('task.claim', { taskID: scheduled }, peer(b)); f.advance(3001);
  f.run('clock.tick', {}, scheduler); assert.equal(f.state().incidents[0].status, 'open');
  assert.throws(() => f.prepare(scheduled), /MISSED_SCHEDULE_DECISION_REQUIRED/);
  f.run('task.missed', { taskID: scheduled, run: true }); f.prepare(scheduled);
});

test('missed skip/run-late policies and dependency-free priority ordering are deterministic', t => {
  const f = fixture(t);
  const high = f.task({ priority: 90 }), low = f.task({ priority: 10 });
  f.run('task.claim', { taskID: low }, peer(b)); f.run('task.claim', { taskID: high }, peer(b));
  assert.deepEqual(readyTasks(f.state(), 'dev', 1000).map(t => t.id), [high, low]);
  const skipped = f.task({ schedule: { at: 2000, missed: 'skip', maxLatenessMs: 1000 } });
  const late = f.task({ schedule: { at: 2000, missed: 'run_late', maxLatenessMs: 1000 } });
  f.run('task.claim', { taskID: late }, peer(a)); f.advance(3001); f.run('clock.tick', {}, scheduler);
  assert.equal(f.state().tasks.find(t => t.id === skipped).status, 'cancelled'); f.prepare(late, a);
});

test('state, audit and idempotency receipts commit atomically and survive reopening', t => {
  let fail = false; const f = fixture(t, { beforeCommit: () => { if (fail) throw new Error('Injected failure'); } });
  const before = f.state(), audit = f.store.events('dev'); fail = true;
  assert.throws(() => f.run('channel.configure', { mode: 'automatic' }), /Injected failure/);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.store.events('dev'), audit); fail = false;
  const command = f.run('channel.configure', { mode: 'automatic' }); f.restart();
  const { result, context, ...payload } = command;
  assert.equal(f.store.apply(payload, context).replayed, true);
  assert.throws(() => f.store.apply({ ...payload, mode: 'approval' }, context), /COMMAND_IDEMPOTENCY_CONFLICT/);
  assert.equal(f.channel().mode, 'automatic');
});

test('bounded storage rejects new work without deleting audit or unresolved evidence', t => {
  const f = fixture(t, { eventLimit: 1 }); const before = f.state();
  assert.throws(() => f.run('channel.configure', { mode: 'automatic' }), /CONTROL_EVENT_STORE_FULL/);
  assert.deepEqual(f.state(), before); assert.equal(f.store.events('dev').entries.length, 1);
});

test('30-day pruning removes only rolling telemetry, never master authority audit', t => {
  const f = fixture(t), generation = f.appoint(); f.run('master.renew', { generation }, adapter(a));
  assert.ok(f.store.events('dev').entries.some(e => e.type === 'master.renewed'));
  f.advance(RETENTION_MS + 1); f.run('clock.tick', {}, scheduler);
  const entries = f.store.events('dev').entries;
  assert.ok(!entries.some(e => e.type === 'master.renewed')); assert.ok(entries.some(e => e.type === 'master.activated'));
});

test('database ownership is exclusive and insecure/symlink databases fail closed', t => {
  const f = fixture(t);
  assert.throws(() => new ControlStore(f.root));
  if (process.platform === 'win32') return;
  const path = join(f.root, 'control.db'); f.store.close(); chmodSync(path, 0o644);
  assert.throws(() => new ControlStore(f.root), /INSECURE_CONTROL_DATABASE/); chmodSync(path, 0o600);
  const outside = privateTemp(join(tmpdir(), 'turnlink-control-link-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(path, join(outside, 'control.db')); assert.throws(() => new ControlStore(outside), /INSECURE_CONTROL_DATABASE/);
  assert.ok(readFileSync(path).length > 0);
});
