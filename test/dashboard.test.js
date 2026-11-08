import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once, EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { WebSocketServer } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { createDashboard } from '../src/dashboard-server.js';
import { channelPrecondition, taskPrecondition } from '../src/control/contracts.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64), LOGIN = '4'.repeat(64);
const rootFor = () => privateTemp(join(tmpdir(), 'turnlink-dashboard-'));
function staticFiles(root) {
  const directory = join(root, 'site'); mkdirSync(join(directory, 'assets'), { recursive: true });
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Turnlink</title><div id="root"></div>');
  writeFileSync(join(directory, 'assets', 'app.js'), 'document.title="Turnlink";'); return directory;
}
async function attach(t, { root, brokerURL, now = Date.now, ...extra }) {
  const dashboard = createDashboard({ port: 0, channels: ['dev'], loginSecret: LOGIN, brokerToken: ADMIN, brokerURL,
    assetDirectory: staticFiles(root), now, ...extra }); await once(dashboard.server, 'listening');
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const call = async (path, { cookie, csrf, input, headers = {}, raw, method = input === undefined && raw === undefined ? 'GET' : 'POST' } = {}) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'X-Turnlink-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-Turnlink-CSRF': csrf } : {}),
      ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    ...(raw !== undefined || input !== undefined ? { body: raw ?? JSON.stringify(input) } : {}) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const signIn = async () => {
    const result = await call('/api/login', { input: { password: LOGIN } }); assert.equal(result.status, 200);
    const cookie = result.headers.get('set-cookie').split(';')[0];
    const session = await call('/api/session', { cookie }); assert.equal(session.status, 200);
    return { cookie, csrf: session.body.csrf, login: result };
  };
  t.after(() => dashboard.close());
  return { dashboard, origin, call, signIn };
}
async function fixture(t, extra = {}) {
  const root = rootFor(); let time = 1000000;
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true,
    now: () => time, sweepIntervalMs: 20, ...extra }); await once(broker.server, 'listening');
  const brokerURL = `ws://127.0.0.1:${broker.server.address().port}`;
  const admin = new ChannelClient({ url: brokerURL, token: ADMIN });
  const command = (op, fields = {}, channel = 'dev') => admin.request('control_command', { command: { id: randomUUID(), channel, op, ...fields } });
  await command('channel.configure'); await command('channel.configure', {}, 'private');
  const f = await attach(t, { root, brokerURL, now: () => time });
  t.after(async () => { await f.dashboard.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  return { ...f, root, admin, command, advance: ms => { time += ms; }, broker };
}
const configuration = () => ({ id: randomUUID(), op: 'channel.configure', channel: 'dev', mode: 'approval' });
const prepare = (f, owner, command = configuration()) => f.call('/api/preview', { ...owner, input: { command } });
async function claimant(t, f, sessionId) {
  const client = new ChannelClient({ url: `ws://127.0.0.1:${f.broker.server.address().port}`, token: HOST, credentialDirectory: join(f.root, 'proofs') });
  t.after(() => client.close());
  const agentId = `opencode:${sessionId}`;
  await client.request('join', { harness: 'opencode', sessionId, name: sessionId, role: 'Existing participant', channel: 'dev', project: { name: 'Fixture', root: '/fixture' } });
  await client.subscribe(agentId);
  return { client, agentId, run: (op, fields) => client.request('control_command', { agentId, command: { id: randomUUID(), channel: 'dev', op, ...fields } }) };
}

test('dashboard requires separate credentials, explicit channel scopes and safe static assets', () => {
  const root = rootFor(), assetDirectory = staticFiles(root);
  try {
    assert.throws(() => createDashboard({ channels: ['dev'], loginSecret: ADMIN, brokerToken: ADMIN, assetDirectory }), /SEPARATE_DASHBOARD_CREDENTIAL_REQUIRED/);
    assert.throws(() => createDashboard({ channels: [], loginSecret: LOGIN, brokerToken: ADMIN, assetDirectory }));
    assert.throws(() => createDashboard({ channels: ['dev', 'dev'], loginSecret: LOGIN, brokerToken: ADMIN, assetDirectory }), /INVALID_DASHBOARD_CHANNELS/);
    writeFileSync(join(assetDirectory, 'assets', 'private.map'), 'must not serve arbitrary build files');
    assert.throws(() => createDashboard({ channels: ['dev'], loginSecret: LOGIN, brokerToken: ADMIN, assetDirectory }), /INVALID_DASHBOARD_ASSET/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unauthenticated requests see no private data, cookies are HttpOnly/Strict, and credentials never enter session/status/static output', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/status')).status, 401);
  assert.equal((await f.call('/api/session')).status, 401);
  assert.equal((await f.call('/api/login', { input: { password: HOST } })).status, 401);
  const owner = await f.signIn();
  assert.match(owner.login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\//);
  const session = await f.call('/api/session', owner), status = await f.call('/api/status', owner);
  assert.deepEqual(session.body.channels, ['dev']); assert.equal(status.status, 200);
  for (const response of [session, status]) {
    const text = JSON.stringify(response.body);
    for (const secret of [HOST, ADMIN, LOGIN, owner.cookie.split('=')[1]]) assert.ok(!text.includes(secret));
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  const html = await fetch(f.origin); assert.equal(html.status, 200);
  assert.equal(html.headers.get('x-frame-options'), 'DENY'); assert.equal(html.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!(await html.text()).includes(ADMIN));
  assert.equal((await fetch(`${f.origin}/src/config.js`)).status, 404);
  assert.equal((await fetch(`${f.origin}/assets/app.js.map`)).status, 404);
});

test('Origin, Fetch Metadata, exact Host and request-header checks resist cross-site/loopback CSRF and DNS rebinding', async t => {
  const f = await fixture(t), owner = await f.signIn();
  for (const origin of ['https://evil.example', 'null', f.origin.replace('127.0.0.1', 'localhost'), 'http://127.0.0.1:1'])
    assert.equal((await f.call('/api/status', { ...owner, headers: { Origin: origin } })).status, 403);
  assert.equal((await f.call('/api/status', { ...owner, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
  assert.equal((await f.call('/api/status', { ...owner, headers: { 'X-Turnlink-Request': '' } })).status, 403);
  assert.equal((await f.call('/api/logout', { ...owner, input: {}, headers: { Origin: '' } })).status, 403);
  const hostResponse = await new Promise((resolve, reject) => {
    const request = httpRequest(f.origin + '/api/status', { headers: { Host: 'evil.example', Cookie: owner.cookie, 'X-Turnlink-Request': '1' } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    }); request.on('error', reject); request.end();
  });
  assert.equal(hostResponse, 403);
});

test('CSRF tokens are required for every authenticated mutation and one operator login invalidates previous cookies/previews', async t => {
  const f = await fixture(t), first = await f.signIn();
  for (const path of ['/api/preview', '/api/execute', '/api/logout'])
    assert.equal((await f.call(path, { cookie: first.cookie, input: {} })).status, 403);
  const preview = await prepare(f, first); assert.equal(preview.status, 200);
  const next = await f.signIn();
  assert.equal((await f.call('/api/session', first)).status, 401);
  assert.equal((await f.call('/api/execute', { ...next, input: { previewID: preview.body.previewID } })).status, 404);
  assert.equal((await f.call('/api/session', { cookie: `${next.cookie}; ${next.cookie}` })).status, 401);
  assert.equal((await f.call('/api/logout', { ...next, input: {} })).status, 200);
  assert.equal((await f.call('/api/session', next)).status, 401);
});

test('channel/view/query/mutation scopes reject broad RPC, identity injection, unconfigured channels and worktree execution', async t => {
  const f = await fixture(t), owner = await f.signIn();
  assert.equal((await f.call('/api/channels/private/channel', owner)).status, 403);
  assert.equal((await f.call('/api/channels/dev/channel', owner)).status, 200);
  assert.equal((await f.call('/api/channels/dev/security', owner)).status, 404);
  for (const query of ['?credential=secret', '?offset=-1', '?offset=1&offset=2', '?offset=9999999', '?after=NaN'])
    assert.equal((await f.call(`/api/channels/dev/tasks${query}`, owner)).status, 400);
  assert.equal((await f.call('/api/rpc', { ...owner, input: { method: 'enroll', credential: HOST } })).status, 404);
  assert.equal((await prepare(f, owner, { ...configuration(), channel: 'private' })).status, 403);
  assert.equal((await prepare(f, owner, { ...configuration(), actor: { kind: 'scheduler' } })).status, 400);
  assert.equal((await prepare(f, owner, { id: randomUUID(), channel: 'dev', op: 'master.volunteer', eligible: true })).status, 403);
  assert.equal((await prepare(f, owner, { id: randomUUID(), channel: 'dev', op: 'task.create', title: 'No movement', instructions: 'Keep cwd', criteria: 'No movement', requiresWorktree: true })).status, 409);
});

test('commands require an explicit preview/confirmation; exact confirmation retry returns its cached receipt without executing twice', async t => {
  const f = await fixture(t), owner = await f.signIn(), command = configuration();
  const before = (await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel;
  const preview = await prepare(f, owner, command); assert.equal(preview.status, 200); assert.deepEqual(preview.body.command, command);
  assert.equal((await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.mode, 'safe');
  const confirmation = { ...owner, input: { previewID: preview.body.previewID } };
  const first = await f.call('/api/execute', confirmation), next = await f.call('/api/execute', confirmation);
  assert.equal(first.status, 200); assert.equal(first.body.commandID, command.id); assert.deepEqual(next.body, first.body);
  const after = (await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel;
  assert.equal(after.mode, 'approval'); assert.equal(after.policyRevision, before.policyRevision + 1);
  assert.equal((await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID, command: configuration() } })).status, 400);
});

test('broker checks dashboard preconditions at commit, but preserves exact durable command receipt retries', async t => {
  const f = await fixture(t);
  const expected = channelPrecondition((await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel);
  await f.command('channel.configure', { mode: 'automatic' });
  const command = configuration();
  await assert.rejects(f.admin.request('control_command', { command, expected }), /PRECONDITION_FAILED/);
  assert.equal((await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.mode, 'automatic');
  const current = channelPrecondition((await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel);
  const applied = await f.admin.request('control_command', { command, expected: current });
  assert.equal(applied.replayed, false);
  assert.equal((await f.admin.request('control_command', { command, expected: current })).replayed, true, 'a stale precondition must not lose the original committed receipt');
});

test('receipt lookup is read-only, operator/channel scoped, and absence never invokes a command', async t => {
  const f = await fixture(t), owner = await f.signIn(), command = configuration();
  const lookup = () => f.call(`/api/receipt?channel=dev&commandID=${command.id}`, owner);
  assert.equal((await lookup()).body.known, false);
  const preview = await prepare(f, owner, command); await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  const receipt = await lookup(); assert.equal(receipt.status, 200); assert.equal(receipt.body.known, true);
  assert.equal(receipt.body.commandID, command.id); assert.ok(receipt.body.eventCount > 0); assert.match(receipt.body.digest, /^[a-f0-9]{64}$/);
  assert.equal((await f.call(`/api/receipt?channel=private&commandID=${command.id}`, owner)).status, 403);
  assert.equal((await f.admin.request('control_receipt', { channel: 'private', commandID: command.id })).known, false);
  const host = new ChannelClient({ url: `ws://127.0.0.1:${f.broker.server.address().port}`, token: HOST,
    credentialDirectory: join(f.root, 'proofs') }); t.after(() => host.close());
  await assert.rejects(host.request('control_receipt', { channel: 'dev', commandID: command.id }), /OPERATOR_REQUIRED/);
  await host.request('join', { harness: 'opencode', sessionId: 'reader', name: 'reader', channel: 'dev', role: 'unchanged', project: { name: 'fixture', root: '/fixture' } });
  const expected = channelPrecondition((await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel);
  await assert.rejects(host.request('control_command', { agentId: 'opencode:reader', expected,
    command: { id: randomUUID(), channel: 'dev', op: 'master.volunteer', eligible: true } }), /OPERATOR_REQUIRED/);
  assert.equal((await f.call(`/api/receipt?channel=dev&commandID=${command.id}&method=enroll`, owner)).status, 400);
});

test('an in-flight logout from an old session cannot revoke a replacement operator session', async t => {
  const f = await fixture(t), first = await f.signIn();
  let started;
  const reading = new Promise(resolve => { started = (req) => { if (req.url === '/api/logout') { f.dashboard.server.off('request', started); resolve(); } }; f.dashboard.server.on('request', started); });
  let request;
  const response = new Promise((resolve, reject) => {
    request = httpRequest(f.origin + '/api/logout', { method: 'POST', headers: { Cookie: first.cookie, Origin: f.origin,
      'X-Turnlink-Request': '1', 'X-Turnlink-CSRF': first.csrf, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.once('end', () => resolve(res.statusCode));
    }); request.on('error', reject); request.write('{');
  });
  await reading; const next = await f.signIn(); request.end('}');
  assert.equal(await response, 401); assert.equal((await f.call('/api/session', next)).status, 200);
});

test('stale and expired previews cannot mutate policy, and idle/absolute session expiry is enforced', async t => {
  const f = await fixture(t), owner = await f.signIn(), preview = await prepare(f, owner);
  await f.command('channel.configure', { mode: 'automatic' });
  const stale = await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'PREVIEW_STALE');
  const expires = await prepare(f, owner); f.advance(120000);
  assert.equal((await f.call('/api/execute', { ...owner, input: { previewID: expires.body.previewID } })).body.error, 'PREVIEW_EXPIRED');
  f.advance(30 * 60000); assert.equal((await f.call('/api/session', owner)).status, 401);
  const next = await f.signIn();
  for (let i = 0; i < 17; i++) { f.advance(29 * 60000); await f.call('/api/session', next); }
  assert.equal((await f.call('/api/session', next)).status, 401);
});

test('login attempts and body/schema budgets are bounded without echoing passwords or parser exceptions', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/login', { input: { password: '0'.repeat(64) }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  const malformed = await f.call('/api/login', { raw: '{"password": "private invalid body"' });
  assert.equal(malformed.status, 400); assert.ok(!JSON.stringify(malformed.body).includes('private invalid body'));
  assert.equal((await f.call('/api/login', { input: { password: 'x'.repeat(2048) } })).status, 413);
  assert.equal((await f.call('/api/login', { input: { password: '0'.repeat(64), actor: 'operator' } })).status, 400);
  assert.equal((await f.call('/api/login', { input: { password: '0'.repeat(64) } })).status, 401);
  assert.equal((await f.call('/api/login', { input: { password: LOGIN } })).status, 429);
});

async function stub(t, handler, extra = {}) {
  const root = rootFor(), server = new WebSocketServer({ host: '127.0.0.1', port: 0 }), events = new EventEmitter();
  await once(server, 'listening');
  const channel = { id: 'dev', generation: 0, policyRevision: 1, mode: 'safe', volunteers: [], active: null, proposal: null, election: null };
  server.on('connection', socket => socket.on('message', raw => {
    const request = JSON.parse(raw), respond = result => socket.send(JSON.stringify({ v: 2, id: request.id, result }));
    if (request.method === 'hello') respond({ protocol: 2, hostId: 'operator', admin: true });
    else handler({ request, respond, socket, events, channel });
  }));
  const f = await attach(t, { root, brokerURL: `ws://127.0.0.1:${server.address().port}`, ...extra });
  t.after(async () => { await f.dashboard.close(); for (const s of server.clients) s.terminate(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  return { ...f, events };
}

test('lost broker command responses are held as uncertain and never automatically resent', async t => {
  let starts = 0, expected;
  const f = await stub(t, ({ request, respond, socket, channel }) => {
    if (request.method === 'control_query') respond({ channel });
    if (request.method === 'control_command') { starts++; expected = request.params.expected; socket.close(); }
  });
  const owner = await f.signIn(), preview = await prepare(f, owner), input = { previewID: preview.body.previewID };
  const result = await f.call('/api/execute', { ...owner, input });
  assert.equal(result.body.error, 'COMMAND_OUTCOME_UNCERTAIN'); assert.equal(result.body.commandID, preview.body.command.id);
  assert.equal((await f.call('/api/execute', { ...owner, input })).status, 409); assert.equal(starts, 1);
  assert.equal(expected.policyRevision, 1); assert.equal(expected.generation, 0); assert.equal(expected.activeID, null);
});

test('broker commit-fence rejection is a stale preview, not an automatically replayed command', async t => {
  let starts = 0;
  const f = await stub(t, ({ request, respond, socket, channel }) => {
    if (request.method === 'control_query') respond({ channel });
    if (request.method === 'control_command') { starts++; socket.send(JSON.stringify({ v: 2, id: request.id, error: 'PRECONDITION_FAILED' })); }
  });
  const owner = await f.signIn(), preview = await prepare(f, owner), input = { previewID: preview.body.previewID };
  const result = await f.call('/api/execute', { ...owner, input });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'PREVIEW_STALE');
  assert.equal((await f.call('/api/execute', { ...owner, input })).status, 409); assert.equal(starts, 1);
});

test('logout/replacement during asynchronous revalidation revokes the old session before any command is sent', async t => {
  let queryCount = 0, starts = 0, release;
  const f = await stub(t, ({ request, respond, events, channel }) => {
    if (request.method === 'control_query') {
      queryCount++;
      if (queryCount === 2) { release = () => respond({ channel }); events.emit('checking'); } else respond({ channel });
    }
    if (request.method === 'control_command') { starts++; respond({}); }
  });
  const owner = await f.signIn(), preview = await prepare(f, owner), checking = once(f.events, 'checking');
  const execute = f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  await checking; await f.signIn(); release();
  assert.equal((await execute).status, 401); assert.equal(starts, 0);
});

test('preview expiry during asynchronous revalidation is checked again at the actual RPC send boundary', async t => {
  let time = 1000000, queries = 0, starts = 0, release;
  const f = await stub(t, ({ request, respond, events, channel }) => {
    if (request.method === 'control_query') {
      if (++queries === 2) { release = () => respond({ channel }); events.emit('checking'); } else respond({ channel });
    }
    if (request.method === 'control_command') { starts++; respond({}); }
  }, { now: () => time });
  const owner = await f.signIn(), preview = await prepare(f, owner), checking = once(f.events, 'checking');
  const execute = f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  await checking; time += 120000; release();
  const result = await execute; assert.equal(result.status, 409); assert.equal(result.body.error, 'PREVIEW_EXPIRED'); assert.equal(starts, 0);
});

test('a browser cannot approve an executor-disabled or unsupported recovery proposal', async t => {
  const action = { id: randomUUID(), status: 'awaiting_approval', operation: 'retry_delivery' };
  const f = await stub(t, ({ request, respond, channel }) => {
    if (request.method === 'control_query') respond(request.params.view === 'channel' ? { channel } : { entries: [action] });
    if (request.method === 'control_info') respond({ available: true, effectsEnabled: true, effectOperations: ['pause_delivery'] });
  });
  const owner = await f.signIn();
  const result = await prepare(f, owner, { id: randomUUID(), channel: 'dev', op: 'action.approve', actionID: action.id });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'EFFECT_NOT_ENABLED');
});

test('recovery approval previews expose the exact wake policy and native recovery binding, and refuse changed proposals', async t => {
  const action = { id: randomUUID(), status: 'awaiting_approval', operation: 'change_wake_policy', target: 'opencode:receiver',
    wakePolicy: 'paused', evidence: 'not_applicable', generation: 3, policyRevision: 1, requester: 'opencode:master' };
  let sends = 0;
  const f = await stub(t, ({ request, respond, channel }) => {
    if (request.method === 'control_query') respond(request.params.view === 'channel' ? { channel } : { entries: [action] });
    if (request.method === 'control_info') respond({ available: true, effectsEnabled: true, effectOperations: ['change_wake_policy', 'retry_delivery'] });
    if (request.method === 'control_command') { sends++; respond({ commandID: request.params.command.id }); }
  });
  const owner = await f.signIn();
  const command = () => ({ id: randomUUID(), channel: 'dev', op: 'action.approve', actionID: action.id });
  const wake = await prepare(f, owner, command()); assert.equal(wake.status, 200);
  assert.equal(wake.body.proposal.wakePolicy, 'paused');
  assert.equal(wake.body.proposal.actionID, action.id);
  assert.equal(wake.body.proposal.requester, action.requester);
  assert.equal(wake.body.proposal.generation, action.generation);
  assert.equal(wake.body.proposal.policyRevision, action.policyRevision);
  const rejection = await prepare(f, owner, { ...command(), op: 'action.reject' });
  assert.equal(rejection.status, 200); assert.match(rejection.body.proposal.effect, /Rejects this proposal/);
  action.wakePolicy = 'steer';
  const stale = await f.call('/api/execute', { ...owner, input: { previewID: wake.body.previewID } });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'PREVIEW_STALE'); assert.equal(sends, 0);
  Object.assign(action, { operation: 'retry_delivery', messageID: randomUUID(), evidence: 'native_idempotent',
    admissionID: 'msg_original_native_prompt', recoveryEvidenceID: randomUUID() });
  delete action.wakePolicy;
  const retry = await prepare(f, owner, command()); assert.equal(retry.status, 200);
  assert.equal(retry.body.proposal.admissionID, action.admissionID);
  assert.equal(retry.body.proposal.recoveryEvidenceID, action.recoveryEvidenceID);
  assert.equal(retry.body.proposal.wakePolicy, null);
  assert.equal(retry.body.proposal.messageID, action.messageID);
  assert.match(retry.body.proposal.effect, /schedules recovery/i);
  action.recoveryEvidenceID = randomUUID();
  const changed = await f.call('/api/execute', { ...owner, input: { previewID: retry.body.previewID } });
  assert.equal(changed.status, 409); assert.equal(changed.body.error, 'PREVIEW_STALE'); assert.equal(sends, 0);
});

test('durable notifications reach the real dashboard; preview/read never acknowledge and confirmation changes no control authority', async t => {
  const f = await fixture(t), owner = await f.signIn();
  await f.command('task.create', { title: 'Deadline fixture', instructions: 'private content excluded', criteria: 'Keep unresolved', requiresWorktree: false, deadlineAt: 1000001 });
  f.advance(2);
  const deadline = Date.now() + 5000;
  let inbox;
  do { inbox = await f.call('/api/channels/dev/notifications?after=0', owner); if (inbox.body.entries?.length) break; await delay(20); } while (Date.now() < deadline);
  assert.equal(inbox.status, 200); assert.equal(inbox.body.entries.length, 1);
  const notification = inbox.body.entries[0], command = { op: 'notification.ack', channel: 'dev', id: notification.id };
  assert.equal(notification.acknowledgedAt, null); assert.ok(!JSON.stringify(inbox.body).includes('private content excluded'));
  assert.equal((await f.call('/api/channels/private/notifications', owner)).status, 403);
  assert.equal((await f.call(`/api/notification?channel=private&id=${notification.id}`, owner)).status, 403);
  assert.equal((await f.call('/api/preview', { cookie: owner.cookie, input: { command } })).status, 403);
  assert.equal((await f.call('/api/channels/dev/notifications?offset=0', owner)).status, 400);
  const state = f.broker.store, before = await f.admin.request('control_query', { channel: 'dev', view: 'incidents' });
  const preview = await prepare(f, owner, command); assert.equal(preview.status, 200); assert.match(preview.body.notice, /does not resolve/);
  assert.equal((await f.call(`/api/notification?channel=dev&id=${notification.id}`, owner)).body.acknowledgedAt, null);
  const input = { previewID: preview.body.previewID };
  const first = await f.call('/api/execute', { ...owner, input }); assert.equal(first.status, 200); assert.equal(first.body.result.acknowledgedAt, 1000002);
  assert.deepEqual((await f.call('/api/execute', { ...owner, input })).body, first.body);
  assert.deepEqual(await f.admin.request('control_query', { channel: 'dev', view: 'incidents' }), before);
  assert.deepEqual(f.broker.store, state);
  const lookup = await f.call(`/api/notification?channel=dev&id=${notification.id}`, owner); assert.equal(lookup.body.acknowledgedAt, 1000002);
  assert.equal((await prepare(f, owner, command)).status, 409);
});

test('lost notification acknowledgement reply is not resent; its immutable ID supports read-only investigation', async t => {
  const notification = { id: randomUUID(), channel: 'dev', sequence: 1, type: 'incident.opened', at: 1000, entityID: randomUUID(), acknowledgedAt: null };
  let acknowledgements = 0;
  const f = await stub(t, ({ request, respond, socket, channel }) => {
    if (request.method === 'control_query') respond({ channel });
    if (request.method === 'control_notifications') respond(notification);
    if (request.method === 'control_notification_ack') { acknowledgements++; notification.acknowledgedAt = 1001; socket.close(); }
  });
  const owner = await f.signIn(), command = { op: 'notification.ack', channel: 'dev', id: notification.id };
  const preview = await prepare(f, owner, command); assert.equal(preview.status, 200);
  const input = { previewID: preview.body.previewID };
  const result = await f.call('/api/execute', { ...owner, input }); assert.equal(result.body.error, 'COMMAND_OUTCOME_UNCERTAIN');
  assert.equal((await f.call('/api/execute', { ...owner, input })).status, 409); assert.equal(acknowledgements, 1);
  const lookup = await f.call(`/api/notification?channel=dev&id=${notification.id}`, owner);
  assert.equal(lookup.body.acknowledgedAt, 1001); assert.equal(acknowledgements, 1);
});

test('replacement login while notification is revalidated prevents the old acknowledgement send', async t => {
  const notification = { id: randomUUID(), channel: 'dev', sequence: 1, type: 'incident.opened', at: 1000, acknowledgedAt: null };
  let queries = 0, sends = 0, release;
  const f = await stub(t, ({ request, respond, events, channel }) => {
    if (request.method === 'control_query') respond({ channel });
    if (request.method === 'control_notifications') {
      if (++queries === 2) { release = () => respond(notification); events.emit('checking'); } else respond(notification);
    }
    if (request.method === 'control_notification_ack') { sends++; respond({}); }
  });
  const owner = await f.signIn(), preview = await prepare(f, owner, { op: 'notification.ack', channel: 'dev', id: notification.id });
  const checking = once(f.events, 'checking'), execute = f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  await checking; await f.signIn(); release(); assert.equal((await execute).status, 401); assert.equal(sends, 0);
});

test('advanced task metadata survives guarded real-dashboard creation without claim, dispatch or implicit late-run decision', async t => {
  const f = await fixture(t), owner = await f.signIn();
  const dependency = await f.command('task.create', { title: 'Dependency', instructions: 'Existing work', criteria: 'Master review', requiresWorktree: false });
  const command = { id: randomUUID(), op: 'task.create', channel: 'dev', title: 'Scheduled dependant', instructions: 'Keep approvals', criteria: 'Wait for dependency',
    requiresWorktree: false, dependencies: [dependency.commandID], priority: 91, schedule: { at: 2000000, missed: 'ask', maxLatenessMs: 30000 }, deadlineAt: 3000000, progressTimeoutMs: 120000 };
  const preview = await prepare(f, owner, command); assert.equal(preview.status, 200);
  assert.equal(preview.body.proposal.scheduledStartUTC, new Date(2000000).toISOString());
  assert.equal(preview.body.proposal.deadlineUTC, new Date(3000000).toISOString());
  assert.equal(preview.body.proposal.missedPolicy, 'ask'); assert.deepEqual(preview.body.command.dependencies, [dependency.commandID]);
  assert.equal((await f.admin.request('control_receipt', { channel: 'dev', commandID: command.id })).known, false);
  const confirmed = await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } }); assert.equal(confirmed.status, 200);
  const task = (await f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: command.id })).entries[0];
  for (const field of ['dependencies', 'priority', 'schedule', 'deadlineAt', 'progressTimeoutMs']) assert.deepEqual(task[field], command[field]);
  assert.equal(task.status, 'open'); assert.equal(task.claimant, null); assert.equal(task.attempt, 0); assert.equal(task.requiresWorktree, false); assert.equal(task.missedDecision, undefined);
});

test('task preview rejects duplicate IDs, past/out-of-range dates and oversized dependency sets without task admission', async t => {
  const f = await fixture(t), owner = await f.signIn(), id = randomUUID();
  const base = { id: randomUUID(), op: 'task.create', channel: 'dev', title: 'Refused metadata', instructions: 'No effect', criteria: 'Refuse', requiresWorktree: false };
  for (const [fields, code] of [[{ dependencies: [id, id] }, 'DUPLICATE_DEPENDENCY'], [{ deadlineAt: 1 }, 'DEADLINE_IN_PAST'],
    [{ schedule: { at: Number.MAX_SAFE_INTEGER } }, 'TASK_TIME_OUT_OF_RANGE']]) {
    const result = await prepare(f, owner, { ...base, ...fields }); assert.equal(result.status, 409); assert.equal(result.body.error, code);
  }
  assert.equal((await prepare(f, owner, { ...base, dependencies: Array.from({ length: 65 }, () => randomUUID()) })).status, 400);
  assert.equal((await f.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.length, 0);
});

test('deadline expiry and unknown dependency refuse precisely, not as inferred execution uncertainty or permission to replay', async t => {
  const f = await fixture(t), owner = await f.signIn();
  const base = { id: randomUUID(), op: 'task.create', channel: 'dev', title: 'Refused commit', instructions: 'No effect', criteria: 'Exact refusal', requiresWorktree: false };
  const dated = { ...base, deadlineAt: 1000005 }, preview = await prepare(f, owner, dated); assert.equal(preview.status, 200);
  f.advance(6);
  const expired = await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } }); assert.equal(expired.status, 409); assert.equal(expired.body.error, 'DEADLINE_IN_PAST');
  const unknown = { ...base, id: randomUUID(), dependencies: [randomUUID()] }, dependencyPreview = await prepare(f, owner, unknown);
  assert.equal(dependencyPreview.status, 200);
  const refused = await f.call('/api/execute', { ...owner, input: { previewID: dependencyPreview.body.previewID } });
  assert.equal(refused.status, 409); assert.equal(refused.body.error, 'UNKNOWN_DEPENDENCY');
  for (const commandID of [dated.id, unknown.id]) assert.equal((await f.admin.request('control_receipt', { channel: 'dev', commandID })).known, false);
  assert.equal((await f.admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.length, 0);
});

test('an explicit deadline rejection at the actual broker commit is displayed without retry while lost replies remain uncertain', async t => {
  let sends = 0;
  const f = await stub(t, ({ request, respond, socket, channel }) => {
    if (request.method === 'control_query') respond({ channel });
    if (request.method === 'control_command') { sends++; socket.send(JSON.stringify({ v: 2, id: request.id, error: 'DEADLINE_IN_PAST' })); }
  });
  const owner = await f.signIn(), preview = await prepare(f, owner, { id: randomUUID(), op: 'task.create', channel: 'dev', title: 'Commit deadline', instructions: 'Keep policy', criteria: 'Refuse', requiresWorktree: false, deadlineAt: Date.now() + 60000 });
  const input = { previewID: preview.body.previewID };
  const result = await f.call('/api/execute', { ...owner, input }); assert.equal(result.status, 409); assert.equal(result.body.error, 'DEADLINE_IN_PAST');
  assert.equal((await f.call('/api/execute', { ...owner, input })).status, 409); assert.equal(sends, 1);
});

test('reassignment previews bind exact claimant/attempt, reopen only after confirmation and never release a later claim on retry', async t => {
  const f = await fixture(t), owner = await f.signIn(), a = await claimant(t, f, 'a'), b = await claimant(t, f, 'b');
  const taskID = (await f.command('task.create', { title: 'Reassign fixture', instructions: 'Keep evidence', criteria: 'Voluntary claims', requiresWorktree: false })).commandID;
  await a.run('task.claim', { taskID });
  const command = { id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID }, preview = await prepare(f, owner, command);
  assert.equal(preview.status, 200); assert.equal(preview.body.proposal.claimant, a.agentId);
  await a.run('task.release', { taskID }); await b.run('task.claim', { taskID });
  const stale = await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'PREVIEW_STALE');
  const fresh = await prepare(f, owner, command); assert.equal(fresh.status, 200); assert.equal(fresh.body.proposal.claimant, b.agentId);
  const input = { previewID: fresh.body.previewID }, committed = await f.call('/api/execute', { ...owner, input }); assert.equal(committed.status, 200);
  const task = () => f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID });
  assert.equal((await task()).entries[0].status, 'open'); assert.equal((await task()).entries[0].claimant, null);
  await b.run('task.claim', { taskID }); const newer = (await task()).entries[0];
  assert.deepEqual((await f.call('/api/execute', { ...owner, input })).body, committed.body); assert.deepEqual((await task()).entries[0], newer);
});

test('real broker enforces task digest at commit even when channel policy is unchanged', async t => {
  const f = await fixture(t), a = await claimant(t, f, 'a'), b = await claimant(t, f, 'b');
  const taskID = (await f.command('task.create', { title: 'Wire fence', instructions: 'Keep current owner', criteria: 'Refuse stale release', requiresWorktree: false })).commandID;
  await a.run('task.claim', { taskID });
  const expectedTask = taskPrecondition((await f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0]);
  const expected = channelPrecondition((await f.admin.request('control_query', { channel: 'dev', view: 'channel' })).channel);
  await a.run('task.release', { taskID }); await b.run('task.claim', { taskID });
  const command = { id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID };
  await assert.rejects(f.admin.request('control_command', { command, expected, expectedTask }), /PRECONDITION_FAILED/);
  assert.equal((await f.admin.request('control_receipt', { channel: 'dev', commandID: command.id })).known, false);
  assert.equal((await f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0].claimant, b.agentId);
});

test('active-work reassignment remains blocked until stop evidence, and new uncertainty revokes that eligibility', async t => {
  const f = await fixture(t, { taskDispatch: true }), owner = await f.signIn(), a = await claimant(t, f, 'a');
  await f.admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
  const taskID = (await f.command('task.create', { title: 'Active fixture', instructions: 'No blind release', criteria: 'Fresh stop marker', requiresWorktree: false })).commandID;
  await a.run('task.claim', { taskID });
  const pulled = await a.client.request('control_task_pull', { agentId: a.agentId, credential: '3'.repeat(64), channel: 'dev', cwd: '/fixture', scopeDigest: 'a'.repeat(64) });
  const task = pulled.task;
  const report = (op, fields) => a.client.request('control_adapter', { agentId: a.agentId, credential: '3'.repeat(64), command: { id: randomUUID(), op, channel: 'dev', taskID, attempt: task.attempt, ...fields } });
  await report('task.admission', { outcome: 'admitted', receiptID: randomUUID(), admissionID: task.nativeAdmissionID });
  await report('task.started', { evidenceID: randomUUID() });
  const command = { id: randomUUID(), op: 'task.reassign', channel: 'dev', taskID };
  assert.equal((await prepare(f, owner, command)).body.error, 'STOP_EVIDENCE_REQUIRED');
  await report('task.stopped', { evidenceID: randomUUID() }); const preview = await prepare(f, owner, command); assert.equal(preview.status, 200);
  await report('task.uncertain', {});
  const result = await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'STOP_EVIDENCE_REQUIRED');
  assert.equal((await prepare(f, owner, { ...command, id: randomUUID() })).body.error, 'STOP_EVIDENCE_REQUIRED');
  const observed = (await f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0];
  assert.equal(observed.status, 'uncertain'); assert.equal(observed.claimant, a.agentId); assert.equal(observed.stoppedEvidence, undefined);
});

