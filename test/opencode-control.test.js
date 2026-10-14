import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { openCodeFixture } from './fixtures/opencode.js';

test('OpenCode role notices use native idempotent admission without changing existing agent/model/permissions', async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-opencode-control-'));
  const tokenFile = join(root, 'host.token'), adapterTokenFile = join(root, 'adapter.token');
  writeFileSync(tokenFile, '1'.repeat(64), { mode: 0o600 }); writeFileSync(adapterTokenFile, '3'.repeat(64), { mode: 0o600 });
  const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true });
  await once(broker.server, 'listening');
  const options = { url: `ws://127.0.0.1:${broker.server.address().port}`, tokenFile, credentialDirectory: join(root, 'proofs'), control: true, adapterTokenFile };
  const admin = new ChannelClient({ ...options, token: '2'.repeat(64) });
  t.after(async () => { admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const command = (op, fields = {}) => ({ id: randomUUID(), op, channel: 'dev', ...fields });
  await admin.request('control_command', { command: command('channel.configure') });
  await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
  const f = await openCodeFixture(t, options);
  t.after(f.cleanup);
  assert.ok(f.tools.channel_control && f.tools.channel_status);
  assert.ok(!JSON.stringify(f.tools.channel_control.input).includes('master.renew'));
  const context = { sessionID: 'b' };
  await f.tools.channel_join.execute({ channel: 'dev', name: 'b', role: 'full project access', project: { name: 'fixture' } }, context);
  await f.tools.channel_control.execute({ command: command('master.volunteer', { eligible: true }) }, context);
  await delay(50); // Drain the initial read-only role poll before appointment.
  f.permissions.set('b', [{ id: 'permission_role_blocker', sessionID: 'b' }]);
  const proposal = command('master.appoint', { candidate: 'opencode:b' });
  await admin.request('control_command', { command: proposal });
  await f.tools.channel_status.execute({ channel: 'dev', view: 'channel' }, context);
  await delay(100);
  assert.equal(f.calls.filter(c => c.metadata?.kind === 'offer').length, 0, 'role notices must not bypass existing harness blockers');
  f.permissions.set('b', []);
  await f.tools.channel_status.execute({ channel: 'dev', view: 'channel' }, context);
  for (let i = 0; i < 100; i++) { if (f.calls.some(c => c.metadata?.kind === 'offer')) break; await delay(30); }
  const offer = f.calls.find(call => call.metadata?.kind === 'offer');
  assert.ok(offer); assert.match(offer.text, /existing project access remains unchanged/);
  assert.equal(offer.agent, undefined); assert.equal(offer.model, undefined); assert.equal(offer.permissions, undefined);
  assert.equal(offer.resume, true); assert.match(offer.id, /^msg_turnlink_role_/);
  let accepted = false;
  for (let i = 0; i < 100; i++) {
    const events = await admin.request('control_query', { channel: 'dev', view: 'events' });
    if (events.entries.some(e => e.type === 'notice.accepted')) { accepted = true; break; }
    await delay(30);
  }
  assert.ok(accepted);
  await f.tools.channel_control.execute({ command: command('master.accept', { proposalID: proposal.id, promptVersion: 1 }) }, context);
  assert.equal((await admin.request('control_query', { channel: 'dev', view: 'channel' })).channel.active.agentId, 'opencode:b');
  await delay(50);
  await f.tools.channel_status.execute({ channel: 'dev', view: 'channel' }, context);
  await delay(100);
  assert.equal(f.calls.filter(call => call.metadata?.kind === 'offer').length, 1);
  const active = f.calls.find(call => call.metadata?.kind === 'active');
  assert.ok(active); assert.equal(active.resume, false);
  await admin.request('control_command', { command: command('master.revoke') });
  await f.tools.channel_status.execute({ channel: 'dev', view: 'channel' }, context);
  for (let i = 0; i < 100; i++) { if (f.calls.some(c => c.metadata?.kind === 'ended')) break; await delay(30); }
  assert.equal(f.calls.find(c => c.metadata?.kind === 'ended').resume, false);
  f.cleanup();
});
