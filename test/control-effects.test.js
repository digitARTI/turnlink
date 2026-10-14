import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { privateTemp, atomicWrite, readPrivate } from '../src/storage.js';
import { ControlGateway } from '../src/control/gateway.js';
import { BrokerEffectExecutor } from '../src/control/effects.js';
import { applyBrokerEffect } from '../src/broker-effects.js';

function fixture(t) {
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
  run('channel.configure'); run('master.volunteer', { eligible: true }, participant);
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

test('unimplemented effect operations remain approved records, never side effects', t => {
  const f = fixture(t), id = f.action('remove_member');
  f.run('action.approve', { actionID: id }); f.executor().run();
  assert.equal(f.writes(), 0); assert.equal(f.gateway().store.snapshot().actions[0].status, 'approved');
  assert.deepEqual(f.gateway().store.effectIntents(), []);
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
