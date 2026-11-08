import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { ControlArchives } from '../src/control/archives.js';
import { Command, validateControlState } from '../src/control/contracts.js';
import { authorizeWorktreeGrant, observeCodexDestinationOwners, observeCodexDestinationStepRecovery, authorizeCodexDestinationStep, authorizeCodexDestinationStepDisposal } from '../src/control/worktree-authorization.js';
import { ControlGateway } from '../src/control/gateway.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { McpEstablishmentPlan } from '../src/control/mcp-establishment-contracts.js';
import { makeContainedSourceRetirement } from '../src/control/contained-source-retirement-contracts.js';
import { parseRequest } from '../src/protocol.js';

function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-mcp-establishment-'));
  let store = new ControlStore(root), now = 1000;
  const agentId = `codex:${randomUUID()}`, member = { agentId, harness: 'codex', connected: true, channel: 'dev' };
  const adapter = { kind: 'adapter', agentId }, participant = { kind: 'participant', agentId };
  const apply = (op, fields = {}, actor = { kind: 'operator' }) => {
    const command = { id: randomUUID(), op, channel: 'dev', ...fields };
    return { command, result: store.apply(command, { actor, members: [member], now }) };
  };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  apply('channel.configure');
  const taskID = apply('task.create', { title: 'Target MCP', instructions: 'Establish target', criteria: 'Retain owner' }).command.id;
  apply('task.claim', { taskID }, participant);
  const plan = { id: randomUUID(), kind: 'mcp_runtime', harness: 'codex', processGeneration: randomUUID(), agentId,
    reservation: { generation: randomUUID(), revision: 1 }, from: '/source', to: '/destination', digest: 'a'.repeat(64),
    effects: { processes: true, network: true, credentials: true, filesystem: true, plugins: true } };
  const preview = () => apply('worktree.preview', { taskID, from: plan.from, to: plan.to, configurationDigest: plan.digest,
    purpose: 'establish-mcp', mcpPlan: plan }, adapter).command.id;
  const evidence = fields => apply('evidence.record', { entityID: taskID, kind: 'capability', ...fields }, adapter);
  const prepare = () => {
    evidence({ nativeMcpRuntime: true }); apply('evidence.record', { entityID: taskID, kind: 'idle' }, adapter);
    const previewID = preview(); apply('worktree.approve', { taskID, previewID });
    const begin = apply('worktree.begin', { taskID, previewID, claimGeneration: 1, configurationDigest: plan.digest, purpose: 'establish-mcp' }, adapter).command;
    return store.snapshot().transitions.find(v => v.id === begin.id);
  };
  const receipt = grant => ({ transitionID: grant.id, planID: plan.id, reservation: plan.reservation, resourceID: randomUUID(),
    processGeneration: plan.processGeneration, kind: 'mcp_runtime', phase: 'constructed' });
  const settle = (grant, outcome, fields = {}) => apply('worktree.settle', { transitionID: grant.id, purpose: 'establish-mcp', outcome,
    actualLocation: plan.from, configurationDigest: plan.digest, receiptID: randomUUID(), ...fields }, adapter);
  return { apply, prepare, preview, evidence, receipt, settle, plan, taskID, member, adapter, participant, root,
    get store() { return store; }, restart: () => { store.close(); store = new ControlStore(root); } };
}

test('broker refuses an unverified MCP cleanup receipt without clearing the retained hold', t => {
  const f = fixture(t), grant = f.prepare(), resource = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt: resource });
  const gateway = Object.create(ControlGateway.prototype);
  gateway.worktreeGrants = true;
  gateway.store = f.store;
  gateway.adapter = () => f.member;
  gateway.now = () => 1000;
  gateway.members = () => [f.member];
  const cleanupReceipt = { cleanupID: randomUUID(), resource, sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  const command = { id: randomUUID(), op: 'worktree.settle', channel: 'dev', transitionID: grant.id, purpose: 'establish-mcp',
    outcome: 'failed', actualLocation: f.plan.from, configurationDigest: f.plan.digest, receiptID: randomUUID(), cleanupReceipt };
  assert.throws(() => gateway.command({ principal: { admin: false } }, { command }, true), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  const retained = f.store.snapshot().transitions.find(row => row.id === grant.id);
  assert.equal(retained.status, 'established');
  assert.deepEqual(retained.resourceReceipt, resource);
  assert.equal(retained.cleanupReceipt, undefined);
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
});

test('trusted MCP cleanup verification binds the native receipt to unchanged broker ownership', async t => {
  const f = fixture(t), grant = f.prepare(), resource = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt: resource });
  const gateway = Object.create(ControlGateway.prototype);
  Object.assign(gateway, { worktreeGrants: true, store: f.store, adapter: () => f.member,
    now: () => 1000, members: () => [f.member], runtimeAvailable: () => true });
  const cleanupReceipt = { cleanupID: randomUUID(), resource, sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  const command = { id: randomUUID(), op: 'worktree.settle', channel: 'dev', transitionID: grant.id, purpose: 'establish-mcp',
    outcome: 'failed', actualLocation: f.plan.from, configurationDigest: f.plan.digest, receiptID: randomUUID(), cleanupReceipt };
  const socket = { principal: { admin: false } }, params = { command }, signal = new AbortController().signal;
  await assert.rejects(gateway.verifiedMcpCleanup(socket, params, async () => ({ ...cleanupReceipt, cleanupID: randomUUID() }), signal), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  assert.equal(f.store.snapshot().transitions.find(row => row.id === grant.id).status, 'established');
  let leaseReleased = false;
  await gateway.verifiedMcpCleanup(socket, params, async ({ grant: observed }) => {
    assert.deepEqual(observed.resourceReceipt, resource);
    const proof = { ...cleanupReceipt };
    Object.defineProperty(proof, codexVerifierLease, { value: { check() {}, release() { leaseReleased = true; } } });
    return proof;
  }, signal);
  assert.equal(leaseReleased, true);
  assert.equal(f.store.snapshot().transitions.find(row => row.id === grant.id).status, 'failed');
  f.restart(); gateway.store = f.store;
  const replay = await gateway.verifiedMcpCleanup(socket, params, async () => { throw new Error('must not replay verifier'); }, signal);
  assert.equal(replay.replayed, true);
  await assert.rejects(gateway.verifiedMcpCleanup(socket, { command: { ...command, receiptID: randomUUID() } }, async () => cleanupReceipt, signal), /COMMAND_IDEMPOTENCY_CONFLICT/);
  f.apply('task.release', { taskID: f.taskID }, f.participant);
});

