import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureBrokerControl } from './fixtures/broker-control.js';

test('fixture broker control authenticates and exposes only a bounded read-only receiver view', async t => {
  const secret = 'a'.repeat(64), broker = { store: { bindings: { 'opencode:ses_test': {
    receiverHash: 'sensitive-hash', receiverHandoff: { status: 'held', sourceDetached: true, transitionID: 'transition', secret: 'private' },
    ownerDrain: { phase: 'draining', nextTransitionID: 'next', receiverHash: 'private' },
  } }, messages: [{ messageId: 'm', delivered: ['agent'], offered: [], text: 'private-text' }] } };
  const control = await startFixtureBrokerControl({ broker, secret }); t.after(() => control.close());
  const url = `http://127.0.0.1:${control.port}/v1/receiver/opencode:ses_test`;
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await fetch(url, { headers: { authorization: 'b'.repeat(64) } })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: secret } })).status, 404);
  const response = await fetch(url, { headers: { authorization: secret } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { exists: true, handoff: { status: 'held', sourceDetached: true, transitionID: 'transition' },
    drain: { phase: 'draining', nextTransitionID: 'next' } });
  const snapshot = await (await fetch(`http://127.0.0.1:${control.port}/v1/snapshot`, { headers: { authorization: secret } })).json();
  assert.deepEqual(snapshot.messages, [{ messageId: 'm', delivered: ['agent'], offered: [] }]);
  assert.ok(!JSON.stringify(snapshot).includes('private'));
  assert.equal(broker.store.bindings['opencode:ses_test'].receiverHandoff.status, 'held');
});
