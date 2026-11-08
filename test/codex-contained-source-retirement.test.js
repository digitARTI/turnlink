import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, promises as fs, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { Duplex } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { privateTemp } from '../src/storage.js';
import { digest, receiverHandoffKey } from '../src/config.js';
import { CodexContainedMcp } from '../src/codex-contained-mcp.js';
import { retireRestoredCapturedSource } from '../src/codex-contained-mcp-recovery.js';
import { makeContainedSourceRetirement } from '../src/control/contained-source-retirement-contracts.js';
import { createCodexRetiredEffectVerifier } from '../src/codex-retired-effect-verifier.js';
import { WorktreeTransition } from '../src/control/contracts.js';
import { createCodexContainedOwner, inspectCodexContainedOwner } from '../src/codex-contained-owner.js';
import { attachCodexBrokerGrantBridge } from '../src/codex-broker-grant-bridge.js';
import { attachCodexMcpAttemptOwner } from '../src/codex-mcp-attempt-owner.js';
import { acceptCodexVmAttemptCapability } from '../src/codex-vm-capability-channel.js';

function fixture(t, owner, identity, root) {
  const agentId = `codex:${randomUUID()}`, transitionID = randomUUID(), mcpTransitionID = randomUUID(), stepID = randomUUID(), operationID = randomUUID(), shutdownID = randomUUID(), modelShutdownID = randomUUID();
  const sourceRetirement = makeContainedSourceRetirement([{ names: ['fixture'], ...identity }]);
  const grant = { id: transitionID, channel: 'dev', taskID: randomUUID(), agentId, previewID: randomUUID(), claimGeneration: 1,
    from: '/source', to: '/destination', configurationDigest: 'c'.repeat(64), authorityDigest: 'd'.repeat(64), status: 'prepared', preparedAt: 1000,
    sourceMcpShutdown: true, sourceModelShutdown: true, sourceRetirement, destinationOwners: { mcpTransitionID, providerTransitionID: randomUUID(),
      mcpResourceID: randomUUID(), providerResourceID: randomUUID(), stepID } };
  const { daemonID: _daemon, ...saved } = identity;
  const records = [{ transitionID: mcpTransitionID, plan: { reservation: { generation: randomUUID(), revision: 1 } }, step: { receipt: { stepID },
    movement: { phase: 'bound', grant, publication: { phase: 'observed', operationID, contained: [{ names: ['fixture'], ...saved }],
      sourceShutdown: { phase: 'observed', shutdownID, receipt: { shutdownID, operationID, transitionID, stepID, status: 'closed_local' } },
      sourceModelShutdown: { phase: 'observed', shutdownID: modelShutdownID, receipt: { shutdownID: modelShutdownID, operationID, transitionID, stepID, status: 'closed_local' } } } } } }];
  const journal = { agentId, hostId: 'local', snapshot: () => structuredClone(records), entries: () => structuredClone(records), exclusive: async fn => fn() };
  const client = Object.assign(new EventEmitter(), { hostId: 'local', receiverKeys: new Map(), subscriptions: new Set([agentId]), activeSubscriptions: new Set([agentId]) });
  const credentialDirectory = join(root, 'keys'); client.receiverKeys.set(agentId, receiverHandoffKey('local', agentId, transitionID, credentialDirectory, true));
  let detached = true, allow = true;
  client.request = async (method, params) => {
    if (!allow) throw Error('grant revoked');
    return method === 'control_worktree_authorize' ? { checkedAt: 1001, grant } : { status: 'held', transitionID: params.transitionID, sourceDetached: detached };
  };
  const native = { usesClient: value => value === client, onClose() { return () => {}; },
    async observeRestoredPublicationExact(_thread, reservation, ids) { return { reservation, ...ids, historicalStatus: 'installed', snapshotObserved: true }; },
    async observeRestoredSourceShutdown(_thread, ids) { return { ...ids, historicalStatus: 'closed' }; },
    async observeRestoredSourceModelShutdown(_thread, ids) { return { ...ids, historicalStatus: 'closed' }; } };
  const args = { client, native, journal, agentId, mcpTransitionID, credentialDirectory, credential: async () => '3'.repeat(64),
    owners: [{ resourceID: identity.resourceID, owner }], signal: new AbortController().signal, guard() {} };
  return { args, records, grant, setDetached(value) { detached = value; }, revoke() { allow = false; } };
}

