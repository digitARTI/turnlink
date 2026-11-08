import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ControlArchives } from '../src/control/archives.js';
import { privateTemp } from '../src/storage.js';
import { ControlStore } from '../src/control/store.js';
import { Command, validateControlState } from '../src/control/contracts.js';
import { authorizeWorktreeGrant } from '../src/control/worktree-authorization.js';
import { readyTasks } from '../src/control/reducer.js';
import { protectedHistory } from '../src/control/history.js';

// Broker contract fixtures; no assertion that these references prove native readiness.
function fixture(t, task = {}) {
  const root = privateTemp(join(tmpdir(), 'turnlink-provider-establishment-'));
  let store = new ControlStore(root), now = 1000;
  const agentId = `codex:${randomUUID()}`, member = { agentId, harness: 'codex', connected: true, channel: 'dev' };
  const adapter = { kind: 'adapter', agentId }, participant = { kind: 'participant', agentId };
  const apply = (op, fields = {}, actor = { kind: 'operator' }) => {
    const command = { id: randomUUID(), op, channel: 'dev', ...fields };
    return { command, result: store.apply(command, { actor, members: [member], now }) };
  };
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  apply('channel.configure');
  const taskID = apply('task.create', { title: 'Context only', instructions: 'Construct context', criteria: 'No movement', ...task }).command.id;
  apply('task.claim', { taskID }, participant);
  const plan = { id: randomUUID(), kind: 'provider_factory', harness: 'codex', processGeneration: randomUUID(), agentId,
    reservation: { generation: randomUUID(), revision: 1 }, from: '/source', to: '/destination', providerID: 'selected-provider', family: 'configured', digest: 'a'.repeat(64) };
  const preview = () => apply('worktree.preview', { taskID, from: plan.from, to: plan.to, configurationDigest: plan.digest,
    purpose: 'establish-provider', providerPlan: plan }, adapter).command.id;
  const evidence = fields => apply('evidence.record', { entityID: taskID, kind: 'capability', ...fields }, adapter).command.id;
  const prepare = () => {
    evidence({ sameConversationWorktree: false, nativeProviderFactory: true });
    apply('evidence.record', { entityID: taskID, kind: 'idle' }, adapter);
    const previewID = preview(); apply('worktree.approve', { taskID, previewID });
    const begin = apply('worktree.begin', { taskID, previewID, claimGeneration: 1, configurationDigest: plan.digest, purpose: 'establish-provider' }, adapter).command;
    return store.snapshot().transitions.find(v => v.id === begin.id);
  };
  const receipt = grant => ({ transitionID: grant.id, planID: plan.id, reservation: plan.reservation, resourceID: randomUUID(), processGeneration: plan.processGeneration, kind: 'provider_factory', phase: 'constructed' });
  const settle = (grant, outcome, fields = {}) => apply('worktree.settle', { transitionID: grant.id, purpose: 'establish-provider', outcome,
    actualLocation: plan.from, configurationDigest: plan.digest, receiptID: randomUUID(), ...fields }, adapter);
  return { apply, prepare, preview, evidence, receipt, settle, plan, taskID, member, adapter, participant,
    get store() { return store; }, restart: () => { store.close(); store = new ControlStore(root); }, advance: ms => { now += ms; } };
}

