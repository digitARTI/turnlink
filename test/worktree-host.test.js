import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { ManagedWorktreeHost } from '../src/worktree-host.js';
import { ManualManagedWorktreeHost } from '../src/manual-managed-worktree-host.js';
import { WorktreeLifecycle } from '../src/worktree-lifecycle.js';
import { privateTemp } from '../src/storage.js';

async function fixture(t) {
  const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-host-'))), repository = join(root, 'repo'); mkdirSync(repository);
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  writeFileSync(join(repository, 'file'), 'original\n'); writeFileSync(join(repository, '.gitignore'), 'ignored\n');
  git(['add', '.']); git(['commit', '-m', 'fixture']);
  let broker, a, admin, drop, before, verify, after, held = false, time = 1000;
  const sends = [], effects = [];
  const start = async () => {
    broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
      controlPlane: true, managedRecords: true, now: () => time }); await once(broker.server, 'listening');
    const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
    admin = new ChannelClient({ ...options, token: '2'.repeat(64) }); a = new ChannelClient({ ...options, token: '1'.repeat(64) });
    await a.request('join', { harness: 'opencode', sessionId: 'a', name: 'a', channel: 'dev', role: 'fixture', project: { name: 'fixture', root: repository } });
    await a.subscribe('opencode:a');
  };
  await start();
  const operator = (op, fields = {}) => admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op, ...fields } });
  await operator('channel.configure'); await admin.request('control_enroll_adapter', { hostId: a.hostId, credential: '3'.repeat(64) });
  const taskID = (await operator('task.create', { title: 'fixture', instructions: 'fixture', criteria: 'fixture', requiresWorktree: false })).commandID;
  await a.request('control_command', { agentId: 'opencode:a', command: { id: randomUUID(), channel: 'dev', op: 'task.claim', taskID } });
  const transport = { get hostId() { return a.hostId; }, get admin() { return a.admin; }, get activeSubscriptions() { return a.activeSubscriptions; }, connect: () => a.connect(),
    request: async (method, params) => {
      assert.equal(held, true, 'all bridge RPCs run inside the host/native exclusion window');
      const command = params.command;
      if (command) sends.push(structuredClone(command));
      await before?.(method, params);
      const result = await a.request(method, params);
      if (drop?.(method, params, result)) throw new Error('simulated lost broker reply');
      return result;
    } };
  const nativePort = { exclusive: async fn => {
    assert.equal(held, false); held = true; try { return await fn(); } finally { held = false; }
  }, verify: async input => { assert.equal(held, true); return verify ? verify(input) : true; } };
  const options = { client: transport, hostId: a.hostId, channel: 'dev', credential: async () => '3'.repeat(64), nativePort,
    repository, directory: join(root, 'state'), worktreeRoot: join(root, 'trees'), agentId: 'opencode:a', enabled: true, now: () => time,
    afterEffect: record => { assert.equal(held, true); effects.push(record.kind); after?.(record); } };
  const make = extra => new ManagedWorktreeHost({ ...options, ...extra }); const host = make();
  t.after(async () => { a.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const remote = async id => (await admin.request('control_query', { channel: 'dev', view: 'managedPreviews', entityID: id })).entries[0];
  const approve = p => operator('managed.approve', { previewID: p.id, digest: p.digest ?? host.previewDigest(p) });
  return { root, host, make, taskID, sends, effects, options, nativePort, operator, remote,
    preview: () => host.previewCreate(taskID, 1), approve,
    drop: fn => { drop = fn; }, before: fn => { before = fn; }, verify: fn => { verify = fn; }, after: fn => { after = fn; },
    broker: () => broker, client: () => a, admin: () => admin, time: n => { time = n; },
    restart: async () => { a.close(); admin.close(); await broker.close(); await start(); },
  };
}

test('coordinated host executes real Git only after operator approval and keeps cleanup a separate approved action', async t => {
  const f = await fixture(t), preview = await f.preview();
  assert.equal((await f.remote(preview.id)).status, 'pending');
  await assert.rejects(f.host.create(preview.id), /WORKTREE_APPROVAL_REQUIRED/); assert.equal(existsSync(preview.destination), false);
  await f.approve(preview); const created = await f.host.create(preview.id);
  assert.equal((await f.remote(preview.id)).status, 'created'); assert.equal(readFileSync(join(created.destination, 'file'), 'utf8'), 'original\n');
  const removal = await f.host.previewRemove(created.id);
  await assert.rejects(f.host.remove(removal.id), /WORKTREE_APPROVAL_REQUIRED/);
  await f.approve(removal); await f.host.remove(removal.id);
  assert.equal((await f.remote(removal.id)).status, 'removed'); assert.equal(existsSync(created.destination), false);
  assert.deepEqual(f.effects, ['create', 'remove']);
  const revalidations = f.sends.filter(c => c.op === 'managed.revalidate');
  assert.equal(new Set(revalidations.map(c => c.id)).size, revalidations.length, 'each authority check uses a fresh broker command ID');
  assert.equal(f.broker().store.messages.length, 0, 'filesystem coordination must not wake a model');
  const task = (await f.admin().request('control_query', { channel: 'dev', view: 'tasks', entityID: f.taskID })).entries[0];
  assert.equal(task.status, 'claimed', 'Git receipts cannot complete or accept a task');
});

test('operator-supervised host binds each manual confirmation to its exact approved worktree operation', async t => {
  const f = await fixture(t), manualOptions = { ...f.options, client: f.client(), afterEffect: () => {},
    operatorGuard: async scope => { const record = await f.remote(scope.previewID); return record?.status === 'executing' && record.digest === scope.digest && record.manualConfirmation?.id === scope.confirmationID; } };
  const host = new ManualManagedWorktreeHost(manualOptions);
  const preview = await host.previewCreate(f.taskID, 1);
  await f.approve(preview);
  const confirm = async value => (await f.operator('managed.confirm_manual', { previewID: value.id, digest: value.digest,
    acknowledgement: 'operator-confirms-no-active-use' })).commandID;
  await assert.rejects(host.create(preview.id), /MANUAL_WORKTREE_ATTESTATION_REQUIRED/);
  await assert.rejects(host.executeConfirmed('create', preview.id, preview.digest, 'incorrect'), /MANUAL_WORKTREE_ATTESTATION_REQUIRED/);
  await assert.rejects(host.executeConfirmed('create', preview.id, 'a'.repeat(64), 'operator-confirms-no-active-use', randomUUID()), /MANUAL_WORKTREE_ATTESTATION_REQUIRED/);
  const creationConfirmation = await confirm(preview);
  const created = await host.executeConfirmed('create', preview.id, preview.digest, 'operator-confirms-no-active-use', creationConfirmation);
  assert.equal(created.phase, 'created');
  assert.equal(created.coordination.manualAttestation.previewID, preview.id);
  assert.equal(created.coordination.manualAttestation.digest, preview.digest);
  const removal = await host.previewRemove(created.id);
  await assert.rejects(host.executeConfirmed('remove', removal.id, removal.digest, 'operator-confirms-no-active-use', randomUUID()), /WORKTREE_APPROVAL_REQUIRED/);
  await f.approve(removal);
  const removalConfirmation = await confirm(removal);
  const removed = await host.executeConfirmed('remove', removal.id, removal.digest, 'operator-confirms-no-active-use', removalConfirmation);
  assert.equal(removed.phase, 'removed');
  assert.equal(removed.coordination.manualAttestation.previewID, removal.id);
  assert.equal(removed.coordination.manualAttestation.digest, removal.digest);
  assert.equal((await f.remote(removal.id)).manualConfirmation.id, removalConfirmation);
  assert.notEqual(removed.coordination.manualAttestation.digest, created.coordination.manualAttestation.digest);
  assert.equal(existsSync(created.destination), false);
  const restored = new ManualManagedWorktreeHost(manualOptions);
  assert.equal(restored.current(removal.id).coordination.manualAttestation.previewID, removal.id);
});

test('manual operator verification failure prevents any Git effect after approval', async t => {
  const f = await fixture(t);
  const host = new ManualManagedWorktreeHost({ ...f.options, client: f.client(), afterEffect: () => { throw new Error('Git was invoked'); },
    operatorGuard: async () => false });
  const preview = await host.previewCreate(f.taskID, 1); await f.approve(preview);
  const confirmation = (await f.operator('managed.confirm_manual', { previewID: preview.id, digest: preview.digest,
    acknowledgement: 'operator-confirms-no-active-use' })).commandID;
  await assert.rejects(host.executeConfirmed('create', preview.id, preview.digest, 'operator-confirms-no-active-use', confirmation), /MANUAL_WORKTREE_OPERATOR_REQUIRED/);
  assert.equal(existsSync(preview.destination), false);
  assert.equal((await f.remote(preview.id)).status, 'failed');
});

test('manual host recovers a lost creation result after broker restart without repeating Git', async t => {
  const f = await fixture(t); let effects = 0;
  const make = () => new ManualManagedWorktreeHost({ ...f.options, client: f.client(),
    operatorGuard: async scope => { const record = await f.remote(scope.previewID); return record?.status === 'executing' && record.digest === scope.digest && record.manualConfirmation?.id === scope.confirmationID; },
    afterEffect: () => { effects++; throw new Error('synthetic lost creation result'); } });
  let host = make(); const preview = await host.previewCreate(f.taskID, 1); await f.approve(preview);
  const confirmation = (await f.operator('managed.confirm_manual', { previewID: preview.id, digest: preview.digest,
    acknowledgement: 'operator-confirms-no-active-use' })).commandID;
  await assert.rejects(host.executeConfirmed('create', preview.id, preview.digest, 'operator-confirms-no-active-use', confirmation), /synthetic lost creation result/);
  assert.equal(effects, 1); assert.equal((await f.remote(preview.id)).status, 'uncertain');
  await f.restart(); host = make();
  await host.recover();
  assert.equal(effects, 1, 'recovery observes the worktree and never invokes Git again');
  assert.equal(host.current(preview.id).phase, 'created');
  assert.equal((await f.remote(preview.id)).status, 'created');
  assert.equal(host.current(preview.id).coordination.manualAttestation.digest, preview.digest);
});

test('lost publication reply restarts with the original publication ID and never silently creates another preview', async t => {
  const f = await fixture(t); let once = true;
  f.drop((method, p) => p.command?.op === 'managed.preview' && once && !(once = false));
  await assert.rejects(f.preview(), /lost broker reply/);
  const record = f.host.records[0], publicationID = record.coordination.publicationID;
  assert.equal(record.coordination.publicationAck, false); assert.equal((await f.remote(record.id)).status, 'pending');
  f.drop(undefined); const restarted = f.make(); await restarted.recover();
  assert.equal(restarted.records[0].coordination.publicationAck, true);
  assert.deepEqual(f.sends.filter(c => c.op === 'managed.preview').map(c => c.id), [publicationID, publicationID]);
  assert.deepEqual(f.effects, []);
});

test('lost grant response proves no Git invocation and settles the exact broker intent as failed, never starting Git on recovery', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p); let once = true;
  f.drop((method, p) => p.command?.op === 'managed.begin' && once && !(once = false));
  await assert.rejects(f.host.create(p.id), /lost broker reply/);
  assert.equal(f.host.current(p.id).phase, 'failed'); assert.equal((await f.remote(p.id)).status, 'failed');
  const begins = f.sends.filter(c => c.op === 'managed.begin'); assert.equal(begins.length, 2); assert.equal(begins[0].id, begins[1].id);
  await f.make().recover(); assert.deepEqual(f.effects, []); assert.equal(existsSync(p.destination), false);
  await assert.rejects(f.host.create(p.id), /WORKTREE_RECOVERY_REQUIRED/);
});