test('single owner accepts revocation while asynchronous intent I/O is stalled', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-owner-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  let entered, resume; const stalled = new Promise(resolve => { entered = resolve; }), wait = new Promise(resolve => { resume = resolve; });
  const options = { directory: join(root, 'owner-data'), grant, effectID: randomUUID(), resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() };
  assert.throws(() => createCodexContainedOwner({ ...options, expectedUID: process.geteuid() + 1 }), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  const owner = createCodexContainedOwner({ ...options, async writeIntent(path, data) { entered(); await wait; await fs.writeFile(path, data, { mode: 0o600 }); } });
  owner.attachGuard(() => true);
  const pending = assert.rejects(owner.prepare(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/); await stalled;
  const revocation = owner.revoke(); assert.equal(owner.snapshot().revoked, true);
  assert.deepEqual(await Promise.race([revocation, delay(1500).then(() => { throw Error('revocation waited for stalled I/O'); })]), { revoked: true, durable: true });
  assert.equal(owner.snapshot().dispatchAvailable, false); await assert.rejects(owner.prepare(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  resume(); await pending;
  const recovered = inspectCodexContainedOwner(options.directory); assert.equal(recovered.revoked, true);
  assert.equal(recovered.intent.containerID, item.containerID); assert.equal(recovered.intent.daemonID, item.daemonID);
  owner.close(); assert.throws(() => createCodexContainedOwner(options), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
});

test('owner crash retains its revocation and excludes automatic takeover', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-owner-crash-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  const options = { directory: join(root, 'owner-data'), grant, effectID: randomUUID(), resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() };
  const module = pathToFileURL(resolve('src/codex-contained-owner.js')).href;
  const script = `import { createCodexContainedOwner } from ${JSON.stringify(module)};
    const options = JSON.parse(process.argv[1]);
    const owner = createCodexContainedOwner({ ...options, writeIntent: async () => { process.send({ type: 'stalled' }); await new Promise(() => {}); } });
    owner.attachGuard(() => true);
    owner.prepare().catch(() => {}); process.on('message', async () => { await owner.revoke(); process.send({ type: 'revoked' }); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(options)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  assert.equal((await once(child, 'message'))[0].type, 'stalled');
  const revoked = once(child, 'message'); child.send({ type: 'revoke' }); assert.equal((await revoked)[0].type, 'revoked');
  child.kill('SIGKILL'); await exited;
  assert.deepEqual(inspectCodexContainedOwner(options.directory), { intent: null, revoked: true, dispatchAvailable: false });
  assert.equal(existsSync(join(options.directory, 'owner')), true);
  assert.throws(() => createCodexContainedOwner(options), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
});

test('failed revocation persistence keeps the owner latched and prevents takeover', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-owner-fault-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  const options = { directory: join(root, 'owner-data'), grant, effectID: randomUUID(), resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() };
  const owner = createCodexContainedOwner({ ...options, async writeRevocation() { throw new Error('injected I/O failure'); } });
  owner.attachGuard(() => true);
  await assert.rejects(owner.revoke(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  assert.equal(owner.snapshot().revoked, true); assert.equal(owner.snapshot().faulted, true);
  await assert.rejects(owner.prepare(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  assert.throws(() => owner.close(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  assert.throws(() => createCodexContainedOwner(options), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
});

test('successor refuses a removed tombstone on the wrong Docker daemon without running an effect', async t => {
  const root = privateTemp('/private/tmp/turnlink-retired-daemon-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'expected-daemon' };
  const command = ['server'], image = `sha256:${'b'.repeat(64)}`, docker = join(root, 'docker'), calls = join(root, 'calls');
  writeFileSync(docker, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${calls}'\nif [ "$1" = context ]; then printf 'unix:///tmp/fake.sock\\n'; elif [ "$1" = info ]; then printf 'wrong-daemon\\n'; else exit 1; fi\n`, { mode: 0o700 });
  const commandDigest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  writeFileSync(join(root, `${identity.resourceID}.json`), JSON.stringify({ version: 1, ...identity, image, commandDigest,
    name: `turnlink-mcp-${identity.operationID}`, phase: 'removed' }), { mode: 0o600 });
  const owner = new CodexContainedMcp({ directory: root, docker, spec: { resourceID: identity.resourceID, image, command } });
  const f = fixture(t, owner, identity, root), effectID = randomUUID(), ownerProof = '5'.repeat(64);
  const verifier = createCodexRetiredEffectVerifier({ grant: f.grant, effectID, resourceID: identity.resourceID, owner, ownerProof, guard() {} });
  const fence = { effectID, kind: 'remove', resourceID: identity.resourceID, transitionID: f.grant.id,
    grantDigest: digest(JSON.stringify(WorktreeTransition.parse(f.grant))), ownerProofHash: digest(ownerProof), receiverHash: '6'.repeat(64) };
  await assert.rejects(verifier.verify({ phase: 'finish', fence, ownerProof, signal: new AbortController().signal }));
  const observedCalls = readFileSync(calls, 'utf8').trim().split('\n');
  assert.equal(observedCalls.at(-1), 'info'); assert.ok(observedCalls.every(value => ['context', 'info'].includes(value)));
  await assert.rejects(verifier.verify({ phase: 'finish', fence: { ...fence, kind: 'stop' }, ownerProof, signal: new AbortController().signal }));
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), observedCalls);
  const tombstonePath = join(root, `${identity.resourceID}.json`), changed = JSON.parse(readFileSync(tombstonePath, 'utf8'));
  changed.containerID = 'c'.repeat(64); writeFileSync(tombstonePath, JSON.stringify(changed), { mode: 0o600 });
  await assert.rejects(verifier.verify({ phase: 'finish', fence, ownerProof, signal: new AbortController().signal }));
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), observedCalls);
});

