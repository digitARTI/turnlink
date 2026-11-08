import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { privateTemp } from '../src/storage.js';
import { digest } from '../src/config.js';
import { ToolSession } from '../src/tools.js';

function fixture(root) {
  const agentId = 'codex:worker', taskID = randomUUID(), previewID = randomUUID(), coordinator = 'opencode:manager';
  const task = { id: taskID, channel: 'dev', claimant: agentId, status: 'claimed', requiresWorktree: true, claimGeneration: 1 };
  const preview = { id: previewID, taskID, channel: 'dev', agentId, claimGeneration: 1, approved: true,
    from: '/source', to: '/destination', sessionCoordinator: coordinator };
  const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: agentId, source: preview.from, destination: preview.to,
    runtime: 'codex 0.165.0', model: 'synthetic', provider: 'synthetic', permissions: 'read-only', work: 'saved work' };
  const member = { agentId, project: { root: preview.from } }, sent = [];
  const client = { options: { credentialDirectory: root }, async request(method, params) {
    if (method === 'control_query') return { entries: params.view === 'tasks' ? [task] : [preview], next: params.entityID ? 1 : params.offset + 1 };
    if (method === 'members') return [member];
    if (method === 'history') return sent.slice().reverse().slice(params.offset, params.offset + params.limit)
      .map(message => ({ ...message, channel: 'dev', from: { agentId } }));
    if (method === 'send') { sent.push(params); return { id: randomUUID() }; }
    throw new Error('Unexpected request');
  } };
  // The final empty page is necessary because broker responses may be truncated.
  const request = client.request; client.request = (method, params) => method === 'control_query' && !params.entityID && params.offset > 0
    ? Promise.resolve({ entries: [], next: params.offset }) : request(method, params);
  const session = new ToolSession(client, { harness: 'codex', sessionId: 'worker', restoreWatchesOnJoin: true });
  session.agentId = agentId; session.channel = 'dev';
  const file = join(root, 'manual-session-records', digest(agentId), `${taskID}-${previewID}.json`);
  return { session, client, task, preview, record, coordinator, member, sent, file };
}

test('sending an approved source record stores the exact agent-provided JSON privately', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), text = JSON.stringify(f.record);
  const result = await f.session.call('channel_send', { to: f.coordinator, text, messageId: 'record-1' });
  assert.equal(result.privateRecordSaved, true);
  assert.equal(readFileSync(f.file, 'utf8'), text);
  assert.equal(f.sent[0].text, text);
});

test('a conflicting retry cannot overwrite the private copy of the accepted record', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), text = JSON.stringify(f.record);
  await f.session.call('channel_send', { to: f.coordinator, text, messageId: 'record-1' });
  await assert.rejects(f.session.call('channel_send', { to: f.coordinator, text: JSON.stringify({ ...f.record, work: 'different' }), messageId: 'record-1' }), /Idempotency key reused/);
  assert.equal(readFileSync(f.file, 'utf8'), text); assert.equal(f.sent.length, 1);
});

test('replaying an older accepted record does not replace the newer private copy', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), oldText = JSON.stringify(f.record), newText = JSON.stringify({ ...f.record, work: 'newer' });
  await f.session.call('channel_send', { to: f.coordinator, text: oldText, messageId: 'old' });
  await f.session.call('channel_send', { to: f.coordinator, text: newText, messageId: 'new' });
  const replay = await f.session.call('channel_send', { to: f.coordinator, text: oldText, messageId: 'old' });
  assert.equal(replay.privateRecordSaved, undefined); assert.equal(readFileSync(f.file, 'utf8'), newText);
});

