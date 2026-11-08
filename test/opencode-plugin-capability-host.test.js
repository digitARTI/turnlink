import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createOpenCodePluginCapabilityHost } from '../src/opencode-plugin-capability-host.js';
import { createOpenCodePluginCapabilityClient } from '../src/opencode-plugin-capability-client.js';
import { createOpenCodePluginProcessPort } from '../src/opencode-plugin-process-port.js';
import { tools, controlTools } from '../src/tools.js';

// Node 22 may unref a MessagePort while a close-event promise is pending.
// Keep this test file alive, with a deadline so a real deadlock still fails.
const keepAlive = setInterval(() => {}, 1000);
const keepAliveDeadline = setTimeout(() => clearInterval(keepAlive), 30000);
after(() => { clearInterval(keepAlive); clearTimeout(keepAliveDeadline); });

test('plugin capability host scopes methods to one session and revokes pending responses', async () => {
  const { port1, port2 } = new MessageChannel(), controller = new AbortController(); let release;
  const context = { session: { get: async input => ({ id: input.sessionID }), wait: () => new Promise(resolve => { release = resolve; }),
    context: async () => [] }, permission: { list: async () => [] } };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned', signal: controller.signal });
  const id = randomUUID(), reply = once(port2, 'message'); port2.postMessage({ id, method: 'session.get', sessionID: 'ses_owned' });
  assert.deepEqual((await reply)[0], { id, ok: true, value: { id: 'ses_owned' } });
  port2.postMessage({ id: randomUUID(), method: 'session.wait', sessionID: 'ses_owned' });
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(release); const closed = once(port2, 'close'); controller.abort(); release({ secret: 'must not cross' });
  await closed; host.close(); port2.close();
});

test('plugin capability host closes on unlisted methods and foreign sessions', async () => {
  for (const input of [{ method: 'session.prompt', sessionID: 'ses_owned' }, { method: 'session.get', sessionID: 'ses_other' }]) {
    const { port1, port2 } = new MessageChannel(), context = { session: {}, permission: {} };
    const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned' });
    const closed = once(port2, 'close'); port2.postMessage({ id: randomUUID(), ...input }); await closed; host.close(); port2.close();
  }
});

test('plugin event stream forwards only the bound session and closes on stream loss', async () => {
  const { port1, port2 } = new MessageChannel(); let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  const context = { session: {}, permission: {}, event: { async *subscribe() {
    yield { type: 'session.deleted', data: { sessionID: 'ses_foreign' } };
    yield { type: 'permission.asked', data: { sessionID: 'ses_owned', id: 'p1' } };
    await wait;
  } } };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned' });
  const [message] = await once(port2, 'message');
  assert.deepEqual(message, { sequence: 1, event: { type: 'permission.asked', data: { sessionID: 'ses_owned', id: 'p1' } } });
  port2.postMessage({ method: 'event.ack', sequence: 1 });
  const closed = once(port2, 'close'); finish(); await closed; host.close(); port2.close();
});

test('duplicate in-flight capability requests close the port', async () => {
  const { port1, port2 } = new MessageChannel(), id = randomUUID();
  const context = { session: { wait: () => new Promise(() => {}) }, permission: {} };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned' });
  const closed = once(port2, 'close');
  port2.postMessage({ id, method: 'session.wait', sessionID: 'ses_owned' });
  port2.postMessage({ id, method: 'session.wait', sessionID: 'ses_owned' });
  await closed; host.close(); port2.close();
});

