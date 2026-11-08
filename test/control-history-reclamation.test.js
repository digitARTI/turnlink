import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';
import { ControlGateway } from '../src/control/gateway.js';
import { RETENTION_MS, Notice, Event, validateControlState } from '../src/control/contracts.js';
import { readyTasks, reduceControl } from '../src/control/reducer.js';
import { lifecycleDigest } from '../src/control/worktree-lifecycle-contracts.js';
import { privateTemp } from '../src/storage.js';
const early = 1000, now = RETENTION_MS + 2000;
const human = { actor: { kind: 'operator' }, now: early, members: [] };
function fixture(t, options = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-history-')); let store = new ControlStore(root, options);
  const archives = new ControlArchives(join(root, 'exports'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, human);
  return { get store() { return store; }, archives, restart() { store.close(); store = new ControlStore(root, options); },
    reclaim() { const d = store.exportTo(archives, randomUUID(), now); return { request: { id: d.id, digest: d.digest, before: early + 1 }, result: store.reclaimHistory(archives, { id: d.id, digest: d.digest, before: early + 1 }, now) }; } };
}
test('verified explicit archival recovers exhausted old event capacity and exports retained historical events once', t => {
  const f = fixture(t, { eventLimit: 1 });
  assert.throws(() => f.store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, human), /CONTROL_EVENT_STORE_FULL/);
  const { result, request } = f.reclaim(); assert.equal(result.events, 1);
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, { ...human, now });
  f.restart(); assert.equal(f.store.reclaimHistory(f.archives, request, now).replayed, true);
  const descriptor = f.store.exportTo(f.archives, randomUUID(), now);
  const rows = readFileSync(f.archives.path(descriptor.id), 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(rows.filter(row => row.kind === 'event').length, 2);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM events').get().n, 1);
});
test('settled notices free quota but exact acceptance retry and offer evidence survive restart; pending notices remain live', t => {
  const f = fixture(t), assignmentID = randomUUID(), acceptedID = randomUUID();
  const insert = f.store.db.prepare('INSERT INTO notices(id,channel,agent_id,assignment_id,status,body) VALUES(?,?,?,?,?,?)');
  for (const [id, status] of [[acceptedID, 'accepted'], [randomUUID(), 'cancelled'], [randomUUID(), 'pending']]) {
    const notice = Notice.parse({ id, channel: 'dev', agentId: 'opencode:a', assignmentID: status === 'pending' ? randomUUID() : assignmentID,
      generation: 1, promptVersion: 1, kind: 'offer', text: 'Private collaboration notice', at: early, status,
      ...(status === 'accepted' ? { receiptID: 'msg_original' } : {}) });
    insert.run(id, notice.channel, notice.agentId, notice.assignmentID, status, JSON.stringify(notice));
  }
  assert.equal(f.reclaim().result.notices, 2); f.restart();
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM notices').get().n, 1);
  f.store.acceptNotice('dev', 'opencode:a', acceptedID, 'msg_original', now);
  assert.throws(() => f.store.acceptNotice('dev', 'opencode:a', acceptedID, 'msg_changed', now), /NOTICE_RECEIPT_CONFLICT/);
  assert.equal(f.store.offerAccepted('dev', 'opencode:a', assignmentID), true);
});
test('terminal collaboration text compacts while lifecycle tombstone survives late uncertainty and matching stop after restart', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit() { if (fail) throw new Error('cold commit failure'); } }), id = randomUUID();
  f.store.apply({ id, channel: 'dev', op: 'task.create', title: 'Archived terminal payload', instructions: 'x'.repeat(9000), criteria: 'Preserve exact content', requiresWorktree: false }, human);
  const state = f.store.snapshot(), task = state.tasks[0];
  Object.assign(task, { status: 'cancelled', claimant: 'opencode:a', dispatchIntentID: randomUUID(), attempt: 1 });
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const event = Event.parse({ id: randomUUID(), channel: 'dev', type: 'task.missed', actor: human.actor, at: early, entityID: id, durable: true });
  f.store.db.prepare('INSERT INTO events(id,channel,at,durable,body) VALUES(?,?,?,?,?)').run(event.id, 'dev', early, 1, JSON.stringify(event));
  const before = f.store.snapshot(), result = f.reclaim().result;
  assert.equal(result.taskPayloads, 1); assert.ok(result.stateBytesFreed > 8000);
  assert.deepEqual(f.store.snapshot(), before); f.restart(); assert.deepEqual(f.store.snapshot(), before);
  const context = { actor: { kind: 'adapter', agentId: 'opencode:a' }, now, members: [{ agentId: 'opencode:a', channel: 'dev', harness: 'opencode', connected: true }] };
  const uncertain = { id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: id, attempt: 1 };
  fail = true; assert.throws(() => f.store.apply(uncertain, context), /cold commit failure/);
  assert.equal(f.store.snapshot().tasks[0].terminalHold, false);
  assert.equal(f.store.commandReceipt('dev', uncertain.id).known, false);
  fail = false; f.store.apply(uncertain, context);
  assert.equal(f.store.snapshot().tasks[0].terminalHold, true);
  f.restart();
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.stopped', taskID: id, attempt: 1, holdGeneration: 1, evidenceID: randomUUID() }, context);
  assert.equal(f.store.snapshot().tasks[0].terminalHold, false);
  assert.equal(f.store.snapshot().tasks[0].instructions, 'x'.repeat(9000));
});
test('old acknowledged notifications free event and acknowledgement quotas while exact lookup and acknowledgement survive restart', t => {
  const f = fixture(t, { eventLimit: 2, notificationAckLimit: 1 });
  const result = f.store.apply({ id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'storage' }, human), id = result.eventIDs[0];
  const original = f.store.acknowledgeNotification('dev', id, early);
  const state = f.store.snapshot(); Object.assign(state.incidents[0], { status: 'resolved', resolvedAt: early });
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const reclaimed = f.reclaim().result; assert.equal(reclaimed.notificationAcks, 1); assert.equal(reclaimed.events, 2);
  f.restart(); assert.deepEqual(f.store.notification('dev', id), original);
  assert.deepEqual(f.store.acknowledgeNotification('dev', id, now), original);
  assert.equal(f.store.notifications('dev', { pendingOnly: true }).entries.length, 0);
  assert.deepEqual(f.store.notifications('dev').entries, [original]);
  assert.throws(() => f.store.notification('other', id), /NOTIFICATION_NOT_FOUND/);
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'storage' }, { ...human, now });
  const pending = f.store.notifications('dev', { pendingOnly: true }).entries[0];
  assert.ok(pending); f.store.acknowledgeNotification('dev', pending.id, now);
});
test('unresolved tasks pin their terminal prerequisites, artifact evidence, history and large payloads', t => {
  const f = fixture(t), id = randomUUID(), dependent = randomUUID();
  f.store.apply({ id, channel: 'dev', op: 'task.create', title: 'Prerequisite', instructions: 'x'.repeat(8000), criteria: 'Preserve', requiresWorktree: false }, human);
  f.store.apply({ id: dependent, channel: 'dev', op: 'task.create', title: 'Dependent', instructions: 'Preserve', criteria: 'Preserve', dependencies: [id], requiresWorktree: false }, human);
  const state = f.store.snapshot(); state.tasks[0].status = 'cancelled';
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const before = f.store.snapshot();
  assert.throws(() => f.reclaim(), /CONTROL_HISTORY_NOTHING_TO_RECLAIM/);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM events').get().n, 3);
});
test('retention, archive digest, bounded index and commit failures leave live history intact', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit() { if (fail) throw new Error('commit failure'); } });
  const descriptor = f.store.exportTo(f.archives, randomUUID(), now), request = { id: descriptor.id, digest: descriptor.digest, before: early + 1 };
  const before = f.store.snapshot(), events = f.store.db.prepare('SELECT * FROM events').all();
  assert.throws(() => f.store.reclaimHistory(f.archives, { ...request, before: now }, now), /CONTROL_HISTORY_RETENTION/);
  assert.throws(() => f.store.reclaimHistory(f.archives, { ...request, digest: '0'.repeat(64) }, now), /CONTROL_ARCHIVE_DIGEST_MISMATCH/);
  fail = true; assert.throws(() => f.store.reclaimHistory(f.archives, request, now), /commit failure/);
  assert.deepEqual(f.store.snapshot(), before); assert.deepEqual(f.store.db.prepare('SELECT * FROM events').all(), events);
  fail = false; assert.equal(f.store.reclaimHistory(f.archives, request, now).events, 1);
  assert.throws(() => f.store.reclaimHistory(f.archives, { ...request, before: early }, now), /CONTROL_HISTORY_IDEMPOTENCY_CONFLICT/);
  const bounded = fixture(t, { archivedHistoryLimit: 1 });
  bounded.store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, human);
  assert.throws(() => bounded.reclaim(), /ARCHIVED_HISTORY_INDEX_FULL/);
  assert.equal(bounded.store.db.prepare('SELECT count(*) AS n FROM events').get().n, 2);
});
test('missing history archive blocks writes and startup; restoring original private bytes recovers history', t => {
  const f = fixture(t), { request } = f.reclaim(), file = f.archives.path(request.id), bytes = readFileSync(file);
  rmSync(file);
  assert.throws(() => f.store.apply({ id: randomUUID(), channel: 'dev', op: 'channel.configure' }, human));
  assert.throws(() => f.restart());
  writeFileSync(file, bytes, { mode: 0o600 }); f.restart();
  assert.equal(f.store.events('dev').entries.length, 1);
});
test('compaction frees usable stored-state capacity while hydrated bytes retain their independent hard bound', t => {
  const f = fixture(t, { stateByteLimit: 13000 }), id = randomUUID();
  const create = taskID => f.store.apply({ id: taskID, channel: 'dev', op: 'task.create', title: 'Payload', instructions: 'x'.repeat(9000), criteria: 'Preserve', requiresWorktree: false }, human);
  create(id); const state = f.store.snapshot(); state.tasks[0].status = 'cancelled';
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const event = Event.parse({ id: randomUUID(), channel: 'dev', type: 'task.missed', actor: human.actor, at: early, entityID: id, durable: true });
  f.store.db.prepare('INSERT INTO events(id,channel,at,durable,body) VALUES(?,?,?,?,?)').run(event.id, 'dev', early, 1, JSON.stringify(event));
  assert.throws(() => create(randomUUID()), /CONTROL_STATE_FULL/);
  f.reclaim(); create(randomUUID());
  assert.equal(f.store.snapshot().tasks.length, 2);
  assert.throws(() => create(randomUUID()), /CONTROL_HYDRATED_STATE_FULL/);
  f.restart(); assert.equal(f.store.snapshot().tasks.length, 2);
});
test('bounded cold task metadata frees a full hot task array while preserving a late hold at full hot capacity', t => {
  const f = fixture(t), first = randomUUID();
  f.store.apply({ id: first, channel: 'dev', op: 'task.create', title: 'Terminal', instructions: 'Original collaboration', criteria: 'Retain', requiresWorktree: false }, human);
  const state = f.store.snapshot(), template = { ...state.tasks[0], status: 'cancelled', claimant: 'opencode:a', dispatchIntentID: randomUUID(), attempt: 1 };
  state.tasks = Array.from({ length: 4096 }, (_, index) => ({ ...template, id: index ? randomUUID() : first }));
  const artifactID = randomUUID(), stoppedID = randomUUID();
  Object.assign(state.tasks[0], { status: 'completed', result: { summary: 'Accepted original result', evidence: [artifactID] }, stoppedEvidence: stoppedID });
  state.evidence = [{ id: artifactID, channel: 'dev', entityID: first, agentId: 'opencode:a', kind: 'artifact', attempt: 1, at: early },
    { id: stoppedID, channel: 'dev', entityID: first, agentId: 'opencode:a', kind: 'stopped', attempt: 1, at: early }];
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const insert = f.store.db.prepare('INSERT INTO events(id,channel,at,durable,body) VALUES(?,?,?,?,?)');
  f.store.db.exec('BEGIN');
  for (const task of state.tasks) { const event = { id: randomUUID(), channel: 'dev', type: task.status === 'completed' ? 'task.completed' : 'task.missed', actor: human.actor, at: early, entityID: task.id, durable: true }; insert.run(event.id, 'dev', early, 1, JSON.stringify(event)); }
  f.store.db.exec('COMMIT');
  const create = () => f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.create', title: 'New', instructions: 'New', criteria: 'New', requiresWorktree: false }, human);
  assert.throws(create);
  const { result } = f.reclaim(); assert.equal(result.entities.tasks, 4096);
  assert.equal(f.store.storageStatus().quotas.find(row => row.resource === 'cold_tasks').level, 'critical');
  create(); assert.equal(f.store.snapshot().tasks.length, 4097);
  const hot = JSON.parse(f.store.db.prepare('SELECT body FROM control_state').get().body);
  assert.equal(hot.tasks.length, 1);
  hot.tasks = Array.from({ length: 4096 }, (_, index) => ({ ...hot.tasks[0], id: index ? randomUUID() : hot.tasks[0].id }));
  hot.tasks[0].dependencies = [first]; const dependentID = hot.tasks[0].id;
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(hot));
  f.restart();
  const context = { actor: { kind: 'adapter', agentId: 'opencode:a' }, now, members: [{ agentId: 'opencode:a', channel: 'dev', harness: 'opencode', connected: true }] };
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.claim', taskID: dependentID }, { ...context, actor: { kind: 'participant', agentId: 'opencode:a' } });
  assert.deepEqual(readyTasks(f.store.snapshot(), 'dev', now).map(task => task.id), [dependentID]);
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: first, attempt: 1 }, context);
  assert.equal(f.store.snapshot().tasks.find(task => task.id === first).terminalHold, true);
  assert.equal(readyTasks(f.store.snapshot(), 'dev', now).length, 0);
  assert.equal(f.store.storageStatus().unresolved.tasks, 4097);
  f.restart(); assert.equal(f.store.snapshot().tasks.find(task => task.id === first).instructions, 'Original collaboration');
  const stop = { id: randomUUID(), channel: 'dev', op: 'task.stopped', taskID: first, attempt: 1, holdGeneration: 1, evidenceID: randomUUID() };
  assert.throws(() => f.store.apply({ ...stop, holdGeneration: 0 }, context), /STALE_TERMINAL_HOLD/);
  f.store.apply(stop, context); assert.equal(readyTasks(f.store.snapshot(), 'dev', now).length, 1);
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.uncertain', taskID: first, attempt: 1 }, context);
  assert.equal(f.store.apply(stop, context).replayed, true); assert.equal(readyTasks(f.store.snapshot(), 'dev', now).length, 0);
  assert.throws(() => f.store.apply({ ...stop, id: randomUUID(), evidenceID: randomUUID() }, context), /STALE_TERMINAL_HOLD/);
  f.store.apply({ ...stop, id: randomUUID(), holdGeneration: 2, evidenceID: randomUUID() }, context);
  assert.equal(readyTasks(f.store.snapshot(), 'dev', now).length, 1);
  const full = f.store.snapshot(); assert.throws(() => validateControlState(full));
  assert.throws(() => reduceControl(full, { id: randomUUID(), channel: 'dev', op: 'channel.configure' }, { ...human, now }));
  const exported = f.store.exportTo(f.archives, randomUUID(), now);
  assert.deepEqual(new ControlArchives(f.archives.directory).describe(exported.id), exported);
  const file = f.archives.path(exported.id), rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  rows[0].schemaVersion = 16;
  const content = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(content); rows.at(-1).contentDigest = createHash('sha256').update(content).digest('hex');
  writeFileSync(file, content + JSON.stringify(rows.at(-1)) + '\n');
  assert.throws(() => new ControlArchives(f.archives.directory).describe(exported.id), 'schema16 cannot reinterpret expanded schema17 state');
});
test('a full evidence array recovers hot capacity while exact archived evidence remains available after restart', t => {
  const f = fixture(t), state = f.store.snapshot(), entityID = randomUUID();
  state.evidence = Array.from({ length: 16384 }, () => ({ id: randomUUID(), channel: 'dev', entityID, agentId: 'opencode:a', kind: 'stopped', attempt: 1, at: early }));
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const original = state.evidence[0], context = { actor: { kind: 'adapter', agentId: 'opencode:a' }, now: early,
    members: [{ agentId: 'opencode:a', channel: 'dev', harness: 'opencode', connected: true }] };
  const record = () => f.store.apply({ id: randomUUID(), channel: 'dev', op: 'evidence.record', entityID, kind: 'stopped', attempt: 1 }, context);
  assert.throws(record, /CONTROL_HOT_ENTITY_STORE_FULL/);
  assert.equal(f.reclaim().result.entities.evidence, 16384); record(); f.restart();
  assert.equal(f.store.snapshot().evidence.length, 16385);
  assert.deepEqual(f.store.snapshot().evidence.find(row => row.id === original.id), original);
  assert.equal(f.store.storageStatus().quotas.find(row => row.resource === 'cold_evidence').level, 'critical');
});
test('full managed cleanup metadata capacity stays pinned until exact create/remove proof then recovers through cold hydration', t => {
  const f = fixture(t), taskID = randomUUID(), resourceID = randomUUID(), agentId = 'opencode:a';
  f.store.apply({ id: taskID, channel: 'dev', op: 'task.create', title: 'Managed terminal', instructions: 'Retain', criteria: 'Retain', requiresWorktree: true }, human);
  const state = f.store.snapshot(); state.tasks[0].status = 'cancelled';
  const preview = { id: resourceID, kind: 'create', resourceID, agentId, taskID, claimGeneration: 0, repository: '/repo', common: '/repo/.git',
    destination: `/managed/${resourceID}/tree`, revision: 'a'.repeat(40), phase: 'preview', createdAt: early, expiresAt: early + 1000 };
  const created = { id: resourceID, channel: 'dev', agentId, hostId: 'local', preview, digest: lifecycleDigest(preview), status: 'created', policyRevision: 1,
    at: early, approvedAt: early, intentID: randomUUID(), receiptID: randomUUID(), directory: { dev: 1, ino: 2 }, settledAt: early };
  state.managedPreviews.push(created); f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  assert.throws(() => f.reclaim(), /CONTROL_HISTORY_NOTHING_TO_RECLAIM/);
  const removePreview = { ...preview, id: randomUUID(), kind: 'remove', directory: created.directory };
  const removed = { ...created, id: removePreview.id, preview: removePreview, digest: lifecycleDigest(removePreview), status: 'removed', intentID: randomUUID(), receiptID: randomUUID() };
  delete removed.directory; state.managedPreviews.push(removed);
  for (let index = 1; index < 2048; index++) {
    const id = randomUUID(), directory = { dev: 1, ino: index + 2 }, createPreview = { ...preview, id, resourceID: id, destination: `/managed/${id}/tree` };
    const source = { ...created, id, preview: createPreview, digest: lifecycleDigest(createPreview), directory, intentID: randomUUID(), receiptID: randomUUID() };
    const removal = { ...removePreview, id: randomUUID(), resourceID: id, destination: createPreview.destination, directory };
    state.managedPreviews.push(source, { ...removed, id: removal.id, preview: removal, digest: lifecycleDigest(removal), intentID: randomUUID(), receiptID: randomUUID() });
  }
  f.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
  const newTaskID = randomUUID();
  f.store.apply({ id: newTaskID, channel: 'dev', op: 'task.create', title: 'New managed', instructions: 'Retain', criteria: 'Retain', requiresWorktree: true }, human);
  const context = { actor: { kind: 'participant', agentId }, now: early, members: [{ agentId, channel: 'dev', harness: 'opencode', connected: true }] };
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.claim', taskID: newTaskID }, context);
  const newID = randomUUID(), nextPreview = { ...preview, id: newID, resourceID: newID, taskID: newTaskID, claimGeneration: 1, destination: `/managed/${newID}/tree` };
  const publish = { id: randomUUID(), channel: 'dev', op: 'managed.preview', hostId: 'local', preview: nextPreview };
  assert.throws(() => f.store.apply(publish, { ...context, actor: { kind: 'adapter', agentId } }), /CONTROL_HOT_ENTITY_STORE_FULL/);
  const before = f.store.snapshot(), result = f.reclaim().result;
  assert.equal(result.entities.managedPreviews, 4096); f.restart();
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(JSON.parse(f.store.db.prepare('SELECT body FROM control_state').get().body).managedPreviews.length, 0);
  f.store.apply(publish, { ...context, actor: { kind: 'adapter', agentId } });
  assert.equal(f.store.snapshot().managedPreviews.length, 4097);
});
test('full audit budget recovers without touching current authentication and preserves cold plus hot metadata in exports', t => {
  const f = fixture(t), credential = '7'.repeat(64);
  f.store.enrollAdapter('local', credential, early);
  assert.equal(f.store.adapterRevocationObserved('local'), false);
  const insert = f.store.db.prepare('INSERT INTO credential_audit(host_id,action,at) VALUES(?,?,?)');
  f.store.db.exec('BEGIN'); for (let index = 1; index < 4096; index++) insert.run('local', index % 2 ? 'revoked' : 'enrolled', early); f.store.db.exec('COMMIT');
  assert.throws(() => f.store.revokeAdapter('local', now), /CREDENTIAL_AUDIT_FULL/);
  assert.equal(f.store.adapterDigest('local'), credential);
  assert.equal(f.reclaim().result.credentialAudit, 4096);
  f.restart(); assert.equal(f.store.adapterDigest('local'), credential);
  f.store.revokeAdapter('local', now); assert.equal(f.store.adapterDigest('local'), undefined);
  assert.equal(f.store.adapterRevocationObserved('local'), true);
  const descriptor = f.store.exportTo(f.archives, randomUUID(), now), contents = readFileSync(f.archives.path(descriptor.id), 'utf8');
  const rows = contents.trimEnd().split('\n').map(JSON.parse).filter(row => row.kind === 'credential_audit');
  assert.equal(rows.length, 4097); assert.equal(new Set(rows.map(row => row.value.sequence)).size, 4097);
  assert.ok(!contents.includes(credential));
  assert.equal(f.store.storageStatus().quotas.find(row => row.resource === 'cold_credential_audit').level, 'critical');
});
test('worst-case complete storage diagnostics remain typed and bounded with every hot/cold and runtime quota', t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-history-quotas-'));
  const gateway = new ControlGateway({ directory: root, now: () => now, members: () => [], runtimeAvailable: () => false });
  t.after(() => { gateway.close(); rmSync(root, { recursive: true, force: true }); });
  gateway.activityFailures = 1;
  const status = gateway.storageStatus();
  assert.equal(status.quotas.length, 34);
  assert.ok(status.quotas.some(row => row.resource === 'checkpoint_observations'));
  assert.ok(status.quotas.some(row => row.resource === 'checkpoint_destinations'));
  assert.equal(status.pressure.level, 'critical');
  assert.ok(status.pressure.resources.includes('control_runtime')); assert.ok(status.pressure.resources.includes('telemetry_health'));
});
