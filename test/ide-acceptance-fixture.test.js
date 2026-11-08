import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ChannelClient } from '../src/client.js';

async function setup(t) {
  const { startIDEFixture } = await import('../deploy/ide-acceptance-fixture.js');
  const parent = privateTemp(join(tmpdir(), 'turnlink-manual-test-'));
  const fixture = await startIDEFixture({ parent, native: '/reviewed/codex', proxy: '/reviewed/codex-proxy.js' });
  t.after(async () => { await fixture.close(); rmSync(parent, { recursive: true, force: true }); });
  return fixture;
}

async function memberFixture(t, master = false) {
  const fixture = await setup(t);
  const participant = new ChannelClient({ url: fixture.brokerURL, tokenFile: join(fixture.root, 'host.token'), credentialDirectory: join(fixture.root, 'credentials') });
  const operator = new ChannelClient({ url: fixture.brokerURL, tokenFile: join(fixture.root, 'admin.token') });
  t.after(() => { participant.close(); operator.close(); });
  const register = sessionId => participant.request('join', { harness: 'codex', sessionId, channel: 'manual-ide', name: 'manual-fixture',
    role: 'Synthetic test', project: { name: 'manual-fixture', root: join(fixture.root, 'project') } });
  await register('bound-thread'); await participant.subscribe(participant.primaryAgentId);
  await participant.request('control_command', { command: { id: randomUUID(), channel: 'manual-ide', op: 'master.volunteer', eligible: true }, agentId: participant.primaryAgentId });
  if (master) {
    const offer = await fixture.phase('appoint');
    const notice = (await participant.request('control_query', { channel: 'manual-ide', view: 'notices', agentId: participant.primaryAgentId })).entries[0];
    // This protocol test explicitly simulates the fixture adapter receipt; it
    // is not native execution or a claim of manual UI acceptance.
    await participant.request('control_notice_ack', { agentId: participant.primaryAgentId, credential: readFileSync(join(fixture.root, 'adapter.token'), 'utf8'), id: notice.id, receiptID: 'msg_manual_unit_offer' });
    await participant.request('control_command', { agentId: participant.primaryAgentId, command: { id: randomUUID(), channel: 'manual-ide', op: 'master.accept', proposalID: offer.assignmentID, promptVersion: 1 } });
  }
  return { fixture, participant, operator, register };
}

async function persistedMutations(fixture, operator, phase) {
  if (phase === 'wake') return fixture.broker.store.messages.length;
  const type = { appoint: 'master.proposed', task: 'task.created', incident: 'incident.opened' }[phase];
  return (await operator.request('control_query', { channel: 'manual-ide', view: 'events', limit: 100 })).entries.filter(event => event.type === type).length;
}

