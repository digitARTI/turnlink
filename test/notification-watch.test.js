import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once, EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';
import { NotificationWatch, NotificationWatchLine, watchNotifications } from '../src/notification-watch.js';
import { privateDirectory, privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const notification = (sequence, extra = {}) => ({ id: randomUUID(), channel: 'dev', sequence, type: 'incident.opened', at: 1000, entityID: randomUUID(), acknowledgedAt: null, ...extra });
function fixture(extra = {}) {
  const notices = [notification(1), notification(2), notification(3)], calls = [], output = [];
  const client = { request: async (method, params) => {
    calls.push({ method, params });
    const entries = notices.filter(n => n.sequence > params.after && n.acknowledgedAt === null).slice(0, params.limit);
    return { entries, next: entries.at(-1)?.sequence ?? params.after };
  } };
  const watch = new NotificationWatch({ client, channel: 'dev', emit: async frame => { output.push(NotificationWatchLine.parse(frame)); }, batchSize: 2, pagesPerPoll: 1, ...extra });
  return { watch, client, notices, calls, output };
}

test('watch pages are bounded, deduplicated per instance and never mark pending notices as seen', async () => {
  const f = fixture();
  assert.deepEqual(await f.watch.poll(), { emitted: 2, cursor: 2 });
  assert.deepEqual(await f.watch.poll(), { emitted: 1, cursor: 0 });
  await f.watch.poll(); await f.watch.poll(); assert.equal(f.output.length, 3);
  f.notices.push(notification(4)); await f.watch.poll(); await f.watch.poll();
  assert.equal(f.output.length, 4); assert.equal(new Set(f.output.map(v => v.notification.id)).size, 4);
  assert.ok(f.calls.every(c => c.method === 'control_notifications' && c.params.pendingOnly === true && c.params.limit === 2 && c.params.channel === 'dev'));
  assert.ok(f.notices.every(n => n.acknowledgedAt === null));
});

test('concurrent polls join one pending output phase rather than duplicating reads or delivery', async () => {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), resume = new Promise(resolve => { release = resolve; });
  const output = [], f = fixture({ emit: async frame => { output.push(frame); enter(); await resume; } });
  const first = f.watch.poll(), second = f.watch.poll(); assert.equal(first, second);
  await entered; assert.equal(output.length, 1); assert.equal(f.calls.length, 1);
  release(); await first; assert.equal(output.length, 2); assert.equal(f.calls.length, 1);
});

for (const kind of ['foreign channel', 'acknowledged', 'bad cursor', 'duplicate ID', 'unordered', 'unknown field', 'oversized page']) {
  test(`watch refuses ${kind} before any output and stops the instance`, async () => {
    const a = notification(1), b = notification(2);
    const entries = kind === 'foreign channel' ? [a, { ...b, channel: 'private' }] : kind === 'acknowledged' ? [a, { ...b, acknowledgedAt: 1001 }] :
      kind === 'duplicate ID' ? [a, { ...b, id: a.id }] : kind === 'unordered' ? [b, a] : kind === 'unknown field' ? [{ ...a, credential: 'must-not-be-delivered' }] :
      kind === 'oversized page' ? [a, b, notification(3)] : [a, b];
    let reads = 0; const output = [];
    const watch = new NotificationWatch({ channel: 'dev', batchSize: 2, emit: async frame => { output.push(frame); }, client: { request: async () => {
      reads++; return { entries, next: kind === 'bad cursor' ? 42 : entries.at(-1).sequence };
    } } });
    await assert.rejects(watch.poll()); assert.deepEqual(output, []);
    await assert.rejects(watch.poll(), /NOTIFICATION_WATCH_STOPPED/); assert.equal(reads, 1);
  });
}

test('changed immutable IDs and bounded emission memory refuse rather than silently evicting old hints', async () => {
  const f = fixture({ batchSize: 100 }); await f.watch.poll();
  f.notices[0] = { ...f.notices[0], type: 'task.uncertain' };
  await assert.rejects(f.watch.poll(), /NOTIFICATION_WATCH_INVALID/); assert.equal(f.output.length, 3);
  const limited = fixture({ maxEmitted: 1 });
  await assert.rejects(limited.watch.poll(), /NOTIFICATION_WATCH_LIMIT/); assert.equal(limited.output.length, 1);
  assert.equal(limited.watch.emitted.size, 1); assert.ok(limited.notices.every(n => n.acknowledgedAt === null));
});

test('a failed output receipt is never automatically retried by the same monitor', async () => {
  let writes = 0; const f = fixture({ emit: async () => { writes++; throw new Error('private output failure'); } });
  await assert.rejects(f.watch.poll(), /private output failure/); assert.equal(f.watch.emitted.size, 0);
  await assert.rejects(f.watch.poll(), /NOTIFICATION_WATCH_STOPPED/); assert.equal(writes, 1); assert.equal(f.calls.length, 1);
});