test('provider-context approval needs no fabricated movement capability or destination authority', t => {
  const f = fixture(t), grant = f.prepare();
  assert.equal(grant.purpose, 'establish-provider'); assert.equal(grant.authorityDigest, undefined);
  assert.equal(f.store.snapshot().evidence.find(e => e.kind === 'capability').sameConversationWorktree, false);
  assert.deepEqual(authorizeWorktreeGrant(f.store.snapshot(), grant, f.member, 1000, [f.member]).grant, grant);
  assert.throws(() => f.apply('worktree.settle', { transitionID: grant.id, outcome: 'moved', actualLocation: f.plan.to,
    authorityDigest: 'a'.repeat(64), configurationDigest: f.plan.digest, receiptID: randomUUID() }, f.adapter), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.equal(f.store.snapshot().tasks[0].status, 'claimed');
});

test('construction success retains task, conversation and history holds through restart', t => {
  const f = fixture(t), grant = f.prepare(), resourceReceipt = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt }); f.restart();
  const state = f.store.snapshot(); assert.equal(state.transitions[0].status, 'established');
  assert.deepEqual(state.transitions[0].resourceReceipt, resourceReceipt);
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
  assert.throws(() => f.apply('task.reassign', { taskID: f.taskID }), /WORKTREE_TRANSITION_UNRESOLVED/);
  assert.throws(() => f.preview(), /WORKTREE_TRANSITION_UNRESOLVED/);
  const other = f.apply('task.create', { title: 'Other', instructions: 'No dispatch', criteria: 'Held', requiresWorktree: false }).command.id;
  f.apply('task.claim', { taskID: other }, f.participant);
  const capabilityEvidenceID = f.apply('evidence.record', { entityID: other, kind: 'capability', sameConversationWorktree: false }, f.adapter).command.id;
  assert.deepEqual(readyTasks(f.store.snapshot(), 'dev', 1000), []);
  assert.throws(() => f.apply('task.prepare', { taskID: other, capabilityEvidenceID }, { kind: 'scheduler' }), /WORKTREE_TRANSITION_UNRESOLVED/);
  const pins = protectedHistory(f.store.snapshot(), [], 999999999);
  assert.ok(pins.ids.has(grant.id)); assert.ok(pins.ids.has(f.taskID));
  assert.equal(f.store.storageStatus().unresolved.transitions, 1);
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
});

test('constructed ownership cannot be laundered into failure, replayed readiness or movement', t => {
  const f = fixture(t), grant = f.prepare(), resourceReceipt = f.receipt(grant);
  const established = f.settle(grant, 'established', { resourceReceipt }).command;
  assert.throws(() => f.settle(grant, 'failed'), /RESOURCE_OWNERSHIP_RETAINED/);
  f.settle(grant, 'uncertain');
  assert.throws(() => f.settle(grant, 'failed'), /RESOURCE_OWNERSHIP_RETAINED/);
  f.store.apply(established, { actor: f.adapter, members: [f.member], now: 1000 });
  assert.equal(f.store.snapshot().transitions[0].status, 'uncertain');
  assert.deepEqual(f.store.snapshot().transitions[0].resourceReceipt, resourceReceipt);
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), grant, f.member, 1000, [f.member]), /WORKTREE_TRANSITION_NOT_PENDING/);
});

test('resource receipts and scope must match the native plan and remain at the source', t => {
  const f = fixture(t), grant = f.prepare();
  for (const patch of [{ processGeneration: randomUUID() }, { planID: randomUUID() }, { transitionID: randomUUID() }, { reservation: { generation: randomUUID(), revision: 1 } }])
    assert.throws(() => f.settle(grant, 'established', { resourceReceipt: { ...f.receipt(grant), ...patch } }), /RESOURCE_PLAN_MISMATCH/);
  assert.throws(() => f.settle(grant, 'established', { resourceReceipt: f.receipt(grant), actualLocation: f.plan.to }), /CONFIGURATION_CHANGED/);
  const changed = structuredClone(f.store.snapshot()); changed.transitions[0].providerPlan.providerID = 'retagged';
  assert.throws(() => validateControlState(changed), /Invalid worktree scope/);
});

test('a resource approval cannot satisfy task movement approval after a known no-effect failure', t => {
  const f = fixture(t), grant = f.prepare(); f.settle(grant, 'failed');
  const capabilityEvidenceID = f.evidence({ sameConversationWorktree: true, nativeProviderFactory: true });
  assert.throws(() => f.apply('task.prepare', { taskID: f.taskID, capabilityEvidenceID }, { kind: 'scheduler' }), /WORKTREE_PREVIEW_APPROVAL_REQUIRED/);
});

test('strict scope shapes reject movement authority, arbitrary resource kinds and mixed receipts', () => {
  const base = { id: randomUUID(), op: 'worktree.begin', channel: 'dev', taskID: randomUUID(), previewID: randomUUID(), claimGeneration: 1, configurationDigest: 'a'.repeat(64) };
  assert.throws(() => Command.parse(base));
  assert.throws(() => Command.parse({ ...base, purpose: 'establish-provider', authorityDigest: 'a'.repeat(64) }));
  assert.ok(Command.parse({ ...base, purpose: 'establish-provider' }));
});

