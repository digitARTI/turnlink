import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmFixtureStop, fixtureIdentifiers, fixtureStartupPhase } from './fixtures/codex-vm-xpc/broker-vm-fixture.js';
import { cleanupVMResources } from './fixtures/opencode-vm-cleanup.js';

test('VM fixtures have distinct XPC identities and report only observed startup stages', () => {
  const a = fixtureIdentifiers(), b = fixtureIdentifiers();
  assert.notEqual(a.client, b.client);
  assert.notEqual(a.service, b.service);
  assert.notEqual(a.client, a.service);
  assert.equal(fixtureStartupPhase(''), 'vm-start');
  assert.equal(fixtureStartupPhase('vm-started-fixture\n'), 'guest-boot-or-image-load');
  assert.equal(fixtureStartupPhase('daemon-ping-authenticated\n'), 'bridge');
  assert.throws(() => fixtureIdentifiers('bad'));
});

test('cleanup continues after failures, stops both VM owners and retains unconfirmed state', async () => {
  const calls = [];
  await assert.rejects(cleanupVMResources({
    actions: [() => { calls.push('first'); throw new Error('failed'); }, () => calls.push('second')],
    stopDest: () => { calls.push('dest'); throw new Error('unconfirmed'); },
    stopPlugin: () => { calls.push('plugin'); return true; },
    removeRoot: () => calls.push('remove'),
  }), AggregateError);
  assert.deepEqual(calls, ['first', 'second', 'dest', 'plugin']);
  await cleanupVMResources({ actions: [], stopDest: () => true, stopPlugin: () => true, removeRoot: () => calls.push('remove') });
  assert.equal(calls.at(-1), 'remove');
});

test('failed VM startup is confirmed stopped only after a successful response and service exit', async () => {
  let checks = 0;
  const verify = async value => { checks++; assert.equal(value, 'vm-stopped-fixture 123'); };
  assert.equal(await confirmFixtureStop(async () => null, verify), false);
  assert.equal(await confirmFixtureStop(async () => ({ code: 1, output: '' }), verify), false);
  assert.equal(checks, 0);
  assert.equal(await confirmFixtureStop(async () => ({ code: 0, output: 'vm-stopped-fixture 123' }), verify), true);
  assert.equal(await confirmFixtureStop(async () => ({ code: 0, output: '' }), async () => { throw new Error('unconfirmed'); }), false);
  assert.equal(await confirmFixtureStop(async () => { throw new Error('disconnected'); }, verify), false);
});