test('manual IDE fixture starts real loopback servers and writes only fresh private review artifacts', async t => {
  const fixture = await setup(t), initial = await fixture.status();
  assert.equal(initial.scope, 'synthetic-local-provider; manual UI evidence required');
  assert.equal(initial.modelRequests, 0); assert.equal(initial.channel.members.length, 0);
  assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(fixture.brokerURL, /^ws:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(fixture.broker.server.address().address, '127.0.0.1');
  assert.equal(fixture.server.address().address, '127.0.0.1');
  const config = readFileSync(join(fixture.root, 'codex/config.toml'), 'utf8');
  assert.match(config, /model_provider = "fixture"/); assert.match(config, /requires_openai_auth = false/);
  assert.match(config, /sandbox_mode = "read-only"/); assert.match(config, /approval_policy = "on-request"/);
  const mcpEnv = config.split('[mcp_servers.turnlink.env]')[1];
  assert.match(mcpEnv, /AGENT_CHANNEL_URL/); assert.match(mcpEnv, /AGENT_CHANNEL_TOKEN_FILE/);
  assert.doesNotMatch(mcpEnv, /ADAPTER_TOKEN|ADMIN|HEALTH|CODEX_TASKS|CODEX_EXECUTABLE/);
  assert.equal(existsSync(join(fixture.root, 'codex/auth.json')), false);
  const environment = JSON.parse(readFileSync(join(fixture.root, 'environment.json'), 'utf8'));
  assert.equal(environment.CODEX_HOME, join(fixture.root, 'codex'));
  assert.equal(environment.AGENT_CHANNEL_CODEX_EXECUTABLE, '/reviewed/codex');
  assert.equal(environment.AGENT_CHANNEL_ADAPTER_TOKEN_FILE, join(fixture.root, 'adapter.token'));
  assert.equal(environment.OPENAI_API_KEY, undefined);
});

test('manual fixture exposes bounded metadata and a synthetic Responses stream without retaining prompts or keys', async t => {
  const fixture = await setup(t), secretText = 'DO_NOT_RETAIN_PRIVATE_PROMPT';
  const response = await fetch(fixture.url + '/v1/responses', { method: 'POST', headers: {
    authorization: 'Bearer fixture-only', 'content-type': 'application/json',
  }, body: JSON.stringify({ input: [{ role: 'user', content: [{ type: 'input_text', text: `TURNLINK_MANUAL_BASELINE ${secretText}` }] }] }) });
  assert.equal(response.status, 200); assert.match(await response.text(), /TURNLINK_MANUAL_BASELINE_OK/);
  const status = await (await fetch(fixture.url + '/status')).json();
  assert.equal(status.modelRequests, 1); assert.equal(status.phases.baseline, 1);
  assert.equal(JSON.stringify(status).includes(secretText), false);
  assert.equal(JSON.stringify(status).includes('fixture-only'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(status)) < 16000);
});

test('manual fixture control refuses cross-origin/simple GET/wrong credentials and never dispatches on status', async t => {
  const fixture = await setup(t);
  for (const [path, init] of [
    ['/stop', {}], ['/phase', {}], ['/stop', { method: 'POST', headers: { origin: 'https://evil.invalid' } }],
    ['/phase', { method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: '{"phase":"appoint"}' }],
    ['/status', { headers: { origin: 'https://evil.invalid' } }],
  ]) assert.ok((await fetch(fixture.url + path, init)).status >= 400);
  await assert.rejects(fixture.phase('appoint'), /ONE_FIXTURE_MEMBER_REQUIRED/);
  await assert.rejects(fixture.phase('arbitrary'), /PHASE_UNSUPPORTED/);
  assert.equal((await fixture.status()).modelRequests, 0);
  const token = readFileSync(join(fixture.root, 'control.token'), 'utf8');
  const stopped = await fetch(fixture.url + '/stop', { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
  }, body: '{}' });
  assert.equal(stopped.status, 200);
  await fixture.close();
  await assert.rejects(fetch(fixture.url + '/status'));
  assert.equal(JSON.parse(readFileSync(join(fixture.root, 'fixture.json'), 'utf8')).state, 'stopped');
});

test('manual fixture cleanup refuses unknown/live roots and removes only its stopped exact root', async t => {
  const fixture = await setup(t);
  const { cleanupIDEFixture } = await import('../deploy/ide-acceptance-fixture.js');
  assert.throws(() => cleanupIDEFixture(fixture.root), /FIXTURE_STILL_RUNNING/);
  assert.throws(() => cleanupIDEFixture(join(fixture.root, '..')), /FIXTURE_/);
  const missing = join(fixture.root, 'unknown-missing');
  assert.throws(() => cleanupIDEFixture(missing), /FIXTURE_/); assert.equal(existsSync(missing), false);
  await fixture.close(); cleanupIDEFixture(fixture.root);
  assert.equal(existsSync(fixture.root), false);
});