test('missed-schedule confirmation becomes stale when a participant claims the task during operator review', async t => {
  const f = await fixture(t), owner = await f.signIn(), a = await claimant(t, f, 'a');
  const taskID = (await f.command('task.create', { title: 'Missed ask', instructions: 'Keep claim fence', criteria: 'Explicit run decision', requiresWorktree: false, schedule: { at: 1, missed: 'ask', maxLatenessMs: 5 } })).commandID;
  const preview = await prepare(f, owner, { id: randomUUID(), op: 'task.missed', channel: 'dev', taskID, run: true }); assert.equal(preview.status, 200);
  await a.run('task.claim', { taskID });
  const result = await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } }); assert.equal(result.status, 409); assert.equal(result.body.error, 'PREVIEW_STALE');
  const task = (await f.admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0];
  assert.equal(task.claimant, a.agentId); assert.equal(task.missedDecision, undefined);
});

test('dashboard sends both channel and exact canonical task fences at the actual reassignment/missed RPC boundary', async t => {
  const task = { id: randomUUID(), channel: 'dev', title: 'Transport fixture', instructions: 'No privileges', criteria: 'Exact target fence',
    dependencies: [], priority: 50, status: 'claimed', createdAt: 1, progressTimeoutMs: 300000, requiresWorktree: false,
    claimant: 'opencode:owner', attempt: 0, claimGeneration: 1, admission: 'none', schedule: { at: 1, missed: 'ask', maxLatenessMs: 5 } };
  let sends = 0;
  const f = await stub(t, ({ request, respond, channel }) => {
    if (request.method === 'control_query') respond(request.params.view === 'channel' ? { channel } : { entries: [task] });
    if (request.method === 'control_command') {
      sends++; assert.deepEqual(request.params.expectedTask, taskPrecondition(task)); assert.equal(request.params.expected.policyRevision, 1);
      respond({ commandID: request.params.command.id, eventIDs: [], replayed: false });
    }
  });
  const owner = await f.signIn();
  for (const fields of [{ op: 'task.reassign' }, { op: 'task.missed', run: false }]) {
    const preview = await prepare(f, owner, { id: randomUUID(), channel: 'dev', taskID: task.id, ...fields }); assert.equal(preview.status, 200);
    assert.equal((await f.call('/api/execute', { ...owner, input: { previewID: preview.body.previewID } })).status, 200);
  }
  assert.equal(sends, 2);
});