test('schema 17 migrates legacy state but cannot disguise established-resource records', t => {
  const f = fixture(t);
  f.store.db.exec('PRAGMA user_version=17'); f.restart();
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 36);
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) });
  f.store.db.exec('PRAGMA user_version=17');
  assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});


function cleanupReceipt(f, resource) {
  return { cleanupID: randomUUID(), resource, sourceCwd: f.plan.from, kind: 'provider_factory', phase: 'owner_released' };
}

test('provider fence release requires an exact settled cleanup and no other broker holds', t => {
  const f = fixture(t), grant = f.prepare(), resource = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt: resource });
  const established = f.store.snapshot().transitions[0];
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), established, f.member, 1000, [f.member], 'release-provider'), /WORKTREE_TRANSITION_NOT_PENDING/);
  f.settle(grant, 'failed', { cleanupReceipt: cleanupReceipt(f, resource) });
  const state = f.store.snapshot(), released = state.transitions[0];
  assert.deepEqual(authorizeWorktreeGrant(state, released, f.member, 1000, [f.member], 'release-provider').grant, released);
  const held = structuredClone(state);
  held.transitions.push({ ...released, id: randomUUID(), status: 'uncertain' });
  assert.throws(() => authorizeWorktreeGrant(held, released, f.member, 1000, [f.member], 'release-provider'), /WORKTREE_TRANSITION_UNRESOLVED/);
  assert.throws(() => authorizeWorktreeGrant(state, { ...released, receiptID: randomUUID() }, f.member, 1000, [f.member], 'release-provider'), /STALE_WORKTREE_GRANT/);
  assert.throws(() => authorizeWorktreeGrant(state, released, { ...f.member, connected: false }, 1000, [], 'release-provider'), /ELIGIBLE_MEMBER_REQUIRED/);
});

test('exact unpublished-owner cleanup releases the hold, preserves proof and cannot authorize movement', t => {
  const f = fixture(t), grant = f.prepare(), resourceReceipt = f.receipt(grant);
  f.settle(grant, 'established', { resourceReceipt }); f.restart();
  const current = f.store.snapshot().transitions[0];
  f.evidence({ nativeProviderFactory: false, sameConversationWorktree: false });
  f.apply('evidence.record', { entityID: f.taskID, kind: 'busy' }, f.adapter);
  assert.deepEqual(authorizeWorktreeGrant(f.store.snapshot(), current, f.member, 1000, [f.member], 'cleanup-provider').grant, current);
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), current, f.member, 1000, [f.member], 'observe-worktree'), /WORKTREE_EFFECT_SCOPE_MISMATCH/);
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), current, f.member, 1000, [f.member]), /WORKTREE_TRANSITION_NOT_PENDING/);
  f.settle(grant, 'failed', { cleanupReceipt: cleanupReceipt(f, resourceReceipt) }); f.restart();
  const value = f.store.snapshot().transitions[0];
  assert.equal(value.status, 'failed'); assert.deepEqual(value.resourceReceipt, resourceReceipt);
  assert.equal(value.cleanupReceipt.phase, 'owner_released'); assert.equal(f.store.storageStatus().unresolved.transitions, 0);
  f.apply('evidence.record', { entityID: f.taskID, kind: 'idle' }, f.adapter);
  const cap = f.evidence({ nativeProviderFactory: false, sameConversationWorktree: true });
  assert.throws(() => f.apply('task.prepare', { taskID: f.taskID, capabilityEvidenceID: cap }, { kind: 'scheduler' }), /WORKTREE_PREVIEW_APPROVAL_REQUIRED/);
  f.apply('task.release', { taskID: f.taskID }, f.participant);
});

