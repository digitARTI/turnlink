import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { AdmissionLedger } from '../src/admissions.js';

async function eventually(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(75); }
  throw new Error('Codex control condition timed out');
}
async function fixture(t, extraEnv = {}, brokerOptions = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-control-'));
  const adapterFile = join(root, 'adapter.token'); writeFileSync(adapterFile, '3'.repeat(64), { mode: 0o600 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true, ...brokerOptions });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, token: '1'.repeat(64), credentialDirectory: join(root, 'proofs') };
  const participant = new ChannelClient(options), admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  const output = []; let child;
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const start = async (method = 'thread/start') => {
    child = spawn(process.execPath, [resolve('src/codex-proxy.js'), resolve('test/fixtures/codex.js'), 'app-server'], {
      env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_URL: options.url,
        AGENT_CHANNEL_TOKEN: options.token, AGENT_CHANNEL_CREDENTIAL_DIR: options.credentialDirectory,
        AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_ADAPTER_TOKEN_FILE: adapterFile, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', line => output.push(JSON.parse(line)));
    const id = randomUUID(); send({ id, method, params: { fixtureId: 'b' } });
    await eventually(() => output.some(m => m.id === id));
    await eventually(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members.some(a => a.agentId === 'codex:b' && a.connected));
  };
  const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, 'exit'); } };
  t.after(async () => { await stop(); participant.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const command = (op, fields = {}) => ({ id: randomUUID(), op, channel: 'dev', ...fields });
  const run = (connection, op, fields = {}) => connection.request('control_command', {
    ...(connection === participant ? { agentId: 'codex:b' } : {}), command: command(op, fields),
  });
  const registration = { harness: 'codex', sessionId: 'b', name: 'b', channel: 'dev', role: 'implementation', project: { name: 'fixture', root: '/fixture' } };
  const notify = () => participant.request('join', registration); // Broker-generated self presence triggers adapter maintenance, as a real MCP join does.
  const query = view => admin.request('control_query', { channel: 'dev', view, ...(view === 'notices' ? { agentId: 'codex:b' } : {}) });
  await run(admin, 'channel.configure');
  await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
  await notify(); await start(); await delay(50);
  const appoint = async () => {
    await run(participant, 'master.volunteer', { eligible: true });
    const proposal = await run(admin, 'master.appoint', { candidate: 'codex:b' });
    await notify(); return proposal.commandID;
  };
  const admitted = async () => eventually(async () => (await query('events')).entries.some(e => e.type === 'notice.accepted'));
  const roleCalls = () => output.filter(m => m.method === 'fixture/received' && /Turnlink supplemental/.test(m.params.input?.[0]?.text || ''));
  return { root, broker, participant, admin, output, send, start, stop, run, query, appoint, admitted, roleCalls, notify, options };
}

test('Codex role offers use same-thread admission and explicit activation without permission overrides', async t => {
  const f = await fixture(t);
  const proposalID = await f.appoint(); await f.admitted();
  const offer = f.roleCalls()[0].params;
  assert.equal(offer.method, 'turn/start'); assert.equal(offer.threadId, 'b');
  assert.deepEqual(Object.keys(offer).sort(), ['input', 'method', 'threadId']);
  assert.match(offer.input[0].text, /existing project access remains unchanged/);
  assert.equal((await f.query('channel')).channel.active, null);
  await f.run(f.participant, 'master.accept', { proposalID, promptVersion: 1 });
  await delay(50); await f.notify();
  await eventually(() => f.roleCalls().some(c => /is active/.test(c.params.input[0].text)));
  assert.equal(f.roleCalls()[1].params.method, 'turn/steer');
  const before = (await f.query('channel')).channel.active.expiresAt;
  await delay(50); await f.notify();
  await eventually(async () => (await f.query('channel')).channel.active.expiresAt > before);
  f.send({ id: 100, method: 'fixture/finish', params: { threadId: 'b' } });
  await eventually(() => f.output.some(m => m.method === 'turn/completed'));
  await f.run(f.admin, 'master.revoke'); await delay(50); await f.notify(); await delay(150);
  assert.equal(f.roleCalls().length, 2, 'ended notices must not wake idle threads');
  f.send({ id: 101, method: 'turn/start', params: { threadId: 'b', input: [{ type: 'text', text: 'Human authorized new turn' }] } });
  await eventually(() => f.roleCalls().some(c => /is inactive/.test(c.params.input[0].text)));
  assert.equal(f.roleCalls().at(-1).params.method, 'turn/steer');
  assert.ok(!f.output.some(m => typeof m.id === 'string' && m.id.startsWith('turnlink-internal-')));
});

test('Codex role admission waits for existing approval and drops superseded offers', async t => {
  const f = await fixture(t);
  f.send({ id: 200, method: 'fixture/approval', params: { threadId: 'b' } });
  await eventually(() => f.output.some(m => m.id === 999));
  const first = await f.appoint(); await delay(100);
  assert.equal(f.roleCalls().length, 0);
  const replacement = await f.run(f.admin, 'master.appoint', { candidate: 'codex:b' });
  await delay(50); await f.notify(); await delay(100);
  f.send({ id: 999, result: { decision: 'approved' } });
  await f.admitted();
  const offers = f.roleCalls().filter(c => c.params.input[0].text.includes('Turnlink supplemental master role'));
  assert.equal(offers.length, 1);
  assert.ok(!offers[0].params.input[0].text.includes(first));
  assert.ok(offers[0].params.input[0].text.includes(replacement.commandID));
});

test('Codex uncertain role response is never blindly replayed and late native receipt is reconciled privately', async t => {
  const f = await fixture(t, { TURNLINK_FIXTURE_DELAY_ROLE: '1', AGENT_CHANNEL_RPC_TIMEOUT_MS: '50' });
  const proposalID = await f.appoint();
  await eventually(() => f.roleCalls().length === 1);
  const ledger = () => new AdmissionLedger('local', 'codex:b', f.options.credentialDirectory);
  await eventually(() => ledger().records.some(r => r.state === 'uncertain'));
  await delay(100); await f.notify(); await delay(100);
  assert.equal(f.roleCalls().length, 1);
  await assert.rejects(f.run(f.participant, 'master.accept', { proposalID, promptVersion: 1 }), /ROLE_NOTICE_NOT_ADMITTED/);
  f.send({ id: 300, method: 'fixture/release-admission', params: {} });
  await f.admitted();
  await f.run(f.participant, 'master.accept', { proposalID, promptVersion: 1 });
  assert.ok(ledger().records.some(r => r.state === 'accepted'));
  assert.ok(!f.output.some(m => typeof m.id === 'string' && m.id.startsWith('turnlink-internal-')));
});

test('Codex restart preserves uncertain role admission and refuses reinjection', async t => {
  const f = await fixture(t, { TURNLINK_FIXTURE_DELAY_ROLE: '1', AGENT_CHANNEL_RPC_TIMEOUT_MS: '50' });
  await f.appoint(); await eventually(() => f.roleCalls().length === 1);
  const ledger = () => new AdmissionLedger('local', 'codex:b', f.options.credentialDirectory);
  await eventually(() => ledger().records.some(r => r.state === 'uncertain'));
  await f.stop(); await f.start(); await delay(100); await f.notify(); await delay(150);
  assert.equal(f.roleCalls().length, 1);
  assert.ok(ledger().records.some(r => r.state === 'uncertain'));
  assert.ok(!(await f.query('events')).entries.some(e => e.type === 'notice.accepted'));
});

test('resumed Codex thread with unknown lifecycle cannot be woken by a role offer', async t => {
  const f = await fixture(t);
  await f.stop(); await f.start('thread/resume');
  await f.appoint(); await delay(150);
  assert.equal(f.roleCalls().length, 0);
  f.send({ id: 400, method: 'turn/start', params: { threadId: 'b', input: [{ type: 'text', text: 'Human authorized turn' }] } });
  await f.admitted();
  assert.equal(f.roleCalls()[0].params.method, 'turn/steer');
});

test('live Codex proxy obeys paused queue and steer policies while preserving approvals and refusing ambiguous replay', async t => {
  const f = await fixture(t, { AGENT_CHANNEL_RPC_TIMEOUT_MS: '80' }, { controlEffects: true, sweepIntervalMs: 20 });
  const proposalID = await f.appoint(); await f.admitted();
  await f.run(f.participant, 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query('channel')).channel.active.generation;
  const policy = async wakePolicy => {
    const result = await f.run(f.participant, 'action.request', { generation, operation: 'change_wake_policy', target: 'codex:b', evidence: 'not_applicable', wakePolicy });
    await eventually(() => f.broker.store.effectReceipts?.[result.commandID]?.outcome === 'succeeded');
  };
  await f.participant.request('join', { harness: 'opencode', sessionId: 'sender', name: 'sender', channel: 'dev', role: 'fixture', project: { name: 'fixture', root: '/fixture' } });
  const send = text => f.participant.request('send', { agentId: 'opencode:sender', to: 'codex:b', text, messageId: text });
  const peerCalls = text => f.output.filter(m => m.method === 'fixture/received' && m.params.input?.[0]?.text?.includes(text));
  await policy('paused');
  const held = await send('policy-paused'); await delay(150);
  assert.equal(peerCalls('policy-paused').length, 0); assert.deepEqual(f.broker.store.messages.find(m => m.id === held.id).offered, []);
  await policy('queue'); await delay(2100);
  assert.equal(peerCalls('policy-paused').length, 0, 'queue waits for the active native turn');
  f.send({ id: 801, method: 'fixture/finish', params: { threadId: 'b' } });
  await eventually(() => peerCalls('policy-paused').length === 1);
  assert.equal(peerCalls('policy-paused')[0].params.method, 'turn/start');
  await policy('steer');
  await send('policy-steer'); await eventually(() => peerCalls('policy-steer').length === 1);
  assert.equal(peerCalls('policy-steer')[0].params.method, 'turn/steer');
  f.send({ id: 802, method: 'fixture/approval', params: { threadId: 'b' } }); await eventually(() => f.output.some(m => m.id === 999));
  await send('approval-policy-held'); await delay(2100);
  assert.equal(peerCalls('approval-policy-held').length, 0, 'steer does not answer pending native approval');
  f.send({ id: 999, result: { decision: 'approved' } });
  await eventually(() => peerCalls('approval-policy-held').length === 1);
  f.send({ id: 803, method: 'fixture/finish', params: { threadId: 'b' } }); await delay(100);
  const uncertain = await send('delay-admission-policy');
  await eventually(async () => (await f.query('evidence')).entries.some(e => e.entityID === uncertain.id && e.kind === 'uncertain'));
  await delay(2100); assert.equal(peerCalls('delay-admission-policy').length, 1, 'unknown native admission is never replayed');
  const record = (await f.query('evidence')).entries.find(e => e.entityID === uncertain.id && e.kind === 'uncertain');
  await assert.rejects(f.run(f.participant, 'action.request', { generation, operation: 'retry_delivery', target: 'codex:b', messageID: uncertain.id,
    evidence: 'known_unadmitted', evidenceID: record.id }), /EVIDENCE_REQUIRED/);
});

test('known Codex native acceptance survives a failed recovery finish and restart without another native call', async t => {
  const faultRoot = privateTemp(join(tmpdir(), 'turnlink-codex-finish-fault-'));
  t.after(() => rmSync(faultRoot, { recursive: true, force: true }));
  const preload = join(faultRoot, 'transport-fault.mjs'), block = join(faultRoot, 'block-finish');
  const actionID = randomUUID(), evidenceID = randomUUID();
  writeFileSync(block, 'hold finish transport', { mode: 0o600 });
  writeFileSync(preload, `import { ChannelClient } from ${JSON.stringify(new URL('../src/client.js', import.meta.url).href)};
import { existsSync } from 'node:fs';
const request = ChannelClient.prototype.request;
let prepared = false;
ChannelClient.prototype.request = async function(method, params = {}) {
  if (method === 'control_delivery_finish' && existsSync(${JSON.stringify(block)})) throw new Error('Fixture finish RPC unavailable');
  if (method === 'control_delivery_pull' && !prepared) {
    prepared = true;
    await request.call(this, 'control_adapter', { agentId: params.agentId, credential: params.credential, command: {
      id: ${JSON.stringify(evidenceID)}, op: 'evidence.record', channel: 'dev', entityID: params.messageID, kind: 'unadmitted' } });
    await request.call(this, 'control_command', { agentId: params.agentId, command: {
      id: ${JSON.stringify(actionID)}, op: 'action.request', channel: 'dev', generation: 1, target: params.agentId,
      operation: 'retry_delivery', messageID: params.messageID, evidence: 'known_unadmitted', evidenceID: ${JSON.stringify(evidenceID)} } });
    for (let i = 0; i < 100; i++) {
      const value = await request.call(this, 'control_query', { agentId: params.agentId, channel: 'dev', view: 'actions' });
      if (value.entries.find(a => a.id === ${JSON.stringify(actionID)})?.status === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
  return request.call(this, method, params);
};`);
  const f = await fixture(t, { NODE_OPTIONS: `--import=${new URL(`file://${preload}`).href}` }, { controlEffects: true, sweepIntervalMs: 20 });
  const proposalID = await f.appoint(); await f.admitted();
  await f.run(f.participant, 'master.accept', { proposalID, promptVersion: 1 });
  await f.participant.request('join', { harness: 'opencode', sessionId: 'sender', name: 'sender', channel: 'dev', role: 'fixture', project: { name: 'fixture', root: '/fixture' } });
  const message = await f.participant.request('send', { agentId: 'opencode:sender', to: 'codex:b', text: 'native-finish-restart', messageId: 'native-finish-restart' });
  const calls = () => f.output.filter(m => m.method === 'fixture/received' && m.params.input?.[0]?.text?.includes('native-finish-restart'));
  await eventually(() => calls().length === 1);
  const ledger = () => new AdmissionLedger('local', 'codex:b', f.options.credentialDirectory);
  await eventually(() => ledger().get(message.id)?.state === 'accepted');
  assert.equal(f.broker.store.deliveryRetries[actionID].outcome, undefined);
  assert.equal(f.broker.store.messages.find(m => m.id === message.id).delivered.length, 0);
  await f.stop(); unlinkSync(block); await f.start();
  await eventually(() => f.broker.store.deliveryRetries[actionID].outcome === 'admitted' && f.broker.store.messages.find(m => m.id === message.id).delivered.includes('codex:b'));
  assert.equal(calls().length, 1);
});
