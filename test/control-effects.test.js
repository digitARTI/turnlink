import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { privateTemp, atomicWrite, readPrivate } from '../src/storage.js';
import { ControlGateway } from '../src/control/gateway.js';
import { BrokerEffectExecutor } from '../src/control/effects.js';
import { applyBrokerEffect } from '../src/broker-effects.js';
import { RETENTION_MS } from '../src/control/contracts.js';
import { reduceControl } from '../src/control/reducer.js';

function fixture(t, { coldTasks = false } = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-effects-')), file = join(root, 'broker.json');
  const members = ['a', 'b'].map(id => ({ agentId: `opencode:${id}`, channel: 'dev', harness: 'opencode', connected: true }));
  let now = 1000, writes = 0, gateway;
  const open = () => { gateway = new ControlGateway({ directory: join(root, 'control'), now: () => now, members: () => members }); return gateway; };
  open();
  t.after(() => { gateway.store.close(); rmSync(root, { recursive: true, force: true }); });
  const run = (op, fields = {}, actor = { kind: 'operator' }) => {
    const command = { id: randomUUID(), op, channel: 'dev', ...fields };
    gateway.store.apply(command, gateway.context(actor)); return command.id;
  };
  const participant = { kind: 'participant', agentId: 'opencode:a' };
  run('channel.configure');
  if (coldTasks) {
    run('task.create', { title: 'Archived terminal', instructions: 'Retain authority checks', criteria: 'Exact', requiresWorktree: false });
    const state = gateway.store.snapshot(), template = { ...state.tasks[0], status: 'cancelled' };
    state.tasks = Array.from({ length: 4096 }, (_, index) => ({ ...template, id: index ? randomUUID() : template.id }));
    gateway.store.db.prepare('UPDATE control_state SET body=?').run(JSON.stringify(state));
    const insert = gateway.store.db.prepare('INSERT INTO events(id,channel,at,durable,body) VALUES(?,?,?,?,?)');
    gateway.store.db.exec('BEGIN');
    for (const task of state.tasks) {
      const event = { id: randomUUID(), channel: 'dev', type: 'task.missed', actor: { kind: 'operator' }, at: now, entityID: task.id, durable: true };
      insert.run(event.id, 'dev', now, 1, JSON.stringify(event));
    }
    gateway.store.db.exec('COMMIT');
    const cutoff = now + 1; now += RETENTION_MS + 2000;
    const archive = gateway.store.exportTo(gateway.archives, randomUUID(), now);
    assert.equal(gateway.store.reclaimHistory(gateway.archives, { id: archive.id, digest: archive.digest, before: cutoff }, now).entities.tasks, 4096);
    run('task.create', { title: 'New hot task', instructions: 'Retain authority checks', criteria: 'Exact', requiresWorktree: false });
  }
  run('master.volunteer', { eligible: true }, participant);
  const proposalID = run('master.appoint', { candidate: 'opencode:a' });
  const notice = gateway.store.notices('dev', 'opencode:a').entries[0];
  gateway.store.acceptNotice('dev', 'opencode:a', notice.id, 'msg_fixture', now);
  run('master.accept', { proposalID, promptVersion: 1 }, participant);
  let broker = { version: 3, bindings: {}, agents: { 'opencode:b': { channel: 'dev' } }, messages: [] };
  atomicWrite(file, JSON.stringify(broker));
  const action = (operation, fields = {}) => run('action.request', { operation, target: 'opencode:b', generation: 1, evidence: 'not_applicable', ...fields }, participant);
  const executor = (hooks = {}) => new BrokerEffectExecutor({ gateway, ...hooks,
    lookup: id => broker.effectReceipts?.[id], apply: value => {
      const result = applyBrokerEffect(broker, value, now); writes++; atomicWrite(file, JSON.stringify(result.state)); broker = result.state; return result.receipt;
    } });
  const reopen = () => { gateway.store.close(); broker = JSON.parse(readPrivate(file)); open(); };
  return { run, action, executor, reopen, gateway: () => gateway, broker: () => broker, setBroker: value => { broker = value; atomicWrite(file, JSON.stringify(value)); },
    writes: () => writes, advance: ms => { now += ms; }, connected: value => { members[0].connected = value; } };
}

test('effect intent commits atomically with executing state and rolls back on storage failure', t => {
  const f = fixture(t), id = f.action('pause_delivery');
  f.gateway().store.beforeCommit = () => { throw new Error('commit fault'); };
  assert.throws(() => f.executor().run(), /commit fault/);
  assert.equal(f.gateway().store.snapshot().actions[0].status, 'approved');
  assert.deepEqual(f.gateway().store.effectIntents(), []); assert.equal(f.writes(), 0);
  f.gateway().store.beforeCommit = () => {}; f.executor().run();
  assert.equal(f.gateway().store.snapshot().actions[0].status, 'succeeded');
  assert.ok(f.broker().deliveryPauses['opencode:b']); assert.ok(f.broker().effectReceipts[id]);
});

