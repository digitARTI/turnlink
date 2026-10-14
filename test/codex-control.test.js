import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { AdmissionLedger } from '../src/admissions.js';

async function eventually(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(75); }
  throw new Error('Codex control condition timed out');
}
async function fixture(t, extraEnv = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-control-'));
  const adapterFile = join(root, 'adapter.token'); writeFileSync(adapterFile, '3'.repeat(64), { mode: 0o600 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true });
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
