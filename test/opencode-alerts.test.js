import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { ChannelClient } from '../src/client.js';
import { createBroker } from '../src/broker.js';
import { privateTemp } from '../src/storage.js';
import { ChannelAlerts, projectChannelAlerts } from '../src/control/alert-contracts.js';
import { makeOpenCodeAlerts } from '../adapters/opencode-alerts.js';
import { makeOpenCodeAlertsUI, setupOpenCodeAlertsUI } from '../adapters/opencode-tui-runtime.js';
import { openCodeFixture } from './fixtures/opencode.js';

const summary = (extra = {}) => ChannelAlerts.parse({ version: 1, agentId: 'opencode:a', channel: 'dev', checkedAt: 1000,
  controlAvailable: true, pressure: { level: 'ok', resources: [] }, incidents: { open: 0 },
  tasks: { uncertain: 0, overdue: 0, awaitingReview: 0, reviewForYou: 0 }, role: { proposalForYou: false }, ...extra });
const snapshot = (extra = {}) => ({ version: 1, sessionID: 'a', checkedAt: 1000, registered: true, available: true, summary: summary(), ...extra });

test('passive broker alerts require the actual enrolled member proof, stay channel/claimant scoped and expose no collaboration bodies', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-alerts-')); let now = 1000000;
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
    controlPlane: true, now: () => now, sweepIntervalMs: 60000 }); await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), a = new ChannelClient({ ...options, token: '1'.repeat(64) }), b = new ChannelClient({ ...options, token: '1'.repeat(64) });
  t.after(async () => { admin.close(); a.close(); b.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const run = (client, channel, op, fields = {}, agentId) => client.request('control_command', { ...(agentId ? { agentId } : {}), command: { id: randomUUID(), channel, op, ...fields } });
  await run(admin, 'dev', 'channel.configure'); await run(admin, 'private', 'channel.configure');
  for (const [client, id] of [[a, 'a'], [b, 'b']]) await client.request('join', { harness: 'opencode', sessionId: id, name: id, role: 'private-role', channel: 'dev', project: { name: 'secret-project', root: '/secret/project' } });
  await a.subscribe('opencode:a'); await b.subscribe('opencode:b');
  await run(admin, 'dev', 'incident.open', { category: 'permission' }); await run(admin, 'private', 'incident.open', { category: 'storage' });
  for (const [client, id] of [[a, 'a'], [b, 'b']]) {
    const task = await run(admin, 'dev', 'task.create', { title: 'secret-title', instructions: 'private instructions and Authorization header', criteria: 'private criteria', requiresWorktree: false, deadlineAt: now + 1000 });
    await run(client, 'dev', 'task.claim', { taskID: task.commandID }, `opencode:${id}`);
  }
  now += 2000;
  const result = await a.request('control_alerts', { channel: 'dev', agentId: 'opencode:a' });
  assert.equal(result.incidents.open, 1); assert.equal(result.tasks.overdue, 1); assert.equal(result.tasks.uncertain, 0);
  assert.equal(result.tasks.reviewForYou, 0); assert.equal(result.role.proposalForYou, false);
  const text = JSON.stringify(result);
  for (const secret of ['secret-title', 'private instructions', 'Authorization', 'private criteria', 'private-role', 'secret-project', '/secret/project', '1'.repeat(64), '2'.repeat(64), 'proof']) assert.ok(!text.includes(secret));
  await assert.rejects(a.request('control_alerts', { channel: 'private', agentId: 'opencode:a' }), /CONTROL_ACCESS_DENIED/);
  await assert.rejects(a.rpc('control_alerts', { channel: 'dev', agentId: 'opencode:b', proof: '0'.repeat(64) }), /CONTROL_ACCESS_DENIED/);
  await assert.rejects(admin.request('control_alerts', { channel: 'dev', agentId: 'opencode:a', proof: '0'.repeat(64) }), /PARTICIPANT_REQUIRED/);
  assert.equal(broker.store.messages.length, 0, 'an alert read must not inject any broker message');
});

test('projection keeps other sessions/tasks out and only a verified review authority receives review hints', () => {
  const state = { incidents: [{ channel: 'dev', status: 'open' }, { channel: 'elsewhere', status: 'open' }], tasks: [
    { channel: 'dev', claimant: 'opencode:a', status: 'uncertain', deadlineAt: 1000 },
    { channel: 'dev', claimant: 'opencode:b', status: 'uncertain', deadlineAt: 1000 },
    { channel: 'dev', claimant: 'opencode:b', status: 'review', stoppedEvidence: randomUUID() },
    { channel: 'dev', claimant: 'opencode:a', status: 'review' },
    { channel: 'elsewhere', claimant: 'opencode:a', status: 'uncertain' },
  ] };
  const channel = { id: 'dev', proposal: { agentId: 'opencode:a', acceptBy: 3000 } };
  const plain = projectChannelAlerts(state, channel, 'opencode:a', 2000);
  // The uncertain attempt and the review without stop proof both require attention.
  assert.equal(plain.tasks.uncertain, 2); assert.equal(plain.tasks.overdue, 1); assert.equal(plain.tasks.awaitingReview, 1);
  assert.equal(plain.tasks.reviewForYou, 0); assert.equal(plain.incidents.open, 1); assert.equal(plain.role.proposalForYou, true);
  assert.equal(projectChannelAlerts(state, channel, 'opencode:a', 2000, true).tasks.reviewForYou, 1);
  assert.equal(projectChannelAlerts(state, channel, 'opencode:a', 3000).role.proposalForYou, false);
  assert.throws(() => summary({ prompt: 'must not cross the alert boundary' }));
});

