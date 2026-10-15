import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ChannelClient } from './client.js';
import { Channel } from './protocol.js';
import { Command, channelPrecondition } from './control/contracts.js';
import { digest, matches, validateCredential, stateDir, adminToken, token, url } from './config.js';
import { diagnosticCode } from './diagnostics.js';

const views = new Set(['channel', 'tasks', 'actions', 'incidents', 'events', 'messages', 'evidence', 'previews', 'transitions', 'activity']);
const commands = new Set(['channel.configure', 'master.appoint', 'master.revoke', 'action.approve', 'action.reject', 'task.missed', 'task.create']);
const fail = (status, code) => { const error = new Error(code); Object.assign(error, { status, code }); throw error; };
const check = (value, status, code) => { if (!value) fail(status, code); };
const hex = () => randomBytes(32).toString('hex');
const Login = z.strictObject({ password: z.string().regex(/^[a-f0-9]{64}$/) });
const Preview = z.strictObject({ command: Command });
const Execute = z.strictObject({ previewID: z.string().uuid() });

function assets(directory) {
  const files = new Map();
  const read = (file, type) => {
    const stat = lstatSync(join(directory, file));
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024, 500, 'INVALID_DASHBOARD_ASSET');
    files.set(`/${file}`, { type, body: readFileSync(join(directory, file)) });
  };
  check(!lstatSync(directory).isSymbolicLink(), 500, 'INVALID_DASHBOARD_ASSET');
  read('index.html', 'text/html; charset=utf-8');
  const assetDirectory = join(directory, 'assets'), stat = lstatSync(assetDirectory);
  check(stat.isDirectory() && !stat.isSymbolicLink(), 500, 'INVALID_DASHBOARD_ASSET');
  const entries = readdirSync(assetDirectory); check(entries.length <= 32, 500, 'INVALID_DASHBOARD_ASSET');
  for (const file of entries) {
    check(/^[a-zA-Z0-9_.-]+\.(js|css)$/.test(file), 500, 'INVALID_DASHBOARD_ASSET');
    read(`assets/${file}`, file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
  }
  files.set('/', files.get('/index.html')); return files;
}
function body(req, maxBytes = 24576) {
  check(/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || ''), 415, 'JSON_REQUIRED');
  if (req.headers['content-length']) check(Number(req.headers['content-length']) <= maxBytes, 413, 'BODY_TOO_LARGE');
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0, settled = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true; req.pause(); reject(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413, code: 'BODY_TOO_LARGE' })); return;
      }
      if (!settled) chunks.push(chunk);
    });
    req.once('end', () => {
      if (settled) return;
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(Object.assign(new Error('INVALID_JSON'), { status: 400, code: 'INVALID_JSON' })); }
    });
    req.once('error', reject); req.once('aborted', () => reject(new Error('REQUEST_ABORTED')));
  });
}

