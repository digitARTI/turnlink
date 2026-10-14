import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64), ADAPTER = '3'.repeat(64);
async function fixture(t, enabled = true, extra = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-control-broker-'));
  let now = 1000;
  const broker = createBroker({ directory: root, port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: enabled, now: () => now, ...extra });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory: join(root, 'proofs') };
  const clients = [];
  const client = (token = HOST) => { const value = new ChannelClient({ ...options, token }); clients.push(value); return value; };
  const admin = client(ADMIN), a = client(), b = client(), c = client();
  const joinAgent = async (connection, sessionId, channel = 'dev') => {
    await connection.request('join', { harness: 'opencode', sessionId, name: sessionId, role: 'full project access', channel,
      project: { name: 'fixture', root: '/project' } });
    await connection.subscribe(`opencode:${sessionId}`);
  };
  await joinAgent(a, 'a'); await joinAgent(b, 'b'); await joinAgent(c, 'c');
  const run = (connection, agentId, op, fields = {}, channel = 'dev') => connection.request('control_command', {
    ...(agentId ? { agentId } : {}), command: { id: randomUUID(), op, channel, ...fields },
  });
  const query = (connection = admin, agentId, view = 'channel', fields = {}, channel = 'dev') => connection.request('control_query', {
    channel, view, ...(agentId ? { agentId } : {}), ...fields,
  });
  const enroll = () => admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  const appoint = async () => {
    await run(a, 'opencode:a', 'master.volunteer', { eligible: true });
    const result = await run(admin, undefined, 'master.appoint', { candidate: 'opencode:a' });
    const notice = (await query(a, 'opencode:a', 'notices')).entries.find(n => n.kind === 'offer');
    return { proposalID: result.commandID, notice };
  };
  t.after(async () => { clients.forEach(c => c.close()); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  if (enabled) await run(admin, undefined, 'channel.configure');
  return { broker, options, admin, a, b, c, client, run, query, enroll, appoint, joinAgent, advance: ms => { now += ms; } };
}

test('control plane is opt-in and leaves baseline channel messaging available', async t => {
  const f = await fixture(t, false);
  assert.equal((await f.a.request('control_info')).enabled, false);
  await assert.rejects(f.run(f.admin, undefined, 'channel.configure'), /CONTROL_DISABLED/);
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'baseline', messageId: 'baseline' });
  assert.equal(message.text, 'baseline');
});

test('broker derives roles and refuses caller-selected operator, adapter or scheduler authority', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(f.a, 'opencode:a', 'channel.configure', { mode: 'automatic' }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.a, 'opencode:a', 'evidence.record', { entityID: randomUUID(), kind: 'idle' }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.admin, undefined, 'action.begin', { actionID: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.admin, undefined, 'action.revalidate', { actionID: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.a, 'opencode:a', 'action.reconcile', { actionID: randomUUID(), outcome: 'succeeded', evidenceID: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.run(f.a, 'opencode:a', 'master.volunteer', { eligible: true, actor: { kind: 'operator' } }), /Invalid request schema/);
  await assert.rejects(f.a.rpc('control_query', { agentId: 'opencode:b', proof: '0'.repeat(64), channel: 'dev', view: 'channel' }), /CONTROL_ACCESS_DENIED/);
  await f.run(f.admin, undefined, 'channel.configure', {}, 'other');
  await assert.rejects(f.query(f.a, 'opencode:a', 'tasks', {}, 'other'), /CONTROL_ACCESS_DENIED/);
});

test('adapter evidence needs separate enrollment, matching session proof and the actual receiver socket', async t => {
  const f = await fixture(t);
  const command = { id: randomUUID(), op: 'evidence.record', channel: 'dev', entityID: randomUUID(), kind: 'idle' };
  await assert.rejects(f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command }), /ADAPTER_CREDENTIAL_REQUIRED/);
  await assert.rejects(f.admin.request('control_enroll_adapter', { hostId: 'local', credential: HOST }), /SEPARATE_ADAPTER_CREDENTIAL_REQUIRED/);
  await f.enroll();
  const sameHost = f.client();
  await assert.rejects(sameHost.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command }), /ADAPTER_RECEIVER_REQUIRED/);
  await f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command });
  await f.admin.request('control_revoke_adapter', { hostId: 'local' });
  await assert.rejects(f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER,
    command: { ...command, id: randomUUID() } }), /ADAPTER_CREDENTIAL_REQUIRED/);
});

