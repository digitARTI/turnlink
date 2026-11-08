import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ControlStore } from '../src/control/store.js';
import { lifecycleDigest, LifecyclePreview, DirectoryIdentity } from '../src/control/worktree-lifecycle-contracts.js';
import { ControlArchives } from '../src/control/archives.js';
import { validateControlState } from '../src/control/contracts.js';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { WorktreeLifecycle } from '../src/worktree-lifecycle.js';

function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-managed-records-'));
  let store = new ControlStore(root), now = 1000;
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const members = [{ agentId: 'opencode:a', harness: 'opencode', channel: 'dev', connected: true },
    { agentId: 'opencode:b', harness: 'opencode', channel: 'dev', connected: true }];
  const run = (op, fields = {}, actor = { kind: 'operator' }) => store.apply({ id: randomUUID(), op, channel: 'dev', ...fields }, { actor, now, members });
  const adapter = (op, fields = {}) => run(op, fields, { kind: 'adapter', agentId: 'opencode:a' });
  run('channel.configure');
  const taskID = run('task.create', { title: 'task', instructions: 'task', criteria: 'task', requiresWorktree: false }).commandID;
  run('task.claim', { taskID }, { kind: 'participant', agentId: 'opencode:a' });
  const preview = (extra = {}) => {
    const id = randomUUID(); return LifecyclePreview.parse({ id, resourceID: id, kind: 'create', phase: 'preview', agentId: 'opencode:a', taskID,
      claimGeneration: 1, repository: '/repo', common: '/repo/.git', destination: `/managed/${id}/tree`, revision: 'a'.repeat(40),
      createdAt: now, expiresAt: now + 300000, ...extra });
  };
  const publish = p => adapter('managed.preview', { hostId: 'host', preview: p });
  const approve = p => run('managed.approve', { previewID: p.id, digest: lifecycleDigest(p) });
  const begin = p => adapter('managed.begin', { previewID: p.id, digest: lifecycleDigest(p) });
  const settle = (p, intentID, outcome, extra = {}) => {
    const id = randomUUID(); return adapter('managed.settle', { id, previewID: p.id, intentID, receiptID: id, outcome, ...extra });
  };
  return { root, run, adapter, preview, publish, approve, begin, settle, taskID, members, state: () => store.snapshot(), store: () => store,
    time: n => { now = n; }, restart: () => { store.close(); store = new ControlStore(root); } };
}

test('managed lifecycle persists exact human approvals, claim-fenced intents and idempotent receipts independently of a master', t => {
  const f = fixture(t), p = f.preview(); f.publish(p);
  assert.throws(() => f.begin(p), /MANAGED_PREVIEW_NOT_APPROVED/);
  assert.throws(() => f.adapter('managed.approve', { previewID: p.id, digest: lifecycleDigest(p) }), /OPERATOR_REQUIRED/);
  assert.throws(() => f.run('managed.approve', { previewID: p.id, digest: '0'.repeat(64) }), /MANAGED_PREVIEW_DIGEST_MISMATCH/);
  f.approve(p); const intent = f.begin(p).commandID;
  assert.throws(() => f.run('task.release', { taskID: f.taskID }, { kind: 'participant', agentId: 'opencode:a' }), /WORKTREE_TRANSITION_UNRESOLVED/);
  f.restart();
  f.adapter('managed.revalidate', { previewID: p.id, intentID: intent, digest: lifecycleDigest(p) });
  const id = randomUUID(), command = { id, previewID: p.id, intentID: intent, receiptID: id, outcome: 'created', directory: { dev: 1, ino: 2 } };
  f.adapter('managed.settle', command); const before = f.state(); f.adapter('managed.settle', command);
  assert.deepEqual(f.state(), before); assert.equal(f.state().managedPreviews[0].status, 'created');
  assert.equal(f.state().channels[0].active, null);
  assert.throws(() => f.settle(p, intent, 'removed'), /MANAGED_INTENT_MISMATCH/);
});

test('stale claims, expiry, policy revision and competing lifecycle work prevent admission', async t => {
  for (const kind of ['claim', 'expiry', 'policy', 'other']) await t.test(kind, t => {
    const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p);
    if (kind === 'claim') {
      f.run('task.release', { taskID: f.taskID }, { kind: 'participant', agentId: 'opencode:a' });
      f.run('task.claim', { taskID: f.taskID }, { kind: 'participant', agentId: 'opencode:a' });
    }
    if (kind === 'expiry') f.time(p.expiresAt);
    if (kind === 'policy') f.run('channel.configure', { mode: 'automatic' });
    if (kind === 'other') { const second = f.preview(); f.publish(second); f.approve(second); f.begin(second); }
    assert.throws(() => f.begin(p), /STALE_TASK_CLAIM|STALE_WORKTREE_PREVIEW|STALE_POLICY|MANAGED_WORKTREE_UNRESOLVED/);
    assert.equal(f.state().managedPreviews.find(v => v.id === p.id).status, 'approved');
  });
});