test('missing, foreign or changed cleanup proof cannot clear constructed resource ownership', t => {
  const f = fixture(t), grant = f.prepare(), resourceReceipt = f.receipt(grant); f.settle(grant, 'established', { resourceReceipt });
  assert.throws(() => f.settle(grant, 'failed'), /RESOURCE_OWNERSHIP_RETAINED/);
  for (const patch of [{ resourceID: randomUUID() }, { processGeneration: randomUUID() }, { planID: randomUUID() }, { reservation: { generation: randomUUID(), revision: 1 } }]) {
    assert.throws(() => f.settle(grant, 'failed', { cleanupReceipt: cleanupReceipt(f, { ...resourceReceipt, ...patch }) }), /RESOURCE_CLEANUP_MISMATCH/);
  }
  assert.throws(() => f.settle(grant, 'failed', { cleanupReceipt: { ...cleanupReceipt(f, resourceReceipt), sourceCwd: f.plan.to } }), /RESOURCE_CLEANUP_MISMATCH/);
  assert.equal(f.store.snapshot().transitions[0].status, 'established');
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
});

test('cleanup proof is scoped, requires exact current ownership and cannot be disguised as schema 18', t => {
  const f = fixture(t), grant = f.prepare(), resourceReceipt = f.receipt(grant); f.settle(grant, 'established', { resourceReceipt });
  const cleanup = cleanupReceipt(f, resourceReceipt);
  assert.throws(() => f.settle(grant, 'uncertain', { cleanupReceipt: cleanup }));
  f.settle(grant, 'failed', { cleanupReceipt: cleanup });
  const state = f.store.snapshot(); state.transitions[0].cleanupReceipt.resource.resourceID = randomUUID();
  assert.throws(() => validateControlState(state), /Invalid provider cleanup receipt/);
  f.store.db.exec('PRAGMA user_version=18'); assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});


test('cancelled setup can release its exact unpublished owner without reviving the task', t => {
  const f = fixture(t, { schedule: { at: 1000, missed: 'ask', maxLatenessMs: 1000 } });
  const grant = f.prepare(), resourceReceipt = f.receipt(grant); f.settle(grant, 'established', { resourceReceipt });
  f.apply('task.missed', { taskID: f.taskID, run: false });
  const current = f.store.snapshot().transitions[0];
  assert.equal(f.store.snapshot().tasks[0].status, 'cancelled');
  assert.deepEqual(authorizeWorktreeGrant(f.store.snapshot(), current, f.member, 1000, [f.member], 'cleanup-provider').grant, current);
  f.settle(grant, 'failed', { cleanupReceipt: cleanupReceipt(f, resourceReceipt) });
  assert.equal(f.store.snapshot().tasks[0].status, 'cancelled'); assert.equal(f.store.storageStatus().unresolved.transitions, 0);
});


test('approved native model-context owners keep their distinct scope and exact cleanup across restart', t => {
  const f = fixture(t);
  f.plan.kind = 'provider_context';
  f.plan.modelContext = { model: 'selected-model', catalogSource: 'configured', apiKeyDiscovery: true, cache: 'native' };
  const grant = f.prepare(), receipt = { ...f.receipt(grant), kind: 'provider_context' };
  assert.deepEqual(grant.providerPlan.modelContext, f.plan.modelContext);
  assert.throws(() => f.settle(grant, 'established', { resourceReceipt: f.receipt(grant) }), /RESOURCE_PLAN_MISMATCH/);
  f.settle(grant, 'established', { resourceReceipt: receipt }); f.restart();
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
  const cleanup = { cleanupID: randomUUID(), resource: receipt, sourceCwd: f.plan.from, kind: 'provider_context', phase: 'owner_released' };
  assert.throws(() => f.settle(grant, 'failed', { cleanupReceipt: { ...cleanup, kind: 'provider_factory' } }));
  f.settle(grant, 'failed', { cleanupReceipt: cleanup });
  f.apply('task.release', { taskID: f.taskID }, f.participant);
});