test('membership writes require host authorization and cannot escape the session', async () => {
  const { port1, port2 } = new MessageChannel(), writes = [];
  const context = { session: {}, permission: {}, storage: { get: async () => null, set: async (...args) => writes.push(args), remove: async () => writes.push('removed') } };
  let allowed = false;
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned', authorizeMembership: async () => allowed });
  const value = { sessionID: 'ses_owned', directory: '/synthetic', channel: 'dev', forms: [], taskWatch: false };
  let id = randomUUID(), response = once(port2, 'message'); port2.postMessage({ id, method: 'storage.set', sessionID: 'ses_owned', value });
  assert.deepEqual((await response)[0], { id, ok: false, error: 'PLUGIN_CAPABILITY_UNAVAILABLE' }); assert.equal(writes.length, 0);
  allowed = true; id = randomUUID(); response = once(port2, 'message'); port2.postMessage({ id, method: 'storage.set', sessionID: 'ses_owned', value });
  assert.equal((await response)[0].ok, true); assert.deepEqual(writes[0], ['memberships/ses_owned', value]);
  const closed = once(port2, 'close'); port2.postMessage({ id: randomUUID(), method: 'storage.set', sessionID: 'ses_other', value });
  await closed; assert.equal(writes.length, 1); host.close(); port2.close();
});

test('membership authorization completing after revocation cannot write', async () => {
  const { port1, port2 } = new MessageChannel(), controller = new AbortController(); let release, writes = 0;
  const context = { session: {}, permission: {}, storage: { set: async () => { writes++; } } };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned', signal: controller.signal,
    authorizeMembership: () => new Promise(resolve => { release = resolve; }) });
  port2.postMessage({ id: randomUUID(), method: 'storage.set', sessionID: 'ses_owned', value: { sessionID: 'ses_owned', directory: '/synthetic', forms: [], taskWatch: false } });
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(release); const closed = once(port2, 'close'); controller.abort(); release(true); await closed;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(writes, 0); host.close(); port2.close();
});

test('capability client uses the scoped host and rejects operations after disconnect', async () => {
  const { port1, port2 } = new MessageChannel(); let release;
  const context = { session: { get: async ({ sessionID }) => ({ id: sessionID }), wait: () => new Promise(resolve => { release = resolve; }),
    context: async () => [] }, permission: { list: async () => [] }, storage: { get: async () => undefined } };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned' });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  assert.deepEqual(await client.session.get({ sessionID: 'ses_owned' }), { id: 'ses_owned' });
  assert.throws(() => client.session.get({ sessionID: 'ses_other' }), /PLUGIN_CAPABILITY_UNAVAILABLE/);
  assert.equal(await client.storage.get('memberships/ses_owned'), undefined);
  const waiting = client.session.wait({ sessionID: 'ses_owned' });
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(release); host.close(); await assert.rejects(waiting, /PLUGIN_CAPABILITY_UNAVAILABLE/); release(); client.close();
});

test('maintenance pauses before the host drains activity and resumes only after release', async () => {
  const { port1, port2 } = new MessageChannel(); let finish, paused = false;
  const host = createOpenCodePluginCapabilityHost({ port: port1, sessionID: 'ses_owned', activityEvidence: () => true,
    context: { session: { wait: () => new Promise(resolve => { finish = resolve; }) }, permission: {} } });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  client.maintenance.register({ pause: () => { paused = true; }, resume: () => { paused = false; } });
  const pending = client.session.wait({ sessionID: 'ses_owned' });
  while (!finish) await new Promise(resolve => setTimeout(resolve, 2));
  await host.pauseMaintenance(); assert.equal(paused, true);
  let acquired = false;
  const acquiring = host.drainAndHoldActivity().then(hold => { acquired = true; return hold; });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(acquired, false);
  finish({}); await pending;
  const hold = await acquiring; assert.equal(hold.check(), true);
  await assert.rejects(host.resumeMaintenance(), /PLUGIN_CAPABILITY_UNAVAILABLE/);
  hold.release(); await host.resumeMaintenance(); assert.equal(paused, false);
  host.close(); client.close();
});

