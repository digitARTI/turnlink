import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialTaskForm, taskFields } from '../dashboard/src/task-form.js';
import { Command } from '../src/control/contracts.js';

const form = fields => ({ ...initialTaskForm, title: 'Scheduled fixture', instructions: 'Keep native approvals', criteria: 'Exact metadata', ...fields });
const command = fields => Command.parse({ id: randomUUID(), channel: 'dev', op: 'task.create', ...taskFields(form(fields)) });

test('task form defaults preserve existing-cwd, optional timing and voluntary claim contract', () => {
  const fields = taskFields(form({})), parsed = command({});
  assert.equal(fields.requiresWorktree, false); assert.equal(fields.priority, 50); assert.equal(fields.progressTimeoutMs, 300000);
  assert.deepEqual(fields.dependencies, []); assert.ok(!Object.hasOwn(fields, 'schedule')); assert.ok(!Object.hasOwn(fields, 'deadlineAt'));
  assert.deepEqual(parsed.dependencies, []); assert.equal(parsed.generation, undefined);
});

test('form produces exact bounded dependency/priority/deadline/schedule values with ask as default', () => {
  const a = randomUUID(), b = randomUUID();
  const parsed = command({ dependencies: `${a},\n${b}`, priority: '100', scheduledAt: '2028-02-29T12:34', deadlineAt: '2028-03-01T01:02', progressTimeoutSeconds: '2592000', maxLatenessSeconds: '3600' });
  assert.deepEqual(parsed.dependencies, [a, b]); assert.equal(parsed.priority, 100);
  assert.deepEqual(parsed.schedule, { at: Date.UTC(2028, 1, 29, 12, 34), missed: 'ask', maxLatenessMs: 3600000 });
  assert.equal(parsed.deadlineAt, Date.UTC(2028, 2, 1, 1, 2)); assert.equal(parsed.progressTimeoutMs, 2592000000);
  for (const missed of ['ask', 'skip', 'run_late']) assert.equal(command({ scheduledAt: '2028-01-01T00:00', missed }).schedule.missed, missed);
});

test('UTC input is exact across local DST gaps/overlaps and rejects calendar normalization, timezone offsets and invalid epochs', () => {
  for (const date of ['2026-03-29T02:30', '2026-10-25T02:30']) {
    assert.equal(command({ scheduledAt: date }).schedule.at, Date.parse(`${date}:00.000Z`));
  }
  for (const value of ['2027-02-29T12:00', '2028-02-30T12:00', '2028-04-31T12:00', '2028-13-01T12:00', '2028-01-01T24:00',
    '2028-01-01T12:60', '2028-01-01T12:00Z', '2028-01-01T12:00+02:00', '1969-12-31T23:59', 'not a date']) {
    for (const field of ['scheduledAt', 'deadlineAt']) assert.throws(() => taskFields(form({ [field]: value })), /UTC date and time/);
  }
});

test('numeric controls reject fractions/exponents/overflow and enforce the broker bounds', () => {
  for (const field of ['priority', 'maxLatenessSeconds', 'progressTimeoutSeconds']) {
    for (const value of ['', '-1', '1.5', '1e2', 'Infinity', '9007199254740992'])
      assert.throws(() => taskFields(form({ scheduledAt: '2028-01-01T00:00', [field]: value })), /whole number/);
  }
  assert.throws(() => taskFields(form({ priority: '101' })), /whole number/);
  for (const field of ['maxLatenessSeconds', 'progressTimeoutSeconds']) {
    for (const value of ['0', '2592001']) assert.throws(() => taskFields(form({ scheduledAt: '2028-01-01T00:00', [field]: value })), /whole number/);
  }
  assert.equal(command({ priority: '0', progressTimeoutSeconds: '1' }).progressTimeoutMs, 1000);
});

test('dependencies are explicit bounded IDs, not titles; invalid/unknown identities remain broker-owned checks', () => {
  const id = randomUUID(); assert.throws(() => taskFields(form({ dependencies: `${id}, ${id}` })), /distinct/);
  assert.throws(() => taskFields(form({ dependencies: Array.from({ length: 65 }, () => randomUUID()).join('\n') })), /at most 64/);
  assert.equal(command({ dependencies: Array.from({ length: 64 }, () => randomUUID()).join('\n') }).dependencies.length, 64);
  assert.throws(() => command({ dependencies: 'not-a-task-uuid' }));
  assert.throws(() => taskFields(form({ scheduledAt: '2028-01-01T00:00', missed: 'automatic replay' })), /missed-schedule policy/);
  assert.ok(!Object.hasOwn(taskFields(form({ scheduledAt: '', maxLatenessSeconds: 'unused' })), 'schedule'));
});