test('lost created/removal receipts survive actual broker restart and block later effects until exact receipt acknowledgement', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p);
  f.drop((method, p) => p.command?.op === 'managed.settle');
  await assert.rejects(f.host.create(p.id), /lost broker reply/);
  assert.equal(f.host.current(p.id).phase, 'created'); assert.equal((await f.remote(p.id)).status, 'created');
  await assert.rejects(f.host.previewCreate(f.taskID, 1), /lost broker reply/); assert.deepEqual(f.effects, ['create']);
  const receipt = f.host.current(p.id).coordination.settlements[0]; assert.equal(receipt.acknowledged, false);
  await f.restart(); f.drop(undefined);
  const restarted = f.make(); await restarted.recover();
  assert.equal(restarted.current(p.id).coordination.settlements[0].acknowledged, true);
  await restarted.create(p.id); assert.deepEqual(f.effects, ['create']);
  const removal = await restarted.previewRemove(p.id); await f.approve(removal);
  f.drop((method, p) => p.command?.op === 'managed.settle'); await assert.rejects(restarted.remove(removal.id), /lost broker reply/);
  await f.restart(); f.drop(undefined); const again = f.make(); await again.recover();
  assert.equal((await f.remote(removal.id)).status, 'removed'); assert.equal(again.current(removal.id).phase, 'removed');
  await again.remove(removal.id); assert.deepEqual(f.effects, ['create', 'remove']);
  const creationReceipts = f.sends.filter(c => c.op === 'managed.settle' && c.previewID === p.id);
  assert.equal(new Set(creationReceipts.map(c => c.id)).size, 1); assert.ok(creationReceipts.length >= 3);
});

