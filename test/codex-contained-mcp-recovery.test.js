import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { atomicWrite, privateTemp } from '../src/storage.js';
import { receiverHandoffKey } from '../src/config.js';
import { CodexContainedMcp } from '../src/codex-contained-mcp.js';
import { acquireCapturedRetiredSource, acquireRestoredCapturedRetiredSource, loadContainedRecoveryOwners } from '../src/codex-contained-mcp-recovery.js';
import { CodexAdmissionFence, requireCodexPublicationBarrier } from '../src/codex-admission-fence.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';

test('contained recovery requires private explicit unique local owner configuration', async t => {
  const root = privateTemp('/private/tmp/turnlink-contained-recovery-config-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'recovery.json'), spec = { resourceID: randomUUID(), image: `sha256:${'a'.repeat(64)}`, command: ['server'] };
  const value = { version: 1, directory: root, docker: '/bin/false', owners: [spec] };
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  const result = loadContainedRecoveryOwners(path); assert.equal(result.length, 1); assert.equal(result[0].resourceID, spec.resourceID);
  assert.ok(result[0].owner instanceof CodexContainedMcp);
  for (const bad of [{ ...value, owners: [spec, spec] }, { ...value, docker: 'docker' },
    { ...value, owners: [{ ...spec, command: ['bad\0argument'] }] }, { ...value, owners: [{ ...spec, operationID: randomUUID() }] }]) {
    writeFileSync(path, JSON.stringify(bad), { mode: 0o600 });
    assert.throws(() => loadContainedRecoveryOwners(path), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  }
  writeFileSync(path, JSON.stringify(value), { mode: 0o644 });
  chmodSync(path, 0o644);
  assert.throws(() => loadContainedRecoveryOwners(path), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
});

test('retired source correlation binds saved identity, native receipt and live barriers', async t => {
  const root = privateTemp('/private/tmp/turnlink-captured-recovery-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const threadId = randomUUID(), agentId = `codex:${threadId}`, transitionID = randomUUID();
  const item = { names: ['fixture'], resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: 123 };
  const owner = new CodexContainedMcp({ directory: root, docker: '/bin/false', spec: { resourceID: item.resourceID, image: `sha256:${'b'.repeat(64)}`, command: ['server'] } });
  owner.acquireRetiredObservation = async ({ signal, expected }) => {
    const { names: _names, ...identity } = item; assert.deepEqual(expected, identity);
    return { ...identity, check() { if (signal.aborted) throw Error('revoked'); }, async revalidate() { this.check(); return true; } };
  };
  const receipt = { shutdownID: randomUUID(), operationID: randomUUID(), transitionID: randomUUID(), stepID: randomUUID(), status: 'closed_local' };
  let records = [{ transitionID, plan: { reservation: {} }, step: { receipt: {}, movement: { phase: 'bound', grant: {}, publication: {
    phase: 'observed', operationID: receipt.operationID, contained: [item], sourceShutdown: { phase: 'observed', shutdownID: receipt.shutdownID, receipt } } } } }];
  const journal = { agentId, hostId: 'local', snapshot: () => structuredClone(records) }, client = { hostId: 'local' };
  const fence = new CodexAdmissionFence({ write() {}, reply() {}, activity: () => ({ known: true, idle: true, blocked: false, flushing: false }) });
  t.after(() => fence.close()); let close;
  const native = { supportsPublicationFixture: true, onClose(listener) { close = listener; return () => { close = undefined; }; },
    assertPublicationBarrier(barrier, id) { requireCodexPublicationBarrier(barrier, id, fence); }, async observeSourceShutdownFixture() { return receipt; } };
  await fence.exclusive(threadId, async ({ publicationGuard, beginPublication, endPublication }) => {
    await beginPublication(); const controller = new AbortController();
    const args = { native, journal, client, agentId, mcpTransitionID: transitionID, owners: [{ resourceID: item.resourceID, owner }],
      signal: controller.signal, guard() {}, publicationGuard };
    const observation = await acquireCapturedRetiredSource(args);
    assert.deepEqual(observation.entries, [item]); assert.equal(observation[codexVerifierLease], undefined);
    assert.equal(await observation.revalidate(), true);
    records = structuredClone(records); records[0].step.movement.publication.contained[0].containerID = 'c'.repeat(64);
    assert.throws(() => observation.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
    records[0].step.movement.publication.contained[0].containerID = item.containerID;
    assert.throws(() => observation.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
    const next = await acquireCapturedRetiredSource(args); close();
    assert.throws(() => next.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
    endPublication();
  });
});

test('successor correlates exact retired source with a held receiver and refuses stale evidence', async t => {
  const root = privateTemp('/private/tmp/turnlink-restored-contained-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const realDocker = process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE === '1';
  const threadId = randomUUID(), agentId = `codex:${threadId}`, mcpTransitionID = randomUUID(), transitionID = randomUUID();
  const item = { names: ['fixture'], resourceID: randomUUID(), operationID: randomUUID(), containerID: 'a'.repeat(64), wrapperPID: realDocker ? process.pid : 123 };
  const docker = '/opt/homebrew/bin/docker';
  const spec = { resourceID: item.resourceID, image: realDocker ? execFileSync(docker, ['image', 'inspect', 'alpine:3.21', '--format', '{{.Id}}'], { encoding: 'utf8' }).trim() : `sha256:${'b'.repeat(64)}`, command: realDocker ? ['sh'] : ['server'] };
  const shim = join(root, 'docker'), present = join(root, 'present'), calls = join(root, 'calls');
  writeFileSync(shim, `#!${process.execPath}\nconst fs = require('node:fs');\nconst op = process.argv[2];\nfs.appendFileSync(${JSON.stringify(calls)}, op + '\\n');\nif (op === 'info') console.log('local-daemon');\nelse if (op === 'ps') { if (fs.existsSync(${JSON.stringify(present)})) console.log(${JSON.stringify(item.containerID)}); }\nelse process.exitCode = 1;\n`, { mode: 0o700 });
  if (!realDocker) atomicWrite(join(root, `${item.resourceID}.json`), JSON.stringify({ version: 1, resourceID: item.resourceID, operationID: item.operationID,
    daemonID: 'local-daemon', image: spec.image, commandDigest: createHash('sha256').update(JSON.stringify(spec.command)).digest('hex'),
    name: `turnlink-mcp-${item.operationID}`, phase: 'removed', containerID: item.containerID, wrapperPID: item.wrapperPID }));
  const priorHost = process.env.DOCKER_HOST; if (!realDocker) process.env.DOCKER_HOST = 'unix:///tmp/turnlink-test.sock';
  let owner;
  try { owner = new CodexContainedMcp({ directory: root, docker: realDocker ? docker : shim, spec,
    ...(realDocker ? { operationID: item.operationID, wrapperPID: item.wrapperPID } : {}) }); }
  finally { if (priorHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = priorHost; }
  if (realDocker) {
    const created = await owner.create(); item.containerID = created.containerID;
    t.after(() => { try { execFileSync(docker, ['rm', '--force', item.containerID], { stdio: 'ignore' }); } catch {} });
    assert.equal((await owner.retire()).status, 'removed_local');
  }
  const stepID = randomUUID(), operationID = randomUUID(), shutdownID = randomUUID();
  const grant = { id: transitionID, channel: 'dev', taskID: randomUUID(), agentId, previewID: randomUUID(), claimGeneration: 1,
    from: '/source', to: '/destination', configurationDigest: 'c'.repeat(64), authorityDigest: 'd'.repeat(64), status: 'prepared', preparedAt: 1000,
    sourceMcpShutdown: true, destinationOwners: { mcpTransitionID, providerTransitionID: randomUUID(),
      mcpResourceID: randomUUID(), providerResourceID: randomUUID(), stepID } };
  const receipt = { shutdownID, operationID, transitionID, stepID, status: 'closed_local' };
  let records = [{ transitionID: mcpTransitionID, plan: { reservation: { generation: randomUUID(), revision: 1 } },
    step: { receipt: { stepID }, movement: { phase: 'bound', grant, publication: { phase: 'observed', operationID,
      contained: [structuredClone(item)], sourceShutdown: { phase: 'observed', shutdownID, receipt } } } } }];
  const journal = { agentId, hostId: 'local', snapshot: () => structuredClone(records), entries: () => structuredClone(records),
    exclusive: async operation => operation() };
  const client = Object.assign(new EventEmitter(), { hostId: 'local', receiverKeys: new Map(), subscriptions: new Set([agentId]), activeSubscriptions: new Set([agentId]) });
  const credentialDirectory = join(root, 'keys'); client.receiverKeys.set(agentId, receiverHandoffKey('local', agentId, transitionID, credentialDirectory, true));
  let hold = 'held', closed = false;
  client.request = async (method, params) => method === 'control_worktree_authorize' ? { checkedAt: 1001, grant } : { status: hold, transitionID: params.transitionID, sourceDetached: false };
  let close;
  const native = { usesClient: value => value === client && !closed, onClose(listener) { close = listener; return () => { close = undefined; }; },
    async observeRestoredPublicationExact(_thread, reservation, ids) { return { reservation, ...ids, historicalStatus: 'installed', snapshotObserved: true }; },
    async observeRestoredSourceShutdown(_thread, ids) { return { ...ids, historicalStatus: 'closed' }; } };
  const args = { client, native, journal, agentId, mcpTransitionID, credentialDirectory, credential: async () => 'secret',
    owners: [{ resourceID: item.resourceID, owner }], signal: new AbortController().signal, guard() {} };
  const observation = await acquireRestoredCapturedRetiredSource(args);
  assert.deepEqual(observation.entries, [item]); assert.equal(observation[codexVerifierLease], undefined);
  assert.equal(await observation.revalidate(), true);
  if (!realDocker) {
    writeFileSync(present, 'present');
    await assert.rejects(observation.revalidate(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
    rmSync(present); assert.throws(() => observation.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  } else observation.release();
  hold = 'released'; await assert.rejects(acquireRestoredCapturedRetiredSource(args), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/); hold = 'held';
  client.subscriptionGenerations = new Map([[agentId, 1]]);
  const reacquired = await acquireRestoredCapturedRetiredSource(args);
  client.activeSubscriptions.delete(agentId); client.subscriptionGenerations.set(agentId, 2); client.activeSubscriptions.add(agentId);
  assert.throws(() => reacquired.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  const key = client.receiverKeys.get(agentId), next = await acquireRestoredCapturedRetiredSource(args);
  client.receiverKeys.set(agentId, 'f'.repeat(64));
  assert.throws(() => next.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  client.receiverKeys.set(agentId, key);
  const changed = await acquireRestoredCapturedRetiredSource(args);
  records[0].step.movement.publication.contained[0].containerID = 'e'.repeat(64);
  assert.throws(() => changed.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  records[0].step.movement.publication.contained[0].containerID = item.containerID;
  const disconnected = await acquireRestoredCapturedRetiredSource(args);
  client.emit('membership_removed', { agentId });
  assert.throws(() => disconnected.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  const final = await acquireRestoredCapturedRetiredSource(args); closed = true; close();
  assert.throws(() => final.check(), /CONTAINED_MCP_RECOVERY_UNAVAILABLE/);
  assert.equal(client.listenerCount('disconnected'), 0); assert.equal(client.listenerCount('membership_removed'), 0);
  if (!realDocker) assert.ok(existsSync(calls));
});