test('manual phase commands require the one explicit fixture participant and publish only correlated IDs', async t => {
  const fixture = await setup(t);
  const participant = new ChannelClient({ url: fixture.brokerURL, tokenFile: join(fixture.root, 'host.token'),
    credentialDirectory: join(fixture.root, 'credentials') });
  t.after(() => participant.close());
  await participant.request('join', { harness: 'codex', sessionId: 'manual-test-thread', channel: 'manual-ide',
    name: 'manual-fixture', role: 'Synthetic test', project: { name: 'manual-fixture', root: join(fixture.root, 'project') } });
  await participant.subscribe(participant.primaryAgentId);
  await participant.request('control_command', { agentId: participant.primaryAgentId, command: {
    id: randomUUID(), op: 'master.volunteer', channel: 'manual-ide', eligible: true,
  } });
  const appointed = await fixture.phase('appoint'); assert.match(appointed.assignmentID, /^[a-f0-9-]{36}$/);
  assert.equal(appointed.prompt, `TURNLINK_MANUAL_ACCEPT:${appointed.assignmentID}`);
  const payload = { input: [{ role: 'user', content: [{ type: 'input_text', text: appointed.prompt }] }], tools: [{ type: 'function', name: 'mcp_turnlink_channel_control' }] };
  const response = await fetch(fixture.url + '/v1/responses', { method: 'POST', headers: {
    authorization: 'Bearer fixture-only', 'content-type': 'application/json',
  }, body: JSON.stringify(payload) });
  const stream = await response.text(); assert.match(stream, /master.accept/); assert.match(stream, new RegExp(appointed.assignmentID));
  assert.equal((await fixture.status()).channel.activeID, null, 'mock output is not an executed native tool or role acceptance');
  const before = (await fixture.status()).modelRequests;
  const incident = await fixture.phase('incident'); assert.match(incident.incidentID, /^[a-f0-9-]{36}$/);
  assert.equal((await fixture.status()).modelRequests, before, 'incident creation and status do not invoke the model');
  const wake = await fixture.phase('wake'); assert.match(wake.messageID, /^[a-f0-9-]{36}$/);
  assert.equal((await fixture.status()).entities.wakeID, wake.messageID);
  await assert.rejects(fixture.phase('wake'), /WAKE_ALREADY_SENT/);
});

test('actual manual fixture CLI starts, answers status, stops and cleans its exact root without editor/native children', async t => {
  const parent = privateTemp(join(tmpdir(), 'turnlink-manual-cli-'));
  const child = spawn(process.execPath, ['deploy/ide-acceptance-fixture.js', 'start', '/reviewed/codex', '/reviewed/codex-proxy.js', parent], {
    cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit'); let output = '', diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic += chunk; });
  t.after(async () => { if (child.exitCode === null) child.kill(); await exit; rmSync(parent, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture CLI readiness timeout')), 15000);
    child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error(`Fixture exited before ready: ${diagnostic}`)); });
    child.stdout.on('data', chunk => { output += chunk; try { const value = JSON.parse(output); clearTimeout(timer); resolve(value); } catch {} });
  });
  const { fixtureRequest, cleanupIDEFixture } = await import('../deploy/ide-acceptance-fixture.js');
  assert.equal((await fixtureRequest(ready.root, 'status')).modelRequests, 0);
  assert.deepEqual(await fixtureRequest(ready.root, 'stop'), { state: 'stopping' });
  const [code] = await exit; assert.equal(code, 0, diagnostic);
  cleanupIDEFixture(ready.root); assert.equal(existsSync(ready.root), false);
});