test('crash after intent is recovered once, but authority expiry prevents an unapplied effect', t => {
  const f = fixture(t); f.action('pause_delivery');
  assert.throws(() => f.executor({ afterIntent: () => { throw new Error('crash'); } }).run(), /crash/);
  assert.equal(f.writes(), 0); f.reopen(); f.advance(120000); f.executor().run();
  assert.equal(f.writes(), 0); assert.equal(f.gateway().store.snapshot().actions[0].status, 'failed');
});

test('an unapplied intent with unchanged authority resumes once after restart', t => {
  const f = fixture(t); f.action('pause_delivery');
  assert.throws(() => f.executor({ afterIntent: () => { throw new Error('crash'); } }).run(), /crash/);
  f.reopen(); f.connected(false); f.executor().run();
  assert.equal(f.writes(), 0); assert.equal(f.gateway().store.snapshot().actions[0].status, 'executing');
  f.connected(true); f.executor().run(); f.executor().run();
  assert.equal(f.writes(), 1); assert.equal(f.gateway().store.snapshot().actions[0].status, 'succeeded');
});

test('membership removal needs approval then commits cancellation and an immutable receipt', t => {
  const f = fixture(t), id = f.action('remove_member');
  f.executor().run(); assert.ok(f.broker().agents['opencode:b']);
  f.run('action.approve', { actionID: id }); f.executor().run();
  assert.equal(f.writes(), 1); assert.equal(f.gateway().store.snapshot().actions[0].status, 'succeeded');
  assert.equal(f.broker().agents['opencode:b'], undefined); assert.ok(f.broker().effectReceipts[id]);
});

test('crash after broker effect reconciles its receipt without replay even after authority expires', t => {
  const f = fixture(t), id = f.action('pause_delivery');
  assert.throws(() => f.executor({ afterEffect: () => { throw new Error('crash'); } }).run(), /crash/);
  assert.equal(f.writes(), 1); assert.equal(f.gateway().store.snapshot().actions[0].status, 'executing');
  f.reopen(); f.advance(120000); f.executor().run(); f.executor().run();
  assert.equal(f.writes(), 1); assert.equal(f.gateway().store.snapshot().actions[0].status, 'succeeded');
  assert.equal(f.gateway().store.snapshot().actions[0].evidenceID, f.broker().effectReceipts[id].id);
});

test('last-moment policy change prevents an effect and matching receipts are immutable', t => {
  const f = fixture(t); f.action('pause_delivery');
  f.executor({ afterIntent: () => f.run('channel.configure', { mode: 'approval' }) }).run();
  assert.equal(f.writes(), 0); assert.equal(f.gateway().store.snapshot().actions[0].status, 'failed');
  const id = f.action('resume_delivery'); f.run('action.approve', { actionID: id }); f.executor().run();
  const intent = f.gateway().store.effectIntents().find(i => i.id === id);
  const duplicate = applyBrokerEffect(f.broker(), intent, 1001);
  assert.equal(duplicate.state, f.broker());
  assert.throws(() => applyBrokerEffect(f.broker(), { ...intent, target: 'opencode:a' }, 1001), /EFFECT_RECEIPT_CONFLICT/);
});

