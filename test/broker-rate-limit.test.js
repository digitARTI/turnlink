import test from 'node:test';
import assert from 'node:assert/strict';
import { retryBrokerPreDispatch } from '../src/broker-rate-limit.js';

const limited = () => Object.assign(new Error('rejected before dispatch'), { code: 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' });

test('a confirmed pre-dispatch rejection is retried but an ambiguous error is not', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const result = await retryBrokerPreDispatch(async () => { if (++attempts < 3) throw limited(); return 'accepted'; },
    { check() {}, signal: controller.signal });
  assert.equal(result, 'accepted'); assert.equal(attempts, 3);
  let calls = 0;
  await assert.rejects(retryBrokerPreDispatch(async () => { calls++; throw new Error('lost reply'); },
    { check() {}, signal: controller.signal }), /lost reply/);
  assert.equal(calls, 1);
});

test('receiver changes or cancellation during backoff prevent another dispatch', async () => {
  const controller = new AbortController(); let calls = 0, current = true;
  await assert.rejects(retryBrokerPreDispatch(async () => { calls++; current = false; throw limited(); }, {
    check() { if (!current) throw new Error('owner changed'); }, signal: controller.signal,
  }), /owner changed/);
  assert.equal(calls, 1);
  const abort = new AbortController(); calls = 0;
  await assert.rejects(retryBrokerPreDispatch(async () => { calls++; abort.abort(); throw limited(); },
    { check() {}, signal: abort.signal }), /abort/i);
  assert.equal(calls, 1);
});

test('a guard failure after an effect is never treated as a pre-dispatch rejection', async () => {
  const controller = new AbortController(); let calls = 0, checks = 0;
  await assert.rejects(retryBrokerPreDispatch(async () => { calls++; return 'effect'; }, {
    check() { if (++checks === 2) throw limited(); }, signal: controller.signal,
  }), /rejected before dispatch/);
  assert.equal(calls, 1);
});