test('an uncertain receipt is frozen before send, retried unchanged, then separately resolved by a positive Git observation', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p);
  f.after(() => { throw new Error('simulated result loss after Git'); });
  f.drop((method, p) => p.command?.op === 'managed.settle');
  await assert.rejects(f.host.create(p.id), /simulated result loss after Git/);
  assert.equal(f.host.current(p.id).phase, 'uncertain'); assert.equal((await f.remote(p.id)).status, 'uncertain');
  f.drop(undefined); f.after(undefined); const restarted = f.make(); await restarted.recover();
  const settlements = restarted.current(p.id).coordination.settlements;
  assert.deepEqual(settlements.map(s => [s.outcome, s.acknowledged]), [['uncertain', true], ['created', true]]);
  assert.notEqual(settlements[0].id, settlements[1].id); assert.deepEqual(f.effects, ['create']);
  const incidents = (await f.admin().request('control_query', { channel: 'dev', view: 'incidents' })).entries;
  assert.equal(incidents.filter(i => i.status === 'open').length, 1);
});

test('a policy change during native verification is rejected by the final fresh broker check before filesystem admission', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p);
  f.verify(async () => { await f.operator('channel.configure', { mode: 'automatic' }); return true; });
  await assert.rejects(f.host.create(p.id), /STALE_POLICY/);
  assert.equal((await f.remote(p.id)).status, 'failed'); assert.equal(existsSync(p.destination), false); assert.deepEqual(f.effects, []);
});

