import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { TransitionJournal, WorktreeCoordinator } from '../src/worktree-transition.js';
import { digest } from '../src/config.js';

function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-transition-')), agentId = 'opencode:a';
  const store = new ControlStore(join(root, 'control'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  let now = 1000, location = '/project', idle = true, blocked = false, authority = digest('original authority'), destinationAuthority = authority;
  let configuration = digest('all applicable configuration'), calls = 0, failMove = false, loseSettlement = false, loseGrant = false, changeAfterGrant = false;
  const members = [{ agentId, channel: 'dev', harness: 'opencode', connected: true }];
  const apply = (op, fields = {}, actor = { kind: 'operator' }) => {
    const command = { id: randomUUID(), channel: 'dev', op, ...fields }; store.apply(command, { actor, members, now }); return command.id;
  };
  apply('channel.configure');
  const taskID = apply('task.create', { title: 'Task', instructions: 'work', criteria: 'tests', requiresWorktree: true });
  apply('task.claim', { taskID }, { kind: 'participant', agentId });
  const client = { request: async (method, params) => {
    assert.equal(params.agentId, agentId);
    if (method === 'control_query') {
      const entries = store.snapshot()[params.view].filter(v => v.channel === 'dev');
      const page = entries.slice(params.offset, params.offset + params.limit); return { entries: page, next: params.offset + page.length };
    }
    assert.equal(method, 'control_adapter'); assert.equal(params.credential, 'fixture-only');
    const result = store.apply(params.command, { actor: { kind: 'adapter', agentId }, members, now });
    if (params.command.op === 'worktree.begin' && changeAfterGrant) configuration = digest('changed during grant');
    if (params.command.op === 'worktree.begin' && loseGrant) { loseGrant = false; throw new Error('lost grant response'); }
    if (params.command.op === 'worktree.settle' && loseSettlement) { loseSettlement = false; throw new Error('lost receipt response'); }
    return result;
  } };
  const snapshot = directory => ({ agentId, directory, projectID: 'project', configurationDigest: configuration,
    authorityDigest: directory === '/worktree' ? destinationAuthority : authority,
    sources: [{ path: `${directory}/AGENTS.md`, digest: digest('instruction contents') }], idle, blocked });
  const port = { sameConversationWorktree: true,
    inspect: async directory => snapshot(directory), observe: async () => snapshot(location),
    exclusive: async operation => operation(),
    move: async input => { assert.equal(input.agentId, agentId); calls++; location = input.to; if (failMove) throw new Error('native response lost'); },
  };
  const coordinator = () => new WorktreeCoordinator({ client, agentId, channel: 'dev', credential: async () => 'fixture-only',
    journal: new TransitionJournal('local', agentId, root), port });
  const prepare = async () => {
    const preview = await coordinator().preview(taskID, '/worktree');
    apply('worktree.approve', { taskID, previewID: preview.previewID }); return preview;
  };
  return { store, taskID, agentId, root, apply, coordinator, prepare, port, calls: () => calls,
    configChanged: () => { configuration = digest('changed configuration'); }, weakened: () => { destinationAuthority = digest('weaker permission policy'); },
    busy: () => { idle = false; }, block: () => { blocked = true; }, failMove: () => { failMove = true; },
    loseSettlement: () => { loseSettlement = true; }, loseGrant: () => { loseGrant = true; }, changeAfterGrant: () => { changeAfterGrant = true; },
    advance: ms => { now += ms; } };
}

test('approved transition preserves the same conversation and never overrides authority fields', async t => {
  const f = fixture(t), p = await f.prepare();
  await f.coordinator().execute(f.taskID, p.previewID);
  assert.equal(f.calls(), 1); assert.equal(f.store.snapshot().transitions[0].status, 'moved');
  assert.equal(f.store.snapshot().tasks[0].status, 'claimed', 'moving is not task execution');
  const journal = new TransitionJournal('local', f.agentId, f.root);
  assert.equal(journal.records[0].phase, 'settled');
  assert.ok(!JSON.stringify(journal.records).includes('fixture-only'));
});

test('native exclusion is mandatory and changed configuration, weaker authority, busy and blockers prevent movement', async t => {
  for (const change of ['configChanged', 'weakened', 'busy', 'block']) {
    await t.test(change, async t => {
      const f = fixture(t), p = await f.prepare(); f[change]();
      await assert.rejects(f.coordinator().execute(f.taskID, p.previewID)); assert.equal(f.calls(), 0);
    });
  }
  const f = fixture(t), p = await f.prepare(); delete f.port.exclusive;
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /NATIVE_EXCLUSION_REQUIRED/); assert.equal(f.calls(), 0);
});