test('cancellation discards late reads and waits for an already-admitted output without emitting subsequent rows', async () => {
  let resolveRead;
  const controller = new AbortController(), output = [];
  const watch = new NotificationWatch({ channel: 'dev', signal: controller.signal, emit: async frame => { output.push(frame); }, client: { request: () => new Promise(resolve => { resolveRead = resolve; }) } });
  const running = watch.poll(); controller.abort(); resolveRead({ entries: [notification(1)], next: 1 });
  await assert.rejects(running, { name: 'AbortError' }); assert.deepEqual(output, []);
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), resume = new Promise(resolve => { release = resolve; });
  const active = new AbortController(), f = fixture({ signal: active.signal, emit: async frame => { output.push(frame); enter(); await resume; } });
  let settled = false; const admitted = f.watch.poll().finally(() => { settled = true; });
  await entered; active.abort(); await Promise.resolve(); assert.equal(settled, false);
  release(); await assert.rejects(admitted, { name: 'AbortError' }); assert.equal(output.length, 1);
});

test('watch loop requires administrator identity, validates intervals and treats manual cancellation as shutdown', async () => {
  const output = [], controller = new AbortController(); let reads = 0;
  const client = { admin: false, connect: async () => {}, request: async () => { reads++; controller.abort(); return { entries: [], next: 0 }; } };
  await assert.rejects(watchNotifications({ client, channel: 'dev', signal: controller.signal, emit: async frame => { output.push(frame); } }), /OPERATOR_REQUIRED/);
  assert.equal(reads, 0); assert.deepEqual(output, []);
  client.admin = true;
  await watchNotifications({ client, channel: 'dev', signal: controller.signal, emit: async frame => { output.push(frame); } });
  assert.equal(reads, 1); assert.deepEqual(output, []);
  for (const intervalMs of [0, 999, 60001, NaN, Infinity, 1000.5]) await assert.rejects(watchNotifications({ client, channel: 'dev', signal: controller.signal, intervalMs, emit: async () => {} }), /NOTIFICATION_WATCH_OPTIONS/);
});

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64);
async function brokerFixture(t, controlOptions) {
  const root = privateTemp(join(tmpdir(), 'turnlink-notification-watch-'));
  const children = [];
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true, controlOptions }); await once(broker.server, 'listening');
  const url = `ws://127.0.0.1:${broker.server.address().port}`, admin = new ChannelClient({ url, token: ADMIN });
  const command = (op, fields = {}, channel = 'dev') => admin.request('control_command', { command: { id: randomUUID(), op, channel, ...fields } });
  await command('channel.configure'); await command('channel.configure', {}, 'private');
  t.after(async () => { for (const close of children) await close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const childDirectory = join(root, 'watcher'); privateDirectory(childDirectory); writeFileSync(join(childDirectory, 'admin-token'), ADMIN, { mode: 0o600 });
  return { root, childDirectory, broker, admin, command, url, children };
}
function startWatch(t, f, extraArgs = []) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/control-admin.js', import.meta.url)), 'notifications-watch', 'dev', ...extraArgs], {
    env: { ...process.env, AGENT_CHANNEL_STATE_DIR: f.childDirectory, AGENT_CHANNEL_URL: f.url }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const changed = new EventEmitter(), frames = [], lines = createInterface({ input: child.stdout });
  let stderr = '', parseError, exited = false;
  child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr = (stderr + text).slice(-8192); });
  lines.on('line', line => { try { frames.push(NotificationWatchLine.parse(JSON.parse(line))); } catch (error) { parseError = error; } changed.emit('changed'); });
  const closed = once(child, 'close').then(([code, signal]) => { exited = true; changed.emit('changed'); return { code, signal }; });
  f.children.push(async () => {
    if (!exited) child.kill('SIGTERM');
    const timer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 10000); timer.unref();
    try { await closed; } finally { clearTimeout(timer); lines.close(); }
  });
  return { child, frames, closed, stderr: () => stderr, exit: async () => {
    let timer;
    try { return await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('watch exit deadline exceeded')), 10000); timer.unref(); })]); }
    finally { clearTimeout(timer); }
  }, wait: async predicate => {
    const signal = AbortSignal.any([t.signal, AbortSignal.timeout(10000)]);
    while (!predicate(frames)) {
      if (parseError) throw parseError;
      assert.equal(exited, false, 'watch exited before its expected output');
      await once(changed, 'changed', { signal });
    }
  } };
}