function readerFixture() {
  const state = { tools: { agentId: 'opencode:a' }, generation: 0, controlChannel: 'dev' }, sessions = new Map([['a', state]]), controller = new AbortController();
  const calls = []; let time = 1000, fail = false, response = async () => summary();
  const read = makeOpenCodeAlerts({ sessions, signal: controller.signal, now: () => time,
    ownSession: async sessionID => { if (fail || sessionID === 'foreign') throw new Error('secret native configuration body'); },
    channel: { request: async (method, params) => { calls.push({ method, params }); return response(); } } });
  return { state, sessions, controller, read, calls, advance: n => { time += n; }, fail: () => { fail = true; }, response: fn => { response = fn; } };
}
test('server alert reader is native-session/location fenced, cached and strictly read-only', async () => {
  const f = readerFixture();
  const result = await f.read({ sessionID: 'a' }); assert.equal(result.available, true); assert.equal(result.registered, true);
  await f.read({ sessionID: 'a' }); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], { method: 'control_alerts', params: { channel: 'dev', agentId: 'opencode:a' } });
  f.advance(15000); await f.read({ sessionID: 'a' }); assert.equal(f.calls.length, 2);
  assert.equal((await f.read({ sessionID: 'not-joined' })).registered, false); assert.equal(f.calls.length, 2);
  assert.equal((await f.read({ sessionID: 'foreign' })).available, false); assert.equal(f.calls.length, 2);
  f.fail(); const failed = await f.read({ sessionID: 'a' }); assert.equal(failed.available, false); assert.ok(!JSON.stringify(failed).includes('secret'));
  await assert.rejects(f.read({ sessionID: 'a', actor: 'operator' }));
});
test('moves, membership ABA, cancellation and wrong broker identities discard in-flight alert data', async t => {
  for (const kind of ['move', 'membership', 'abort', 'identity']) await t.test(kind, async () => {
    const f = readerFixture(); let release;
    f.response(() => new Promise(resolve => { release = resolve; }));
    const result = f.read({ sessionID: 'a' });
    await Promise.resolve(); await Promise.resolve();
    if (kind === 'move') f.sessions.delete('a');
    if (kind === 'membership') f.state.alertRevision = 1;
    if (kind === 'abort') f.controller.abort();
    release(summary(kind === 'identity' ? { agentId: 'opencode:b' } : {}));
    const value = await result; assert.equal(value.available, false); assert.equal(value.summary, undefined);
  });
});