test('safe cancellation needs operator approval and never retracts offered, admitted or legacy-unknown work', t => {
  const f = fixture(t);
  const base = { id: randomUUID(), channel: 'dev', recipients: ['opencode:b'], delivered: [], cancelled: {}, offered: [] };
  const messages = [base, { ...base, id: randomUUID(), offered: ['opencode:b'] }, { ...base, id: randomUUID(), offered: undefined },
    { ...base, id: randomUUID(), delivered: ['opencode:b'] }];
  f.setBroker({ ...f.broker(), messages: messages.map(m => structuredClone(m)) });
  for (const message of messages) {
    const id = f.action('cancel_queued', { messageID: message.id });
    f.executor().run(); assert.equal(f.gateway().store.snapshot().actions.find(a => a.id === id).status, 'awaiting_approval');
    f.run('action.approve', { actionID: id }); f.executor().run();
    assert.equal(f.gateway().store.snapshot().actions.find(a => a.id === id).status, message.id === base.id ? 'succeeded' : 'failed');
  }
  assert.equal(f.broker().messages[0].cancelled['opencode:b'], 'control_cancelled_unoffered');
  assert.ok(f.broker().messages.slice(1).every(m => !m.cancelled['opencode:b']));
});

 test('wake policies and retries persist exact action-bound broker scheduling receipts', t => {
  const f = fixture(t);
  const policyID = f.action('change_wake_policy', { wakePolicy: 'queue' }); f.executor().run();
  assert.equal(f.broker().wakePolicies?.['opencode:b']?.policy, 'queue');
  const message = { id: randomUUID(), channel: 'dev', recipients: ['opencode:b'], delivered: [], cancelled: {}, offered: ['opencode:b'] };
  f.setBroker({ ...f.broker(), messages: [message] });
  const evidenceID = f.run('evidence.record', { entityID: message.id, kind: 'unadmitted' }, { kind: 'adapter', agentId: 'opencode:b' });
  const retryID = f.action('retry_delivery', { messageID: message.id, evidence: 'known_unadmitted', evidenceID }); f.executor().run();
  assert.equal(f.gateway().store.snapshot().actions.find(a => a.id === retryID).status, 'succeeded');
  assert.equal(f.broker().deliveryRetries?.[retryID]?.messageID, message.id);
  const request = f.gateway().store.snapshot().actions.find(a => a.id === policyID);
  assert.throws(() => applyBrokerEffect(f.broker(), { ...request, wakePolicy: 'paused' }, 1001), /EFFECT_RECEIPT_CONFLICT/);
});
 test('new uncertainty after the intent prevents retry without crashing other effects', t => {
  const f = fixture(t), messageID = randomUUID();
  const evidenceID = f.run('evidence.record', { entityID: messageID, kind: 'unadmitted' }, { kind: 'adapter', agentId: 'opencode:b' });
  const id = f.action('retry_delivery', { messageID, evidence: 'known_unadmitted', evidenceID });
  f.executor({ afterIntent: () => f.run('evidence.record', { entityID: messageID, kind: 'uncertain' }, { kind: 'adapter', agentId: 'opencode:b' }) }).run();
  assert.equal(f.writes(), 0); assert.equal(f.gateway().store.snapshot().actions.find(a => a.id === id).status, 'failed');
});

test('a persisted legacy effect receipt reconciles after upgrade without replay', t => {
  const f = fixture(t); const id = f.action('pause_delivery');
  assert.throws(() => f.executor({ afterEffect: () => { throw new Error('crash before settlement'); } }).run(), /crash before settlement/);
  const action = f.gateway().store.snapshot().actions.find(a => a.id === id);
  const fingerprint = createHash('sha256').update(JSON.stringify({ id, channel: 'dev', operation: 'pause_delivery', target: 'opencode:b', messageID: null,
    requester: 'opencode:a', generation: 1, policyRevision: action.policyRevision })).digest('hex');
  f.setBroker({ ...f.broker(), effectReceipts: { [id]: { ...f.broker().effectReceipts[id], fingerprint } } });
  f.reopen(); f.advance(120000); f.executor().run();
  assert.equal(f.writes(), 1); assert.equal(f.gateway().store.snapshot().actions.find(a => a.id === id).status, 'succeeded');
});


test('recovery execution and settled retry grants revalidate archive-expanded state without relaxing standalone limits', t => {
  const f = fixture(t, { coldTasks: true });
  assert.equal(f.gateway().store.snapshot().tasks.length, 4097);
  const policyID = f.action('change_wake_policy', { wakePolicy: 'queue' });
  assert.doesNotThrow(() => f.executor().run());
  assert.equal(f.gateway().store.snapshot().actions.find(action => action.id === policyID).status, 'succeeded');
  assert.equal(f.broker().wakePolicies['opencode:b'].policy, 'queue');
  const message = { id: randomUUID(), channel: 'dev', recipients: ['opencode:b'], delivered: [], cancelled: {}, offered: ['opencode:b'] };
  f.setBroker({ ...f.broker(), messages: [message] });
  const evidenceID = f.run('evidence.record', { entityID: message.id, kind: 'unadmitted' }, { kind: 'adapter', agentId: 'opencode:b' });
  const retryID = f.action('retry_delivery', { messageID: message.id, evidence: 'known_unadmitted', evidenceID });
  f.executor().run();
  const retry = f.gateway().store.snapshot().actions.find(action => action.id === retryID);
  assert.equal(retry.status, 'succeeded');
  assert.doesNotThrow(() => f.executor().authorized(retry, true));
  assert.equal(f.writes(), 2);
  assert.throws(() => reduceControl(f.gateway().store.snapshot(), { id: randomUUID(), op: 'channel.configure', channel: 'dev' },
    f.gateway().context({ kind: 'operator' })), 'standalone reducer still enforces its public hot bounds');
});