test('source retirement requires exact approval and detached held receiver before an effect', async t => {
  const root = privateTemp('/private/tmp/turnlink-retirement-authority-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const owner = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: identity.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  let stops = 0; owner.stopExact = async () => { stops++; throw Error('must not stop'); };
  const f = fixture(t, owner, identity, root);
  const approved = structuredClone(f.grant.sourceRetirement);
  delete f.records[0].step.movement.grant.sourceRetirement;
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/); assert.equal(stops, 0);
  f.records[0].step.movement.grant.sourceRetirement = approved;
  f.records[0].step.movement.publication.contained[0].containerID = 'f'.repeat(64);
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/); assert.equal(stops, 0);
  f.records[0].step.movement.publication.contained[0].containerID = identity.containerID;
  f.setDetached(false);
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/); assert.equal(stops, 0);
  f.setDetached(true); f.revoke();
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/); assert.equal(stops, 0);
});

test('legacy source retirement refuses a v2 grant before dispatching any effect', async t => {
  const root = privateTemp('/private/tmp/turnlink-retirement-v2-refusal-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const owner = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: identity.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  let stops = 0, removals = 0;
  owner.stopExact = async () => { stops++; return { status: 'stopped_local' }; };
  owner.retireExact = async () => { removals++; return { status: 'removed_local' }; };
  const f = fixture(t, owner, identity, root);
  f.grant.sourceRetirement = makeContainedSourceRetirement([{ names: ['fixture'], ...identity }], { permitAdmittedEffectAfterNativeLoss: true });
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  assert.equal(stops, 0); assert.equal(removals, 0);
});

test('source retirement retries only rate-limited reads and does not retry an effect', async t => {
  const root = privateTemp('/private/tmp/turnlink-retirement-retry-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const owner = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: identity.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  let stops = 0, removals = 0;
  owner.stopExact = async () => { stops++; return { status: 'stopped_local' }; };
  owner.retireExact = async () => { removals++; throw Error('ambiguous effect'); };
  const f = fixture(t, owner, identity, root), request = f.args.client.request;
  let rejected = false;
  f.args.client.request = async (...args) => {
    if (!rejected) { rejected = true; throw Object.assign(new Error('rate limited'), { code: 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' }); }
    return request(...args);
  };
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  assert.equal(rejected, true); assert.equal(stops, 1); assert.equal(removals, 1);
});

test('revocation during an in-flight stop prevents a subsequent remove', async t => {
  const root = privateTemp('/private/tmp/turnlink-retirement-revocation-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const owner = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: identity.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  let entered, unblock, removals = 0;
  const dispatched = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { unblock = resolve; });
  owner.stopExact = async () => { entered(); await blocked; return { status: 'stopped_local' }; };
  owner.retireExact = async () => { removals++; return { status: 'removed_local' }; };
  const f = fixture(t, owner, identity, root);
  const result = retireRestoredCapturedSource(f.args); await dispatched;
  f.revoke(); unblock();
  await assert.rejects(result, /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  assert.equal(removals, 0, 'revoked authorization must not dispatch the next effect');
});

test('real contained owner recovers a lost removal reply without a second remove', { skip: process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE !== '1', timeout: 90000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-retirement-real-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const docker = '/opt/homebrew/bin/docker', image = execFileSync(docker, ['image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
  const shim = join(root, 'docker'), lost = join(root, 'lost'), count = join(root, 'removals');
  writeFileSync(shim, `#!/bin/sh\nif [ "$1" = rm ]; then echo rm >> '${count}'; if [ ! -e '${lost}' ]; then '${docker}' "$@" >/dev/null || exit $?; touch '${lost}'; exit 1; fi; fi\nexec '${docker}' "$@"\n`, { mode: 0o700 });
  const resourceID = randomUUID(), operationID = randomUUID(), spec = { resourceID, image, command: ['sh'] };
  const owner = new CodexContainedMcp({ directory: root, docker: shim, spec, operationID, wrapperPID: process.pid });
  const created = await owner.create(); t.after(() => { try { execFileSync(docker, ['rm', '--force', created.containerID], { stdio: 'ignore' }); } catch {} });
  const run = await owner.start(); t.after(() => { run.child.kill('SIGKILL'); });
  let state;
  for (let i = 0; i < 100; i++) { state = await owner.observe(); if (state.running) break; await delay(50); }
  assert.equal(state.running, true);
  const identity = { resourceID, operationID, containerID: created.containerID, wrapperPID: process.pid,
    daemonID: execFileSync(docker, ['info', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim() };
  const f = fixture(t, owner, identity, root);
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  assert.equal(existsSync(lost), true); assert.equal(readFileSync(count, 'utf8'), 'rm\n');
  assert.equal(JSON.parse(readFileSync(join(root, `${resourceID}.json`))).phase, 'removing');
  const observation = await retireRestoredCapturedSource(f.args);
  try { assert.equal(await observation.revalidate(), true); assert.equal(readFileSync(count, 'utf8'), 'rm\n'); }
  finally { observation.release(); }
});

test('owner crash after removal intent before effect keeps the existing container fenced', { skip: process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE !== '1', timeout: 90000 }, async t => {
  const root = privateTemp('/private/tmp/turnlink-retirement-crash-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const docker = '/opt/homebrew/bin/docker', image = execFileSync(docker, ['image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
  const shim = join(root, 'docker'), entered = join(root, 'entered'), count = join(root, 'removals');
  writeFileSync(shim, `#!/bin/sh\nif [ "$1" = rm ]; then echo rm >> '${count}'; touch '${entered}'; sleep 60; fi\nexec '${docker}' "$@"\n`, { mode: 0o700 });
  const resourceID = randomUUID(), operationID = randomUUID(), spec = { resourceID, image, command: ['sh'] };
  const owner = new CodexContainedMcp({ directory: root, docker: shim, spec, operationID, wrapperPID: process.pid });
  const created = await owner.create(); t.after(() => { try { execFileSync(docker, ['rm', '--force', created.containerID], { stdio: 'ignore' }); } catch {} });
  const identity = { resourceID, operationID, containerID: created.containerID, wrapperPID: process.pid,
    daemonID: execFileSync(docker, ['info', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim() };
  const module = pathToFileURL(join(process.cwd(), 'src/codex-contained-mcp.js')).href;
  const script = `import { CodexContainedMcp } from ${JSON.stringify(module)}; const v = JSON.parse(process.argv[1]); await new CodexContainedMcp(v.options).retireExact(v.identity);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ options: { directory: root, docker: shim, spec }, identity })],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
  const closed = once(child, 'close');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } await closed.catch(() => {}); });
  for (let i = 0; i < 200 && !existsSync(entered) && child.exitCode === null; i++) await delay(50);
  assert.ok(existsSync(entered), 'removal intent was not dispatched to the fixture wrapper');
  assert.equal(JSON.parse(readFileSync(join(root, `${resourceID}.json`))).phase, 'removing');
  process.kill(-child.pid, 'SIGKILL'); await closed;
  if (process.env.TURNLINK_RETIRE_NATURAL_LOCK !== '1') {
    // Only after the writer is known dead, age this fixture lock to avoid a
    // minute-long stale-lock wait in the default crash regression.
    const old = new Date(Date.now() - 120000); utimesSync(join(root, `${resourceID}.writer.lock`), old, old);
  }
  let reconciled = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { await owner.stopExact(identity); assert.fail('ambiguous removal must remain fenced'); }
    catch (error) {
      if (error?.code === 'ELOCKED') { await delay(500); continue; }
      assert.match(error.message, /CONTAINED_MCP_UNCERTAIN/); reconciled = true; break;
    }
  }
  assert.equal(reconciled, true, 'fixture lock did not expire');
  const f = fixture(t, owner, identity, root);
  await assert.rejects(retireRestoredCapturedSource(f.args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  assert.equal(readFileSync(count, 'utf8'), 'rm\n');
  assert.equal(execFileSync(docker, ['inspect', '--format', '{{.State.Status}}', created.containerID], { encoding: 'utf8' }).trim(), 'created');
});

test('broker observation rejects foreign scope and invalidates all retained readers synchronously', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-broker-lease-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  const effectID = randomUUID(), request = { grant, effectID, resourceID: item.resourceID, kind: 'remove' };
  const owner = createCodexContainedOwner({ directory: join(root, 'owner-data'), ...request, expectedUID: process.geteuid() });
  assert.throws(() => owner.acquireBrokerObservation(request), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  owner.attachGuard(() => true);
  assert.throws(() => owner.acquireBrokerObservation({ ...request, effectID: randomUUID() }), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  const first = owner.acquireBrokerObservation(request), second = owner.acquireBrokerObservation(request);
  const additional = Array.from({ length: 62 }, () => owner.acquireBrokerObservation(request));
  assert.throws(() => owner.acquireBrokerObservation(request), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  additional.pop().release(); const replacement = owner.acquireBrokerObservation(request);
  let invalidations = 0; first.onInvalidate(() => invalidations++); second.onInvalidate(() => invalidations++);
  assert.equal(first.check(), true); assert.equal(second.dispatchAvailable, false);
  const pending = owner.revoke();
  assert.equal(invalidations, 2); assert.throws(() => first.check(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  assert.throws(() => second.check(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  for (const lease of [...additional, replacement]) assert.throws(() => lease.check(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  await pending; owner.close();
});

test('broker observation crosses an inherited private descriptor and invalidates on revocation', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-broker-inherited-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  const effectID = randomUUID(), owner = createCodexContainedOwner({ directory: join(root, 'owner-data'), grant, effectID,
    resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() });
  owner.attachGuard(() => true);
  const script = `import net from 'node:net';
    const stream = new net.Socket({fd:3,readable:true,writable:true}); let buffer='';
    process.on('message', request => stream.write(JSON.stringify(request)+'\\n'));
    stream.on('data', data => { buffer+=data; for (;;) { const i=buffer.indexOf('\\n'); if(i<0) break;
      const message=JSON.parse(buffer.slice(0,i)); buffer=buffer.slice(i+1); if(message.type!=='heartbeat') process.send(message); } });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited.catch(() => {}); });
  const bridge = attachCodexBrokerGrantBridge({ stream: child.stdio[3], owner, grant, effectID, resourceID: item.resourceID, kind: 'remove' });
  const id = randomUUID(), active = once(child, 'message');
  child.send({ type: 'subscribe', id, digest: createHash('sha256').update(JSON.stringify(WorktreeTransition.parse(grant))).digest('hex'), transition: grant.id,
    effect: effectID, resource: item.resourceID, kind: 'remove' });
  assert.deepEqual((await active)[0], { type: 'active', id });
  const invalidated = once(child, 'message'); await owner.revoke();
  assert.deepEqual((await invalidated)[0], { type: 'invalidated', id });
  bridge.close(); owner.close();
});

test('attempt owner persists a grant-scoped record before acknowledging and revokes its channel', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-mcp-attempt-'); const children = [];
  t.after(async () => { for (const { child, exited } of children) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited.catch(() => {}); }
    rmSync(root, { recursive: true, force: true }); });
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  const effectID = randomUUID(), owner = createCodexContainedOwner({ directory: join(root, 'owner'), grant, effectID, resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() });
  owner.attachGuard(() => true);
  const script = String.raw`import net from 'node:net'; const s=new net.Socket({fd:3,readable:true,writable:true});
    process.on('message', m=>s.write(JSON.stringify(m)+'\n')); s.on('data', data=>process.send(JSON.parse(data))); s.on('close',()=>process.exit(0));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); children.push({ child, exited });
  const recorder = attachCodexMcpAttemptOwner({ stream: child.stdio[3], directory: join(root, 'attempts'), owner, grant, effectID, resourceID: item.resourceID, kind: 'remove' });
  const ack = once(child, 'message'); child.send({ version: 1, scope: recorder.scope, sequence: 1, toolSha256: 'f'.repeat(64) });
  assert.equal((await ack)[0].status, 'recorded');
  const snapshot = recorder.observe(); assert.equal(snapshot.inventory, 'partial'); assert.equal(snapshot.releaseAllowed, false);
  assert.equal(snapshot.attempts.length, 1); assert.equal(snapshot.attempts[0].status, 'uncertain');
  recorder.close(); await exited;
  const successor = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'ipc'] });
  const successorExit = once(successor, 'exit'); children.push({ child: successor, exited: successorExit });
  const recovery = attachCodexMcpAttemptOwner({ stream: successor.stdio[3], directory: join(root, 'attempts'), owner, grant, effectID, resourceID: item.resourceID, kind: 'remove' });
  assert.deepEqual(recovery.observe().attempts, snapshot.attempts);
  const bad = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'ipc'] });
  const badExit = once(bad, 'exit'); children.push({ child: bad, exited: badExit });
  const badRecorder = attachCodexMcpAttemptOwner({ stream: bad.stdio[3], directory: join(root, 'bad-attempts'), owner, grant, effectID, resourceID: item.resourceID, kind: 'remove' });
  bad.send({ version: 1, scope: '0'.repeat(64), sequence: 1, toolSha256: 'f'.repeat(64) }); await badExit;
  assert.throws(() => badRecorder.observe(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/);
  assert.equal(existsSync(join(root, 'bad-attempts', 'attempt-0000')), false);
  await owner.revoke(); await successorExit; assert.throws(() => recovery.observe(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/); owner.close();
});

test('VM capability challenge gates the scoped attempt stream and revocation closes it', { skip: typeof process.geteuid !== 'function' }, async t => {
  const root = privateTemp('/private/tmp/turnlink-vm-capability-'); const children = [];
  t.after(async () => { for (const { child, exited } of children) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited.catch(() => {}); }
    rmSync(root, { recursive: true, force: true }); });
  const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
  const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
  const effectID = randomUUID(), owner = createCodexContainedOwner({ directory: join(root, 'owner'), grant, effectID, resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() });
  owner.attachGuard(() => true);
  const script = String.raw`import net from 'node:net'; import {createHmac} from 'node:crypto';
const s=new net.Socket({fd:3,readable:true,writable:true});let b='',challenge='';s.on('data',chunk=>{b+=chunk;for(;;){let i=b.indexOf('\n');if(i<0)break;let m=JSON.parse(b.slice(0,i));b=b.slice(i+1);
if(m.type==='challenge'){challenge=m.challenge;const tag=createHmac('sha256',Buffer.from('22'.repeat(32),'hex')).update('turnlink-vm-attempt-v1\0'+m.scope+'\0'+challenge).digest('hex');s.write(JSON.stringify({version:1,type:'authenticate',scope:m.scope,tag})+'\n')}
else if(m.type==='ready'){const tag=createHmac('sha256',Buffer.from('22'.repeat(32),'hex')).update('turnlink-vm-attempt-ready-v1\0'+m.scope+'\0'+challenge).digest('hex');if(m.tag!==tag)process.exit(2);s.write(JSON.stringify({version:1,scope:m.scope,sequence:1,toolSha256:'f'.repeat(64)})+'\n')}else process.send(m)}});s.on('close',()=>process.exit(0));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = once(child, 'exit'); children.push({ child, exited }); let recorder;
  acceptCodexVmAttemptCapability({ stream: child.stdio[3], key: Buffer.from('22'.repeat(32), 'hex'), grant, owner, directory: join(root, 'attempts'),
    effectID, resourceID: item.resourceID, kind: 'remove', lifetimeMs: 10000, onReady(value) { recorder = value; } });
  const [ack] = await once(child, 'message'); assert.equal(ack.status, 'recorded');
  assert.equal(recorder.observe().attempts.length, 1); assert.equal(recorder.observe().releaseAllowed, false);
  const bad = spawn(process.execPath, ['--input-type=module', '-e', script.replace("'22'.repeat(32)", "'33'.repeat(32)")], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'ipc'] });
  const badExit = once(bad, 'exit'); children.push({ child: bad, exited: badExit }); let accepted = false;
  acceptCodexVmAttemptCapability({ stream: bad.stdio[3], key: Buffer.from('22'.repeat(32), 'hex'), grant, owner, directory: join(root, 'bad-attempts'),
    effectID, resourceID: item.resourceID, kind: 'remove', lifetimeMs: 10000, onReady() { accepted = true; } });
  await badExit; assert.equal(accepted, false); assert.equal(existsSync(join(root, 'bad-attempts')), false);
  await owner.revoke(); await exited; assert.throws(() => recorder.observe(), /CODEX_CONTAINED_OWNER_UNAVAILABLE/); owner.close();
});

test('a disposable guest submits an authenticated scoped attempt over vsock',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_VM_ATTEMPT_VSOCK !== '1', timeout: 120000 }, async t => {
    const root = privateTemp('/private/tmp/turnlink-vsock-attempt-'); let child, exited;
    t.after(async () => { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); if (exited) await exited.catch(() => {}); rmSync(root, { recursive: true, force: true }); });
    const run = (command, args, options = {}) => { const out = spawnSync(command, args, { encoding: 'buffer', timeout: 60000, maxBuffer: 24 * 1024 * 1024, ...options });
      assert.equal(out.status, 0, String(out.stderr)); return out.stdout; };
    const archive = join(root, 'alpine.tar'), layer = join(root, 'layer.tar'), guest = join(root, 'guest');
    run('/opt/homebrew/bin/docker', ['image', 'save', '--output', archive, 'alpine:3.21']);
    const manifest = JSON.parse(run('/usr/bin/tar', ['-xOf', archive, 'manifest.json']).toString());
    assert.equal(manifest.length, 1); assert.equal(manifest[0].Layers.length, 1); assert.match(manifest[0].Layers[0], /^blobs\/sha256\/[a-f0-9]{64}$/);
    writeFileSync(layer, run('/usr/bin/tar', ['-xOf', archive, manifest[0].Layers[0]]), { mode: 0o600 });
    for (const name of ['bin', 'lib', 'dev', 'proc', 'sys', 'tmp']) mkdirSync(join(guest, name), { recursive: true, mode: 0o700 });
    run('/usr/bin/tar', ['--no-same-owner', '-xf', layer, '-C', guest, 'bin/busybox', 'lib/ld-musl-aarch64.so.1', 'lib/libc.musl-aarch64.so.1']);
    run('/opt/homebrew/bin/go', ['build', '-o', join(guest, 'attempt'), resolve('test/fixtures/codex-vm-attempt-guest.go')],
      { env: { PATH: '/usr/bin:/bin', HOME: root, GOCACHE: join(root, 'go-cache'), GOOS: 'linux', GOARCH: 'arm64', CGO_ENABLED: '0' } });
    const nativeExecutable = process.env.TURNLINK_VM_ATTEMPT_NATIVE_EXECUTABLE, nativeSHA = process.env.TURNLINK_VM_ATTEMPT_NATIVE_SHA256;
    if (nativeExecutable) {
      assert.match(nativeSHA || '', /^[a-f0-9]{64}$/); assert.equal(createHash('sha256').update(readFileSync(nativeExecutable)).digest('hex'), nativeSHA);
      copyFileSync(nativeExecutable, join(guest, 'codex-app-server')); chmodSync(join(guest, 'codex-app-server'), 0o755);
      const image = 'rust@sha256:bc2c4c21d4467cdbbac0ee7b95a6deb742a3467dfe0ff7647916c4b42ca56372';
      const shell = `set -eu; ldd /input/codex-app-server | awk '{for(i=1;i<=NF;i++) if($i ~ /^\\//) print $i}' > /tmp/libs
test -s /tmp/libs
while IFS= read -r p; do mkdir -p "/out$(dirname "$p")"; cp -L "$p" "/out$p"; done < /tmp/libs`;
      run('/opt/homebrew/bin/docker', ['run', '--rm', '--network', 'none', '--read-only', '--user', `${process.getuid()}:${process.getgid()}`,
        '--tmpfs', '/tmp:rw,mode=1777,size=64m', '--mount', `type=bind,src=${guest},dst=/input,readonly`,
        '--mount', `type=bind,src=${guest},dst=/out`, '--entrypoint', '/bin/sh', image, '-c', shell]);
      writeFileSync(join(guest, 'config.toml'), 'model = "fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:1/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\n[mcp_servers.fixture]\ncommand = "/fixture-mcp"\n', { mode: 0o600 });
      const mcp = join(guest, 'fixture-mcp');
      writeFileSync(mcp, String.raw`#!/bin/busybox sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | /bin/busybox sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  [ -n "$id" ] || continue
  case "$line" in
    *'"method":"initialize"'*) version=$(printf '%s' "$line" | /bin/busybox sed -n 's/.*"protocolVersion":"\([^"]*\)".*/\1/p'); result="{\"protocolVersion\":\"$version\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}" ;;
    *'"method":"tools/list"'*) result='{"tools":[{"name":"fixture_echo","description":"fixture","inputSchema":{"type":"object","properties":{}}}]}' ;;
    *'"method":"tools/call"'*) result='{"content":[{"type":"text","text":"ok"}]}' ;;
    *) result='{}' ;;
  esac
  printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
`, { mode: 0o700 }); chmodSync(mcp, 0o755);
    }
    const init = join(guest, 'init'); writeFileSync(init, `#!/bin/busybox sh\n/bin/busybox mount -t devtmpfs devtmpfs /dev\n/bin/busybox mount -t proc proc /proc\nexec </dev/console >/dev/console 2>&1\n${nativeExecutable ? '/bin/busybox mkdir -p /tmp/codex /tmp/sqlite\n/bin/busybox cp /config.toml /tmp/codex/config.toml\nexport TURNLINK_GUEST_NATIVE=1\n' : ''}/attempt\n/bin/busybox sleep 30\n`); chmodSync(init, 0o755);
    const paths = run('/usr/bin/find', ['.', '-print'], { cwd: guest });
    const initrd = join(root, 'initramfs.gz');
    if (nativeExecutable) {
      const raw = join(root, 'initramfs.cpio'), rawFD = openSync(raw, 'wx', 0o600);
      try { run('/usr/bin/cpio', ['-o', '-H', 'newc'], { cwd: guest, input: paths, stdio: ['pipe', rawFD, 'pipe'] }); } finally { closeSync(rawFD); }
      const gzFD = openSync(initrd, 'wx', 0o600); try { run('/usr/bin/gzip', ['-c', raw], { stdio: ['ignore', gzFD, 'pipe'] }); } finally { closeSync(gzFD); }
    } else writeFileSync(initrd, gzipSync(run('/usr/bin/cpio', ['-o', '-H', 'newc'], { cwd: guest, input: paths })), { mode: 0o600 });
    const probe = join(root, 'probe'); run('/usr/bin/swiftc', ['-module-cache-path', join(root, 'swift-cache'), resolve('test/fixtures/codex-vm-attempt-probe.swift'), '-o', probe]);
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', resolve('test/fixtures/codex-vm-boundary-entitlements.plist'), probe]);
    const item = { resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'local-daemon' };
    const fake = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
    const f = fixture(t, fake, item, root), grant = { ...f.grant, sourceRetirement: makeContainedSourceRetirement([{ names: ['fixture'], ...item }], { permitAdmittedEffectAfterNativeLoss: true }) };
    const effectID = randomUUID(), owner = createCodexContainedOwner({ directory: join(root, 'owner'), grant, effectID, resourceID: item.resourceID, kind: 'remove', expectedUID: process.geteuid() });
    owner.attachGuard(() => true); child = spawn(probe, ['/Applications/Docker.app/Contents/Resources/linuxkit/docker-next/nerdbox-kernel-arm64', initrd, ...(nativeExecutable ? ['large'] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
    exited = once(child, 'close'); let diagnostic = ''; child.stderr.on('data', data => { diagnostic += data; });
    const stream = Duplex.from({ writable: child.stdin, readable: child.stdout }); let recorder;
    acceptCodexVmAttemptCapability({ stream, key: Buffer.from('22'.repeat(32), 'hex'), grant, owner, directory: join(root, 'attempts'),
      effectID, resourceID: item.resourceID, kind: 'remove', lifetimeMs: 30000, onReady(value) { recorder = value; } });
    let observed;
    for (let i = 0; i < 600 && !observed && child.exitCode === null; i++) { if (recorder) { const value = recorder.observe(); if (value.attempts.length) observed = value; } if (!observed) await delay(50); }
    assert.equal(observed?.attempts[0].status, 'uncertain', diagnostic); assert.equal(observed.releaseAllowed, false);
    const [code] = await exited; assert.equal(code, 0, diagnostic);
    if (nativeExecutable) assert.match(diagnostic, /TURNLINK_VM_NATIVE_ATTEMPT_OK/);
    owner.close();
  });