test('trusted MCP cleanup verification refuses ownership changed while verifier runs', async t => {
  const f = fixture(t), grant = f.prepare(), resource = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt: resource });
  const gateway = Object.create(ControlGateway.prototype);
  Object.assign(gateway, { worktreeGrants: true, store: f.store, adapter: () => f.member,
    now: () => 1000, members: () => [f.member], runtimeAvailable: () => true });
  const cleanupReceipt = { cleanupID: randomUUID(), resource, sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  const command = { id: randomUUID(), op: 'worktree.settle', channel: 'dev', transitionID: grant.id, purpose: 'establish-mcp',
    outcome: 'failed', actualLocation: f.plan.from, configurationDigest: f.plan.digest, receiptID: randomUUID(), cleanupReceipt };
  await assert.rejects(gateway.verifiedMcpCleanup({ principal: { admin: false } }, { command }, async () => {
    f.settle(grant, 'uncertain');
    return cleanupReceipt;
  }, new AbortController().signal), /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  assert.equal(f.store.snapshot().transitions.find(row => row.id === grant.id).status, 'uncertain');
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
});

test('a late MCP cleanup proof after cancellation cannot release the owner, even after restart', async t => {
  const f = fixture(t), grant = f.prepare(), resource = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt: resource });
  const gateway = Object.create(ControlGateway.prototype);
  Object.assign(gateway, { worktreeGrants: true, store: f.store, adapter: () => f.member,
    now: () => 1000, members: () => [f.member], runtimeAvailable: () => true });
  const cleanupReceipt = { cleanupID: randomUUID(), resource, sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  const command = { id: randomUUID(), op: 'worktree.settle', channel: 'dev', transitionID: grant.id, purpose: 'establish-mcp',
    outcome: 'failed', actualLocation: f.plan.from, configurationDigest: f.plan.digest, receiptID: randomUUID(), cleanupReceipt };
  const controller = new AbortController();
  let completeProof;
  const pending = gateway.verifiedMcpCleanup({ principal: { admin: false } }, { command },
    () => new Promise(resolve => { completeProof = resolve; }), controller.signal);
  assert.equal(typeof completeProof, 'function');
  controller.abort();
  completeProof(cleanupReceipt);
  await assert.rejects(pending, /MCP_CLEANUP_VERIFICATION_UNAVAILABLE/);
  f.restart();
  const retained = f.store.snapshot().transitions.find(row => row.id === grant.id);
  assert.equal(retained.status, 'established');
  assert.deepEqual(retained.resourceReceipt, resource);
  assert.equal(retained.cleanupReceipt, undefined);
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
});

test('MCP grant requires its own capability and cannot become movement or provider authority', t => {
  const f = fixture(t);
  f.evidence({ nativeProviderFactory: true, sameConversationWorktree: true });
  f.apply('evidence.record', { entityID: f.taskID, kind: 'idle' }, f.adapter);
  const previewID = f.preview(); f.apply('worktree.approve', { taskID: f.taskID, previewID });
  assert.throws(() => f.apply('worktree.begin', { taskID: f.taskID, previewID, claimGeneration: 1, configurationDigest: f.plan.digest, purpose: 'establish-mcp' }, f.adapter), /WORKTREE_CAPABILITY_REQUIRED/);
  f.evidence({ nativeMcpRuntime: true });
  const begin = f.apply('worktree.begin', { taskID: f.taskID, previewID, claimGeneration: 1, configurationDigest: f.plan.digest, purpose: 'establish-mcp' }, f.adapter).command;
  const grant = f.store.snapshot().transitions.find(t => t.id === begin.id);
  assert.deepEqual(authorizeWorktreeGrant(f.store.snapshot(), grant, f.member, 1000, [f.member]).grant, grant);
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), grant, f.member, 1000, [f.member], 'observe-provider'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), grant, f.member, 1000, [f.member], 'observe-worktree'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.throws(() => f.settle(grant, 'moved'), /invalid|Invalid|Zod/i);
  const altered = structuredClone(grant); altered.mcpPlan.effects.network = false;
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), altered, f.member, 1000, [f.member]), /STALE_WORKTREE_GRANT/);
});

test('MCP resource and conversation hold survive restart until exact owner cleanup', t => {
  const f = fixture(t), grant = f.prepare(), resource = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt: resource }); f.restart();
  const state = f.store.snapshot(), established = state.transitions.find(t => t.id === grant.id);
  assert.deepEqual(established.resourceReceipt, resource);
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
  assert.deepEqual(authorizeWorktreeGrant(state, established, f.member, 1000, [f.member], 'cleanup-mcp').grant, established);
  const cleanup = { cleanupID: randomUUID(), resource, sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  assert.throws(() => f.settle(established, 'failed', { cleanupReceipt: { ...cleanup, resource: { ...resource, resourceID: randomUUID() } } }), /RESOURCE_CLEANUP_MISMATCH/);
  f.settle(established, 'failed', { cleanupReceipt: cleanup });
  f.apply('task.release', { taskID: f.taskID }, f.participant);
});