// Human-only loopback surface. No generic RPC/actor/credential endpoint and no
// native execution capability. Broker authorization/revalidation remains final.
export function createDashboard({ port = 47322, channels, loginSecret, brokerToken, brokerURL = url,
  assetDirectory = fileURLToPath(new URL('../dist/dashboard/', import.meta.url)), now = Date.now,
  idleMs = 30 * 60000, lifetimeMs = 8 * 3600000, previewMs = 120000 } = {}) {
  validateCredential(loginSecret); validateCredential(brokerToken);
  check(loginSecret !== brokerToken, 500, 'SEPARATE_DASHBOARD_CREDENTIAL_REQUIRED');
  const scopes = z.array(Channel).min(1).max(16).parse(channels);
  check(new Set(scopes).size === scopes.length, 500, 'INVALID_DASHBOARD_CHANNELS');
  check([idleMs, lifetimeMs, previewMs].every(v => Number.isSafeInteger(v) && v > 0), 500, 'INVALID_DASHBOARD_LIMIT');
  const files = assets(assetDirectory), loginDigest = digest(loginSecret), client = new ChannelClient({ token: brokerToken, url: brokerURL });
  let session, closed = false, closePromise;
  const loginBudget = { tokens: 5, at: now() }, requestBudget = { tokens: 40, at: now() };
  const consume = (budget, rate) => {
    const time = now(); check(time >= budget.at, 503, 'CLOCK_REGRESSION');
    budget.tokens = Math.min(budget === loginBudget ? 5 : 40, budget.tokens + (time - budget.at) * rate / 1000); budget.at = time;
    check(budget.tokens >= 1, 429, 'RATE_LIMITED'); budget.tokens--;
  };
  const rpc = async (method, params = {}) => {
    try { return await client.request(method, params); }
    catch (error) { fail(503, diagnosticCode(error)); }
  };
  const scoped = channel => { check(scopes.includes(channel), 403, 'CHANNEL_NOT_ALLOWED'); return channel; };
  const channelState = async channel => (await rpc('control_query', { channel, view: 'channel' })).channel;
  async function commandContext(command) {
    const channel = await channelState(scoped(command.channel)), context = { channel: channelPrecondition(channel), current: {
      mode: channel.mode, generation: channel.generation, policyRevision: channel.policyRevision,
      master: channel.active?.agentId ?? null, proposedMaster: channel.proposal?.agentId ?? null,
    } };
    if (command.op.startsWith('action.')) {
      const result = await rpc('control_query', { channel: command.channel, view: 'actions', entityID: command.actionID, limit: 1 });
      const action = result.entries[0]; check(action && action.status === 'awaiting_approval', 409, 'ACTION_NOT_PENDING');
      if (command.op === 'action.approve') {
        const info = await rpc('control_info');
        check(info.available && info.effectsEnabled && info.effectOperations.includes(action.operation), 409, 'EFFECT_NOT_ENABLED');
      }
      context.action = digest(JSON.stringify(action));
      context.proposal = { operation: action.operation, target: action.target, messageID: action.messageID ?? null,
        evidence: action.evidence, status: action.status };
    }
    return context;
  }
  function authenticate(req) {
    const cookies = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith('turnlink_dashboard='));
    const secret = cookies.length === 1 ? cookies[0].slice('turnlink_dashboard='.length) : '';
    const time = now();
    check(session && time >= session.lastAt && time < session.expiresAt && time - session.lastAt < idleMs && matches(secret, session.hash), 401, 'SIGN_IN_REQUIRED');
    session.lastAt = time; return session;
  }
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const origin = `http://127.0.0.1:${server.address()?.port}`;
    for (const [name, value] of Object.entries({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'" })) res.setHeader(name, value);
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      check(!closed && req.headers.host === new URL(origin).host && req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === 'host').length === 1, 403, 'HOST_DENIED');
      check(req.url.startsWith('/') && !req.url.startsWith('//') && !req.url.includes('#'), 400, 'INVALID_PATH');
      const target = new URL(req.url, origin), path = target.pathname;
      check(!req.headers.origin || req.headers.origin === origin, 403, 'ORIGIN_DENIED');
      check(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 403, 'ORIGIN_DENIED');
      if (!path.startsWith('/api/')) {
        check(['GET', 'HEAD'].includes(req.method) && !target.search, 404, 'NOT_FOUND');
        const asset = files.get(path); check(asset, 404, 'NOT_FOUND');
        res.writeHead(200, { 'Content-Type': asset.type }); res.end(req.method === 'HEAD' ? undefined : asset.body); return;
      }
      check(req.headers['x-turnlink-request'] === '1', 403, 'REQUEST_HEADER_REQUIRED');
      consume(requestBudget, 4);
      if (req.method === 'POST') check(req.headers.origin === origin, 403, 'ORIGIN_REQUIRED');
      if (path === '/api/login' && req.method === 'POST') {
        check(!target.search, 400, 'INVALID_QUERY'); consume(loginBudget, 1 / 60);
        const input = Login.parse(await body(req, 1024)); check(matches(input.password, loginDigest), 401, 'SIGN_IN_FAILED');
        const secret = hex(), time = now();
        session = { hash: digest(secret), csrf: hex(), lastAt: time, expiresAt: time + lifetimeMs, previews: new Map() };
        res.setHeader('Set-Cookie', `turnlink_dashboard=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(lifetimeMs / 1000)}`);
        json(200, { signedIn: true }); return;
      }
      const owner = authenticate(req);
      if (req.method === 'POST') check(matches(req.headers['x-turnlink-csrf'], digest(owner.csrf)), 403, 'CSRF_REQUIRED');
      if (path === '/api/session' && req.method === 'GET' && !target.search) {
        json(200, { csrf: owner.csrf, channels: scopes, expiresAt: owner.expiresAt }); return;
      }
      if (path === '/api/logout' && req.method === 'POST' && !target.search) {
        z.strictObject({}).parse(await body(req, 1024)); check(authenticate(req) === owner, 401, 'SIGN_IN_REQUIRED'); session = undefined;
        res.setHeader('Set-Cookie', 'turnlink_dashboard=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); json(200, { signedOut: true }); return;
      }
      if (path === '/api/status' && req.method === 'GET' && !target.search) {
        const [control, storage, activity] = await Promise.all([rpc('control_info'), rpc('control_storage_status'), rpc('control_activity_status')]);
        json(200, { control, storage, activity, checkedAt: now() }); return;
      }
      if (path === '/api/receipt' && req.method === 'GET') {
        const fields = {};
        for (const [key, value] of target.searchParams) {
          check(['channel', 'commandID'].includes(key) && target.searchParams.getAll(key).length === 1, 400, 'INVALID_QUERY'); fields[key] = value;
        }
        const input = z.strictObject({ channel: Channel, commandID: z.string().uuid() }).parse(fields); scoped(input.channel);
        json(200, await rpc('control_receipt', input)); return;
      }
      const view = /^\/api\/channels\/([^/]+)\/([^/]+)$/.exec(path);
      if (view && req.method === 'GET') {
        const channel = scoped(decodeURIComponent(view[1])), name = view[2]; check(views.has(name), 404, 'NOT_FOUND');
        const params = { channel, view: name, limit: 30 };
        for (const [key, value] of target.searchParams) {
          check(['after', 'offset'].includes(key) && target.searchParams.getAll(key).length === 1 && /^(0|[1-9]\d*)$/.test(value), 400, 'INVALID_QUERY');
          params[key] = Number(value); check(Number.isSafeInteger(params[key]) && params[key] <= (key === 'offset' ? 100000 : Number.MAX_SAFE_INTEGER), 400, 'INVALID_QUERY');
        }
        if (name === 'activity') {
          check(params.offset === undefined, 400, 'INVALID_QUERY'); delete params.view;
          json(200, await rpc('control_activity', params));
        } else json(200, await rpc('control_query', params));
        return;
      }
      if (path === '/api/preview' && req.method === 'POST' && !target.search) {
        const { command } = Preview.parse(await body(req)); scoped(command.channel);
        check(commands.has(command.op), 403, 'COMMAND_NOT_EXPOSED');
        check(command.op !== 'task.create' || !command.requiresWorktree, 409, 'WORKTREE_EXECUTION_DISABLED');
        const context = await commandContext(command), time = now();
        check(authenticate(req) === owner, 401, 'SIGN_IN_REQUIRED');
        for (const [id, preview] of owner.previews) if (preview.state === 'ready' && preview.expiresAt <= time) owner.previews.delete(id);
        if (owner.previews.size >= 64) {
          const completed = [...owner.previews].find(([, p]) => p.state === 'completed'); if (completed) owner.previews.delete(completed[0]);
        }
        check(owner.previews.size < 64, 429, 'PREVIEW_LIMIT');
        const preview = { id: randomUUID(), command, context, expiresAt: time + previewMs, state: 'ready' };
        owner.previews.set(preview.id, preview);
        json(200, { previewID: preview.id, command, current: context.current, proposal: context.proposal, expiresAt: preview.expiresAt,
          notice: 'Confirm this exact broker command. Native permissions and approvals remain authoritative.' }); return;
      }
      if (path === '/api/execute' && req.method === 'POST' && !target.search) {
        const { previewID } = Execute.parse(await body(req, 1024)), preview = owner.previews.get(previewID);
        check(authenticate(req) === owner, 401, 'SIGN_IN_REQUIRED');
        check(preview, 404, 'PREVIEW_NOT_FOUND');
        if (preview.state === 'completed') { json(200, preview.result); return; }
        check(preview.state === 'ready', 409, 'COMMAND_UNCERTAIN_OR_PENDING');
        check(now() < preview.expiresAt, 409, 'PREVIEW_EXPIRED');
        preview.state = 'checking';
        try {
          const context = await commandContext(preview.command);
          check(JSON.stringify(context) === JSON.stringify(preview.context), 409, 'PREVIEW_STALE');
          check(authenticate(req) === owner, 401, 'SIGN_IN_REQUIRED');
        } catch (error) { preview.state = 'stale'; throw error; }
        // Never automatically repeat a timed-out broker command. Its durable
        // command UUID is returned for explicit operator receipt investigation.
        preview.state = 'pending';
        let invoked = false;
        try {
          await client.connect();
          check(now() < preview.expiresAt, 409, 'PREVIEW_EXPIRED');
          check(client.admin && authenticate(req) === owner, 401, 'SIGN_IN_REQUIRED');
          // No await between the final session check and the actual native RPC
          // send. A reconnect must not admit a command for a replaced login.
          invoked = true;
          const result = await client.rpc('control_command', { command: preview.command, expected: preview.context.channel });
          preview.result = { commandID: preview.command.id, result }; preview.state = 'completed'; json(200, preview.result);
        } catch (error) {
          if (!invoked) { preview.state = 'stale'; throw error; }
          if (error.code === 'PRECONDITION_FAILED') {
            preview.state = 'stale'; json(409, { error: 'PREVIEW_STALE', commandID: preview.command.id }); return;
          }
          preview.state = 'uncertain'; json(error.status || 503, { error: 'COMMAND_OUTCOME_UNCERTAIN', commandID: preview.command.id });
        }
        return;
      }
      fail(404, 'NOT_FOUND');
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error.code === 'BODY_TOO_LARGE') res.setHeader('Connection', 'close');
      json(error.name === 'ZodError' ? 400 : error.status || 503, { error: error.name === 'ZodError' ? 'INVALID_REQUEST' : error.status ? error.code : 'DASHBOARD_UNAVAILABLE' });
    }
  });
  server.maxConnections = 32; server.maxHeadersCount = 32; server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  server.listen(port, '127.0.0.1');
  function close() {
    if (closePromise) return closePromise;
    closed = true; session = undefined; client.close();
    closePromise = new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); return closePromise;
  }
  return { server, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const loginFile = join(stateDir, 'dashboard-login.token'), loginSecret = token(true, loginFile);
    const dashboard = createDashboard({ channels: (process.env.TURNLINK_DASHBOARD_CHANNELS || '').split(',').filter(Boolean),
      loginSecret, brokerToken: adminToken(false), port: Number(process.env.TURNLINK_DASHBOARD_PORT || 47322) });
    dashboard.server.on('error', () => { console.error('Turnlink dashboard listener failed.'); void dashboard.close(); process.exitCode = 1; });
    dashboard.server.on('listening', () => {
      console.error(`Turnlink dashboard: http://127.0.0.1:${dashboard.server.address().port}`);
      console.error(`Use the separate dashboard login from the private file: ${loginFile}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await dashboard.close(); process.exit(0); });
  } catch (error) { console.error(`Turnlink dashboard failed (${diagnosticCode(error)}). Check channel scopes, frontend build and private credentials.`); process.exitCode = 1; }
}
