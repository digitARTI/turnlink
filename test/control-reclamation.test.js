import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';
const context = { actor: { kind: 'operator' }, now: 1000000, members: [] };
function fixture(t, options = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-reclaim-')), directory = join(root, 'control');
  let store = new ControlStore(directory, { commandLimit: 2, ...options });
  const archives = new ControlArchives(join(directory, 'exports'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { get store() { return store; }, archives, restart() { store.close(); store = new ControlStore(directory, { commandLimit: 2, ...options }); },
    configure(id = randomUUID()) { return store.apply({ id, channel: 'dev', op: 'channel.configure' }, context); } };
}
test('verified reclamation recovers full receipt capacity and preserves exact retries after restart', t => {
  const f = fixture(t), id = randomUUID(), original = f.configure(id); f.configure();
  assert.throws(() => f.configure(), /COMMAND_RECEIPTS_FULL/);
  const before = f.store.snapshot(), descriptor = f.store.exportTo(f.archives, randomUUID(), context.now);
  assert.deepEqual(f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: descriptor.digest }),
    { id: descriptor.id, digest: descriptor.digest, reclaimed: 2, replayed: false });
  assert.deepEqual(f.store.snapshot(), before); f.configure(); f.restart();
  assert.deepEqual(f.configure(id), { ...original, replayed: true });
  assert.equal(f.store.commandReceipt('dev', id).known, true);
  assert.equal(f.store.commandReceipt('other', id).known, false);
  assert.throws(() => f.store.apply({ id, channel: 'different', op: 'channel.configure' }, context), /COMMAND_IDEMPOTENCY_CONFLICT/);
  assert.equal(f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: descriptor.digest }).replayed, true);
  const next = f.store.exportTo(f.archives, randomUUID(), context.now);
  const rows = readFileSync(f.archives.path(next.id), 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.equal(rows.filter(r => r.kind === 'command').length, 3);
});
test('reclamation refuses wrong digest, modified archives and bounded index overflow', t => {
  const f = fixture(t, { archivedCommandLimit: 1 }), id = randomUUID(); f.configure(id);
  const descriptor = f.store.exportTo(f.archives, randomUUID(), context.now); f.configure();
  assert.throws(() => f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: '0'.repeat(64) }), /CONTROL_ARCHIVE_DIGEST_MISMATCH/);
  assert.equal(f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: descriptor.digest }).reclaimed, 1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 1);
  const next = f.store.exportTo(f.archives, randomUUID(), context.now);
  assert.throws(() => f.store.reclaimReceipts(f.archives, { id: next.id, digest: next.digest }), /ARCHIVED_COMMAND_INDEX_FULL/);
  const content = readFileSync(f.archives.path(descriptor.id), 'utf8');
  writeFileSync(f.archives.path(descriptor.id), content.replace('control-only', 'control-evil'));
  assert.throws(() => f.store.commandReceipt('dev', id));
});
test('reclamation preserves unresolved state and live events', t => {
  const f = fixture(t); f.configure();
  f.store.apply({ id: randomUUID(), channel: 'dev', op: 'task.create', title: 'Unresolved', instructions: 'Preserve', criteria: 'Evidence', requiresWorktree: false }, context);
  const before = f.store.snapshot(), events = f.store.db.prepare('SELECT * FROM events').all();
  const descriptor = f.store.exportTo(f.archives, randomUUID(), context.now);
  f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: descriptor.digest });
  assert.deepEqual(f.store.snapshot(), before); assert.deepEqual(f.store.db.prepare('SELECT * FROM events').all(), events);
  assert.equal(f.store.storageStatus().unresolved.tasks, 1);
});
test('failed reclamation transaction leaves live receipts and permits an explicit retry', t => {
  let fail = false;
  const f = fixture(t, { beforeCommit() { if (fail) throw new Error('injected commit failure'); } }); f.configure();
  const descriptor = f.store.exportTo(f.archives, randomUUID(), context.now), request = { id: descriptor.id, digest: descriptor.digest }; fail = true;
  assert.throws(() => f.store.reclaimReceipts(f.archives, request), /injected commit failure/);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 1);
  fail = false; assert.equal(f.store.reclaimReceipts(f.archives, request).reclaimed, 1);
});
test('missing private archive refuses startup and restoration recovers exact retry', t => {
  const f = fixture(t), id = randomUUID(), original = f.configure(id);
  const descriptor = f.store.exportTo(f.archives, randomUUID(), context.now);
  f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: descriptor.digest });
  const file = f.archives.path(descriptor.id), bytes = readFileSync(file);
  rmSync(file); assert.throws(() => f.restart(), /ENOENT/);
  writeFileSync(file, bytes, { mode: 0o600 }); f.restart();
  assert.deepEqual(f.configure(id), { ...original, replayed: true });
});
test('archive mismatch rolls back reclamation instead of replacing a live command receipt', t => {
  const f = fixture(t), id = randomUUID(); f.configure(id);
  const descriptor = f.store.exportTo(f.archives, randomUUID(), context.now);
  f.store.db.prepare('UPDATE commands SET fingerprint=? WHERE id=?').run('a'.repeat(64), id);
  assert.throws(() => f.store.reclaimReceipts(f.archives, { id: descriptor.id, digest: descriptor.digest }), /CONTROL_ARCHIVE_RECEIPT_MISMATCH/);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 1);
});