test('disconnect while draining revokes the pending hold', async () => {
  const { port1, port2 } = new MessageChannel(); let finish;
  const host = createOpenCodePluginCapabilityHost({ port: port1, sessionID: 'ses_owned', activityEvidence: () => true,
    context: { session: { wait: () => new Promise(resolve => { finish = resolve; }) }, permission: {} } });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  client.maintenance.register({ pause: () => {}, resume: () => {} });
  const pending = client.session.wait({ sessionID: 'ses_owned' }).catch(() => {});
  while (!finish) await new Promise(resolve => setTimeout(resolve, 2));
  await host.pauseMaintenance();
  const acquiring = host.drainAndHoldActivity();
  client.close();
  await assert.rejects(acquiring, /PLUGIN_ACTIVITY_UNAVAILABLE/);
  finish({}); await pending; host.close();
});

test('capabilities work over a child-process channel and revoke on child death', async () => {
  const child = fork('test/fixtures/opencode-capability-child.js', [], { stdio: ['ignore', 'pipe', 'ignore', 'ipc'] });
  let release, aborted = false;
  const context = { session: { get: async ({ sessionID }) => ({ id: sessionID }), wait: (_input, { signal }) => new Promise(resolve => {
    release = resolve; signal.addEventListener('abort', () => { aborted = true; }, { once: true });
  }), context: async () => [] }, permission: { list: async () => [] } };
  const port = createOpenCodePluginProcessPort(child), host = createOpenCodePluginCapabilityHost({ port, context, sessionID: 'ses_child' });
  const lines = createInterface({ input: child.stdout }), [line] = await once(lines, 'line'); assert.equal(line, 'ready');
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(release); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  for (let i = 0; i < 100 && !aborted; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(aborted, true); release(); host.close(); lines.close();
});

test('prompt admission stays disabled without trusted owner and checks the returned receipt', async () => {
  const input = { sessionID: 'ses_owned', id: 'msg_test', text: 'synthetic', delivery: 'queue', resume: true, metadata: { source: 'turnlink' } };
  for (const admitted of [undefined, async () => ({ id: 'wrong', sessionID: 'ses_owned' }), async () => ({ id: input.id, sessionID: input.sessionID })]) {
    const { port1, port2 } = new MessageChannel();
    const host = createOpenCodePluginCapabilityHost({ port: port1, context: { session: {}, permission: {} }, sessionID: input.sessionID, admitPrompt: admitted });
    const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: input.sessionID });
    if (admitted && (await admitted()).id === input.id) assert.deepEqual(await client.session.prompt(input), { id: input.id, sessionID: input.sessionID });
    else await assert.rejects(client.session.prompt(input), /PLUGIN_CAPABILITY_UNAVAILABLE/);
    client.close(); host.close();
  }
});

test('tool bridge registers only owner-defined tools and binds invocation to native session', async () => {
  const { port1, port2 } = new MessageChannel(), exposed = new Map();
  const context = { session: {}, permission: {}, tool: { transform: async fn => fn({ add: tool => exposed.set(tool.name, tool) }) } };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned', allowTools: true });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  await client.tool.transform(editor => {
    for (const definition of tools.filter(tool => tool.name !== 'channel_ack')) editor.add({ name: definition.name,
      execute: async (args, native) => ({ content: JSON.stringify({ args, sessionID: native.sessionID }) }) });
  });
  const joined = await exposed.get('channel_join').execute({ channel: 'dev' }, { sessionID: 'ses_owned' });
  assert.deepEqual(JSON.parse(joined.content), { args: { channel: 'dev' }, sessionID: 'ses_owned' });
  await assert.rejects(exposed.get('channel_join').execute({}, { sessionID: 'ses_foreign' }), /PLUGIN_CAPABILITY_UNAVAILABLE/);
  await assert.rejects(client.tool.transform(() => {}), /PLUGIN_CAPABILITY_UNAVAILABLE/);
  host.close(); await assert.rejects(exposed.get('channel_join').execute({}, { sessionID: 'ses_owned' }), /PLUGIN_CAPABILITY_UNAVAILABLE/); client.close();
});