test('uncertain admission retains the task fence after restart and accepts only an observed positive outcome, not a guessed failure', t => {
  const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p); const intent = f.begin(p).commandID;
  f.settle(p, intent, 'uncertain'); f.restart();
  assert.equal(f.store().storageStatus().unresolved.managedPreviews, 1);
  assert.throws(() => f.settle(p, intent, 'failed'), /MANAGED_RECOVERY_EVIDENCE_REQUIRED/);
  assert.throws(() => f.run('task.release', { taskID: f.taskID }, { kind: 'participant', agentId: 'opencode:a' }), /WORKTREE_TRANSITION_UNRESOLVED/);
  f.settle(p, intent, 'created', { directory: { dev: 1, ino: 2 } });
  assert.equal(f.store().storageStatus().unresolved.managedPreviews, 0);
  assert.equal(f.state().incidents.filter(i => i.status === 'open').length, 1, 'settlement must not auto-resolve the incident');
});

test('cleanup approval is bound to an actual managed creation receipt, host, directory and revision', t => {
  const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p); const intent = f.begin(p).commandID;
  f.settle(p, intent, 'created', { directory: { dev: 1, ino: 2 } });
  const removal = f.preview({ id: randomUUID(), resourceID: p.id, kind: 'remove', destination: p.destination, directory: { dev: 1, ino: 2 } });
  assert.throws(() => f.publish({ ...removal, revision: 'b'.repeat(40) }), /Invalid managed worktree resource/);
  assert.throws(() => f.publish({ ...removal, directory: { dev: 1, ino: 3 } }), /Invalid managed worktree resource/);
  f.publish(removal); f.approve(removal); const removalIntent = f.begin(removal).commandID;
  f.settle(removal, removalIntent, 'removed');
  assert.throws(() => f.publish({ ...removal, id: randomUUID() }), /MANAGED_RESOURCE_REMOVED/);
});

test('manual use confirmation is operator-only, durable and bound to the exact approved intent', t => {
  const f = fixture(t), p = f.preview(); f.publish(p);
  const fields = { previewID: p.id, digest: lifecycleDigest(p), acknowledgement: 'operator-confirms-no-active-use' };
  assert.throws(() => f.run('managed.confirm_manual', fields), /MANAGED_PREVIEW_NOT_APPROVED/);
  f.approve(p);
  assert.throws(() => f.adapter('managed.confirm_manual', fields), /OPERATOR_REQUIRED/);
  assert.throws(() => f.run('managed.confirm_manual', { ...fields, digest: '0'.repeat(64) }), /MANAGED_PREVIEW_DIGEST_MISMATCH/);
  const confirmationID = f.run('managed.confirm_manual', fields).commandID;
  f.restart();
  assert.equal(f.state().managedPreviews.find(value => value.id === p.id).manualConfirmation.id, confirmationID);
  f.store().db.exec('PRAGMA user_version=35'); f.store().close();
  try { assert.throws(() => new ControlStore(f.root), /UNSUPPORTED_CONTROL_SCHEMA/); }
  finally { const db = new DatabaseSync(join(f.root, 'control.db')); db.exec('PRAGMA user_version=36'); db.close(); }
  f.restart();
  assert.throws(() => f.adapter('managed.begin', { previewID: p.id, digest: fields.digest, manualConfirmationID: randomUUID() }), /MANUAL_WORKTREE_ATTESTATION_REQUIRED/);
  const intent = f.adapter('managed.begin', { previewID: p.id, digest: fields.digest, manualConfirmationID: confirmationID }).commandID;
  assert.throws(() => f.adapter('managed.revalidate', { previewID: p.id, digest: fields.digest, intentID: intent, manualConfirmationID: randomUUID() }), /MANUAL_WORKTREE_ATTESTATION_REQUIRED/);
  assert.ok(f.adapter('managed.revalidate', { previewID: p.id, digest: fields.digest, intentID: intent, manualConfirmationID: confirmationID }));
  assert.throws(() => f.run('managed.confirm_manual', fields), /MANAGED_PREVIEW_NOT_APPROVED/);
});

