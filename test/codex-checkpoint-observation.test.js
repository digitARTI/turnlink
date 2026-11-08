import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { checkpointObservation } from '../src/control/checkpoint-observation.js';
import { ControlArchives } from '../src/control/archives.js';

const sha = value => createHash('sha256').update(value).digest('hex');
function candidate() {
  const threadId = randomUUID(), reservation = { generation: randomUUID(), revision: 1 };
  const grant = { id: randomUUID(), channel: 'dev', taskID: randomUUID(), agentId: `codex:${threadId}`,
    previewID: randomUUID(), claimGeneration: 1, from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64),
    authorityDigest: 'b'.repeat(64), checkpointConfigSha256: 'c'.repeat(64), status: 'prepared', preparedAt: 1 };
  const metadata = { version: 1, threadId, transitionId: grant.id, reservation, rolloutSha256: 'd'.repeat(64), journalSha256: 'e'.repeat(64), rolloutBytes: 123, journalBytes: 33 };
  metadata.digest = sha(`${threadId}:${grant.id}:${reservation.generation}:${reservation.revision}:${metadata.rolloutSha256}:${metadata.journalSha256}:${metadata.rolloutBytes}`);
  return { grant, metadata, requestID: randomUUID(), hostId: 'local', recordedAt: 2 };
}
test('checkpoint observation remains historical after restart and rejects conflicting replay', t => {
  const root = privateTemp('/private/tmp/checkpoint-store-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  let store = new ControlStore(join(root, 'control')); t.after(() => store.close());
  const input = candidate(), record = checkpointObservation(input); let checks = 0;
  assert.equal(store.recordCheckpointObservation(record, () => { checks++; }).historical, false);
  assert.equal(checks, 2);
  assert.equal(store.recordCheckpointObservation({ ...record, recordedAt: 3 }, () => { throw new Error('must not revive lease'); }).historical, true);
  assert.throws(() => store.recordCheckpointObservation({ ...record, grantSha256: 'f'.repeat(64) }, () => {}), /CHECKPOINT_OBSERVATION_CONFLICT/);
  const another = checkpointObservation({ ...input, requestID: randomUUID() });
  assert.throws(() => store.recordCheckpointObservation(another, () => {}), /CHECKPOINT_OBSERVATION_CONFLICT/);
  store.close(); store = new ControlStore(join(root, 'control'));
  assert.deepEqual(store.checkpointObservation(record.requestID), record);
  assert.equal(store.recordCheckpointObservation(record, () => { throw new Error('must not revive lease'); }).historical, true);
  const archives = new ControlArchives(join(root, 'exports')), exportID = randomUUID();
  store.exportTo(archives, exportID, 4);
  const rows = readFileSync(archives.path(exportID), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36);
  assert.deepEqual(rows.filter(row => row.kind === 'checkpoint_observation').map(row => row.value), [record]);
});

test('checkpoint observation rolls back if the retained lease changes before commit', t => {
  const root = privateTemp('/private/tmp/checkpoint-store-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  let alive = true;
  const store = new ControlStore(join(root, 'control'), { beforeCommit() { alive = false; } }); t.after(() => store.close());
  const record = checkpointObservation(candidate());
  assert.throws(() => store.recordCheckpointObservation(record, () => { if (!alive) throw new Error('lease revoked'); }), /lease revoked/);
  assert.equal(store.checkpointObservation(record.requestID), undefined);
});

test('checkpoint observations cannot be hidden by schema downgrade or altered after startup', t => {
  const root = privateTemp('/private/tmp/checkpoint-store-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'control'); let store = new ControlStore(directory);
  const record = checkpointObservation(candidate()); store.recordCheckpointObservation(record, () => {});
  store.db.prepare('UPDATE checkpoint_observations SET transition_id=? WHERE request_id=?').run(randomUUID(), record.requestID);
  assert.throws(() => store.checkpointObservation(record.requestID), /INVALID_CHECKPOINT_OBSERVATION/);
  store.db.prepare('UPDATE checkpoint_observations SET transition_id=? WHERE request_id=?').run(record.transitionID, record.requestID);
  store.db.exec('PRAGMA user_version=32'); store.close();
  assert.throws(() => new ControlStore(directory), /UNSUPPORTED_CONTROL_SCHEMA/);
});

for (const point of ['before', 'after']) test(`checkpoint observation survives process death ${point} commit without reviving a lease`, t => {
  const root = privateTemp('/private/tmp/checkpoint-store-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'control'), record = checkpointObservation(candidate());
  const child = spawnSync(process.execPath, ['test/fixtures/checkpoint-observation-crash.js', directory, point],
    { input: JSON.stringify(record), encoding: 'utf8', timeout: 10000 });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  // The fixture is known dead. Age only its own cooperative lock so the
  // standard stale-lock recovery can run without waiting a minute.
  const lock = `${directory}.lock`;
  if (existsSync(lock)) { const old = new Date(Date.now() - 120000); utimesSync(lock, old, old); }
  const store = new ControlStore(directory); t.after(() => store.close());
  assert.deepEqual(store.checkpointObservation(record.requestID), point === 'after' ? record : undefined);
  if (point === 'after') assert.equal(store.recordCheckpointObservation(record, () => { throw new Error('no lease after crash'); }).historical, true);
});

test('destination intent is durable before dispatch and never automatically replayed', t => {
  const root = privateTemp('/private/tmp/checkpoint-stage-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'control'); let store = new ControlStore(directory); t.after(() => store.close());
  const observation = checkpointObservation(candidate()); store.recordCheckpointObservation(observation, () => {});
  const intent = { version: 1, requestID: observation.requestID, transitionID: observation.transitionID,
    vmInstance: 'f'.repeat(64), checkpointDigest: observation.metadata.digest, status: 'pending', startedAt: 3 };
  assert.equal(store.beginCheckpointDestination(intent, () => {}).historical, false);
  store.close(); store = new ControlStore(directory);
  assert.equal(store.checkpointDestination(intent.requestID).status, 'pending');
  assert.equal(store.beginCheckpointDestination(intent, () => { throw new Error('must not dispatch'); }).historical, true);
  assert.throws(() => store.beginCheckpointDestination({ ...intent, vmInstance: 'a'.repeat(64) }, () => {}), /CHECKPOINT_DESTINATION_CONFLICT/);
  assert.equal(store.markCheckpointDestinationUncertain(intent.requestID, 4).status, 'uncertain');
  assert.equal(store.beginCheckpointDestination(intent, () => { throw new Error('must not dispatch'); }).destination.status, 'uncertain');
});

test('quarantined receipt is bound to the intent and exported as historical evidence', t => {
  const root = privateTemp('/private/tmp/checkpoint-stage-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new ControlStore(join(root, 'control')); t.after(() => store.close());
  const observation = checkpointObservation(candidate()); store.recordCheckpointObservation(observation, () => {});
  const intent = { version: 1, requestID: observation.requestID, transitionID: observation.transitionID,
    vmInstance: 'f'.repeat(64), checkpointDigest: observation.metadata.digest, status: 'pending', startedAt: 3 };
  store.beginCheckpointDestination(intent, () => {});
  const receipt = { version: 1, type: 'receipt', vmInstance: intent.vmInstance, challenge: 'a'.repeat(64), envelopeSha256: 'b'.repeat(64),
    checkpointDigest: intent.checkpointDigest, status: 'quarantined', tag: 'c'.repeat(64), releaseAllowed: false };
  assert.throws(() => store.finishCheckpointDestination(intent.requestID, { ...receipt, vmInstance: 'e'.repeat(64) }, 4, () => {}));
  assert.equal(store.checkpointDestination(intent.requestID).status, 'pending');
  const complete = store.finishCheckpointDestination(intent.requestID, receipt, 4, () => {});
  assert.equal(complete.status, 'quarantined');
  const archives = new ControlArchives(join(root, 'exports')), exportID = randomUUID(); store.exportTo(archives, exportID, 5);
  const rows = readFileSync(archives.path(exportID), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.filter(row => row.kind === 'checkpoint_destination').map(row => row.value), [complete]);
});

test('destination intent rolls back on a revoked lease and schema 33 cannot hide a retained intent', t => {
  const root = privateTemp('/private/tmp/checkpoint-stage-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'control'); let alive = true, trigger = false;
  const store = new ControlStore(directory, { beforeCommit() { if (trigger) alive = false; } });
  const observation = checkpointObservation(candidate()); store.recordCheckpointObservation(observation, () => {});
  const intent = { version: 1, requestID: observation.requestID, transitionID: observation.transitionID,
    vmInstance: 'f'.repeat(64), checkpointDigest: observation.metadata.digest, status: 'pending', startedAt: 3 };
  trigger = true;
  assert.throws(() => store.beginCheckpointDestination(intent, () => { if (!alive) throw new Error('lease revoked'); }), /lease revoked/);
  assert.equal(store.checkpointDestination(intent.requestID), undefined);
  trigger = false; alive = true; store.beginCheckpointDestination(intent, () => {});
  store.db.exec('PRAGMA user_version=33'); store.close();
  assert.throws(() => new ControlStore(directory), /UNSUPPORTED_CONTROL_SCHEMA/);
});

for (const point of ['before-intent', 'after-intent', 'before-finish', 'after-finish'])
  test(`destination crash ${point} never creates replay authority`, t => {
    const root = privateTemp('/private/tmp/checkpoint-stage-crash-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, 'control'), observation = checkpointObservation(candidate());
    const intent = { version: 1, requestID: observation.requestID, transitionID: observation.transitionID,
      vmInstance: 'f'.repeat(64), checkpointDigest: observation.metadata.digest, status: 'pending', startedAt: 3 };
    const receipt = { version: 1, type: 'receipt', vmInstance: intent.vmInstance, challenge: 'a'.repeat(64), envelopeSha256: 'b'.repeat(64),
      checkpointDigest: intent.checkpointDigest, status: 'quarantined', tag: 'c'.repeat(64), releaseAllowed: false };
    let store = new ControlStore(directory); store.recordCheckpointObservation(observation, () => {});
    if (point.endsWith('finish')) store.beginCheckpointDestination(intent, () => {});
    store.close();
    const child = spawnSync(process.execPath, ['test/fixtures/checkpoint-destination-crash.js', directory, point],
      { input: JSON.stringify({ intent, receipt }), encoding: 'utf8', timeout: 10000 });
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    const lock = `${directory}.lock`;
    if (existsSync(lock)) { const old = new Date(Date.now() - 120000); utimesSync(lock, old, old); }
    store = new ControlStore(directory); t.after(() => store.close());
    const recovered = store.checkpointDestination(intent.requestID);
    if (point === 'before-intent') assert.equal(recovered, undefined);
    else {
      assert.equal(recovered.status, point === 'after-finish' ? 'quarantined' : 'pending');
      assert.equal(store.beginCheckpointDestination(intent, () => { throw new Error('must not dispatch'); }).historical, true);
    }
  });