test('claim release/reclaim invalidates the old approval', async t => {
  const f = fixture(t), p = await f.prepare();
  f.apply('task.release', { taskID: f.taskID }, { kind: 'participant', agentId: f.agentId });
  f.apply('task.claim', { taskID: f.taskID }, { kind: 'participant', agentId: f.agentId });
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /STALE_WORKTREE_PREVIEW/); assert.equal(f.calls(), 0);
});

test('lost grant response is recovered by exact intent without invoking or replaying a native move', async t => {
  const f = fixture(t), p = await f.prepare(); f.loseGrant();
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /lost grant response/);
  assert.equal(f.calls(), 0); assert.equal(f.store.snapshot().transitions[0].status, 'prepared');
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, { kind: 'participant', agentId: f.agentId }), /WORKTREE_TRANSITION_UNRESOLVED/);
  await f.coordinator().recover(); assert.equal(f.calls(), 0); assert.equal(f.store.snapshot().transitions[0].status, 'failed');
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /WORKTREE_PREVIEW_CONSUMED/);
  const fresh = await f.prepare(); await f.coordinator().execute(f.taskID, fresh.previewID); assert.equal(f.calls(), 1);
});

test('configuration changes during grant acquisition stop before native invocation', async t => {
  const f = fixture(t), p = await f.prepare(); f.changeAfterGrant();
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /CONFIGURATION_CHANGED/);
  assert.equal(f.calls(), 0); assert.equal(f.store.snapshot().transitions[0].status, 'failed');
});

test('native response loss records uncertainty, blocks reassignment and reconciles an observed destination without replay', async t => {
  const f = fixture(t), p = await f.prepare(); f.failMove();
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /native response lost/);
  assert.equal(f.store.snapshot().transitions[0].status, 'uncertain');
  assert.throws(() => f.apply('task.reassign', { taskID: f.taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  await f.coordinator().recover(); assert.equal(f.calls(), 1); assert.equal(f.store.snapshot().transitions[0].status, 'moved');
});

test('lost moved-receipt response preserves its command and restart reconciliation never repeats movement', async t => {
  const f = fixture(t), p = await f.prepare(); f.loseSettlement();
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /lost receipt response/);
  const before = new TransitionJournal('local', f.agentId, f.root).records[0];
  assert.equal(before.phase, 'observed'); assert.equal(before.outcome, 'moved');
  await f.coordinator().recover(); assert.equal(f.calls(), 1);
  assert.equal(new TransitionJournal('local', f.agentId, f.root).records[0].phase, 'settled');
});

test('concurrent coordinator instances cannot race or overwrite unresolved transition evidence', async t => {
  const f = fixture(t), p = await f.prepare(), first = f.coordinator(), second = f.coordinator();
  const move = f.port.move; let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.port.move = async input => { entered(); await new Promise(resolve => { release = resolve; }); return move(input); };
  const operation = first.execute(f.taskID, p.previewID);
  await started;
  await assert.rejects(second.execute(f.taskID, p.previewID), error => error.code === 'ELOCKED');
  release(); await operation;
  assert.equal(f.calls(), 1); assert.equal(new TransitionJournal('local', f.agentId, f.root).records.length, 1);
});

test('configuration changes during the native effect stay uncertain and cannot be accepted as verified continuity', async t => {
  const f = fixture(t), p = await f.prepare(), move = f.port.move;
  f.port.move = async input => { await move(input); f.configChanged(); };
  await assert.rejects(f.coordinator().execute(f.taskID, p.previewID), /CONFIGURATION_CHANGED/);
  assert.equal(f.store.snapshot().transitions[0].status, 'uncertain');
  await f.coordinator().recover();
  assert.equal(f.calls(), 1); assert.equal(f.store.snapshot().transitions[0].status, 'uncertain');
  assert.equal(f.store.events('dev').entries.filter(e => e.type === 'worktree.uncertain').length, 1);
});