test('wide directory identity is exact across approval, export and restart and cannot masquerade as schema 35', t => {
  const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p); const intent = f.begin(p).commandID;
  const directory = { dev: 1, ino: '18446744073709551614' };
  assert.deepEqual(DirectoryIdentity.parse(directory), directory);
  assert.equal(DirectoryIdentity.safeParse({ dev: 1, ino: '9007199254740991' }).success, false);
  assert.equal(DirectoryIdentity.safeParse({ dev: 1, ino: '18446744073709551616' }).success, false);
  f.settle(p, intent, 'created', { directory }); f.restart();
  assert.deepEqual(f.state().managedPreviews.find(value => value.id === p.id).directory, directory);
  const removal = f.preview({ id: randomUUID(), resourceID: p.id, kind: 'remove', destination: p.destination, directory });
  f.publish(removal);
  const archives = new ControlArchives(join(f.root, 'wide-exports')), id = randomUUID();
  f.store().exportTo(archives, id, 1000);
  const rows = JSON.parse('[' + readFileSync(archives.path(id), 'utf8').trim().split('\n').join(',') + ']');
  assert.equal(rows[0].schemaVersion, 36);
  assert.equal(rows.find(value => value.kind === 'state').value.managedPreviews.find(value => value.id === p.id).directory.ino, directory.ino);
  f.store().db.exec('PRAGMA user_version=35'); f.store().close();
  try { assert.throws(() => new ControlStore(f.root), /UNSUPPORTED_CONTROL_SCHEMA/); }
  finally { const db = new DatabaseSync(join(f.root, 'control.db')); db.exec('PRAGMA user_version=36'); db.close(); }
  f.restart(); assert.deepEqual(f.state().managedPreviews.find(value => value.id === p.id).directory, directory);
});

test('lifecycle records reject inconsistent persisted bindings and preserve evidence when journal writes roll back', t => {
  const f = fixture(t), p = f.preview(); f.publish(p);
  const state = f.state(); state.managedPreviews[0].digest = 'f'.repeat(64);
  assert.throws(() => validateControlState(state), /Invalid managed worktree preview/);
  const before = f.state(); f.store().beforeCommit = () => { throw new Error('simulated disk failure'); };
  assert.throws(() => f.approve(p), /simulated disk failure/); assert.deepEqual(f.state(), before);
});