test('native exclusion refusal, dirty cleanup and foreign host journals never turn broker approval into filesystem authority', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p); f.verify(() => false);
  await assert.rejects(f.host.create(p.id), /NATIVE_EXCLUSION_REQUIRED/); assert.deepEqual(f.effects, []);
  f.verify(undefined); const next = await f.preview(); await f.approve(next); await f.host.create(next.id);
  writeFileSync(join(next.destination, 'ignored'), 'user data');
  await assert.rejects(f.host.previewRemove(next.id), /DIRTY_WORKTREE/);
  assert.equal(readFileSync(join(next.destination, 'ignored'), 'utf8'), 'user data');
  assert.throws(() => f.make({ hostId: 'foreign' }), /MANAGED_HOST_JOURNAL_MISMATCH/);
  assert.throws(() => new WorktreeLifecycle({ ...f.options, port: { exclusive: async fn => fn(), claim: async () => ({}), authorize: async () => true } }), /WORKTREE_HOST_BRIDGE_REQUIRED/);
});

test('real participant-host process death after Git is reconciled without a second Git invocation or native/model wake', { skip: process.platform === 'win32', timeout: 20000 }, async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p);
  const config = join(f.root, 'crash.json');
  writeFileSync(config, JSON.stringify({ root: f.root, url: `ws://127.0.0.1:${f.broker().server.address().port}`, hostId: f.client().hostId, previewID: p.id }), { mode: 0o600 });
  await f.client().unsubscribe('opencode:a');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/worktree-host-crash.js', import.meta.url)), config], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const [code, signal] = await once(child, 'exit'); assert.equal(code, null); assert.equal(signal, 'SIGKILL');
  await f.client().subscribe('opencode:a');
  assert.equal((await f.remote(p.id)).status, 'executing');
  // Test-only cleanup of the EXACT dead fixture writer lock, after observing
  // process exit; no production force-unlock path exists or is exercised.
  rmSync(f.host.lock + '.lock', { recursive: true });
  const restarted = f.make(); assert.equal(restarted.current(p.id).phase, 'inflight'); await restarted.recover();
  assert.equal((await f.remote(p.id)).status, 'created'); assert.equal(restarted.current(p.id).phase, 'created');
  assert.equal(existsSync(join(p.destination, 'file')), true); assert.deepEqual(f.effects, []);
  assert.equal(f.broker().store.messages.length, 0);
});

