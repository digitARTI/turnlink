import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateDirectory, privateTemp } from '../src/storage.js';

async function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-reclaim-service-'));
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, controlOptions: { commandLimit: 2 } });
  await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`;
  const admin = new ChannelClient({ url, token: '2'.repeat(64) }), host = new ChannelClient({ url, token: '1'.repeat(64) });
  t.after(async () => { admin.close(); host.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const configure = { id: randomUUID(), channel: 'dev', op: 'channel.configure' };
  const task = { id: randomUUID(), channel: 'dev', op: 'task.create', title: 'Unresolved task', instructions: 'Preserve this task',
    criteria: 'No evidence loss', requiresWorktree: false };
  await admin.request('control_command', { command: configure });
  const original = await admin.request('control_command', { command: task });
  const archive = await admin.request('control_export', { id: randomUUID() });
  return { root, url, admin, host, task, original, archive };
}

test('operator reclaims a verified export at a full command budget without losing task state or exact retry receipts', async t => {
  const f = await fixture(t);
  const next = { id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'storage' };
  await assert.rejects(f.admin.request('control_command', { command: next }), /COMMAND_RECEIPTS_FULL/);
  const result = await f.admin.request('control_storage_reclaim', { id: f.archive.id, digest: f.archive.digest });
  assert.ok(result.reclaimed > 0);
  await f.admin.request('control_command', { command: next });
  const task = (await f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: f.task.id })).entries[0];
  assert.equal(task.title, f.task.title); assert.equal(task.status, 'open');
  const retried = await f.admin.request('control_command', { command: f.task });
  assert.equal(retried.commandID, f.original.commandID); assert.deepEqual(retried.eventIDs, f.original.eventIDs);
  await assert.rejects(f.admin.request('control_command', { command: { ...f.task, title: 'Changed retry' } }), /COMMAND_IDEMPOTENCY_CONFLICT/);
  const receipt = await f.admin.request('control_receipt', { channel: 'dev', commandID: f.task.id });
  assert.equal(receipt.known, true);
});

test('reclamation requires operator authentication and the verified exact export digest', async t => {
  const f = await fixture(t), params = { id: f.archive.id, digest: f.archive.digest };
  await assert.rejects(f.host.request('control_storage_reclaim', params), /OPERATOR_REQUIRED/);
  await assert.rejects(f.admin.request('control_storage_reclaim', { ...params, digest: '0'.repeat(64) }));
  const before = await f.admin.request('control_storage_status');
  assert.equal(before.quotas.find(q => q.resource === 'commands').used, 2);
  await assert.rejects(f.admin.request('control_storage_reclaim', { ...params, actor: { kind: 'operator' } }));
  const after = await f.admin.request('control_storage_status');
  assert.equal(after.quotas.find(q => q.resource === 'commands').used, 2);
});

test('operator CLI reclaims the exact verified export and safely repeats after a lost reply', async t => {
  const f = await fixture(t), directory = join(f.root, 'operator'); privateDirectory(directory);
  writeFileSync(join(directory, 'admin-token'), '2'.repeat(64), { mode: 0o600 });
  const run = (digest = f.archive.digest) => promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('../src/control-admin.js', import.meta.url)), 'storage-reclaim', f.archive.id, digest], {
      env: { ...process.env, AGENT_CHANNEL_STATE_DIR: directory, AGENT_CHANNEL_URL: f.url }, timeout: 10000,
    });
  const first = JSON.parse((await run()).stdout);
  assert.equal(first.id, f.archive.id); assert.ok(first.reclaimed > 0); assert.equal(first.replayed, false);
  await f.admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'incident.open', category: 'storage' } });
  const second = JSON.parse((await run()).stdout);
  assert.equal(second.id, first.id); assert.equal(second.reclaimed, first.reclaimed); assert.equal(second.replayed, true);
  const status = await f.admin.request('control_storage_status');
  assert.equal(status.quotas.find(q => q.resource === 'commands').used, 1, 'retry does not reclaim receipts outside the original archive');
  await assert.rejects(run('0'.repeat(64)), error => {
    assert.equal(error.code, 1); assert.equal(error.stdout, '');
    assert.match(error.stderr, /CONTROL_ARCHIVE_DIGEST_MISMATCH/);
    assert.ok(!error.stderr.includes('2'.repeat(64))); return true;
  });
});