test('concurrent manual phases reserve one bound operation and commit only one mutation', async t => {
  for (const phase of ['wake', 'incident', 'task', 'appoint']) await t.test(phase, async t => {
    const { fixture, operator } = await memberFixture(t, phase === 'task');
    const results = await Promise.all([fixture.phase(phase), fixture.phase(phase)]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(await persistedMutations(fixture, operator, phase), 1);
    await assert.rejects(fixture.phase(phase), /ALREADY_/);
  });
});

test('actual broker response loss retries the exact reserved operation without a second mutation', async t => {
  for (const phase of ['wake', 'incident', 'task', 'appoint']) await t.test(phase, async t => {
    const { fixture, operator } = await memberFixture(t, phase === 'task');
    const original = ChannelClient.prototype.rpc, payloads = []; let lost = false;
    const op = { incident: 'incident.open', task: 'task.create', appoint: 'master.appoint' }[phase];
    ChannelClient.prototype.rpc = async function(method, params) {
      const selected = phase === 'wake' ? method === 'send' : method === 'control_command' && params.command?.op === op;
      if (selected) payloads.push(structuredClone(params));
      const response = await original.call(this, method, params);
      if (selected && !lost) { lost = true; throw new Error('FIXTURE_REPLY_LOST_AFTER_COMMIT'); }
      return response;
    };
    t.after(() => { ChannelClient.prototype.rpc = original; });
    await assert.rejects(fixture.phase(phase), /FIXTURE_REPLY_LOST_AFTER_COMMIT/);
    assert.equal(await persistedMutations(fixture, operator, phase), 1);
    await fixture.phase(phase);
    assert.equal(payloads.length, 2); assert.deepEqual(payloads[1], payloads[0]);
    assert.equal(await persistedMutations(fixture, operator, phase), 1);
    await assert.rejects(fixture.phase(phase), /ALREADY_/);
  });
});

test('uncertain wake remains bound to its original member and cannot retarget a replacement', async t => {
  const { fixture, participant, operator } = await memberFixture(t);
  const original = ChannelClient.prototype.rpc; let lost = false;
  ChannelClient.prototype.rpc = async function(method, params) {
    const response = await original.call(this, method, params);
    if (method === 'send' && !lost) { lost = true; throw new Error('FIXTURE_REPLY_LOST_AFTER_COMMIT'); }
    return response;
  };
  t.after(() => { ChannelClient.prototype.rpc = original; });
  await assert.rejects(fixture.phase('wake'), /FIXTURE_REPLY_LOST_AFTER_COMMIT/);
  await participant.request('leave', { agentId: participant.primaryAgentId });
  await participant.request('join', { harness: 'codex', sessionId: 'replacement-thread', channel: 'manual-ide', name: 'replacement', role: 'Synthetic test', project: { name: 'fixture', root: join(fixture.root, 'project') } });
  await participant.subscribe(participant.primaryAgentId);
  await assert.rejects(fixture.phase('wake'), /BOUND_MEMBER_CHANGED/);
  assert.equal(await persistedMutations(fixture, operator, 'wake'), 1);
});

test('native acceptance owns cleanup before a hanging version probe and enforces its deadline', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const parent = privateTemp(join(tmpdir(), 'turnlink-version-fault-')), fake = join(parent, 'native');
  const checkpoint = join(parent, 'owned.json');
  writeFileSync(fake, `#!${process.execPath}\nimport('node:fs').then(fs => { fs.writeFileSync(${JSON.stringify(checkpoint)}, JSON.stringify({root:process.env.CODEX_HOME.replace(/\\/codex$/, ''),pid:process.pid})); setInterval(()=>{},1000); });\n`, { mode: 0o700 });
  const child = spawn(process.execPath, ['--test', 'test/ide-acceptance-native.test.js'], { cwd: new URL('../', import.meta.url), detached: true,
    env: { PATH: process.env.PATH, TURNLINK_CODEX_MANUAL_FIXTURE_INTEGRATION: '1', TURNLINK_CODEX_EXECUTABLE: fake,
      TURNLINK_CODEX_VERSION_TIMEOUT_MS: '100', TURNLINK_KEEP_MANUAL_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit'); let owned;
  t.after(async () => {
    if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} await exited; }
    if (existsSync(checkpoint)) owned = JSON.parse(readFileSync(checkpoint, 'utf8'));
    owned ||= output.match(/"root":"([^"]+)"/) ? { root: output.match(/"root":"([^"]+)"/)[1] } : null;
    if (owned?.root && owned.root.includes('/turnlink-ide-manual-')) rmSync(owned.root, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  });
  const outcome = await Promise.race([exited.then(([code]) => ({ code })), delay(2500).then(() => ({ hung: true }))]);
  assert.equal(outcome.hung, undefined, 'version deadline and early cleanup must let the failed acceptance process exit');
  assert.equal(outcome.code, 1); assert.match(output, /ETIMEDOUT/);
  owned = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, 'utf8')) : { root: output.match(/"root":"([^"]+)"/)[1] };
  assert.equal(JSON.parse(readFileSync(join(owned.root, 'fixture.json'), 'utf8')).state, 'stopped');
  const metadata = JSON.parse(readFileSync(join(owned.root, 'fixture.json'), 'utf8'));
  await assert.rejects(fetch(metadata.url + '/status'));
});