test('definitively refused stale publication cannot permanently exhaust the host or turn into a new publication ID', async t => {
  const f = await fixture(t);
  f.before((method, p) => { if (p.command?.op === 'managed.preview') throw new Error('simulated transport loss before send'); });
  await assert.rejects(f.preview(), /transport loss/);
  const record = f.host.records[0], publicationID = record.coordination.publicationID;
  f.before(undefined); f.time(record.expiresAt);
  await assert.rejects(f.host.recover(), /STALE_WORKTREE_PREVIEW/);
  assert.equal(f.host.current(record.id).phase, 'failed'); assert.equal(f.host.current(record.id).coordination.publicationRefused, true);
  assert.equal(await f.remote(record.id), undefined); assert.deepEqual(f.effects, []);
  const next = await f.preview(); assert.equal((await f.remote(next.id)).status, 'pending');
  assert.deepEqual(f.sends.filter(c => c.op === 'managed.preview' && c.preview.id === record.id).map(c => c.id), [publicationID, publicationID]);
});

test('Git invocation with no matching result stays uncertain across restart even when the destination appears unused', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p); let attempts = 0;
  const git = f.host.git.bind(f.host);
  f.host.git = (args, cwd) => {
    if (args[0] === 'worktree' && args[1] === 'add') { attempts++; throw new Error('simulated ambiguous Git invocation'); }
    return git(args, cwd);
  };
  await assert.rejects(f.host.create(p.id), /ambiguous Git invocation/);
  const restarted = f.make(); await restarted.recover();
  assert.equal(restarted.current(p.id).phase, 'uncertain'); assert.equal((await f.remote(p.id)).status, 'uncertain');
  await assert.rejects(restarted.create(p.id), /WORKTREE_RECOVERY_REQUIRED/); assert.equal(attempts, 1); assert.deepEqual(f.effects, []);
  await assert.rejects(f.client().request('control_command', { agentId: 'opencode:a', command: { id: randomUUID(), channel: 'dev', op: 'task.release', taskID: f.taskID } }), /WORKTREE_TRANSITION_UNRESOLVED/);
});

test('filesystem writer exclusion spans asynchronous broker/native verification and prevents competing host mutations', async t => {
  const f = await fixture(t), p = await f.preview(); await f.approve(p); const second = f.make();
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  f.verify(async () => { entered(); await new Promise(resolve => { release = resolve; }); return true; });
  const creating = f.host.create(p.id); await waiting;
  await assert.rejects(second.previewCreate(f.taskID, 1));
  f.verify(undefined); release(); await creating;
  assert.deepEqual(f.effects, ['create']);
});