function uiFixture(extra = {}) {
  let route = { type: 'home' }, time = 1000, value = snapshot();
  const memory = { seen: {} }, calls = [], toasts = [], dialogs = [], notices = [], layers = [];
  const location = { directory: '/project', workspaceID: 'local' };
  const ctx = { options: { alerts: true, ...extra }, location,
    client: { rpc: () => ({ snapshot: async (input, options) => { calls.push({ input, options }); return typeof value === 'function' ? value(input) : value; } }) },
    storage: { memory: () => [memory, fn => fn(memory)] },
    data: { session: { get: sessionID => ({ id: sessionID, location }) }, location: { default: () => location } },
    ui: { router: { current: () => route }, toast: { show: toast => toasts.push(toast) }, dialog: { alert: async dialog => dialogs.push(dialog) } },
    attention: { notify: async input => { notices.push(input); } }, keymap: { layer: fn => layers.push(fn()) },
  };
  const ui = makeOpenCodeAlertsUI(ctx, { now: () => time, intervalMs: 60000 });
  return { ctx, ui, calls, toasts, dialogs, notices, layers, memory, location,
    route: id => { route = id ? { type: 'session', sessionID: id } : { type: 'home' }; },
    advance: n => { time += n; }, value: input => { value = input; } };
}
test('CLI checks only the active matching Location, passes native routing explicitly and never polls a model', async t => {
  const f = uiFixture(); t.after(f.ui.dispose);
  await f.ui.poll(); assert.equal(f.calls.length, 0);
  f.route('a'); await f.ui.poll(); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].input, { sessionID: 'a' }); assert.deepEqual(f.calls[0].options.location, f.location);
  assert.equal(f.toasts.length, 0); await f.ui.poll(); assert.equal(f.calls.length, 1);
  f.ctx.data.session.get = () => ({ location: { directory: '/other-project', workspaceID: 'local' } });
  f.advance(15000); await f.ui.poll(); assert.equal(f.calls.length, 1);
  await f.ui.poll(true); assert.equal(f.dialogs.length, 1); assert.match(f.dialogs[0].message, /Open a session in this Location/);
});
test('CLI deduplicates unchanged hints, allows recurrence after resolution, and uses only local display APIs', async t => {
  const f = uiFixture(); t.after(f.ui.dispose); f.route('a');
  f.value(snapshot({ summary: summary({ incidents: { open: 2 } }) })); await f.ui.poll();
  assert.equal(f.toasts.length, 1); assert.match(f.toasts[0].message, /Open channel incidents: 2/); assert.equal(f.notices.length, 0);
  f.advance(15000); await f.ui.poll(); assert.equal(f.toasts.length, 1);
  f.value(snapshot()); f.advance(15000); await f.ui.poll(); assert.equal(f.toasts.length, 1);
  f.value(snapshot({ summary: summary({ incidents: { open: 2 } }) })); f.advance(15000); await f.ui.poll(); assert.equal(f.toasts.length, 2);
  await f.ui.poll(true); assert.equal(f.dialogs.length, 1); assert.equal(f.toasts.length, 2);
});
test('switching sessions/Locations or disposing discards late UI results without notification or navigation', async t => {
  for (const kind of ['session', 'location', 'dispose']) await t.test(kind, async () => {
    const f = uiFixture(); t.after(f.ui.dispose); f.route('a'); let release;
    f.value(() => new Promise(resolve => { release = resolve; })); const poll = f.ui.poll();
    if (kind === 'session') f.route('b'); if (kind === 'location') f.location.directory = '/elsewhere'; if (kind === 'dispose') f.ui.dispose();
    release(snapshot({ summary: summary({ incidents: { open: 1 } }) })); await poll;
    assert.equal(f.toasts.length, 0); assert.equal(f.dialogs.length, 0); assert.equal(f.notices.length, 0);
  });
});
test('wrong-session data and arbitrary RPC failures become generic unavailable alerts without provider text', async t => {
  for (const value of [snapshot({ sessionID: 'foreign' }), snapshot({ summary: summary({ agentId: 'opencode:foreign' }) }), () => { throw new Error('secret credentials or private provider response'); }]) {
    const f = uiFixture(); t.after(f.ui.dispose); f.route('a'); f.value(value); await f.ui.poll();
    assert.equal(f.toasts.length, 1); assert.equal(f.toasts[0].variant, 'error');
    assert.ok(!f.toasts[0].message.includes('secret')); assert.match(f.toasts[0].message, /unavailable/);
  }
});
test('OS attention is separately opt-in, blurred-only, content-free and never requests a sound', async t => {
  const f = uiFixture({ alertNotifications: true }); t.after(f.ui.dispose); f.route('a');
  f.value(snapshot({ summary: summary({ pressure: { level: 'critical', resources: ['commands'] } }) })); await f.ui.poll();
  assert.equal(f.toasts[0].variant, 'error'); assert.equal(f.notices.length, 1);
  assert.deepEqual(f.notices[0].notification, { when: 'blurred' }); assert.equal(f.notices[0].sound, undefined);
  assert.ok(!JSON.stringify(f.notices[0]).includes('/project'));
});
test('CLI opt-out registers no commands; opt-in command opens a local dialog and notification memory is bounded', async t => {
  assert.equal(setupOpenCodeAlertsUI({ options: {} }), undefined);
  const f = uiFixture(); t.after(f.ui.dispose);
  const dispose = setupOpenCodeAlertsUI(f.ctx); t.after(dispose);
  assert.equal(f.layers[0].commands[0].slash.name, 'turnlink-alerts');
  await f.layers[0].commands[0].run(); assert.equal(f.dialogs.length, 1);
  f.value(({ sessionID }) => snapshot({ sessionID, summary: summary({ agentId: `opencode:${sessionID}` }) }));
  for (let i = 0; i < 40; i++) { f.route(`s${i}`); await f.ui.poll(); }
  assert.equal(Object.keys(f.memory.seen).length, 32);
});

test('server plugin registers only the opt-in read RPC, disposes it, and does not inject alert prompts', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-alert-registration-'));
  const tokenFile = join(root, 'host.token'); writeFileSync(tokenFile, '1'.repeat(64), { mode: 0o600 });
  let registration, disposals = 0;
  const f = await openCodeFixture(t, { tokenFile, credentialDirectory: join(root, 'proofs'), control: true, alerts: true }, {
    rpc: { register: async (definition, handlers) => { registration = { definition, handlers }; return { dispose: async () => { disposals++; } }; } },
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(registration.definition.id, 'turnlink.alerts'); assert.deepEqual(Object.keys(registration.handlers), ['snapshot']);
  const before = f.calls.length, result = await registration.handlers.snapshot({ sessionID: 'a' });
  assert.equal(result.registered, false); assert.equal(f.calls.length, before);
  await f.cleanup(); assert.ok(disposals > 0);
});