test('reclamation refuses a valid archive outside the store private export directory', t => {
  const f = fixture(t); f.configure();
  const external = new ControlArchives(join(f.archives.directory, '..', 'external-exports'));
  const descriptor = f.store.exportTo(external, randomUUID(), context.now);
  assert.throws(() => f.store.reclaimReceipts(external, { id: descriptor.id, digest: descriptor.digest }), /CONTROL_ARCHIVE_DIRECTORY_MISMATCH/);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 1);
});

test('cumulative reclamation retains both archive generations and replays their original receipts after restart', t => {
  const f = fixture(t), firstID = randomUUID(), first = f.configure(firstID);
  const one = f.store.exportTo(f.archives, randomUUID(), context.now);
  f.store.reclaimReceipts(f.archives, { id: one.id, digest: one.digest });
  const secondID = randomUUID(), second = f.configure(secondID);
  const two = f.store.exportTo(f.archives, randomUUID(), context.now);
  assert.equal(f.store.reclaimReceipts(f.archives, { id: two.id, digest: two.digest }).reclaimed, 1);
  f.restart();
  assert.deepEqual(f.configure(firstID), { ...first, replayed: true });
  assert.deepEqual(f.configure(secondID), { ...second, replayed: true });
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM archived_commands').get().n, 2);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM commands').get().n, 0);
  const third = f.store.exportTo(f.archives, randomUUID(), context.now);
  const rows = readFileSync(f.archives.path(third.id), 'utf8').trimEnd().split('\n').map(JSON.parse);
  assert.deepEqual(new Set(rows.filter(row => row.kind === 'command').map(row => row.value.id)), new Set([firstID, secondID]));
});

for (const fault of ['corrupt', 'symlink', 'hardlink']) test(`restart refuses ${fault} receipt archives instead of losing retry authority`, t => {
  const f = fixture(t), id = randomUUID(); f.configure(id);
  const archive = f.store.exportTo(f.archives, randomUUID(), context.now);
  f.store.reclaimReceipts(f.archives, { id: archive.id, digest: archive.digest });
  const file = f.archives.path(archive.id), original = readFileSync(file);
  if (fault === 'corrupt') writeFileSync(file, original.toString().replace('control-only', 'control-evil'));
  else {
    const target = join(f.archives.directory, '..', 'archive-copy');
    writeFileSync(target, original, { mode: 0o600 }); rmSync(file);
    if (fault === 'symlink') symlinkSync(target, file); else linkSync(target, file);
  }
  assert.throws(() => f.restart());
});