test('master activation requires a durable native role-notice receipt; ordinary history stays participant-only', async t => {
  const f = await fixture(t); await f.enroll();
  await f.b.request('send', { agentId: 'opencode:b', to: 'opencode:c', text: 'private peer exchange', messageId: 'private' });
  const { proposalID, notice } = await f.appoint();
  assert.match(notice.text, /not a replacement system prompt/);
  const accept = () => f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  await assert.rejects(accept(), /ROLE_NOTICE_NOT_ADMITTED/);
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_role_fixture' });
  await accept();
  const generation = (await f.query()).channel.active.generation;
  assert.equal((await f.query(f.a, 'opencode:a', 'messages', { generation })).entries[0].text, 'private peer exchange');
  assert.deepEqual(await f.a.request('history', { agentId: 'opencode:a', channel: 'dev' }), []);
  await assert.rejects(f.query(f.b, 'opencode:b', 'messages', { generation }), /MASTER_MESSAGE_ACCESS_REQUIRED/);
  await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'pause_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  await delay(75);
  assert.equal(f.broker.store.deliveryPauses, undefined, 'effects must remain disabled by default');
  assert.equal((await f.admin.request('control_info')).effectsEnabled, false);
  f.advance(120000);
  await assert.rejects(f.query(f.a, 'opencode:a', 'messages', { generation }), /MASTER_MESSAGE_ACCESS_REQUIRED/);
});

test('leaving and quickly rejoining never restores the old master generation', async t => {
  const f = await fixture(t); await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_role_fixture' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  await f.a.request('leave', { agentId: 'opencode:a' });
  await f.joinAgent(f.a, 'a');
  assert.equal((await f.query()).channel.active, null);
  await assert.rejects(f.query(f.a, 'opencode:a', 'messages', { generation }), /MASTER_MESSAGE_ACCESS_REQUIRED/);
  assert.ok(!(await f.query()).channel.volunteers.includes('opencode:a'));
});

test('bounded control pagination never returns another channel or credentials', async t => {
  const f = await fixture(t); await f.enroll();
  for (let i = 0; i < 4; i++) await f.run(f.admin, undefined, 'task.create', {
    title: `task ${i}`, instructions: 'x'.repeat(12000), criteria: 'evidence', requiresWorktree: false,
  });
  const page = await f.query(f.a, 'opencode:a', 'tasks', { limit: 100 });
  assert.ok(page.entries.length > 0 && page.entries.length < 4);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 49152);
  assert.ok(!JSON.stringify(page).includes(ADAPTER));
  const next = await f.query(f.a, 'opencode:a', 'tasks', { offset: page.next });
  assert.equal(next.entries.length + page.entries.length, 4);
});

test('opt-in broker effects pause, cancel only unoffered queued messages, and resume future delivery', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 50 });
  await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_effect_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const waitAction = async id => {
    for (let i = 0; i < 100; i++) {
      const receipt = f.broker.store.effectReceipts?.[id];
      if (receipt) return receipt;
      await delay(25);
    }
    throw new Error('Broker effect did not settle');
  };
  const pause = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'pause_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  assert.equal((await waitAction(pause.commandID)).outcome, 'succeeded');
  const seen = []; f.b.on('message', message => seen.push(message));
  const queued = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'queued', messageId: 'queued' });
  const held = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'held until resume', messageId: 'held' });
  assert.deepEqual(f.broker.store.messages.find(m => m.id === queued.id).offered, []);
  await delay(75); assert.equal(seen.length, 0);
  const cancel = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'cancel_queued', target: 'opencode:b', messageID: queued.id, evidence: 'not_applicable' });
  await delay(75); assert.equal(f.broker.store.effectReceipts[cancel.commandID], undefined);
  await f.run(f.admin, undefined, 'action.approve', { actionID: cancel.commandID });
  assert.equal((await waitAction(cancel.commandID)).outcome, 'succeeded');
  const resume = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'resume_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  await waitAction(resume.commandID);
  for (let i = 0; i < 100 && !seen.some(m => m.id === held.id); i++) await delay(25);
  assert.ok(seen.some(m => m.id === held.id));
  const pushed = once(f.b, 'message');
  await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'new delivery', messageId: 'new' });
  const [message] = await pushed; assert.equal(message.text, 'new delivery'); assert.equal(message.offered, undefined);
  assert.ok(!seen.some(m => m.id === queued.id));
  assert.deepEqual((await f.admin.request('control_info')).effectOperations, ['pause_delivery', 'resume_delivery', 'cancel_queued']);
});

test('an offered broker message cannot be cancelled by master assertion or human approval', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 50 });
  await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_effect_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const message = await f.a.request('send', { agentId: 'opencode:a', to: 'opencode:b', text: 'possibly admitted', messageId: 'offered' });
  const cancel = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'cancel_queued', target: 'opencode:b', messageID: message.id, evidence: 'known_unadmitted' });
  await f.run(f.admin, undefined, 'action.approve', { actionID: cancel.commandID });
  for (let i = 0; i < 100 && !f.broker.store.effectReceipts?.[cancel.commandID]; i++) await delay(25);
  assert.equal(f.broker.store.effectReceipts[cancel.commandID].outcome, 'failed');
  assert.equal(f.broker.store.messages.find(m => m.id === message.id).cancelled['opencode:b'], undefined);
});