test('matching provider and MCP owners coexist and each must be independently released', t => {
  const f = fixture(t);
  Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true, skillCapture: true, stepPreparation: true });
  const providerPlan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: f.plan.processGeneration,
    agentId: f.plan.agentId, reservation: f.plan.reservation, from: f.plan.from, to: f.plan.to,
    providerID: 'fixture', family: 'configured', digest: 'b'.repeat(64) };
  f.evidence({ nativeProviderFactory: true }); f.apply('evidence.record', { entityID: f.taskID, kind: 'idle' }, f.adapter);
  const preview = f.apply('worktree.preview', { taskID: f.taskID, from: providerPlan.from, to: providerPlan.to,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider', providerPlan }, f.adapter).command.id;
  f.apply('worktree.approve', { taskID: f.taskID, previewID: preview });
  const begin = f.apply('worktree.begin', { taskID: f.taskID, previewID: preview, claimGeneration: 1,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider' }, f.adapter).command;
  const provider = f.store.snapshot().transitions.find(t => t.id === begin.id);
  const providerReceipt = { transitionID: provider.id, planID: providerPlan.id, reservation: providerPlan.reservation,
    resourceID: randomUUID(), processGeneration: providerPlan.processGeneration, kind: 'provider_factory', phase: 'constructed' };
  f.apply('worktree.settle', { transitionID: provider.id, outcome: 'established', actualLocation: providerPlan.from,
    configurationDigest: providerPlan.digest, receiptID: randomUUID(), purpose: 'establish-provider', resourceReceipt: providerReceipt }, f.adapter);
  const originalReservation = f.plan.reservation;
  f.plan.reservation = { ...originalReservation, revision: originalReservation.revision + 1 };
  assert.throws(() => f.preview(), /WORKTREE_TRANSITION_UNRESOLVED/);
  f.plan.reservation = originalReservation;
  const mcp = f.prepare(), mcpReceipt = f.receipt(mcp);
  assert.deepEqual(authorizeWorktreeGrant(f.store.snapshot(), mcp, f.member, 1000, [f.member]).grant, mcp);
  f.settle(mcp, 'established', { resourceReceipt: mcpReceipt }); f.restart();
  let state = f.store.snapshot(), currentProvider = state.transitions.find(t => t.id === provider.id);
  const currentMcp = state.transitions.find(t => t.id === mcp.id);
  assert.deepEqual(observeCodexDestinationOwners(state, currentMcp, currentProvider, f.member, 1000, [f.member]),
    { mcpGrant: currentMcp, providerGrant: currentProvider, checkedAt: 1000 });
  assert.throws(() => authorizeCodexDestinationStep(state, currentMcp, currentProvider, f.member, 1000, [f.member]), /WORKTREE_CAPABILITY_REQUIRED/);
  f.evidence({ nativeMcpRuntime: true, nativeProviderFactory: true });
  state = f.store.snapshot();
  assert.deepEqual(authorizeCodexDestinationStep(state, currentMcp, currentProvider, f.member, 1000, [f.member]),
    { mcpGrant: currentMcp, providerGrant: currentProvider, checkedAt: 1000, purpose: 'prepare-destination-step' });
  assert.throws(() => authorizeCodexDestinationStep(state, currentMcp, currentProvider, f.member, 301001, [f.member]), /WORKTREE_CAPABILITY_REQUIRED/);
  const capabilityChanged = structuredClone(state), combined = capabilityChanged.evidence.findLast(value => value.kind === 'capability');
  capabilityChanged.evidence.push({ ...combined, id: randomUUID(), nativeProviderFactory: false });
  assert.throws(() => authorizeCodexDestinationStep(capabilityChanged, currentMcp, currentProvider, f.member, 1000, [f.member]), /WORKTREE_CAPABILITY_REQUIRED/);
  const busy = structuredClone(state); busy.evidence.push({ ...busy.evidence.find(value => value.kind === 'idle'), id: randomUUID(), kind: 'busy' });
  assert.throws(() => authorizeCodexDestinationStep(busy, currentMcp, currentProvider, f.member, 1000, [f.member]), /IDLE_EVIDENCE_REQUIRED/);
  const superseded = structuredClone(state); superseded.previews.push({ ...superseded.previews.at(-1), id: randomUUID(), approved: false });
  assert.throws(() => authorizeCodexDestinationStep(superseded, currentMcp, currentProvider, f.member, 1000, [f.member]), /STALE_WORKTREE_PREVIEW/);
  const withoutDisclosure = structuredClone(state), withoutMcp = withoutDisclosure.transitions.find(value => value.id === mcp.id);
  delete withoutMcp.mcpPlan.effects.stepPreparation;
  delete withoutDisclosure.previews.find(value => value.id === withoutMcp.previewID).mcpPlan.effects.stepPreparation;
  assert.throws(() => authorizeCodexDestinationStep(withoutDisclosure, withoutMcp, currentProvider, f.member, 1000, [f.member]), /DESTINATION_STEP_NOT_APPROVED/);
  assert.throws(() => observeCodexDestinationOwners(state, currentMcp, { ...currentProvider, resourceReceipt: { ...providerReceipt, resourceID: randomUUID() } }, f.member, 1000, [f.member]), /STALE_WORKTREE_GRANT/);
  assert.throws(() => observeCodexDestinationOwners(state, currentProvider, currentMcp, f.member, 1000, [f.member]), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.throws(() => observeCodexDestinationOwners(state, currentMcp, currentProvider, f.member, 1000, [{ ...f.member, connected: false }]), /ELIGIBLE_MEMBER_REQUIRED/);
  const cancelled = structuredClone(state); cancelled.tasks.find(value => value.id === f.taskID).status = 'cancelled';
  assert.throws(() => observeCodexDestinationOwners(cancelled, currentMcp, currentProvider, f.member, 1000, [f.member]), /DESTINATION_OWNERS_UNAVAILABLE/);
  assert.throws(() => authorizeCodexDestinationStep(cancelled, currentMcp, currentProvider, f.member, 1000, [f.member]), /DESTINATION_OWNERS_UNAVAILABLE/);
  assert.deepEqual(observeCodexDestinationStepRecovery(cancelled, currentMcp, currentProvider, f.member, 1000, [f.member]),
    { mcpGrant: currentMcp, providerGrant: currentProvider, checkedAt: 1000 });
  assert.deepEqual(authorizeCodexDestinationStepDisposal(cancelled, currentMcp, currentProvider, f.member, 1000, [f.member]),
    { mcpGrant: currentMcp, providerGrant: currentProvider, checkedAt: 1000, purpose: 'dispose-destination-step' });
  assert.throws(() => authorizeCodexDestinationStepDisposal(cancelled, currentMcp, { ...currentProvider, resourceReceipt: { ...providerReceipt, resourceID: randomUUID() } }, f.member, 1000, [f.member]), /STALE_WORKTREE_GRANT/);
  assert.throws(() => authorizeCodexDestinationStepDisposal(cancelled, currentMcp, currentProvider, f.member, 1000, [{ ...f.member, connected: false }]), /ELIGIBLE_MEMBER_REQUIRED/);
  assert.throws(() => observeCodexDestinationStepRecovery(cancelled, currentMcp, currentProvider, f.member, 1000, [{ ...f.member, connected: false }]), /ELIGIBLE_MEMBER_REQUIRED/);
  const revoked = structuredClone(state); revoked.previews.find(value => value.id === currentMcp.previewID).approved = false;
  assert.throws(() => authorizeCodexDestinationStep(revoked, currentMcp, currentProvider, f.member, 1000, [f.member]), /STALE_WORKTREE_PREVIEW/);
  const otherReservation = structuredClone(state), otherProvider = otherReservation.transitions.find(value => value.id === provider.id);
  otherProvider.providerPlan.reservation.revision++;
  otherReservation.previews.find(value => value.id === otherProvider.previewID).providerPlan.reservation.revision++;
  assert.throws(() => observeCodexDestinationOwners(otherReservation, currentMcp, otherProvider, f.member, 1000, [f.member]), /DESTINATION_OWNERS_UNAVAILABLE/);
  assert.deepEqual(authorizeWorktreeGrant(state, currentProvider, f.member, 1000, [f.member], 'cleanup-provider').grant, currentProvider);
  const providerCleanup = { cleanupID: randomUUID(), resource: providerReceipt, sourceCwd: providerPlan.from, kind: 'provider_factory', phase: 'owner_released' };
  f.apply('worktree.settle', { transitionID: provider.id, outcome: 'failed', actualLocation: providerPlan.from,
    configurationDigest: providerPlan.digest, receiptID: randomUUID(), purpose: 'establish-provider', cleanupReceipt: providerCleanup }, f.adapter);
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
  const mcpCleanup = { cleanupID: randomUUID(), resource: mcpReceipt, sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' };
  f.settle(mcp, 'failed', { cleanupReceipt: mcpCleanup });
  f.apply('task.release', { taskID: f.taskID }, f.participant);
});

test('MCP plan refuses cross-scope data, hidden fields, and incompatible receipts', t => {
  const f = fixture(t);
  const base = { id: randomUUID(), op: 'worktree.preview', channel: 'dev', taskID: f.taskID, from: f.plan.from, to: f.plan.to,
    configurationDigest: f.plan.digest, purpose: 'establish-mcp', mcpPlan: f.plan };
  assert.ok(Command.parse(base));
  for (const mcpPlan of [{ ...f.plan, url: 'https://secret.example' }, { ...f.plan, effects: { ...f.plan.effects, extra: true } }, { ...f.plan, kind: 'provider_factory' }])
    assert.throws(() => Command.parse({ ...base, mcpPlan }));
  assert.throws(() => Command.parse({ ...base, purpose: 'establish-provider' }));
  const grant = f.prepare(), wrong = { ...f.receipt(grant), kind: 'provider_factory' };
  assert.throws(() => f.settle(grant, 'established', { resourceReceipt: wrong }));
});

test('a pending or uncertain MCP effect blocks another resource scope', t => {
  const f = fixture(t), mcp = f.prepare();
  const providerPlan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: f.plan.processGeneration,
    agentId: f.plan.agentId, reservation: f.plan.reservation, from: f.plan.from, to: f.plan.to,
    providerID: 'fixture', family: 'configured', digest: 'b'.repeat(64) };
  const previewProvider = () => f.apply('worktree.preview', { taskID: f.taskID, from: providerPlan.from, to: providerPlan.to,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider', providerPlan }, f.adapter);
  assert.throws(previewProvider, /WORKTREE_TRANSITION_UNRESOLVED/);
  f.settle(mcp, 'uncertain');
  assert.throws(previewProvider, /WORKTREE_TRANSITION_UNRESOLVED/);
});

test('schema 23 rejects downgraded state and rehashed older exports containing MCP scope', t => {
  const f = fixture(t), grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  const exports = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-mcp-export-')));
  t.after(() => rmSync(exports.directory, { recursive: true, force: true }));
  const id = randomUUID(); f.store.exportTo(exports, id, 1001);
  const path = exports.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36);
  rows[0].schemaVersion = 22;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(id), /CONTROL_EXPORT_INVALID/);
  f.store.db.exec('PRAGMA user_version=22');
  assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('schema 24 preserves binding-capture disclosure and refuses downgraded state and exports', t => {
  const f = fixture(t); f.plan.effects.bindingCapture = true;
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.bindingCapture, true);
  const exports = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-mcp-binding-export-')));
  t.after(() => rmSync(exports.directory, { recursive: true, force: true }));
  const id = randomUUID(); f.store.exportTo(exports, id, 1001);
  const path = exports.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 23;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(id), /CONTROL_EXPORT_INVALID/);
  f.store.db.exec('PRAGMA user_version=23'); assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('schema 23 MCP records migrate without gaining a binding-capture effect', t => {
  const f = fixture(t), grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  const before = f.store.snapshot().transitions[0];
  f.store.db.exec('PRAGMA user_version=23'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(f.store.snapshot().transitions[0], before);
  assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.bindingCapture, undefined);
});

test('schema 25 preserves plugin capture and refuses downgraded state and exports', t => {
  const f = fixture(t); f.plan.effects.pluginCapture = true;
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.pluginCapture, true);
  const exports = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-mcp-plugin-export-')));
  t.after(() => rmSync(exports.directory, { recursive: true, force: true }));
  const id = randomUUID(); f.store.exportTo(exports, id, 1001);
  const path = exports.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 24;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(id), /CONTROL_EXPORT_INVALID/);
  f.store.db.exec('PRAGMA user_version=24'); assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('schema 24 MCP records migrate without gaining plugin capture', t => {
  const f = fixture(t); f.plan.effects.bindingCapture = true;
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  const before = f.store.snapshot().transitions[0];
  f.store.db.exec('PRAGMA user_version=24'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(f.store.snapshot().transitions[0], before);
  assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.pluginCapture, undefined);
});

test('schema 26 preserves skill capture and refuses downgraded state and exports', t => {
  const f = fixture(t); Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true, skillCapture: true });
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.skillCapture, true);
  const exports = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-mcp-skill-export-')));
  t.after(() => rmSync(exports.directory, { recursive: true, force: true }));
  const id = randomUUID(); f.store.exportTo(exports, id, 1001);
  const path = exports.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 25;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(id), /CONTROL_EXPORT_INVALID/);
  f.store.db.exec('PRAGMA user_version=25'); assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('skill capture disclosure requires the same plan to capture bindings and plugins', t => {
  const f = fixture(t);
  f.plan.effects.skillCapture = true;
  assert.equal(McpEstablishmentPlan.safeParse(f.plan).success, false);
  f.plan.effects.bindingCapture = true;
  assert.equal(McpEstablishmentPlan.safeParse(f.plan).success, false);
  f.plan.effects.pluginCapture = true;
  assert.equal(McpEstablishmentPlan.safeParse(f.plan).success, true);
});

test('step preparation disclosure requires all retained inputs and a broad effect ceiling', t => {
  const f = fixture(t);
  f.plan.effects.stepPreparation = true;
  assert.equal(McpEstablishmentPlan.safeParse(f.plan).success, false);
  Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true, skillCapture: true });
  assert.equal(McpEstablishmentPlan.safeParse(f.plan).success, true);
  for (const field of ['processes', 'network', 'credentials', 'filesystem', 'plugins']) {
    const plan = structuredClone(f.plan); plan.effects[field] = false;
    assert.equal(McpEstablishmentPlan.safeParse(plan).success, false);
  }
});

test('step authorization transport requires exactly the second owner for paired actions', () => {
  const request = params => JSON.stringify({ v: 2, id: 1, method: 'control_worktree_authorize', params });
  const params = { agentId: `codex:${randomUUID()}`, proof: 'a'.repeat(64), credential: 'b'.repeat(64),
    channel: 'dev', grant: {}, peerGrant: {}, action: 'prepare-destination-step' };
  assert.equal(parseRequest(request(params)).params.action, 'prepare-destination-step');
  const missing = { ...params }; delete missing.peerGrant;
  assert.throws(() => parseRequest(request(missing)));
  assert.throws(() => parseRequest(request({ ...params, action: 'cleanup-mcp' })));
  for (const action of ['shutdown-source-mcp', 'observe-source-mcp-shutdown', 'shutdown-source-model', 'observe-source-model-shutdown']) {
    assert.equal(parseRequest(request({ ...missing, action })).params.action, action);
    assert.throws(() => parseRequest(request({ ...params, action })));
  }
});

test('schema 27 retains step preparation disclosure and rejects downgraded state and exports', t => {
  const f = fixture(t); Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true, skillCapture: true, stepPreparation: true });
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  f.restart(); assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.stepPreparation, true);
  const exports = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-step-preparation-export-')));
  t.after(() => rmSync(exports.directory, { recursive: true, force: true }));
  const id = randomUUID(); f.store.exportTo(exports, id, 1001);
  const path = exports.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 26;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(id), /CONTROL_EXPORT_INVALID/);
  f.store.db.exec('PRAGMA user_version=26'); assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('schema 26 MCP records migrate without gaining step preparation', t => {
  const f = fixture(t); Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true, skillCapture: true });
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  const before = f.store.snapshot().transitions[0];
  f.store.db.exec('PRAGMA user_version=26'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(f.store.snapshot().transitions[0], before);
  assert.equal(before.mcpPlan.effects.stepPreparation, undefined);
});

