import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { CodexAdmissionFence } from '../src/codex-admission-fence.js';

// Explicit installed-runtime contract probes. Everything (including model HTTP,
// credentials, thread history and projects) is isolated and synthetic. These
// observations are not a production owner capability or a movement switch.
const enabled = process.env.TURNLINK_CODEX_CONTINUITY_INTEGRATION === '1';
const binary = process.env.TURNLINK_CODEX_EXECUTABLE || 'codex';
const otherBinary = process.env.TURNLINK_CODEX_OTHER_EXECUTABLE || binary;
const modernVersions = new Set(['codex-cli 0.161.0', 'codex-cli 0.162.0-alpha.17.2', 'codex-cli 0.165.0', 'codex-cli 0.166.0']);
const measuredVersions = new Set([...modernVersions, 'codex-cli 0.135.0-alpha.1']);
async function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-continuity-')), home = join(root, 'home'), codexHome = join(home, '.codex');
  const source = join(root, 'source'), destination = join(root, 'destination');
  const sqlite = join(root, 'sqlite'), temporary = join(root, 'temporary');
  const appData = join(home, 'AppData'), roaming = join(appData, 'Roaming'), local = join(appData, 'Local');
  const xdgConfig = join(home, '.config'), xdgCache = join(home, '.cache'), xdgData = join(home, '.data');
  for (const path of [home, codexHome, source, destination, sqlite, temporary, appData, roaming, local, xdgConfig, xdgCache, xdgData])
    mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(codexHome, 'AGENTS.md'), 'TURNLINK_NATIVE_GLOBAL_FIXED: preserve this instruction.\n');
  writeFileSync(join(source, 'AGENTS.md'), 'TURNLINK_NATIVE_PROJECT_FIXED: preserve project instructions.\n');
  writeFileSync(join(destination, 'AGENTS.md'), 'TURNLINK_NATIVE_PROJECT_FIXED: preserve project instructions.\nTURNLINK_NATIVE_DESTINATION_DISCOVERY: new destination instruction.\n');
  let calls = 0;
  const clients = [];
  const inputs = [], model = createServer(async (request, response) => {
    const chunks = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
    if (request.method === 'GET') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture' }] })); return; }
    inputs.push(JSON.parse(Buffer.concat(chunks).toString())); calls++;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const item = { id: `msg_fixture_${calls}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Local fixture completed.', annotations: [] }] };
    const result = { id: `resp_fixture_${calls}`, object: 'response', created_at: 1, status: 'completed', model: 'fixture', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('response.created', { response: { ...result, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    event('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: 'Local fixture completed.' });
    event('response.output_item.done', { output_index: 0, item }); event('response.completed', { response: result }); response.end();
  });
  t.after(async () => { for (const client of clients) await client.stop(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  writeFileSync(join(codexHome, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[features]\nplugins = false\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, CODEX_SQLITE_HOME: sqlite,
    APPDATA: roaming, LOCALAPPDATA: local, XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: xdgCache, XDG_DATA_HOME: xdgData,
    TMPDIR: temporary, TMP: temporary, TEMP: temporary, TURNLINK_FIXTURE_KEY: 'local-fixture-only',
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'url.file:///turnlink-fixture-no-network/.insteadOf', GIT_CONFIG_VALUE_0: 'https://',
    GIT_CONFIG_KEY_1: 'url.file:///turnlink-fixture-no-network/.insteadOf', GIT_CONFIG_VALUE_1: 'http://' };
  if (process.platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
    env.WINDIR = env.SystemRoot;
  }
  const version = execFileSync(binary, ['--version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 12000 }).trim();
  const bindings = join(root, 'bindings');
  execFileSync(binary, ['app-server', 'generate-ts', '--experimental', '--out', bindings], { env, stdio: 'ignore', timeout: 12000 });
  const schema = Object.fromEntries(['ThreadSettingsUpdateParams', 'TurnStartParams', 'ThreadResumeParams'].map(name => [name,
    readFileSync(join(bindings, 'v2', `${name}.ts`), 'utf8')]));
  function client(name, executable = binary) {
    const child = spawn(executable, ['app-server'], { cwd: source, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(child, 'close'), pending = new Map(), frames = [], state = { known: false, idle: true, blocked: false, flushing: false };
    let sequence = 0, stopped = false;
    child.stderr.resume();
    const rejectAll = () => { for (const row of pending.values()) { clearTimeout(row.timer); row.reject(new Error('CODEX_NATIVE_PROCESS_CLOSED')); } pending.clear(); };
    child.on('error', rejectAll); child.on('exit', rejectAll);
    const fence = new CodexAdmissionFence({ write: line => child.stdin.write(`${line}\n`), reply: frame => { const row = pending.get(frame.id); if (row) row.reject(new Error('CODEX_NATIVE_FENCE_REFUSED')); }, activity: () => state });
    createInterface({ input: child.stdout }).on('line', line => {
      const frame = JSON.parse(line); fence.observe(frame); frames.push(frame);
      if (frames.length > 2048) { child.kill(); return; }
      if (frame.result?.thread?.id) state.known = true;
      if (frame.method === 'turn/started') state.idle = false;
      if (frame.method === 'turn/completed') state.idle = true;
      const row = pending.get(frame.id);
      if (frame.method || !row) return;
      pending.delete(frame.id); clearTimeout(row.timer);
      if (frame.error) row.reject(Object.assign(new Error('CODEX_NATIVE_RPC_REFUSED'), { nativeMethod: row.method, nativeCode: frame.error.code, nativeMessage: String(frame.error.message).slice(0, 500) })); else row.resolve(frame.result);
    });
    const rpc = (method, params, token) => new Promise((resolve, reject) => {
      const id = `${name}-${++sequence}`, timer = setTimeout(() => { pending.delete(id); reject(new Error('CODEX_NATIVE_RPC_TIMEOUT')); }, 12000);
      pending.set(id, { resolve, reject, timer, method });
      try { const frame = { id, method, params }; token ? fence.internal(frame, token) : fence.editor(JSON.stringify(frame)); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
    const initialize = async () => { await rpc('initialize', { clientInfo: { name: 'turnlink_native_contract_fixture', version: '0.1.0' }, capabilities: { experimentalApi: true } }); child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); };
    const turn = async (threadId, text, token, overrides = {}) => {
      const start = await rpc('turn/start', { threadId, input: [{ type: 'text', text }], ...overrides }, token);
      for (let index = 0; index < 500; index++) {
        const frame = frames.find(frame => frame.method === 'turn/completed' && frame.params?.threadId === threadId && frame.params?.turn?.id === start.turn.id);
        if (frame) { assert.equal(frame.params.turn.status, 'completed'); return frame.params.turn; } await delay(20);
      }
      throw new Error('CODEX_NATIVE_TURN_TIMEOUT');
    };
    const stop = async (signal = 'SIGTERM') => { if (stopped) return; stopped = true; fence.close(); rejectAll(); child.kill(signal); await closed; };
    const result = { rpc, initialize, turn, fence, frames, state, stop }; clients.push(result); return result;
  }
  const first = client('owner'); await first.initialize();
  const selection = await first.rpc('thread/start', { cwd: realpathSync(source), sandbox: 'read-only', approvalPolicy: 'on-request', developerInstructions: 'TURNLINK_NATIVE_DEVELOPER_FIXED: preserve developer authority.' });
  await first.turn(selection.thread.id, 'Seed only this isolated native contract fixture.');
  const otherVersion = execFileSync(otherBinary, ['--version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 12000 }).trim();
  return { first, client, selection, source: realpathSync(source), destination: realpathSync(destination), version, otherVersion, schema, inputs, get calls() { return calls; } };
}

test('installed Codex settings cwd retains exact thread/governance and measures destination instruction reload using only local inference', { skip: !enabled, timeout: 45000 }, async t => {
  const f = await fixture(t), id = f.selection.thread.id;
  assert.match(f.schema.ThreadSettingsUpdateParams, /cwd\?: string/);
  assert.ok(!/ownerToken|expectedRevision|expectedGeneration/.test(f.schema.ThreadSettingsUpdateParams));
  const before = await f.first.rpc('thread/resume', { threadId: id, excludeTurns: true }), calls = f.calls;
  assert.deepEqual(await f.first.rpc('thread/settings/update', { threadId: id, cwd: f.destination }), {});
  assert.equal(f.calls, calls, 'cwd settings update must not start inference');
  const changed = await f.first.rpc('thread/resume', { threadId: id, excludeTurns: true });
  assert.equal(changed.thread.id, id); assert.equal(changed.cwd, f.destination);
  if (before.thread.sessionId !== undefined) assert.equal(changed.thread.sessionId, before.thread.sessionId);
  assert.equal(changed.model, before.model); assert.equal(changed.modelProvider, before.modelProvider);
  assert.deepEqual(changed.sandbox, before.sandbox); assert.deepEqual(changed.approvalPolicy, before.approvalPolicy);
  for (const key of ['approvalsReviewer', 'activePermissionProfile', 'disabledPluginIds'])
    if (Object.hasOwn(before, key)) assert.deepEqual(changed[key], before[key]);
  await f.first.turn(id, 'Observe destination instructions without running tools.');
  const input = JSON.stringify(f.inputs.at(-1));
  assert.equal(input.includes('TURNLINK_NATIVE_GLOBAL_FIXED'), true); assert.equal(input.includes('TURNLINK_NATIVE_PROJECT_FIXED'), true);
  const destinationInstructionsObserved = input.includes('TURNLINK_NATIVE_DESTINATION_DISCOVERY');
  if (modernVersions.has(f.version)) assert.equal(destinationInstructionsObserved, true);
  if (f.version === 'codex-cli 0.135.0-alpha.1') assert.equal(destinationInstructionsObserved, false, 'desktop alpha lacks the required destination reload contract');
  assert.equal(input.includes('TURNLINK_NATIVE_DEVELOPER_FIXED'), true);
  const fork = await f.first.rpc('thread/fork', { threadId: id, excludeTurns: true });
  assert.notEqual(fork.thread.id, id);
  if (measuredVersions.has(f.version)) { assert.equal(before.thread.sessionId, id); assert.equal(fork.thread.sessionId, fork.thread.id); }
  assert.equal(fork.thread.forkedFromId, id);
  t.diagnostic(JSON.stringify({ version: f.version, nativeSettingsCwd: true, sameThread: true, inferenceForSettings: false,
    nativePoliciesPreserved: true, destinationInstructionsObserved, rootSessionIdPresent: typeof before.thread.sessionId === 'string',
    forkHasDistinctThreadId: fork.thread.id !== id, forkKeepsRootSessionId: fork.thread.sessionId === id, productionOwnerContract: false }));
});

test('installed Codex resumes an idle stopped thread in the destination and keeps its history', { skip: !enabled, timeout: 45000 }, async t => {
  const f = await fixture(t), id = f.selection.thread.id;
  if (!modernVersions.has(f.version)) { t.skip('requires a tested installed runtime with destination instruction reload'); return; }
  const before = await f.first.rpc('thread/read', { threadId: id, includeTurns: true });
  assert.ok(JSON.stringify(before).includes('Seed only this isolated native contract fixture.'));
  const sourceConfig = await f.first.rpc('config/read', { cwd: f.source, includeLayers: true });
  const destinationConfig = await f.first.rpc('config/read', { cwd: f.destination, includeLayers: true });
  assert.equal(JSON.stringify(sourceConfig).includes('TURNLINK_NATIVE_DESTINATION_DISCOVERY'), false);
  assert.equal(JSON.stringify(destinationConfig).includes('TURNLINK_NATIVE_DESTINATION_DISCOVERY'), false,
    'config/read does not include the destination AGENTS.md content');
  await f.first.stop('SIGTERM');
  const next = f.client('resumed'); await next.initialize();
  const calls = f.calls;
  const resumed = await next.rpc('thread/resume', { threadId: id, cwd: f.destination, excludeTurns: false });
  assert.equal(resumed.thread.id, id); assert.equal(resumed.cwd, f.destination);
  for (const field of ['transitionId', 'operationId', 'reservation', 'ownerToken', 'remoteActivity'])
    assert.equal(Object.hasOwn(resumed, field), false, `thread/resume does not return ${field}`);
  assert.equal(f.calls, calls, 'resuming must not start inference');
  assert.ok(JSON.stringify(resumed.thread).includes('Seed only this isolated native contract fixture.'));
  assert.equal(resumed.model, f.selection.model); assert.equal(resumed.modelProvider, f.selection.modelProvider);
  assert.deepEqual(resumed.sandbox, f.selection.sandbox); assert.deepEqual(resumed.approvalPolicy, f.selection.approvalPolicy);
  await next.stop('SIGTERM');
  const verified = f.client('verified'); await verified.initialize();
  const afterResume = await verified.rpc('thread/resume', { threadId: id, excludeTurns: false });
  assert.equal(afterResume.thread.id, id); assert.equal(afterResume.cwd, f.destination, 'destination cwd must survive restart before a new turn');
  assert.equal(f.calls, calls, 'the relocation must not start inference');
  await verified.turn(id, 'Verify the resumed destination using only the local fixture.');
  const input = JSON.stringify(f.inputs.at(-1));
  assert.ok(input.includes('TURNLINK_NATIVE_GLOBAL_FIXED') && input.includes('TURNLINK_NATIVE_PROJECT_FIXED'));
  assert.ok(input.includes('TURNLINK_NATIVE_DESTINATION_DISCOVERY'));
  await verified.stop('SIGTERM');
  const final = f.client('reopened'); await final.initialize();
  const reopened = await final.rpc('thread/resume', { threadId: id, excludeTurns: false });
  assert.equal(reopened.thread.id, id); assert.equal(reopened.cwd, f.destination);
  const history = JSON.stringify(reopened.thread);
  assert.ok(history.includes('Seed only this isolated native contract fixture.'));
  assert.ok(history.includes('Verify the resumed destination using only the local fixture.'));
});

test('installed Codex characterizes destination instruction changes after resume and after restart', { skip: !enabled, timeout: 45000 }, async t => {
  const f = await fixture(t), id = f.selection.thread.id;
  if (f.version !== 'codex-cli 0.165.0') { t.skip('characterized only for installed Codex 0.165.0'); return; }
  await f.first.stop('SIGTERM');
  const next = f.client('destination-drift'); await next.initialize();
  const resumed = await next.rpc('thread/resume', { threadId: id, cwd: f.destination, excludeTurns: true });
  assert.equal(resumed.thread.id, id); assert.equal(resumed.cwd, f.destination);
  writeFileSync(join(f.destination, 'AGENTS.md'), 'TURNLINK_NATIVE_PROJECT_FIXED: preserve project instructions.\nTURNLINK_NATIVE_CHANGED_AFTER_RESUME: use the latest destination instruction.\n');
  const instructionsOnDisk = readFileSync(join(f.destination, 'AGENTS.md'), 'utf8');
  const configBefore = await next.rpc('config/read', { cwd: f.destination, includeLayers: true });
  const threadBefore = await next.rpc('thread/read', { threadId: id, includeTurns: false });
  await next.turn(id, 'Observe the changed destination instruction using only the local fixture.');
  const input = JSON.stringify(f.inputs.at(-1));
  t.diagnostic(JSON.stringify({ version: f.version, changedInstructionObserved: input.includes('TURNLINK_NATIVE_CHANGED_AFTER_RESUME'),
    priorInstructionObserved: input.includes('TURNLINK_NATIVE_DESTINATION_DISCOVERY') }));
  assert.equal(input.includes('TURNLINK_NATIVE_CHANGED_AFTER_RESUME'), false);
  assert.ok(input.includes('TURNLINK_NATIVE_DESTINATION_DISCOVERY'));
  await next.stop('SIGTERM');
  const restarted = f.client('destination-restarted'); await restarted.initialize();
  const reopened = await restarted.rpc('thread/resume', { threadId: id, cwd: f.destination, excludeTurns: true });
  assert.equal(reopened.thread.id, id);
  assert.deepEqual(reopened.instructionSources, resumed.instructionSources);
  const configAfter = await restarted.rpc('config/read', { cwd: f.destination, includeLayers: true });
  const threadAfter = await restarted.rpc('thread/read', { threadId: id, includeTurns: false });
  assert.equal(readFileSync(join(f.destination, 'AGENTS.md'), 'utf8'), instructionsOnDisk);
  assert.deepEqual(configAfter.config, configBefore.config);
  assert.equal(threadAfter.thread.id, threadBefore.thread.id);
  await restarted.turn(id, 'Observe the destination after restart using only the local fixture.');
  assert.ok(JSON.stringify(f.inputs.at(-1)).includes('TURNLINK_NATIVE_CHANGED_AFTER_RESUME'));
});

test('installed Codex can change approval policy at a later native turn', { skip: !enabled, timeout: 45000 }, async t => {
  const f = await fixture(t), id = f.selection.thread.id;
  if (f.version !== 'codex-cli 0.165.0') { t.skip('characterized only for installed Codex 0.165.0'); return; }
  const before = await f.first.rpc('thread/resume', { threadId: id, excludeTurns: true });
  assert.equal(before.approvalPolicy, 'on-request');
  await f.first.turn(id, 'Synthetic policy-change characterization; do not invoke tools.', undefined, { approvalPolicy: 'never' });
  const after = await f.first.rpc('thread/resume', { threadId: id, excludeTurns: true });
  assert.equal(after.thread.id, id); assert.equal(after.approvalPolicy, 'never');
  t.diagnostic(JSON.stringify({ version: f.version, initialPolicy: before.approvalPolicy, subsequentPolicy: after.approvalPolicy, productionAuthorityProof: false }));
});

test('installed Codex can change the selected model at a later native turn', { skip: !enabled, timeout: 45000 }, async t => {
  const f = await fixture(t), id = f.selection.thread.id;
  if (f.version !== 'codex-cli 0.165.0') { t.skip('characterized only for installed Codex 0.165.0'); return; }
  const before = await f.first.rpc('thread/resume', { threadId: id, excludeTurns: true });
  assert.equal(before.model, 'fixture');
  await f.first.turn(id, 'Synthetic model-change characterization; do not invoke tools.', undefined, { model: 'fixture-other' });
  const after = await f.first.rpc('thread/resume', { threadId: id, excludeTurns: true });
  assert.equal(after.thread.id, id); assert.equal(after.model, 'fixture-other');
  assert.equal(f.inputs.at(-1).model, 'fixture-other');
  t.diagnostic(JSON.stringify({ version: f.version, initialModel: before.model, subsequentModel: after.model, productionAuthorityProof: false }));
});

test('installed Codex cross-process writer boundary is measured separately from its private stdio fence', { skip: !enabled, timeout: 45000 }, async t => {
  const f = await fixture(t), id = f.selection.thread.id, other = f.client('other', otherBinary); await other.initialize();
  const observed = f.first.frames.length;
  let writerRefused = false, writerReleasedOnUnsubscribe = false, writerReleasedOnProcessExit = false;
  await f.first.fence.exclusive(id, async ({ guard }) => {
    let resumed;
    try { resumed = await other.rpc('thread/resume', { threadId: id, excludeTurns: true }); }
    catch (error) {
      assert.equal(error.nativeCode, -32600); assert.equal(/already has an active writer/.test(error.nativeMessage), true);
      writerRefused = true; guard(); return;
    }
    assert.equal(resumed.thread.id, id);
    await other.rpc('thread/settings/update', { threadId: id, cwd: f.destination });
    await other.turn(id, 'Other isolated native client turn while first stdio fence is held.');
    guard(); assert.equal(f.first.fence.held, true);
    assert.ok(!f.first.frames.slice(observed).some(frame => frame.method === 'turn/started'));
    assert.equal((await other.rpc('thread/resume', { threadId: id, excludeTurns: true })).cwd, f.destination);
  });
  if (measuredVersions.has(f.version) && measuredVersions.has(f.otherVersion))
    assert.equal(writerRefused, modernVersions.has(f.version) && modernVersions.has(f.otherVersion));
  if (writerRefused) {
    await f.first.rpc('thread/unsubscribe', { threadId: id });
    for (let index = 0; index < 20; index++) {
      try { assert.equal((await other.rpc('thread/resume', { threadId: id, excludeTurns: true })).thread.id, id); writerReleasedOnUnsubscribe = true; break; }
      catch (error) { assert.equal(/already has an active writer/.test(error.nativeMessage), true); await delay(25); }
    }
    if (!writerReleasedOnUnsubscribe) {
      await f.first.stop('SIGKILL');
      assert.equal((await other.rpc('thread/resume', { threadId: id, excludeTurns: true })).thread.id, id); writerReleasedOnProcessExit = true;
    }
    await other.turn(id, 'Resume after verified isolated owner release.');
  }
  t.diagnostic(JSON.stringify({ version: f.version, otherVersion: f.otherVersion, activeWriterRefusedOtherProcess: writerRefused,
    secondProcessResumedSameThread: !writerRefused, secondProcessChangedCwd: !writerRefused,
    secondProcessCompletedTurn: !writerRefused, ownerStdioFenceObservedForeignTurn: false, writerReleasedOnUnsubscribe, writerReleasedOnProcessExit,
    processExitWasSIGKILL: writerReleasedOnProcessExit,
    productionOwnerContract: false }));
});