test('real CLI delivers channel-scoped pending metadata, deduplicates later polling and redelivers stable pending IDs on explicit restart', async t => {
  const f = await brokerFixture(t), secret = 'PRIVATE_TASK_BODY_NOT_IN_WATCH';
  await f.command('task.create', { title: secret, instructions: secret, criteria: secret, requiresWorktree: false });
  await f.command('incident.open', { category: 'connectivity', entityID: randomUUID() });
  await f.command('incident.open', { category: 'storage' }, 'private');
  const first = startWatch(t, f, ['1000']); await first.wait(frames => frames.some(v => v.event === 'watching'));
  assert.equal(first.frames.filter(v => v.event === 'notification').length, 1);
  const initialID = first.frames.find(v => v.event === 'notification').notification.id;
  await f.command('incident.open', { category: 'permission', entityID: randomUUID() });
  await first.wait(frames => frames.filter(v => v.event === 'notification').length >= 2);
  assert.equal(first.frames.filter(v => v.event === 'notification' && v.notification.id === initialID).length, 1);
  assert.ok(first.frames.filter(v => v.event === 'notification').every(v => v.notification.channel === 'dev' && v.notification.acknowledgedAt === null));
  const pending = await f.admin.request('control_notifications', { channel: 'dev', pendingOnly: true }); assert.equal(pending.entries.length, 2);
  const serialized = JSON.stringify(first.frames) + first.stderr(); for (const value of [secret, HOST, ADMIN]) assert.ok(!serialized.includes(value));
  first.child.kill('SIGTERM'); const result = await first.exit();
  // Windows does not deliver a catchable SIGTERM; its hard termination code is not POSIX shutdown evidence.
  if (process.platform !== 'win32') assert.equal(result.code, 0);
  const restarted = startWatch(t, f, ['1000']); await restarted.wait(frames => frames.some(v => v.event === 'watching'));
  assert.deepEqual(restarted.frames.filter(v => v.event === 'notification').map(v => v.notification.id), pending.entries.map(v => v.id));
});

test('real CLI disconnect stops visibly without acknowledging, reconnecting or leaking credentials', async t => {
  const f = await brokerFixture(t); await f.command('incident.open', { category: 'connectivity' });
  const watch = startWatch(t, f, ['1000']); await watch.wait(frames => frames.some(v => v.event === 'watching'));
  await f.broker.close(); const result = await watch.exit(); assert.equal(result.code, 1);
  assert.match(watch.stderr(), /NOTIFICATION_WATCH_DISCONNECTED/);
  assert.ok(!watch.stderr().includes(ADMIN)); assert.ok(!watch.stderr().includes(HOST));
});

test('real CLI refuses non-admin credentials and invalid interval before publishing any watching/notice frame', async t => {
  const f = await brokerFixture(t); writeFileSync(join(f.childDirectory, 'admin-token'), HOST, { mode: 0o600 });
  const denied = startWatch(t, f, ['1000']); assert.equal((await denied.exit()).code, 1); assert.deepEqual(denied.frames, []); assert.match(denied.stderr(), /OPERATOR_REQUIRED/);
  writeFileSync(join(f.childDirectory, 'admin-token'), ADMIN, { mode: 0o600 });
  const invalid = startWatch(t, f, ['1']); assert.equal((await invalid.exit()).code, 1); assert.deepEqual(invalid.frames, []); assert.match(invalid.stderr(), /NOTIFICATION_WATCH_OPTIONS/);
});

test('real CLI stays read-only and available when command-receipt capacity is exhausted', async t => {
  const f = await brokerFixture(t, { commandLimit: 3 }); await f.command('incident.open', { category: 'storage' });
  await assert.rejects(f.command('incident.open', { category: 'permission' }), /COMMAND_RECEIPTS_FULL/);
  const watch = startWatch(t, f, ['1000']); await watch.wait(frames => frames.some(v => v.event === 'watching'));
  assert.equal(watch.frames.filter(v => v.event === 'notification').length, 1);
  assert.equal((await f.admin.request('control_notifications', { channel: 'dev', pendingOnly: true })).entries.length, 1);
});

test('real CLI output-pipe failure exits visibly without acknowledging retained notices', async t => {
  const f = await brokerFixture(t); await f.command('incident.open', { category: 'connectivity' });
  const watch = startWatch(t, f, ['1000']); await watch.wait(frames => frames.some(v => v.event === 'watching'));
  watch.child.stdout.destroy();
  await f.command('incident.open', { category: 'permission' });
  assert.equal((await watch.exit()).code, 1); assert.match(watch.stderr(), /NOTIFICATION_WATCH_OUTPUT/);
  assert.equal((await f.admin.request('control_notifications', { channel: 'dev', pendingOnly: true })).entries.length, 2);
});