test('schema 5 migration preserves raw state, audit and existing command receipts without rewriting history', t => {
  const f = fixture(t), store = f.store();
  const old = f.state(); delete old.managedPreviews;
  store.db.prepare('UPDATE control_state SET body=? WHERE singleton=1').run(JSON.stringify(old));
  const raw = store.db.prepare('SELECT body FROM control_state').get().body;
  const commands = store.db.prepare('SELECT * FROM commands ORDER BY id').all(), events = store.db.prepare('SELECT * FROM events ORDER BY sequence').all();
  store.db.exec('DROP TABLE notification_acks; DROP TABLE adapter_health; PRAGMA user_version=5'); f.restart();
  assert.equal(f.store().db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.equal(f.store().db.prepare('SELECT body FROM control_state').get().body, raw);
  assert.deepEqual(f.state().managedPreviews, []);
  assert.deepEqual(f.store().db.prepare('SELECT * FROM commands ORDER BY id').all(), commands);
  assert.deepEqual(f.store().db.prepare('SELECT * FROM events ORDER BY sequence').all(), events);
});

test('real broker gates records separately, authenticates receiver/adapter/host, and scopes private paths to the owner', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-managed-broker-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true, managedRecords: true });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), a = new ChannelClient({ ...options, token: '1'.repeat(64) }), b = new ChannelClient({ ...options, token: '1'.repeat(64) });
  t.after(async () => { admin.close(); a.close(); b.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const run = (client, op, fields = {}, identity) => client.request('control_command', { ...(identity ? { agentId: identity } : {}), command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  await run(admin, 'channel.configure');
  for (const [client, id] of [[a, 'a'], [b, 'b']]) {
    await client.request('join', { harness: 'opencode', sessionId: id, name: id, role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/project' } });
    await client.subscribe(`opencode:${id}`);
  }
  await admin.request('control_enroll_adapter', { hostId: a.hostId, credential: '3'.repeat(64) });
  const taskID = (await run(admin, 'task.create', { title: 'fixture', instructions: 'fixture', criteria: 'fixture', requiresWorktree: false })).commandID;
  await run(a, 'task.claim', { taskID }, 'opencode:a');
  const id = randomUUID(), p = LifecyclePreview.parse({ id, resourceID: id, kind: 'create', phase: 'preview', agentId: 'opencode:a', taskID,
    claimGeneration: 1, repository: '/private-repo', common: '/private-repo/.git', destination: `/private-managed/${id}/tree`, revision: 'a'.repeat(40),
    createdAt: Date.now(), expiresAt: Date.now() + 299000 });
  const command = { id: randomUUID(), channel: 'dev', op: 'managed.preview', hostId: a.hostId, preview: p };
  const adapt = (client, cmd, credential = '3'.repeat(64), agentId = 'opencode:a') => client.request('control_adapter', { agentId, credential, command: cmd });
  await assert.rejects(run(a, 'managed.preview', { hostId: a.hostId, preview: p }, 'opencode:a'), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(adapt(a, command, '0'.repeat(64)), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(adapt(a, { ...command, hostId: 'foreign' }), /MANAGED_HOST_MISMATCH/);
  await adapt(a, command);
  const query = client => client.request('control_query', { channel: 'dev', agentId: client === a ? 'opencode:a' : 'opencode:b', view: 'managedPreviews' });
  assert.equal((await query(a)).entries.length, 1); assert.equal((await query(b)).entries.length, 0);
  const cliState = join(root, 'cli'); mkdirSync(cliState, { mode: 0o700 });
  writeFileSync(join(cliState, 'admin-token'), '2'.repeat(64), { mode: 0o600 });
  const runCli = async (...args) => {
    const cli = spawn(process.execPath, ['src/control-admin.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, AGENT_CHANNEL_URL: options.url, AGENT_CHANNEL_STATE_DIR: cliState } });
    let output = '', errors = '';
    cli.stdout.on('data', chunk => { output += chunk; }); cli.stderr.on('data', chunk => { errors += chunk; });
    const [code] = await once(cli, 'close'); return { code, output, errors };
  };
  const reviewResult = await runCli('managed-worktree-review', 'dev', id);
  assert.equal(reviewResult.code, 0, reviewResult.errors);
  const reviewed = JSON.parse(reviewResult.output);
  assert.equal(reviewed.preview.preview.destination, p.destination);
  assert.deepEqual(reviewed.approval, { op: 'managed.approve', channel: 'dev', previewID: id, digest: lifecycleDigest(p) });
  assert.equal((await admin.request('control_query', { channel: 'dev', view: 'managedPreviews', entityID: id, limit: 1 })).entries[0].status, 'pending',
    'review must not approve or perform the operation');
  const commandID = randomUUID(), approved = await runCli('managed-worktree-approve', 'dev', id, commandID);
  assert.equal(approved.code, 0, approved.errors);
  assert.equal(JSON.parse(approved.output).commandID, commandID);
  assert.equal(JSON.parse(approved.errors).commandID, commandID);
  const replay = await runCli('managed-worktree-approve', 'dev', id, commandID);
  assert.equal(replay.code, 0, replay.errors); assert.equal(JSON.parse(replay.output).commandID, commandID);
  assert.notEqual((await runCli('managed-worktree-approve', 'dev', id)).code, 0, 'a decided preview cannot be approved under a new command');
  const begin = { id: randomUUID(), op: 'managed.begin', channel: 'dev', previewID: id, digest: lifecycleDigest(p) };
  await assert.rejects(adapt(b, begin), /ADAPTER_RECEIVER_REQUIRED/);
  const grant = await adapt(a, begin); assert.equal(grant.managedWorktreeExecutionEnabled, false); assert.equal(grant.worktreeExecutionEnabled, false);
  assert.equal(broker.store.messages.length, 0); assert.equal((await admin.request('control_info')).managedWorktreeRecordsEnabled, true);
});

test('production/default broker capabilities do not expose enabled managed record or execution paths', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-managed-off-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true }); await once(broker.server, 'listening');
  const admin = new ChannelClient({ url: `ws://127.0.0.1:${broker.server.address().port}`, token: '2'.repeat(64) });
  t.after(async () => { admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const info = await admin.request('control_info'); assert.equal(info.managedWorktreeRecordsEnabled, false); assert.equal(info.managedWorktreeExecutionEnabled, false);
  await assert.rejects(admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'managed.approve', previewID: randomUUID(), digest: '0'.repeat(64) } }), /MANAGED_WORKTREE_RECORDS_DISABLED/);
});

test('real Git host previews and broker reducer share exact serialized approval digests for creation and clean-only removal', async t => {
  const f = fixture(t), root = realpathSync(f.root), repository = join(root, 'repo'); mkdirSync(repository);
  const git = args => execFileSync('git', args, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  writeFileSync(join(repository, 'file'), 'fixture\n'); git(['add', '.']); git(['commit', '-m', 'fixture']);
  const intents = new Map();
  const host = new WorktreeLifecycle({ repository, directory: join(root, 'host-state'), worktreeRoot: join(root, 'trees'), agentId: 'opencode:a', enabled: true, now: () => 1000,
    port: {
      // This deterministic fixture does not claim production native exclusion.
      exclusive: async fn => fn(), claim: async taskID => f.state().tasks.find(v => v.id === taskID),
      authorize: async request => {
        if (!intents.has(request.previewID)) intents.set(request.previewID, f.adapter('managed.begin', { previewID: request.previewID, digest: request.digest }).commandID);
        f.adapter('managed.revalidate', { previewID: request.previewID, intentID: intents.get(request.previewID), digest: request.digest }); return true;
      },
    } });
  const sendPreview = preview => {
    const { digest, ...record } = preview;
    // Roundtrip across a JSON transport, then validate the exact broker digest.
    const p = LifecyclePreview.parse(JSON.parse(JSON.stringify(record))); f.publish(p);
    assert.equal(f.state().managedPreviews.find(v => v.id === p.id).digest, digest); f.approve(p); return p;
  };
  const p = sendPreview(await host.previewCreate(f.taskID, 1)), created = await host.create(p.id);
  assert.equal(existsSync(created.destination), true);
  f.settle(p, intents.get(p.id), 'created', { directory: created.directory });
  const removal = sendPreview(await host.previewRemove(created.id)), removed = await host.remove(removal.id);
  f.settle(removal, intents.get(removal.id), 'removed');
  assert.equal(removed.phase, 'removed'); assert.equal(existsSync(created.destination), false);
  assert.equal(f.state().tasks[0].status, 'claimed', 'filesystem receipts must not report/accept the task');
});

test('lifecycle intents fence other tasks and conversation moves, not just their own task ID', t => {
  const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p); f.begin(p);
  const taskID = f.run('task.create', { title: 'other', instructions: 'other', criteria: 'other', requiresWorktree: false }).commandID;
  f.run('task.claim', { taskID }, { kind: 'participant', agentId: 'opencode:a' });
  assert.throws(() => f.run('task.prepare', { taskID, capabilityEvidenceID: randomUUID() }, { kind: 'scheduler' }), /MANAGED_WORKTREE_UNRESOLVED/);
  assert.throws(() => f.adapter('worktree.begin', { taskID, previewID: randomUUID(), claimGeneration: 1,
    configurationDigest: 'a'.repeat(64), authorityDigest: 'a'.repeat(64) }), /MANAGED_WORKTREE_UNRESOLVED/);
});

test('active native dispatch on another task prevents a lifecycle grant before any effect', t => {
  const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p);
  const taskID = f.run('task.create', { title: 'other', instructions: 'other', criteria: 'other', requiresWorktree: false }).commandID;
  f.run('task.claim', { taskID }, { kind: 'participant', agentId: 'opencode:a' });
  const cap = f.adapter('evidence.record', { entityID: taskID, kind: 'capability', sameConversationWorktree: false }).commandID;
  f.adapter('evidence.record', { entityID: taskID, kind: 'idle' });
  f.run('task.prepare', { taskID, capabilityEvidenceID: cap }, { kind: 'scheduler' });
  assert.throws(() => f.begin(p), /EXECUTION_MAY_BE_ACTIVE/);
  assert.equal(f.state().managedPreviews[0].status, 'approved');
});

test('cleanup cannot bypass an open resource/task incident and non-creation receipts cannot replace directory identity', t => {
  const f = fixture(t), p = f.preview(); f.publish(p); f.approve(p); const intent = f.begin(p).commandID;
  assert.throws(() => f.settle(p, intent, 'failed', { directory: { dev: 5, ino: 6 } }), /MANAGED_OUTCOME_MISMATCH/);
  f.settle(p, intent, 'created', { directory: { dev: 1, ino: 2 } });
  const removal = f.preview({ id: randomUUID(), resourceID: p.id, kind: 'remove', destination: p.destination, directory: { dev: 1, ino: 2 } });
  f.publish(removal); f.approve(removal);
  f.run('incident.open', { category: 'admission', entityID: p.id });
  assert.throws(() => f.begin(removal), /MANAGED_EVIDENCE_UNRESOLVED/);
});

test('Windows host preview paths can be recorded by a POSIX broker without evaluating destination contents', t => {
  const f = fixture(t), id = randomUUID(), p = f.preview({ id, resourceID: id, repository: 'C:\\repo', common: 'C:\\repo\\.git', destination: `C:\\managed\\${id}\\tree` });
  f.publish(p); f.approve(p);
  assert.equal(f.state().managedPreviews[0].preview.destination, p.destination);
});
