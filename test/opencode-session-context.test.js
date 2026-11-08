import test from 'node:test';
import assert from 'node:assert/strict';
import { readOpenCodeSessionContext } from '../adapters/opencode-session-context.js';

test('an agent can compare its own native permission rules without exposing them', async () => {
  const session = { agent: 'build', location: { directory: '/synthetic' }, permissions: [{ action: 'read', resource: '/synthetic/*', effect: 'allow' }] };
  const agent = { id: 'build', permissions: [{ action: 'read', resource: 'private-pattern', effect: 'deny' }] };
  const ctx = { app: { version: 'v2.2.5' }, agent: { get: async () => ({ data: agent }) }, model: { default: async () => ({ data: { id: 'model', providerID: 'provider' } }) } };
  const read = () => readOpenCodeSessionContext({ ctx, sessionID: 's', ownSession: async () => session, signal: new AbortController().signal });
  const first = await read();
  assert.equal(first.agent, 'build'); assert.equal(first.model, 'model'); assert.equal(first.provider, 'provider'); assert.equal(first.runtime, 'opencode 2.2.5');
  assert.match(first.permissions, /^native-rules-sha256:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(first).includes('private-pattern'));
  assert.equal((await read()).permissions, first.permissions);
  session.permissions[0].effect = 'deny';
  assert.notEqual((await read()).permissions, first.permissions);
});

test('session observations stay unknown without a selected agent and reject changing settings', async () => {
  const signal = new AbortController().signal, ctx = { agent: { get: async () => ({ id: 'build', permissions: [] }) } };
  const unknown = await readOpenCodeSessionContext({ ctx, sessionID: 's', ownSession: async () => ({ location: { directory: '/synthetic' } }), signal });
  assert.equal(unknown.agent, null); assert.equal(unknown.permissions, null);
  assert.equal(unknown.runtime, null);
  let calls = 0;
  await assert.rejects(readOpenCodeSessionContext({ ctx, sessionID: 's', signal, ownSession: async () => ({ agent: 'build',
    location: { directory: '/synthetic' }, permissions: [{ action: 'read', resource: '*', effect: ++calls === 1 ? 'allow' : 'deny' }] }) }), /changed during observation/);
  const shared = { agent: 'build', location: { directory: '/synthetic' }, permissions: [{ action: 'read', resource: '*', effect: 'allow' }] };
  calls = 0;
  await assert.rejects(readOpenCodeSessionContext({ ctx, sessionID: 's', signal, ownSession: async () => {
    if (++calls === 2) shared.permissions[0].effect = 'deny';
    return shared;
  } }), /changed during observation/);
  const changingAgent = { id: 'build', permissions: [{ action: 'read', resource: '*', effect: 'allow' }] };
  calls = 0;
  const changing = { agent: { get: async () => {
    if (++calls === 2) changingAgent.permissions[0].effect = 'deny';
    return changingAgent;
  } } };
  await assert.rejects(readOpenCodeSessionContext({ ctx: changing, sessionID: 's', signal,
    ownSession: async () => ({ agent: 'build', location: { directory: '/synthetic' }, permissions: [] }) }), /changed during observation/);
});
