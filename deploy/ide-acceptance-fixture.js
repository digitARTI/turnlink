// Synthetic manual acceptance only. Never launches editors/native children or
// reads/writes actual editor profiles, accounts, model credentials or sessions.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { join, resolve, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { lstatSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { privateTemp, privateDirectory, atomicWrite, readPrivate } from '../src/storage.js';

const channel = 'manual-ide';
const check = (value, code) => { if (!value) throw new Error(code); };
const uuid = value => {
  const digest = createHash('sha256').update(value).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
};
const live = new Map();
const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(request, max) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; check(bytes <= max, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function record(root) {
  const initial = lstatSync(root); check(initial.isDirectory() && !initial.isSymbolicLink(), 'FIXTURE_IDENTITY_INVALID');
  privateDirectory(root);
  const value = JSON.parse(readPrivate(join(root, 'fixture.json'), 16384)), stat = lstatSync(root);
  check(value.kind === 'turnlink-manual-ide-v1' && value.root === realpathSync(root) &&
    value.device === stat.dev && value.inode === stat.ino && /^turnlink-ide-manual-/.test(basename(root)), 'FIXTURE_IDENTITY_INVALID');
  return value;
}

export function cleanupIDEFixture(root) {
  let value;
  try { value = record(resolve(root)); } catch { throw new Error('FIXTURE_IDENTITY_INVALID'); }
  check(value.state === 'stopped', 'FIXTURE_STILL_RUNNING');
  if (value.pid !== process.pid) {
    let running = true;
    try { process.kill(value.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
    check(!running, 'FIXTURE_PROCESS_STILL_RUNNING');
  } else check(!live.has(value.root), 'FIXTURE_STILL_RUNNING');
  rmSync(value.root, { recursive: true });
}

export async function startIDEFixture({ parent = process.platform === 'darwin' ? '/tmp' : tmpdir(), native, proxy } = {}) {
  check([parent, native, proxy].every(value => typeof value === 'string' && isAbsolute(value) && !/[\x00-\x1f]/.test(value)), 'ABSOLUTE_FIXTURE_PATHS_REQUIRED');
  // mkdtemp never adopts/overwrites an existing root. Only this fresh private
  // tree is written; source artifact paths are stored for later human review.
  const root = realpathSync(privateTemp(join(parent, 'turnlink-ide-manual-')));
  const paths = Object.fromEntries(['codex', 'home', 'sqlite', 'temp', 'project', 'credentials', 'broker', 'editor/User'].map(name => [name, join(root, name)]));
  for (const path of Object.values(paths)) privateDirectory(path);
  const secret = () => randomBytes(32).toString('hex');
  const host = secret(), adminSecret = secret(), adapter = secret(), control = secret();
  for (const [name, value] of Object.entries({ 'host.token': host, 'admin.token': adminSecret, 'adapter.token': adapter, 'control.token': control })) atomicWrite(join(root, name), value);
  const stat = lstatSync(root);
  let metadata = { kind: 'turnlink-manual-ide-v1', root, device: stat.dev, inode: stat.ino, pid: process.pid, state: 'starting' };
  const save = () => atomicWrite(join(root, 'fixture.json'), JSON.stringify(metadata)); save();
  let broker, admin, peer, server, expiry, closed = false, closing;
  const observations = { modelRequests: 0, phases: {}, instructions: { global: false, project: false }, toolCalls: 0 };
  const entities = { taskID: null, incidentID: null, wakeID: null };
  const command = (op, fields = {}) => admin.request('control_command', { command: { id: randomUUID(), op, channel, ...fields } });
  const snapshot = async () => {
    const [view, tasks] = await Promise.all([
      admin.request('control_query', { channel, view: 'channel' }), admin.request('control_query', { channel, view: 'tasks' }),
    ]);
    const recipient = view.members.find(member => member.agentId !== peer.primaryAgentId)?.agentId;
    const notices = recipient ? await admin.request('control_query', { channel, agentId: recipient, view: 'notices', limit: 16 }) : { entries: [] };
    return { view: { ...view.channel, members: view.members }, tasks: tasks.entries, notices: notices.entries };
  };
  let statusSnapshot, statusAt = 0;
  const status = async () => {
    if (!statusSnapshot || Date.now() - statusAt >= 500) {
      statusAt = Date.now();
      statusSnapshot = Promise.all([snapshot(), admin.request('control_query', { channel, view: 'events', limit: 100 })])
        .catch(error => { statusSnapshot = null; throw error; });
    }
    const [current, events] = await statusSnapshot;
    return { scope: 'synthetic-local-provider; manual UI evidence required', state: closed ? 'stopped' : 'running',
      modelRequests: observations.modelRequests, phases: { ...observations.phases }, instructions: { ...observations.instructions },
      toolCalls: observations.toolCalls, expiresAt: metadata.expiresAt, movementEnabled: false, uiEvidence: 'pending manual observation',
      channel: { id: channel, members: current.view.members.slice(0, 32).map(member => ({ agentId: member.agentId, connected: member.connected })),
        proposalID: current.view.proposal?.id ?? null, activeID: current.view.active?.id ?? null, activeAgentID: current.view.active?.agentId ?? null,
        generation: current.view.active?.generation ?? null },
      tasks: current.tasks.filter(task => task.id === entities.taskID).map(task => ({ id: task.id, status: task.status,
        admissionID: task.nativeAdmissionID ?? null, stoppedEvidence: task.stoppedEvidence ?? null, evidence: task.result?.evidence.slice(0, 4) ?? [] })),
      notices: current.notices.slice(-16).map(notice => ({ id: notice.id, kind: notice.kind, status: notice.status })),
      acceptedNoticeIDs: events.entries.filter(event => event.type === 'notice.accepted').slice(-16).map(event => event.entityID),
      entities: { ...entities } };
  };
  const member = current => {
    const members = current.view.members.filter(value => value.connected && value.agentId !== peer.primaryAgentId);
    check(members.length === 1 && members[0].agentId.startsWith('codex:'), 'ONE_FIXTURE_MEMBER_REQUIRED');
    return members[0];
  };
  let phaseTail = Promise.resolve();
  const phaseIntents = new Map(), peerID = 'codex:manual-fixture-peer';
  const duplicate = { appoint: 'ROLE_ALREADY_REQUESTED', task: 'TASK_ALREADY_CREATED', incident: 'INCIDENT_ALREADY_CREATED', wake: 'WAKE_ALREADY_SENT' };
  const savePhases = () => atomicWrite(join(root, 'phase-intents.json'), JSON.stringify([...phaseIntents.values()].map(({ promise, ...intent }) => intent)));
  const reservePhase = name => {
    const id = randomUUID(); let target = null;
    if (name !== 'incident') {
      const candidates = Object.values(broker.store.agents).filter(agent => agent.channel === channel && agent.agentId !== peerID);
      check(candidates.length === 1 && candidates[0].agentId.startsWith('codex:'), 'ONE_FIXTURE_MEMBER_REQUIRED');
      target = candidates[0].agentId;
    }
    const payload = name === 'wake' ? { agentId: peerID, to: target, messageId: id,
      text: 'TURNLINK_MANUAL_WAKE: synthetic peer delivery, preserve current cwd and permissions.' } : {
      command: { id, channel, ...({
        appoint: { op: 'master.appoint', candidate: target }, incident: { op: 'incident.open', category: 'connectivity' },
        task: { op: 'task.create', title: 'Synthetic manual IDE task',
          instructions: 'Return TURNLINK_MANUAL_TASK_RESULT. Do not run tools, modify files, change cwd, permissions or model.',
          criteria: 'Synthetic native result, native adapter artifact/stop evidence, explicit report and master review.', requiresWorktree: false },
      }[name]) },
    };
    const intent = { name, id, target, payload, state: 'reserved' };
    phaseIntents.set(name, intent); savePhases(); return intent;
  };
  const executePhase = async intent => {
    const { name, id, payload, target } = intent;
    try {
      check(!closed, 'FIXTURE_STOPPED');
      const current = await snapshot();
      if (target) check(member(current).agentId === target, 'BOUND_MEMBER_CHANGED');
      if (name === 'appoint') check((!current.view.proposal && !current.view.active) ||
        current.view.proposal?.id === id || current.view.active?.id === id, 'ROLE_ALREADY_REQUESTED');
      if (name === 'task') check(current.view.active, 'MASTER_REQUIRED');
      if (name === 'wake' && !peer.primaryAgentId) {
        await peer.request('join', { harness: 'codex', sessionId: 'manual-fixture-peer', channel,
          name: 'fixture-peer', role: 'Synthetic sender only', project: { name: 'manual-fixture', root: paths.project } });
        check(member(await snapshot()).agentId === target, 'BOUND_MEMBER_CHANGED');
      }
      check(!closed, 'FIXTURE_STOPPED');
      // The UUID, exact payload and recipient were persisted synchronously
      // before the first await. A lost response retains these same inputs.
      intent.state = 'invoking'; savePhases();
      const result = await (name === 'wake' ? peer.request('send', payload) : admin.request('control_command', payload));
      if (name === 'wake') entities.wakeID = result.id;
      if (name === 'task') entities.taskID = id;
      if (name === 'incident') entities.incidentID = id;
      intent.result = name === 'appoint' ? { phase: name, assignmentID: id, prompt: `TURNLINK_MANUAL_ACCEPT:${id}`, accepted: true } :
        name === 'task' ? { phase: name, taskID: id, prompt: `TURNLINK_MANUAL_CLAIM:${id}` } :
        name === 'incident' ? { phase: name, incidentID: id, modelRequests: observations.modelRequests } : { phase: name, messageID: result.id };
      intent.state = 'succeeded'; savePhases(); statusSnapshot = null; return intent.result;
    } catch (error) {
      intent.state = intent.state === 'invoking' ? 'uncertain' : 'blocked'; savePhases(); throw error;
    }
  };
  const phase = name => {
    try {
      check(!closed, 'FIXTURE_STOPPED'); check(Object.hasOwn(duplicate, name), 'PHASE_UNSUPPORTED');
      const intent = phaseIntents.get(name) || reservePhase(name);
      check(intent.state !== 'succeeded', duplicate[name]);
      if (intent.promise) return intent.promise;
      const operation = phaseTail.then(() => executePhase(intent));
      phaseTail = operation.catch(() => {});
      intent.promise = operation.finally(() => { intent.promise = null; });
      return intent.promise;
    } catch (error) { return Promise.reject(error); }
  };
  const model = async (input, response) => {
    check(Array.isArray(input.input), 'FIXTURE_INPUT_REQUIRED'); check(observations.modelRequests < 100, 'FIXTURE_MODEL_LIMIT');
    observations.modelRequests++;
    const serialized = JSON.stringify(input);
    for (const [key, marker] of [['global', 'TURNLINK_MANUAL_GLOBAL_FIXED'], ['project', 'TURNLINK_MANUAL_PROJECT_FIXED']])
      observations.instructions[key] ||= serialized.includes(marker);
    const index = input.input.findLastIndex(item => item.role === 'user'), user = input.input[index];
    const text = typeof user?.content === 'string' ? user.content : (user?.content || []).map(item => item.text || '').join('\n');
    const following = input.input.slice(index + 1);
    const current = await snapshot(); let label = 'baseline', name, args;
    const controlArgs = op => ({ command: { id: uuid(`${root}:${text}:${op.op}`), channel, ...op } });
    if (text.includes('TURNLINK_MANUAL_JOIN')) {
      label = 'join'; name = 'channel_join'; args = { channel, name: 'manual-fixture', role: 'Synthetic manual IDE fixture', project: { name: 'manual-fixture', root: paths.project } };
    } else if (text.includes('TURNLINK_MANUAL_VOLUNTEER')) {
      label = 'volunteer'; name = 'channel_control'; args = controlArgs({ op: 'master.volunteer', eligible: true });
    } else if (text.startsWith('TURNLINK_MANUAL_ACCEPT:')) {
      label = 'accept'; const id = text.trim().split(':')[1]; check(id === current.view.proposal?.id || id === current.view.active?.id, 'FIXTURE_ASSIGNMENT_REQUIRED');
      name = 'channel_control'; args = controlArgs({ op: 'master.accept', proposalID: id, promptVersion: 1 });
    } else if (text.startsWith('TURNLINK_MANUAL_CLAIM:')) {
      label = 'claim'; const id = text.trim().split(':')[1]; check(id === entities.taskID, 'FIXTURE_TASK_REQUIRED');
      name = 'channel_control'; args = controlArgs({ op: 'task.claim', taskID: id });
    } else if (text.includes('TASK_RESULT_DATA\n')) {
      label = 'report'; const data = JSON.parse(text.split('TASK_RESULT_DATA\n').at(-1));
      check(data.taskID === entities.taskID && data.evidence.length <= 4, 'FIXTURE_TASK_REQUIRED');
      name = 'channel_control'; args = controlArgs({ op: 'task.report', taskID: data.taskID, evidence: data.evidence, summary: 'TURNLINK_MANUAL_TASK_RESULT observed from synthetic local model; manual UI verification remains required.' });
    } else if (text.startsWith('TURNLINK_MANUAL_REVIEW:')) {
      label = 'review'; const task = current.tasks.find(task => task.id === text.trim().split(':')[1]);
      check(task?.id === entities.taskID && ['review', 'completed'].includes(task.status) && task.stoppedEvidence && current.view.active, 'FIXTURE_REVIEW_REQUIRED');
      name = 'channel_control'; args = controlArgs({ op: 'task.review', taskID: task.id, evidenceID: task.result.evidence[0], generation: current.view.active.generation, accept: true });
    } else if (text.startsWith('Turnlink task execution')) label = 'task-result';
    else if (text.includes('TASK_REVIEW_DATA\n')) label = 'review-ready';
    else if (text.includes('Turnlink supplemental master role')) label = 'role-offer';
    else if (text.includes('Turnlink supplemental role notice:')) label = 'role-status';
    else if (text.includes('TURNLINK_MANUAL_WAKE')) label = 'wake';
    observations.phases[label] = (observations.phases[label] || 0) + 1;
    let item;
    if (name && !following.some(item => item.type === 'function_call' && item.name?.endsWith(name))) {
      const catalogue = input.tools?.flatMap(tool => tool.type === 'namespace' ? tool.tools.map(value => ({ ...value, namespace: tool.name })) : [tool]);
      const tool = catalogue?.find(tool => tool.name?.endsWith(name)); check(tool, 'FIXTURE_TOOL_REQUIRED');
      observations.toolCalls++;
      item = { type: 'function_call', id: `fc_fixture_${observations.modelRequests}`, call_id: `call_fixture_${observations.modelRequests}`,
        name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify(args), status: 'completed' };
    } else {
      const text = label === 'task-result' ? 'TURNLINK_MANUAL_TASK_RESULT' : `TURNLINK_MANUAL_${label.replaceAll('-', '_').toUpperCase()}_OK`;
      item = { id: `msg_fixture_${observations.modelRequests}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] };
    }
    const result = { id: `resp_fixture_${observations.modelRequests}`, object: 'response', created_at: 1, status: 'completed', model: 'fixture', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('response.created', { response: { ...result, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    if (item.type === 'message') event('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: item.content[0].text });
    event('response.output_item.done', { output_index: 0, item }); event('response.completed', { response: result }); response.end();
  };
  const close = () => closing ||= (async () => {
    closed = true; clearTimeout(expiry); admin?.close(); peer?.close();
    await phaseTail;
    if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    if (broker) await broker.close();
    metadata = { ...metadata, state: 'stopped' }; save(); live.delete(root);
  })();
  try {
    broker = createBroker({ port: 0, directory: paths.broker, secret: host, adminSecret, controlPlane: true, taskDispatch: true, codexTasks: true });
    await once(broker.server, 'listening'); const brokerURL = `ws://127.0.0.1:${broker.server.address().port}`;
    admin = new ChannelClient({ url: brokerURL, token: adminSecret });
    peer = new ChannelClient({ url: brokerURL, token: host, credentialDirectory: paths.credentials });
    await command('channel.configure'); await admin.request('control_enroll_adapter', { hostId: 'local', credential: adapter });
    await peer.connect(); // No fixture member or model wake is created on startup.
    server = createServer(async (request, response) => {
      const json = (code, value) => { response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value)); };
      try {
        check(!closed && !request.headers.origin && !request.headers['sec-fetch-site'], 'REQUEST_REFUSED');
        check(request.headers.host === new URL(metadata.url).host, 'REQUEST_REFUSED');
        if (request.method === 'GET' && request.url === '/status') return json(200, await status());
        check(request.method === 'POST' && request.headers['content-type'] === 'application/json', 'REQUEST_REFUSED');
        if (request.url === '/v1/responses') {
          check(equal(request.headers.authorization, 'Bearer fixture-only'), 'REQUEST_REFUSED');
          return await model(await body(request, 2 * 1024 * 1024), response);
        }
        check(equal(request.headers.authorization, `Bearer ${control}`), 'REQUEST_REFUSED');
        const input = await body(request, 1024);
        if (request.url === '/phase') { check(Object.keys(input).length === 1 && typeof input.phase === 'string', 'REQUEST_REFUSED'); return json(200, await phase(input.phase)); }
        check(request.url === '/stop' && Object.keys(input).length === 0, 'REQUEST_REFUSED');
        response.once('finish', () => { close().catch(() => {}); }); return json(200, { state: 'stopping' });
      } catch (error) { if (!response.headersSent) json(400, { error: /^[A-Z_]+$/.test(error.message) ? error.message : 'FIXTURE_REQUEST_FAILED' }); else response.destroy(); }
    });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    metadata = { ...metadata, url, brokerURL, state: 'running', expiresAt: Date.now() + 30 * 60 * 1000 }; save();
    const environment = { HOME: paths.home, USERPROFILE: paths.home, CODEX_HOME: paths.codex, CODEX_SQLITE_HOME: paths.sqlite,
      TMPDIR: paths.temp, TMP: paths.temp, TEMP: paths.temp, XDG_CONFIG_HOME: join(paths.home, 'config'), XDG_DATA_HOME: join(paths.home, 'data'),
      XDG_CACHE_HOME: join(paths.home, 'cache'), XDG_STATE_HOME: join(paths.home, 'state'), APPDATA: join(paths.home, 'AppData/Roaming'), LOCALAPPDATA: join(paths.home, 'AppData/Local'),
      TURNLINK_FIXTURE_KEY: 'fixture-only', AGENT_CHANNEL_CODEX_EXECUTABLE: native, AGENT_CHANNEL_URL: brokerURL,
      AGENT_CHANNEL_TOKEN_FILE: join(root, 'host.token'), AGENT_CHANNEL_CREDENTIAL_DIR: paths.credentials,
      AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_CODEX_TASKS: '1', AGENT_CHANNEL_HEALTH: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: join(root, 'adapter.token') };
    for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'APPDATA', 'LOCALAPPDATA']) privateDirectory(environment[key]);
    atomicWrite(join(root, 'environment.json'), JSON.stringify(environment, null, 2));
    atomicWrite(join(root, 'editor/User/settings.json'), JSON.stringify({ 'chatgpt.cliExecutable': proxy, 'telemetry.telemetryLevel': 'off',
      'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'security.workspace.trust.enabled': true }, null, 2));
    atomicWrite(join(paths.codex, 'AGENTS.md'), 'TURNLINK_MANUAL_GLOBAL_FIXED: preserve fixture instructions and permissions.\n');
    atomicWrite(join(paths.project, 'AGENTS.md'), 'TURNLINK_MANUAL_PROJECT_FIXED: preserve fixture instructions and permissions.\n');
    const mcpEnv = Object.entries(environment).filter(([key]) => ['AGENT_CHANNEL_URL', 'AGENT_CHANNEL_TOKEN_FILE', 'AGENT_CHANNEL_CREDENTIAL_DIR'].includes(key))
      .map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n');
    atomicWrite(join(paths.codex, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "Manual fixture"\nbase_url = ${JSON.stringify(url + '/v1')}\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n[mcp_servers.turnlink]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([resolve(fileURLToPath(new URL('../src/mcp.js', import.meta.url))), '--codex-stdio', '--control-plane'])}\n[mcp_servers.turnlink.env]\n${mcpEnv}\n`);
    expiry = setTimeout(() => { close().catch(() => {}); }, 30 * 60 * 1000); expiry.unref(); live.set(root, true);
    return { root, url, brokerURL, broker, server, status, phase, close };
  } catch (error) { await close(); throw error; }
}

export async function fixtureRequest(root, operation, phase) {
  const value = record(resolve(root)); check(value.state === 'running', 'FIXTURE_NOT_RUNNING');
  const url = new URL(value.url); check(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'FIXTURE_URL_INVALID');
  check(['status', 'stop', 'phase'].includes(operation), 'FIXTURE_OPERATION_INVALID');
  const response = await fetch(url + operation, operation === 'status' ? { signal: AbortSignal.timeout(10000) } : {
    method: 'POST', headers: { authorization: `Bearer ${readPrivate(join(root, 'control.token'), 128)}`, 'content-type': 'application/json' },
    body: JSON.stringify(operation === 'phase' ? { phase } : {}), signal: AbortSignal.timeout(10000),
  });
  const result = await response.json(); check(response.ok, result.error || 'FIXTURE_REQUEST_FAILED'); return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, first, second, third] = process.argv.slice(2);
    if (operation === 'start') {
      const fixture = await startIDEFixture({ native: first, proxy: second, ...(third ? { parent: third } : {}) });
      console.log(JSON.stringify({ root: fixture.root, status: fixture.url + '/status', project: join(fixture.root, 'project'),
        scope: 'No editor launched. Review environment.json/config/settings before manually opening a fixture session.' }, null, 2));
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { fixture.close().catch(() => { process.exitCode = 1; }); });
    } else if (operation === 'cleanup') { cleanupIDEFixture(first); console.log('Stopped exact fixture root removed.'); }
    else console.log(JSON.stringify(await fixtureRequest(first, operation, second), null, 2));
  } catch (error) { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'FIXTURE_COMMAND_FAILED'); process.exitCode = 1; }
}
