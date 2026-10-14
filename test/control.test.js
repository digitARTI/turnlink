import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, chmodSync, symlinkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { MASTER_LEASE_MS, RETENTION_MS, Command } from '../src/control/contracts.js';
import { masterInstructions, actionDecision } from '../src/control/policy.js';
import { readyTasks } from '../src/control/reducer.js';

const human = { kind: 'operator' }, scheduler = { kind: 'scheduler' };
const peer = agentId => ({ kind: 'participant', agentId });
const adapter = agentId => ({ kind: 'adapter', agentId });
const a = 'opencode:a', b = 'codex:b', c = 'claude:c';
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

test('control defaults and strict commands preserve role separation', t => {
  const f = fixture(t);
  assert.equal(f.channel().mode, 'safe'); assert.equal(f.channel().electionsEnabled, true);
  assert.throws(() => f.run('channel.configure', { mode: 'automatic' }, peer(a)), /OPERATOR_REQUIRED/);
  assert.throws(() => Command.parse({ id: randomUUID(), op: 'master.appoint', channel: 'dev', candidate: a, actor: human }), /Unrecognized/);
  assert.throws(() => f.run('action.request', { generation: 0, operation: 'remove_member', target: b, evidence: 'not_applicable' }, peer(a)), /STALE_MASTER/);
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
  f.run('task.stopped', { taskID: id, attempt, evidenceID: randomUUID() }, adapter(b));
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