test('schema 25 MCP records migrate without gaining skill capture', t => {
  const f = fixture(t); Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true });
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  const before = f.store.snapshot().transitions[0];
  f.store.db.exec('PRAGMA user_version=25'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(f.store.snapshot().transitions[0], before);
  assert.equal(f.store.snapshot().transitions[0].mcpPlan.effects.skillCapture, undefined);
});

test('schema 22 state migrates without changing a legacy provider command receipt', t => {
  const f = fixture(t);
  f.evidence({ nativeProviderFactory: true });
  const providerPlan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: randomUUID(),
    agentId: f.plan.agentId, reservation: f.plan.reservation, from: f.plan.from, to: f.plan.to,
    providerID: 'fixture', family: 'configured', digest: 'b'.repeat(64) };
  const original = f.apply('worktree.preview', { taskID: f.taskID, from: providerPlan.from, to: providerPlan.to,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider', providerPlan }, f.adapter).command;
  f.store.db.exec('PRAGMA user_version=22'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  const replay = f.store.apply(original, { actor: f.adapter, members: [f.member], now: 1000 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.commandID, original.id);
});

test('schema 29 state migrates without inventing source shutdown approval', t => {
  const f = fixture(t), before = f.store.snapshot();
  f.store.db.exec('PRAGMA user_version=29'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(f.store.snapshot(), before);
});

test('schema 30 migrates without inventing model shutdown approval', t => {
  const f = fixture(t), before = f.store.snapshot();
  f.store.db.exec('PRAGMA user_version=30'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  assert.deepEqual(f.store.snapshot(), before);
});

for (const mode of ['uncertain', 'verified-replay', 'shutdown-approved', 'model-approved', 'retirement-approved', 'retirement-v2-approved']) test(`destination movement binds both retained owners: ${mode}`, async t => {
  const f = fixture(t);
  Object.assign(f.plan.effects, { bindingCapture: true, pluginCapture: true, skillCapture: true, stepPreparation: true });
  const providerPlan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: f.plan.processGeneration,
    agentId: f.plan.agentId, reservation: f.plan.reservation, from: f.plan.from, to: f.plan.to,
    providerID: 'fixture', family: 'configured', digest: 'b'.repeat(64) };
  f.evidence({ nativeProviderFactory: true }); f.apply('evidence.record', { entityID: f.taskID, kind: 'idle' }, f.adapter);
  const providerPreview = f.apply('worktree.preview', { taskID: f.taskID, from: providerPlan.from, to: providerPlan.to,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider', providerPlan }, f.adapter).command.id;
  f.apply('worktree.approve', { taskID: f.taskID, previewID: providerPreview });
  const provider = f.apply('worktree.begin', { taskID: f.taskID, previewID: providerPreview, claimGeneration: 1,
    configurationDigest: providerPlan.digest, purpose: 'establish-provider' }, f.adapter).command;
  const providerReceipt = { transitionID: provider.id, planID: providerPlan.id, reservation: providerPlan.reservation,
    resourceID: randomUUID(), processGeneration: providerPlan.processGeneration, kind: 'provider_factory', phase: 'constructed' };
  f.apply('worktree.settle', { transitionID: provider.id, outcome: 'established', actualLocation: providerPlan.from,
    configurationDigest: providerPlan.digest, receiptID: randomUUID(), purpose: 'establish-provider', resourceReceipt: providerReceipt }, f.adapter);
  const mcp = f.prepare(), mcpReceipt = f.receipt(mcp);
  f.settle(mcp, 'established', { resourceReceipt: mcpReceipt });
  f.evidence({ sameConversationWorktree: true, ...(['shutdown-approved', 'model-approved', 'retirement-approved', 'retirement-v2-approved'].includes(mode) ? { nativeMcpRuntime: true } : {}),
    ...(mode === 'model-approved' ? { nativeModelShutdown: true } : {}) });
  const authority = 'c'.repeat(64);
  const binding = { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authority,
    destinationAuthorityDigest: authority, sources: [{ path: '/source/config', digest: authority }] };
  const destinationOwners = { mcpTransitionID: mcp.id, providerTransitionID: provider.id,
    mcpResourceID: mcpReceipt.resourceID, providerResourceID: providerReceipt.resourceID, stepID: randomUUID() };
  const sourceRetirement = makeContainedSourceRetirement([{ names: ['fixture'], resourceID: randomUUID(), operationID: randomUUID(),
    containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'fixture-daemon' }], { permitAdmittedEffectAfterNativeLoss: mode === 'retirement-v2-approved' });
  const movement = { taskID: f.taskID, from: f.plan.from, to: f.plan.to, configurationDigest: authority, binding, destinationOwners,
    ...(['shutdown-approved', 'model-approved', 'retirement-approved', 'retirement-v2-approved'].includes(mode) ? { sourceMcpShutdown: true } : {}),
    ...(mode === 'model-approved' ? { sourceModelShutdown: true } : {}), ...(['retirement-approved', 'retirement-v2-approved'].includes(mode) ? { sourceRetirement } : {}) };
  assert.equal(Command.safeParse({ id: randomUUID(), op: 'worktree.preview', channel: 'dev', ...movement,
    destinationOwners: undefined, sourceMcpShutdown: true }).success, false);
  assert.equal(Command.safeParse({ id: randomUUID(), op: 'worktree.preview', channel: 'dev', ...movement,
    sourceMcpShutdown: false }).success, false);
  assert.equal(Command.safeParse({ id: randomUUID(), op: 'worktree.preview', channel: 'dev', ...movement,
    sourceMcpShutdown: undefined, sourceModelShutdown: true }).success, false);
  assert.throws(() => f.apply('worktree.preview', { ...movement, destinationOwners: { ...destinationOwners, mcpResourceID: randomUUID() } }, f.adapter), /DESTINATION_OWNERS_UNAVAILABLE/);
  const previewID = f.apply('worktree.preview', movement, f.adapter).command.id;
  if (mode === 'retirement-v2-approved') {
    assert.throws(() => f.apply('worktree.approve', { taskID: f.taskID, previewID }), /SOURCE_RETIREMENT_ACK_REQUIRED/);
    assert.throws(() => f.apply('worktree.approve', { taskID: f.taskID, previewID, sourceRetirementDigest: 'a'.repeat(64), admittedEffectAfterNativeLoss: 'may_complete' }), /SOURCE_RETIREMENT_ACK_REQUIRED/);
  }
  if (mode === 'retirement-approved') assert.throws(() => f.apply('worktree.approve', { taskID: f.taskID, previewID,
    sourceRetirementDigest: sourceRetirement.digest, admittedEffectAfterNativeLoss: 'may_complete' }), /SOURCE_RETIREMENT_ACK_INVALID/);
  f.apply('worktree.approve', { taskID: f.taskID, previewID, ...(mode === 'retirement-v2-approved' ? { sourceRetirementDigest: sourceRetirement.digest, admittedEffectAfterNativeLoss: 'may_complete' } : {}) });
  const transitionID = f.apply('worktree.begin', { taskID: f.taskID, previewID, claimGeneration: 1,
    configurationDigest: authority, authorityDigest: authority }, f.adapter).command.id;
  f.restart();
  const state = f.store.snapshot(), grant = state.transitions.find(v => v.id === transitionID);
  if (mode === 'retirement-v2-approved' && process.env.TURNLINK_ARBITER_AUTH_BENCH === '1') {
    const samples = [];
    for (let index = 0; index < 64; index++) {
      const start = performance.now();
      authorizeWorktreeGrant(f.store.snapshot(), grant, f.member, 1000, [f.member], 'retire-source-contained');
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    t.diagnostic(`arbiter authorization snapshot: n=64 median=${samples[32].toFixed(3)}ms p95=${samples[60].toFixed(3)}ms max=${samples[63].toFixed(3)}ms`);
  }
  const mcpOwner = state.transitions.find(v => v.id === mcp.id), providerOwner = state.transitions.find(v => v.id === provider.id);
  assert.deepEqual(grant.destinationOwners, destinationOwners);
  assert.equal(grant.sourceMcpShutdown, ['shutdown-approved', 'model-approved', 'retirement-approved', 'retirement-v2-approved'].includes(mode) ? true : undefined);
  assert.equal(grant.sourceModelShutdown, mode === 'model-approved' ? true : undefined);
  if (['retirement-approved', 'retirement-v2-approved'].includes(mode)) {
    assert.deepEqual(grant.sourceRetirement, sourceRetirement);
    assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'retire-source-contained').grant, grant);
    assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'observe-source-contained-retirement').grant, grant);
    const staleTask = structuredClone(state); staleTask.tasks.find(value => value.id === f.taskID).status = 'cancelled';
    assert.throws(() => authorizeWorktreeGrant(staleTask, grant, f.member, 1000, [f.member], 'retire-source-contained'), /STALE_TASK_CLAIM/);
    assert.deepEqual(authorizeWorktreeGrant(staleTask, grant, f.member, 1000, [f.member], 'observe-source-contained-retirement').grant, grant);
    const noCapability = structuredClone(state); noCapability.evidence.filter(value => value.kind === 'capability').at(-1).nativeMcpRuntime = false;
    assert.throws(() => authorizeWorktreeGrant(noCapability, grant, f.member, 1000, [f.member], 'retire-source-contained'), /WORKTREE_CAPABILITY_REQUIRED/);
    assert.deepEqual(authorizeWorktreeGrant(noCapability, grant, f.member, 1000, [f.member], 'observe-source-contained-retirement').grant, grant);
    const changed = structuredClone(state); changed.transitions.find(value => value.id === transitionID).sourceRetirement = makeContainedSourceRetirement([{ ...sourceRetirement.owners[0], daemonID: 'other-daemon' }]);
    assert.throws(() => validateControlState(changed), /Invalid destination movement owners/);
    assert.throws(() => authorizeWorktreeGrant(state, { ...grant, sourceRetirement: changed.transitions.find(value => value.id === transitionID).sourceRetirement }, f.member, 1000, [f.member], 'handoff-receiver'), /STALE_WORKTREE_GRANT/);
    const archives = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-source-retirement-export-')));
    t.after(() => rmSync(archives.directory, { recursive: true, force: true }));
    const exportID = randomUUID(); f.store.exportTo(archives, exportID, 1001);
    const path = archives.path(exportID), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 31;
    const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
    rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
    writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
    assert.throws(() => new ControlArchives(archives.directory).describe(exportID), /CONTROL_EXPORT_INVALID/);
    f.store.db.exec('PRAGMA user_version=31');
    assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
    return;
  }
  assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'retire-source-contained'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'handoff-receiver').grant, grant);
  assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'check-codex-source-receiver').grant, grant);
  assert.throws(() => authorizeWorktreeGrant(state, grant, { ...f.member, harness: 'opencode' }, 1000, [f.member], 'handoff-receiver'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.throws(() => authorizeWorktreeGrant(state, grant, { ...f.member, harness: 'opencode' }, 1000, [f.member], 'check-codex-source-receiver'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [], 'handoff-receiver'), /ELIGIBLE_MEMBER_REQUIRED/);
  assert.throws(() => authorizeWorktreeGrant(state, { ...grant, destinationOwners: { ...grant.destinationOwners, stepID: randomUUID() } }, f.member, 1000, [f.member], 'handoff-receiver'), /STALE_WORKTREE_GRANT/);
  assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 12000, [f.member], 'handoff-receiver'), /IDLE_EVIDENCE_REQUIRED/);
  if (mode === 'model-approved') {
    assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'shutdown-source-model').grant, grant);
    assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'observe-source-model-shutdown').grant, grant);
    const missingCapability = structuredClone(state); delete missingCapability.evidence.at(-1).nativeModelShutdown;
    assert.throws(() => authorizeWorktreeGrant(missingCapability, grant, f.member, 1000, [f.member], 'shutdown-source-model'), /WORKTREE_CAPABILITY_REQUIRED/);
    assert.deepEqual(authorizeWorktreeGrant(missingCapability, grant, f.member, 1000, [f.member], 'observe-source-model-shutdown').grant, grant);
    const changedApproval = structuredClone(state); delete changedApproval.previews.find(value => value.id === grant.previewID).sourceModelShutdown;
    assert.throws(() => authorizeWorktreeGrant(changedApproval, grant, f.member, 1000, [f.member], 'shutdown-source-model'), /STALE_WORKTREE_PREVIEW/);
    assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [], 'shutdown-source-model'), /ELIGIBLE_MEMBER_REQUIRED/);
  } else {
    assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'shutdown-source-model'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  }
  if (['shutdown-approved', 'model-approved'].includes(mode)) {
    assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'shutdown-source-mcp').grant, grant);
    assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'observe-source-mcp-shutdown').grant, grant);
    const altered = structuredClone(state); delete altered.transitions.find(v => v.id === transitionID).sourceMcpShutdown;
    delete altered.transitions.find(v => v.id === transitionID).sourceModelShutdown;
    assert.throws(() => validateControlState(altered), /Invalid destination movement owners/);
    assert.throws(() => authorizeWorktreeGrant(state, { ...grant, sourceMcpShutdown: undefined, sourceModelShutdown: undefined }, f.member, 1000, [f.member], 'shutdown-source-mcp'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
    assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [], 'shutdown-source-mcp'), /ELIGIBLE_MEMBER_REQUIRED/);
    const missingCapability = structuredClone(state);
    missingCapability.evidence.filter(value => value.kind === 'capability').at(-1).nativeMcpRuntime = false;
    assert.throws(() => authorizeWorktreeGrant(missingCapability, grant, f.member, 1000, [f.member], 'shutdown-source-mcp'), /WORKTREE_CAPABILITY_REQUIRED/);
    assert.deepEqual(authorizeWorktreeGrant(missingCapability, grant, f.member, 1000, [f.member], 'observe-source-mcp-shutdown').grant, grant);
    const changedApproval = structuredClone(state);
    delete changedApproval.previews.find(value => value.id === grant.previewID).sourceMcpShutdown;
    assert.throws(() => authorizeWorktreeGrant(changedApproval, grant, f.member, 1000, [f.member], 'shutdown-source-mcp'), /STALE_WORKTREE_PREVIEW/);
    const uncertainState = structuredClone(state), uncertainGrant = uncertainState.transitions.find(value => value.id === transitionID);
    uncertainGrant.status = 'uncertain';
    assert.throws(() => authorizeWorktreeGrant(uncertainState, uncertainGrant, f.member, 1000, [f.member], 'shutdown-source-mcp'), /WORKTREE_TRANSITION_NOT_PENDING/);
    assert.deepEqual(authorizeWorktreeGrant(uncertainState, uncertainGrant, f.member, 1000, [f.member], 'observe-source-mcp-shutdown').grant, uncertainGrant);
  } else {
    assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'shutdown-source-mcp'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
    assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'observe-source-mcp-shutdown'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  }
  const tampered = structuredClone(state);
  tampered.transitions.find(v => v.id === transitionID).destinationOwners.mcpResourceID = randomUUID();
  assert.throws(() => validateControlState(tampered), /Invalid destination movement owners/);
  assert.throws(() => authorizeWorktreeGrant(state, mcpOwner, f.member, 1000, [f.member], 'cleanup-mcp'), /DESTINATION_MOVEMENT_UNRESOLVED/);
  assert.throws(() => authorizeCodexDestinationStepDisposal(state, mcpOwner, providerOwner, f.member, 1000, [f.member]), /DESTINATION_MOVEMENT_UNRESOLVED/);
  assert.throws(() => authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member]), /DESTINATION_MOVEMENT_PROOF_REQUIRED/);
  assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'bind-destination-grant').grant, grant);
  assert.deepEqual(authorizeWorktreeGrant(state, grant, f.member, 1000, [f.member], 'cancel-destination-grant').grant, grant);
  const cancelledTask = structuredClone(state); cancelledTask.tasks.find(value => value.id === f.taskID).status = 'cancelled';
  assert.deepEqual(authorizeWorktreeGrant(cancelledTask, grant, f.member, 999999, [f.member], 'cancel-destination-grant').grant, grant);
  assert.throws(() => authorizeWorktreeGrant(cancelledTask, grant, f.member, 999999, [f.member], 'bind-destination-grant'), /STALE_TASK_CLAIM/);
  if (mode === 'model-approved') {
    assert.throws(() => authorizeWorktreeGrant(cancelledTask, grant, f.member, 999999, [f.member], 'shutdown-source-model'), /STALE_TASK_CLAIM/);
    assert.deepEqual(authorizeWorktreeGrant(cancelledTask, grant, f.member, 999999, [f.member], 'observe-source-model-shutdown').grant, grant);
  }
  if (['shutdown-approved', 'model-approved'].includes(mode)) {
    assert.throws(() => authorizeWorktreeGrant(cancelledTask, grant, f.member, 999999, [f.member], 'shutdown-source-mcp'), /STALE_TASK_CLAIM/);
    assert.deepEqual(authorizeWorktreeGrant(cancelledTask, grant, f.member, 999999, [f.member], 'observe-source-mcp-shutdown').grant, grant);
  }
  assert.throws(() => authorizeWorktreeGrant(state, mcpOwner, f.member, 1000, [f.member], 'bind-destination-grant'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  const cancellation = { transitionID, stepID: destinationOwners.stepID, cancellationID: randomUUID() };
  const settlement = { id: randomUUID(), op: 'worktree.settle', channel: 'dev', transitionID, outcome: 'failed',
    actualLocation: f.plan.from, configurationDigest: authority, authorityDigest: authority, receiptID: randomUUID(), destinationCancellation: cancellation };
  const gateway = Object.create(ControlGateway.prototype);
  Object.assign(gateway, { worktreeGrants: true, store: f.store, adapter: () => f.member,
    now: () => 1000, members: () => [f.member], runtimeAvailable: () => true });
  assert.throws(() => gateway.command({ principal: { admin: false } }, { command: settlement }, true), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
  await assert.rejects(gateway.verifiedDestinationCancellation({ principal: { admin: false } }, { command: settlement },
    async () => ({ ...cancellation, cancellationID: randomUUID() }), new AbortController().signal), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
  assert.equal(f.store.snapshot().transitions.find(value => value.id === transitionID).status, 'prepared');
  assert.throws(() => f.settle(mcpOwner, 'failed', { cleanupReceipt: { cleanupID: randomUUID(), resource: mcpReceipt,
    sourceCwd: f.plan.from, kind: 'mcp_runtime', phase: 'owner_released' } }), /DESTINATION_MOVEMENT_UNRESOLVED/);
  for (const outcome of ['moved', 'failed']) assert.throws(() => f.apply('worktree.settle', { transitionID, outcome,
    actualLocation: outcome === 'moved' ? f.plan.to : f.plan.from, configurationDigest: authority,
    authorityDigest: authority, receiptID: randomUUID() }, f.adapter), /DESTINATION_MOVEMENT_PROOF_REQUIRED/);
  if (mode === 'model-approved') {
    const archives = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-model-shutdown-export-')));
    t.after(() => rmSync(archives.directory, { recursive: true, force: true }));
    const exportID = randomUUID(); f.store.exportTo(archives, exportID, 1001);
    const path = archives.path(exportID), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 30;
    const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
    rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
    writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
    assert.throws(() => new ControlArchives(archives.directory).describe(exportID), /CONTROL_EXPORT_INVALID/);
    f.store.db.exec('PRAGMA user_version=30');
    assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
    return;
  }
  if (mode === 'shutdown-approved') {
    const archives = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-source-shutdown-export-')));
    t.after(() => rmSync(archives.directory, { recursive: true, force: true }));
    const exportID = randomUUID(); f.store.exportTo(archives, exportID, 1001);
    const path = archives.path(exportID), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
    assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 29;
    const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
    rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
    writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
    assert.throws(() => new ControlArchives(archives.directory).describe(exportID), /CONTROL_EXPORT_INVALID/);
    f.store.db.exec('PRAGMA user_version=29');
    assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
    return;
  }
  if (mode === 'verified-replay') {
    await assert.rejects(gateway.verifiedDestinationCancellation({ principal: { admin: false } }, { command: settlement },
      async () => ({ ...cancellation }), new AbortController().signal), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
    const incompleteProof = { ...cancellation };
    Object.defineProperty(incompleteProof, codexVerifierLease, { value: { check() {} } });
    await assert.rejects(gateway.verifiedDestinationCancellation({ principal: { admin: false } }, { command: settlement },
      async () => incompleteProof, new AbortController().signal), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
    for (const checkResult of [false, Promise.resolve(true)]) {
      let released = false;
      const proof = { ...cancellation };
      Object.defineProperty(proof, codexVerifierLease, { value: {
        check() { return checkResult; }, release() { released = true; },
      } });
      await assert.rejects(gateway.verifiedDestinationCancellation({ principal: { admin: false } }, { command: settlement },
        async () => proof, new AbortController().signal), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
      assert.equal(released, true);
      assert.equal(f.store.snapshot().transitions.find(value => value.id === transitionID).status, 'prepared');
    }
    let invalidReleased = false;
    const invalidLease = { ...cancellation };
    Object.defineProperty(invalidLease, codexVerifierLease, { value: {
      check() { throw new Error('owner connection lost'); },
      release() { invalidReleased = true; },
    } });
    await assert.rejects(gateway.verifiedDestinationCancellation({ principal: { admin: false } }, { command: settlement },
      async () => invalidLease, new AbortController().signal), /owner connection lost/);
    assert.equal(invalidReleased, true);
    assert.equal(f.store.snapshot().transitions.find(value => value.id === transitionID).status, 'prepared');
    let checked = false, released = false;
    const leasedProof = { ...cancellation };
    Object.defineProperty(leasedProof, codexVerifierLease, { value: {
      check() { checked = true; },
      release() { released = true; },
    } });
    const committed = await gateway.verifiedDestinationCancellation({ principal: { admin: false } }, { command: settlement },
      async () => leasedProof, new AbortController().signal);
    assert.equal(checked, true); assert.equal(released, true);
    assert.equal(committed.commandID, settlement.id);
    f.restart(); gateway.store = f.store;
    const replay = gateway.command({ principal: { admin: false } }, { command: settlement }, true);
    assert.equal(replay.replayed, true); assert.equal(replay.commandID, settlement.id);
    assert.throws(() => gateway.command({ principal: { admin: false } }, { command: { ...settlement,
      destinationCancellation: { ...cancellation, cancellationID: randomUUID() } } }, true), /COMMAND_IDEMPOTENCY_CONFLICT/);
    assert.throws(() => gateway.command({ principal: { admin: false } }, { command: { ...settlement, id: randomUUID() } }, true),
      /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
    const after = f.store.snapshot();
    assert.equal(after.transitions.find(value => value.id === transitionID).status, 'failed');
    assert.equal(after.transitions.find(value => value.id === mcp.id).status, 'established');
    assert.equal(after.transitions.find(value => value.id === provider.id).status, 'established');
    return;
  }
  f.apply('worktree.settle', { transitionID, outcome: 'uncertain', actualLocation: f.plan.from,
    configurationDigest: authority, authorityDigest: authority, receiptID: randomUUID() }, f.adapter);
  f.restart();
  assert.equal(f.store.snapshot().transitions.find(v => v.id === transitionID).status, 'uncertain');
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), f.store.snapshot().transitions.find(v => v.id === transitionID),
    f.member, 1000, [f.member], 'bind-destination-grant'), /WORKTREE_TRANSITION_NOT_PENDING/);
  const exports = new ControlArchives(privateTemp(join(tmpdir(), 'turnlink-destination-owners-export-')));
  t.after(() => rmSync(exports.directory, { recursive: true, force: true }));
  const exportID = randomUUID(); f.store.exportTo(exports, exportID, 1001);
  const path = exports.path(exportID), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36); rows[0].schemaVersion = 27;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(exportID), /CONTROL_EXPORT_INVALID/);
  const cancelledState = structuredClone(f.store.snapshot()), cancelledTransition = cancelledState.transitions.find(v => v.id === transitionID);
  Object.assign(cancelledTransition, { status: 'failed', destinationCancellation: cancellation });
  validateControlState(cancelledState);
  f.store.db.prepare('UPDATE control_state SET body=? WHERE singleton=1').run(JSON.stringify(cancelledState));
  const cancellationExportID = randomUUID(); f.store.exportTo(exports, cancellationExportID, 1002);
  const cancellationPath = exports.path(cancellationExportID), cancellationRows = readFileSync(cancellationPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(cancellationRows[0].schemaVersion, 36); cancellationRows[0].schemaVersion = 28;
  const cancellationBody = cancellationRows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  cancellationRows.at(-1).contentBytes = Buffer.byteLength(cancellationBody);
  cancellationRows.at(-1).contentDigest = createHash('sha256').update(cancellationBody).digest('hex');
  writeFileSync(cancellationPath, cancellationBody + JSON.stringify(cancellationRows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(exports.directory).describe(cancellationExportID), /CONTROL_EXPORT_INVALID/);
  f.store.db.exec('PRAGMA user_version=28');
  assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});
