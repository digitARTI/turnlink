import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once, EventEmitter } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { WebSocketServer } from 'ws';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { createDashboard } from '../src/dashboard-server.js';
import { channelPrecondition } from '../src/control/contracts.js';

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