test('real broker restart settles a committed effect receipt without reapplying its action', async t => {
  const f = await fixture(t, true, { controlEffects: true, sweepIntervalMs: 50,
    effectHooks: { afterEffect: () => { throw new Error('Simulated loss before SQLite settlement'); } } });
  await f.enroll(); const { proposalID, notice } = await f.appoint();
  await f.a.request('control_notice_ack', { agentId: 'opencode:a', credential: ADAPTER, id: notice.id, receiptID: 'msg_restart_role' });
  await f.run(f.a, 'opencode:a', 'master.accept', { proposalID, promptVersion: 1 });
  const generation = (await f.query()).channel.active.generation;
  const action = await f.run(f.a, 'opencode:a', 'action.request', { generation, operation: 'pause_delivery', target: 'opencode:b', evidence: 'not_applicable' });
  for (let i = 0; i < 100 && !f.broker.store.effectReceipts?.[action.commandID]; i++) await delay(25);
  const receipt = f.broker.store.effectReceipts[action.commandID]; assert.ok(receipt);
  await f.broker.close();
  let reapplied = false;
  const restarted = createBroker({ directory: join(f.options.credentialDirectory, '..'), port: 0, secret: HOST, adminSecret: ADMIN,
    now: () => 1000, controlPlane: true, controlEffects: true, effectHooks: { afterEffect: () => { reapplied = true; } } });
  await once(restarted.server, 'listening');
  const admin = new ChannelClient({ token: ADMIN, url: `ws://127.0.0.1:${restarted.server.address().port}` });
  t.after(async () => { admin.close(); await restarted.close(); });
  const actions = await admin.request('control_query', { channel: 'dev', view: 'actions' });
  assert.equal(actions.entries.find(a => a.id === action.commandID).status, 'succeeded');
  assert.equal(reapplied, false); assert.deepEqual(restarted.store.effectReceipts[action.commandID], receipt);
  admin.close(); await restarted.close();
});

test('worktree grants are receiver-bound, claim-fenced and cannot be issued by model or operator tools', async t => {
  const f = await fixture(t, true, { worktreeGrants: true }); await f.enroll();
  const task = await f.run(f.admin, undefined, 'task.create', { title: 'isolated task', instructions: 'work', criteria: 'tests', requiresWorktree: true });
  await f.run(f.a, 'opencode:a', 'task.claim', { taskID: task.commandID });
  const digest = 'a'.repeat(64), preview = { id: randomUUID(), channel: 'dev', op: 'worktree.preview', taskID: task.commandID,
    from: '/project', to: '/worktree', configurationDigest: digest,
    binding: { harness: 'opencode', projectID: 'project', sourceAuthorityDigest: digest, destinationAuthorityDigest: digest,
      sources: [{ path: '/project/AGENTS.md', digest }] } };
  const adapter = command => f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command });
  await adapter(preview);
  assert.equal((await f.query(f.b, 'opencode:b', 'previews')).entries.length, 0);
  const begin = { id: randomUUID(), channel: 'dev', op: 'worktree.begin', taskID: task.commandID, previewID: preview.id,
    claimGeneration: 1, configurationDigest: digest, authorityDigest: digest };
  await assert.rejects(adapter(begin), /STALE_WORKTREE_PREVIEW/);
  await f.run(f.admin, undefined, 'worktree.approve', { taskID: task.commandID, previewID: preview.id });
  for (const kind of ['capability', 'idle']) await adapter({ id: randomUUID(), channel: 'dev', op: 'evidence.record', entityID: task.commandID, kind,
    ...(kind === 'capability' ? { sameConversationWorktree: true } : {}) });
  await assert.rejects(f.run(f.a, 'opencode:a', 'worktree.begin', { ...begin, id: randomUUID() }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.admin.request('control_command', { command: begin }), /CONTROL_OPERATION_DISABLED/);
  await assert.rejects(f.client().request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command: begin }), /ADAPTER_RECEIVER_REQUIRED/);
  await adapter(begin);
  await assert.rejects(f.run(f.a, 'opencode:a', 'task.release', { taskID: task.commandID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  const settlement = { id: randomUUID(), channel: 'dev', op: 'worktree.settle', transitionID: begin.id, outcome: 'moved', actualLocation: '/elsewhere',
    configurationDigest: digest, authorityDigest: digest, receiptID: randomUUID() };
  await assert.rejects(adapter(settlement), /UNEXPECTED_WORKTREE_LOCATION/);
  await adapter({ ...settlement, actualLocation: '/worktree' });
  assert.equal((await f.query(f.a, 'opencode:a', 'transitions')).entries[0].status, 'moved');
  assert.equal((await f.a.request('control_info')).worktreeExecutionEnabled, false);
});

test('worktree grant transport is disabled by default, including for enrolled adapters', async t => {
  const f = await fixture(t); await f.enroll();
  await assert.rejects(f.a.request('control_adapter', { agentId: 'opencode:a', credential: ADAPTER, command: { id: randomUUID(), channel: 'dev',
    op: 'worktree.begin', taskID: randomUUID(), previewID: randomUUID(), claimGeneration: 1,
    configurationDigest: 'a'.repeat(64), authorityDigest: 'a'.repeat(64) } }), /WORKTREE_GRANTS_DISABLED/);
});