test('schema 19 cannot disguise a model-context owner or migrate away its hold', t => {
  const f = fixture(t);
  f.plan.kind = 'provider_context';
  f.plan.modelContext = { model: 'selected-model', catalogSource: 'provider-default', apiKeyDiscovery: false, cache: 'native' };
  f.prepare();
  f.store.db.exec('PRAGMA user_version=19');
  assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('model context disclosure cannot extend a factory-only plan or hide external effects', () => {
  const base = { id: randomUUID(), op: 'worktree.preview', channel: 'dev', taskID: randomUUID(), from: '/a', to: '/b', configurationDigest: 'a'.repeat(64), purpose: 'establish-provider' };
  const plan = { id: randomUUID(), kind: 'provider_context', harness: 'codex', processGeneration: randomUUID(), agentId: 'codex:test', reservation: { generation: randomUUID(), revision: 0 }, from: '/a', to: '/b', providerID: 'p', family: 'configured', digest: 'a'.repeat(64), modelContext: { model: 'm', catalogSource: 'configured', apiKeyDiscovery: false, cache: 'native' } };
  assert.ok(Command.parse({ ...base, providerPlan: plan }));
  for (const changed of [{ ...plan, kind: 'provider_factory' }, { ...plan, modelContext: undefined }, { ...plan, modelContext: { ...plan.modelContext, refresh: true } }])
    assert.throws(() => Command.parse({ ...base, providerPlan: changed }));
});


test('schema 20 export preserves model-context holds and rejects a correctly rehashed schema 19 disguise', t => {
  const f = fixture(t);
  f.plan.kind = 'provider_context';
  f.plan.modelContext = { model: 'selected', catalogSource: 'configured', apiKeyDiscovery: false, cache: 'native' };
  const grant = f.prepare(); f.settle(grant, 'established', { resourceReceipt: { ...f.receipt(grant), kind: 'provider_context' } });
  const root = privateTemp(join(tmpdir(), 'turnlink-model-context-export-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const archives = new ControlArchives(root), id = randomUUID(); f.store.exportTo(archives, id, 1001);
  const path = archives.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36);
  assert.deepEqual(new ControlArchives(root).describe(id), archives.describe(id));
  rows[0].schemaVersion = 19;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body);
  rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(root).describe(id), /CONTROL_EXPORT_INVALID/);
});

test('schema 19 factory command fingerprints survive migration and exact retries', t => {
  const f = fixture(t);
  f.evidence({ nativeProviderFactory: true, sameConversationWorktree: false });
  f.apply('evidence.record', { entityID: f.taskID, kind: 'idle' }, f.adapter);
  const preview = f.apply('worktree.preview', { taskID: f.taskID, from: f.plan.from, to: f.plan.to,
    configurationDigest: f.plan.digest, purpose: 'establish-provider', providerPlan: f.plan }, f.adapter);
  // This literal retains schema 19's original factory-plan canonical field order.
  const legacy = { ...Command.parse(preview.command), providerPlan: { id: f.plan.id, kind: 'provider_factory', harness: 'codex',
    processGeneration: f.plan.processGeneration, agentId: f.plan.agentId, reservation: f.plan.reservation,
    from: f.plan.from, to: f.plan.to, providerID: f.plan.providerID, family: f.plan.family, digest: f.plan.digest } };
  const fingerprint = createHash('sha256').update(JSON.stringify({ command: legacy, actor: f.adapter })).digest('hex');
  f.store.db.prepare('UPDATE commands SET fingerprint=? WHERE id=?').run(fingerprint, preview.command.id);
  f.store.db.exec('PRAGMA user_version=19'); f.restart();
  const result = f.store.apply(preview.command, { actor: f.adapter, members: [f.member], now: 1000 });
  assert.equal(result.replayed, true);
  assert.equal(result.commandID, preview.command.id);
  assert.equal(f.store.snapshot().previews.length, 1);
});


test('native retained ownership is recorded as uncertain and cannot become established or replace another resource', t => {
  const f = fixture(t), grant = f.prepare(), resource = { ...f.receipt(grant), phase: 'retained' };
  assert.throws(() => f.settle(grant, 'established', { resourceReceipt: resource }), /RESOURCE_PLAN_MISMATCH/);
  f.settle(grant, 'uncertain', { resourceReceipt: resource }); f.restart();
  const current = f.store.snapshot().transitions[0];
  assert.equal(current.status, 'uncertain');
  assert.throws(() => f.settle(grant, 'uncertain', { resourceReceipt: { ...resource, resourceID: randomUUID() } }), /RESOURCE_OWNERSHIP_RETAINED/);
  assert.throws(() => f.settle(grant, 'failed'), /RESOURCE_OWNERSHIP_RETAINED/);
  const state = f.store.snapshot(); state.transitions[0].status = 'established';
  assert.throws(() => validateControlState(state));
  f.evidence({ nativeProviderFactory: false, sameConversationWorktree: false });
  f.apply('evidence.record', { entityID: f.taskID, kind: 'busy' }, f.adapter);
  assert.deepEqual(authorizeWorktreeGrant(f.store.snapshot(), current, f.member, 1000, [f.member], 'observe-provider').grant, current);
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), current, f.member, 1000, [f.member]), /WORKTREE_TRANSITION_NOT_PENDING/);
  f.settle(grant, 'failed', { cleanupReceipt: cleanupReceipt(f, resource) });
  f.apply('task.release', { taskID: f.taskID }, f.participant);
});

