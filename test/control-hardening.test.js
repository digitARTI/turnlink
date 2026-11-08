import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, linkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { Context, Command, validateControlState } from '../src/control/contracts.js';

function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-control-hardening-'));
  const store = new ControlStore(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const members = [{ agentId: 'opencode:a', channel: 'dev', harness: 'opencode', connected: true }];
  const run = (op, fields = {}, actor = { kind: 'operator' }) => {
    const command = { id: randomUUID(), op, channel: 'dev', ...fields };
    store.apply(command, { actor, now: 1000, members }); return command;
  };
  run('channel.configure');
  return { store, root, run, members };
}

test('trusted membership snapshots reject duplicate identities and incoherent harness namespaces', () => {
  const member = { agentId: 'opencode:a', channel: 'dev', harness: 'opencode', connected: true };
  assert.throws(() => Context.parse({ actor: { kind: 'scheduler' }, now: 1000, members: [member, member] }), /Incoherent/);
  assert.throws(() => Context.parse({ actor: { kind: 'scheduler' }, now: 1000, members: [{ ...member, harness: 'codex' }] }), /Incoherent/);
});

test('state validation rejects forged ballot owners and malformed task lifecycle', t => {
  const f = fixture(t);
  f.run('master.volunteer', { eligible: true }, { kind: 'participant', agentId: 'opencode:a' });
  f.run('election.start', {}, { kind: 'participant', agentId: 'opencode:a' });
  const state = f.store.snapshot(); state.channels[0].election.ballots['opencode:outsider'] = 'opencode:a';
  assert.throws(() => validateControlState(state), /Invalid election/);
  const created = f.run('task.create', { title: 't', instructions: 'work', criteria: 'tests', requiresWorktree: false });
  const broken = f.store.snapshot(); broken.tasks.find(t => t.id === created.id).status = 'running';
  assert.throws(() => validateControlState(broken), /Invalid task lifecycle/);
});

test('dependency validation handles a deep valid chain iteratively and rejects cycles', t => {
  const f = fixture(t);
  f.run('task.create', { title: 't', instructions: 'work', criteria: 'tests', requiresWorktree: false });
  const state = f.store.snapshot(), base = state.tasks[0];
  state.tasks = Array.from({ length: 4096 }, () => ({ ...base, id: randomUUID(), dependencies: [] }));
  for (let i = 1; i < state.tasks.length; i++) state.tasks[i].dependencies = [state.tasks[i - 1].id];
  assert.equal(validateControlState(state).tasks.length, 4096);
  state.tasks[0].dependencies = [state.tasks.at(-1).id];
  assert.throws(() => validateControlState(state), /Cyclic task dependencies/);
});

test('oversized UTF-8 and relative worktree paths cannot cross the control contract', () => {
  assert.throws(() => Command.parse({ id: randomUUID(), op: 'task.create', channel: 'dev', title: 't', instructions: '🙂'.repeat(4000), criteria: 'tests' }), /UTF-8 byte limit/);
  assert.throws(() => Command.parse({ id: randomUUID(), op: 'worktree.preview', channel: 'dev', taskID: randomUUID(),
    from: './project', to: '../worktree', configurationDigest: 'a'.repeat(64) }), /Absolute host path/);
});

test('newer capability reports supersede an earlier positive report', t => {
  const f = fixture(t), actor = { kind: 'adapter', agentId: 'opencode:a' }, participant = { kind: 'participant', agentId: 'opencode:a' };
  const task = f.run('task.create', { title: 't', instructions: 'work', criteria: 'tests', requiresWorktree: false });
  f.run('task.claim', { taskID: task.id }, participant);
  const old = f.run('evidence.record', { entityID: task.id, kind: 'capability', sameConversationWorktree: true }, actor);
  f.run('evidence.record', { entityID: task.id, kind: 'capability', sameConversationWorktree: false }, actor);
  f.run('evidence.record', { entityID: task.id, kind: 'idle' }, actor);
  assert.throws(() => f.run('task.prepare', { taskID: task.id, capabilityEvidenceID: old.id }, { kind: 'scheduler' }), /VERIFIED_CAPABILITY_REQUIRED/);
});

test('role notices roll back with state/audit and superseded offers cannot be acknowledged', t => {
  const f = fixture(t), participant = { kind: 'participant', agentId: 'opencode:a' };
  f.run('master.volunteer', { eligible: true }, participant);
  const before = f.store.snapshot(); f.store.beforeCommit = () => { throw new Error('Injected commit failure'); };
  assert.throws(() => f.run('master.appoint', { candidate: 'opencode:a' }), /Injected commit failure/);
  assert.deepEqual(f.store.snapshot(), before); assert.deepEqual(f.store.notices('dev', 'opencode:a').entries, []);
  f.store.beforeCommit = () => {};
  f.run('master.appoint', { candidate: 'opencode:a' });
  const old = f.store.notices('dev', 'opencode:a').entries[0];
  f.run('master.appoint', { candidate: 'opencode:a' });
  assert.throws(() => f.store.acceptNotice('dev', 'opencode:a', old.id, 'msg_old', 1000), /NOTICE_CANCELLED/);
  const notices = f.store.notices('dev', 'opencode:a').entries;
  assert.equal(notices.filter(n => n.kind === 'offer').length, 1);
  const accepted = notices.find(n => n.kind === 'offer');
  f.store.acceptNotice('dev', 'opencode:a', accepted.id, 'msg_current', 1000);
  f.store.acceptNotice('dev', 'opencode:a', accepted.id, 'msg_current', 1000);
  assert.equal(f.store.events('dev').entries.filter(e => e.type === 'notice.accepted').length, 1);
});

test('hard-linked SQLite paths and invalid storage budgets are rejected', t => {
  const f = fixture(t);
  assert.throws(() => new ControlStore('/unused', { eventLimit: -1 }), /INVALID_CONTROL_LIMIT/);
  if (process.platform === 'win32') return;
  f.store.close();
  const alias = privateTemp(join(tmpdir(), 'turnlink-control-hardlink-')); t.after(() => rmSync(alias, { recursive: true, force: true }));
  linkSync(join(f.root, 'control.db'), join(alias, 'control.db'));
  assert.throws(() => new ControlStore(alias), /INSECURE_CONTROL_DATABASE/);
});