test('revocation rejects an in-flight prompt and suppresses its late receipt', async () => {
  const { port1, port2 } = new MessageChannel(), controller = new AbortController(); let release, aborted = false;
  const host = createOpenCodePluginCapabilityHost({ port: port1, context: { session: {}, permission: {} }, sessionID: 'ses_owned', signal: controller.signal,
    admitPrompt: (_input, signal) => new Promise(resolve => { release = resolve; signal.addEventListener('abort', () => { aborted = true; }, { once: true }); }) });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  const pending = client.session.prompt({ sessionID: 'ses_owned', id: 'msg_test', text: 'synthetic', delivery: 'queue', resume: true, metadata: {} });
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(release); controller.abort(); await assert.rejects(pending, /PLUGIN_CAPABILITY_UNAVAILABLE/);
  release({ id: 'msg_test', sessionID: 'ses_owned' }); assert.equal(aborted, true); client.close(); host.close();
});

test('control tools require separate explicit opt-in', async () => {
  for (const allowControlTools of [false, true]) {
    const { port1, port2 } = new MessageChannel(), exposed = new Map();
    const host = createOpenCodePluginCapabilityHost({ port: port1, context: { session: {}, permission: {},
      tool: { transform: async fn => fn({ add: tool => exposed.set(tool.name, tool) }) } }, sessionID: 'ses_owned', allowTools: true, allowControlTools });
    const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
    const registration = client.tool.transform(editor => {
      for (const tool of [...tools, ...controlTools].filter(tool => tool.name !== 'channel_ack')) editor.add({ name: tool.name, execute: async () => ({ content: '{}' }) });
    });
    if (allowControlTools) { await registration; assert.ok(exposed.has('channel_control')); }
    else { await assert.rejects(registration, /PLUGIN_CAPABILITY_UNAVAILABLE/); assert.equal(exposed.size, 0); }
    client.close(); host.close();
  }
});

test('activity hold requires independent evidence and invalidates on attempted activity', async () => {
  const { port1, port2 } = new MessageChannel(), context = { session: { get: async () => ({}) }, permission: {} };
  let evidence = true;
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned', activityEvidence: () => evidence });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  let hold = host.holdActivity(); assert.equal(hold.check(), true);
  await assert.rejects(client.session.get({ sessionID: 'ses_owned' }), /PLUGIN_CAPABILITY_UNAVAILABLE/);
  assert.equal(hold.check(), false); hold.release();
  evidence = false; assert.throws(() => host.holdActivity(), /PLUGIN_ACTIVITY_UNAVAILABLE/);
  evidence = true; hold = host.holdActivity(); assert.equal(hold.check(), true); host.close(); assert.equal(hold.check(), false); client.close();
});

test('aborting an in-flight native tool closes the capability channel', async () => {
  const { port1, port2 } = new MessageChannel(), exposed = new Map(), started = new AbortController(); let invoked;
  const context = { session: {}, permission: {}, tool: { transform: async fn => fn({ add: tool => exposed.set(tool.name, tool) }) } };
  const host = createOpenCodePluginCapabilityHost({ port: port1, context, sessionID: 'ses_owned', allowTools: true });
  const client = createOpenCodePluginCapabilityClient({ port: port2, sessionID: 'ses_owned' });
  await client.tool.transform(editor => {
    for (const tool of tools.filter(tool => tool.name !== 'channel_ack')) editor.add({ name: tool.name, execute: async (_args, native) => {
      invoked = native; return new Promise(() => {});
    } });
  });
  const pending = exposed.get('channel_join').execute({}, { sessionID: 'ses_owned', signal: started.signal });
  for (let i = 0; i < 100 && !invoked; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(invoked); started.abort(); await assert.rejects(pending, /PLUGIN_CAPABILITY_UNAVAILABLE/);
  for (let i = 0; i < 100 && !invoked.signal.aborted; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(invoked.signal.aborted, true); client.close(); host.close();
});