test('schema 20 cannot disguise retained native ownership records', t => {
  const f = fixture(t), grant = f.prepare();
  f.settle(grant, 'uncertain', { resourceReceipt: { ...f.receipt(grant), phase: 'retained' } });
  f.store.db.exec('PRAGMA user_version=20');
  assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});

test('retained native ownership export cannot be rehashed as schema 20', t => {
  const f = fixture(t), grant = f.prepare();
  f.settle(grant, 'uncertain', { resourceReceipt: { ...f.receipt(grant), phase: 'retained' } });
  const root = privateTemp(join(tmpdir(), 'turnlink-retained-export-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const archives = new ControlArchives(root), id = randomUUID(); f.store.exportTo(archives, id, 1001);
  const path = archives.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36);
  assert.deepEqual(new ControlArchives(root).describe(id), archives.describe(id));
  rows[0].schemaVersion = 20;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body); rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(root).describe(id), /CONTROL_EXPORT_INVALID/);
});


test('catalog effects have a separate immutable approval and survive restart with their hold', t => {
  const f = fixture(t);
  f.plan.kind = 'provider_catalog';
  f.plan.modelContext = { model: 'selected', catalogSource: 'provider-default', apiKeyDiscovery: true, cache: 'native' };
  f.plan.catalogEffects = { network: 'native-provider-catalog', credentials: 'native-provider-auth', cache: 'native-model-cache' };
  const grant = f.prepare();
  const altered = structuredClone(grant); delete altered.providerPlan.catalogEffects;
  assert.throws(() => authorizeWorktreeGrant(f.store.snapshot(), altered, f.member, 1000, [f.member]));
  f.settle(grant, 'established', { resourceReceipt: { ...f.receipt(grant), kind: 'provider_catalog' } });
  f.restart();
  assert.deepEqual(f.store.snapshot().transitions[0].providerPlan.catalogEffects, f.plan.catalogEffects);
  assert.throws(() => f.apply('task.release', { taskID: f.taskID }, f.participant), /WORKTREE_TRANSITION_UNRESOLVED/);
  f.store.db.exec('PRAGMA user_version=21');
  assert.throws(() => f.restart(), /UNSUPPORTED_CONTROL_SCHEMA/);
});


test('catalog export cannot be rehashed as schema 21 to erase its effect scope', t => {
  const f = fixture(t);
  f.plan.kind = 'provider_catalog';
  f.plan.modelContext = { model: 'selected', catalogSource: 'provider-default', apiKeyDiscovery: true, cache: 'native' };
  f.plan.catalogEffects = { network: 'native-provider-catalog', credentials: 'native-provider-auth', cache: 'native-model-cache' };
  f.prepare();
  const root = privateTemp(join(tmpdir(), 'turnlink-catalog-export-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const archives = new ControlArchives(root), id = randomUUID(); f.store.exportTo(archives, id, 1001);
  const path = archives.path(id), rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, 36);
  rows[0].schemaVersion = 21;
  const body = rows.slice(0, -1).map(row => JSON.stringify(row) + '\n').join('');
  rows.at(-1).contentBytes = Buffer.byteLength(body);
  rows.at(-1).contentDigest = createHash('sha256').update(body).digest('hex');
  writeFileSync(path, body + JSON.stringify(rows.at(-1)) + '\n', { mode: 0o600 });
  assert.throws(() => new ControlArchives(root).describe(id), /CONTROL_EXPORT_INVALID/);
});