test('a lost send reply can be retried with the same ID and confirms the private copy', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), request = f.client.request.bind(f.client), text = JSON.stringify(f.record);
  let loseReply = true;
  f.client.request = async (method, params) => {
    if (method === 'send' && loseReply) { loseReply = false; await request(method, params); throw new Error('reply lost'); }
    if (method === 'send' && f.sent.some(item => item.messageId === params.messageId)) return { id: 'existing' };
    return request(method, params);
  };
  await assert.rejects(f.session.call('channel_send', { to: f.coordinator, text, messageId: 'record-1' }), /reply lost/);
  rmSync(f.file);
  const retry = await f.session.call('channel_send', { to: f.coordinator, text, messageId: 'record-1' });
  assert.equal(retry.privateRecordSaved, true);
  assert.equal(readFileSync(f.file, 'utf8'), text); assert.equal(f.sent.length, 1);
});

test('a replay across history pages does not replace a later record', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), oldText = JSON.stringify(f.record), newText = JSON.stringify({ ...f.record, work: 'newer' });
  await f.session.call('channel_send', { to: f.coordinator, text: oldText, messageId: 'old' });
  for (let i = 0; i < 101; i++) f.sent.push({ agentId: f.session.agentId, to: f.coordinator, messageId: `ordinary-${i}`, text: 'ordinary message' });
  await f.session.call('channel_send', { to: f.coordinator, text: newText, messageId: 'new' });
  const replay = await f.session.call('channel_send', { to: f.coordinator, text: oldText, messageId: 'old' });
  assert.equal(replay.privateRecordSaved, undefined); assert.equal(readFileSync(f.file, 'utf8'), newText);
});

test('stale or mismatched source records are not saved or sent', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root); f.preview.from = '/other-source';
  await assert.rejects(f.session.call('channel_send', { to: f.coordinator, text: JSON.stringify(f.record) }), /Approved session record required/);
  assert.equal(existsSync(f.file), false); assert.equal(f.sent.length, 0);
});

test('a resumed destination can forward the original record for coordinator recovery', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root); f.member.project.root = f.preview.to;
  const result = await f.session.call('channel_send', { to: 'opencode:new-manager', text: JSON.stringify(f.record) });
  assert.equal(result.privateRecordSaved, undefined); assert.equal(existsSync(f.file), false);
  assert.equal(f.sent[0].to, 'opencode:new-manager');
});

test('concurrent record updates are saved and sent in invocation order', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), request = f.client.request.bind(f.client);
  let unblock, entered; const waiting = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { unblock = resolve; });
  let first = true;
  f.client.request = async (method, params) => {
    if (method === 'control_query' && params.view === 'tasks' && first) { first = false; entered(); await gate; }
    return request(method, params);
  };
  const oldText = JSON.stringify({ ...f.record, work: 'older' }), newText = JSON.stringify({ ...f.record, work: 'newer' });
  const oldSend = f.session.call('channel_send', { to: f.coordinator, text: oldText, messageId: 'older' });
  await waiting;
  const newSend = f.session.call('channel_send', { to: f.coordinator, text: newText, messageId: 'newer' });
  await new Promise(resolve => setImmediate(resolve)); unblock();
  await Promise.all([oldSend, newSend]);
  assert.deepEqual(f.sent.map(value => value.messageId), ['older', 'newer']);
  assert.equal(readFileSync(f.file, 'utf8'), newText);
});

test('a failed private write does not publish a record to the coordinator', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), blocked = join(root, 'not-a-directory'); writeFileSync(blocked, 'fixture', { mode: 0o600 });
  f.client.options.credentialDirectory = blocked;
  await assert.rejects(f.session.call('channel_send', { to: f.coordinator, text: JSON.stringify(f.record) }));
  assert.equal(f.sent.length, 0);
});

test('a truncated preview response cannot authorize a private write', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-session-record-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture(root), request = f.client.request.bind(f.client);
  f.client.request = (method, params) => method === 'control_query' && params.view === 'previews' && !params.entityID
    ? Promise.resolve({ entries: [f.preview], next: 0 }) : request(method, params);
  await assert.rejects(f.session.call('channel_send', { to: f.coordinator, text: JSON.stringify(f.record) }), /previews unavailable/i);
  assert.equal(f.sent.length, 0); assert.equal(existsSync(f.file), false);
});
