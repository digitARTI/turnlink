import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ContainedSourceRetirement, makeContainedSourceRetirement } from '../src/control/contained-source-retirement-contracts.js';

const owner = () => ({ names: ['z', 'a'], resourceID: randomUUID(), operationID: randomUUID(),
  containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' });

test('source retirement commitment binds effects and every canonical owner identity', () => {
  const original = owner(), plan = makeContainedSourceRetirement([original]);
  assert.deepEqual(plan.owners[0].names, ['a', 'z']);
  assert.equal(ContainedSourceRetirement.safeParse(plan).success, true);
  for (const [key, value] of [['resourceID', randomUUID()], ['operationID', randomUUID()], ['containerID', 'b'.repeat(64)],
    ['wrapperPID', 124], ['daemonID', 'other-daemon'], ['names', ['a']]]) {
    const forged = structuredClone(plan); forged.owners[0][key] = value;
    assert.equal(ContainedSourceRetirement.safeParse(forged).success, false, key);
  }
  assert.equal(ContainedSourceRetirement.safeParse({ ...plan, stop: false }).success, false);
  assert.equal(ContainedSourceRetirement.safeParse({ ...plan, remove: false }).success, false);
  const duplicate = { ...owner(), resourceID: randomUUID(), operationID: randomUUID(), names: ['a'], containerID: 'c'.repeat(64), wrapperPID: 124 };
  assert.throws(() => makeContainedSourceRetirement([original, duplicate]));
});

test('version 2 explicitly binds native-loss, revocation and uncertainty semantics', () => {
  const legacy = makeContainedSourceRetirement([owner()]);
  assert.equal(legacy.version, 1); assert.equal(legacy.admittedEffectAfterNativeLoss, undefined);
  const plan = makeContainedSourceRetirement([owner()], { permitAdmittedEffectAfterNativeLoss: true });
  assert.equal(plan.version, 2); assert.equal(plan.admittedEffectAfterNativeLoss, 'may_complete');
  assert.equal(plan.revocation, 'immediate_session_host_adapter_no_new_effects'); assert.equal(plan.uncertainEffect, 'hold_until_reconciled');
  for (const [key, value] of [['admittedEffectAfterNativeLoss', 'forbidden'], ['revocation', 'deferred'], ['uncertainEffect', 'release']]) {
    assert.equal(ContainedSourceRetirement.safeParse({ ...plan, [key]: value }).success, false);
  }
  const unversioned = { ...legacy, admittedEffectAfterNativeLoss: 'may_complete' };
  assert.equal(ContainedSourceRetirement.safeParse(unversioned).success, false);
});

test('canonical mixed-case UUID ordering and digest do not depend on input order or locale', () => {
  const owners = [
    { names: ['z'], resourceID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', operationID: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local' },
    { names: ['a'], resourceID: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB', operationID: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', containerID: 'b'.repeat(64), wrapperPID: 124, daemonID: 'local' },
  ];
  const plan = makeContainedSourceRetirement(owners);
  assert.deepEqual(plan.owners.map(item => item.resourceID), [owners[1].resourceID, owners[0].resourceID]);
  assert.equal(makeContainedSourceRetirement([...owners].reverse()).digest, plan.digest);
  const module = new URL('../src/control/contained-source-retirement-contracts.js', import.meta.url).href;
  const script = `import { makeContainedSourceRetirement } from ${JSON.stringify(module)}; process.stdout.write(makeContainedSourceRetirement(${JSON.stringify(owners)}).digest);`;
  for (const locale of ['C', 'tr_TR.UTF-8']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, LC_ALL: locale }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, plan.digest, locale);
  }
});
