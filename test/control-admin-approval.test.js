import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { discloseWorktreeApproval, worktreeApprovalForPreview, managedWorktreeReview } from '../src/control-admin-approval.js';
import { makeContainedSourceRetirement } from '../src/control/contained-source-retirement-contracts.js';
import { lifecycleDigest } from '../src/control/worktree-lifecycle-contracts.js';

test('operator approval discloses the exact v2 plan and requires its acknowledgement', () => {
  const plan = makeContainedSourceRetirement([{ names: ['fixture'], resourceID: randomUUID(), operationID: randomUUID(),
    containerID: 'a'.repeat(64), wrapperPID: 123, daemonID: 'fixture-daemon' }], { permitAdmittedEffectAfterNativeLoss: true });
  const authority = 'b'.repeat(64), preview = { id: randomUUID(), channel: 'dev', taskID: randomUUID(), agentId: `codex:${randomUUID()}`,
    from: '/source', to: '/destination', configurationDigest: authority, approved: false, at: 1000, claimGeneration: 1,
    binding: { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authority, destinationAuthorityDigest: authority,
      sources: [{ path: '/source/config', digest: authority }] },
    destinationOwners: { mcpTransitionID: randomUUID(), providerTransitionID: randomUUID(), mcpResourceID: randomUUID(), providerResourceID: randomUUID(), stepID: randomUUID() },
    sourceMcpShutdown: true, sourceRetirement: plan };
  const command = { op: 'worktree.approve', channel: 'dev', taskID: preview.taskID, previewID: preview.id,
    sourceRetirementDigest: plan.digest, admittedEffectAfterNativeLoss: 'may_complete' };
  const disclosure = discloseWorktreeApproval(command, { entries: [preview] });
  assert.deepEqual(disclosure.sourceRetirement, plan); assert.match(disclosure.warning, /may complete after native owner loss/);
  assert.throws(() => discloseWorktreeApproval({ ...command, sourceRetirementDigest: 'c'.repeat(64) }, { entries: [preview] }), /SOURCE_RETIREMENT_ACK_REQUIRED/);
  assert.throws(() => discloseWorktreeApproval({ ...command, admittedEffectAfterNativeLoss: undefined }, { entries: [preview] }), /SOURCE_RETIREMENT_ACK_REQUIRED/);
  assert.throws(() => discloseWorktreeApproval({ ...command, previewID: randomUUID() }, { entries: [preview] }), /WORKTREE_PREVIEW_UNAVAILABLE/);
});

test('worktree review includes the exact checkpoint and native observation acknowledgements', () => {
  const authority = 'b'.repeat(64), common = { id: randomUUID(), channel: 'dev', taskID: randomUUID(),
    from: '/source', to: '/destination', configurationDigest: authority, approved: false, at: 1000, claimGeneration: 1 };
  const sources = [{ path: '/source/config', digest: authority }];
  const codex = { ...common, agentId: `codex:${randomUUID()}`, binding: { harness: 'codex', projectID: 'fixture',
    sourceAuthorityDigest: authority, destinationAuthorityDigest: authority, sources, checkpointConfigSha256: 'c'.repeat(64) } };
  assert.equal(worktreeApprovalForPreview(codex).checkpointConfigSha256, codex.binding.checkpointConfigSha256);
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex'), holdID = randomUUID();
  const pluginFields = { version: 1, image: `sha256:${authority}`, bundleDigest: authority, guardDigest: authority,
    containerID: authority, daemonID: 'fixture', processID: 1, startedAt: 'fixture', nativeHoldID: holdID, executionEligible: false };
  const pairFields = { version: 1, source: { directory: '/source', holdID, revision: 1, authorityDigest: authority },
    destination: { directory: '/destination', holdID: randomUUID(), revision: 1, authorityDigest: authority, observerID: randomUUID() },
    comparison: 'unverified', executionEligible: false };
  const opencode = { ...common, agentId: 'opencode:ses_fixture', binding: { harness: 'opencode', projectID: 'fixture',
    sourceAuthorityDigest: authority, destinationAuthorityDigest: authority, sources,
    pluginProvenance: { ...pluginFields, digest: hash(pluginFields) }, nativeAuthorityObservation: { ...pairFields, digest: hash(pairFields) } } };
  assert.equal(worktreeApprovalForPreview(opencode).nativeAuthorityObservationDigest, opencode.binding.nativeAuthorityObservation.digest);
  assert.equal(Object.hasOwn(worktreeApprovalForPreview(opencode), 'checkpointConfigSha256'), false);
});

test('manual preview disclosure does not present path digest as configuration verification', () => {
  const preview = { id: randomUUID(), channel: 'dev', taskID: randomUUID(), agentId: 'opencode:fixture',
    from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64), approved: false, at: 1000, claimGeneration: 1, manualResume: true };
  const disclosure = discloseWorktreeApproval(worktreeApprovalForPreview(preview), { entries: [preview] });
  assert.match(disclosure.warning, /does not verify effective configuration/);
  assert.equal(disclosure.to, preview.to);
});

test('managed worktree review binds the exact preview and refuses altered or already decided approvals', () => {
  const id = randomUUID(), resourceID = randomUUID();
  const preview = { id, resourceID, kind: 'remove', phase: 'preview', agentId: 'codex:fixture', taskID: randomUUID(), claimGeneration: 1,
    repository: '/repo', common: '/repo/.git', destination: `/managed/${resourceID}/tree`, revision: 'a'.repeat(40),
    directory: { dev: 1, ino: 2 }, createdAt: 1000, expiresAt: 301000 };
  const record = { id, channel: 'dev', agentId: preview.agentId, hostId: 'local', preview,
    digest: lifecycleDigest(preview), status: 'pending', policyRevision: 0, at: 1001 };
  const result = managedWorktreeReview(record, 'dev', id);
  assert.deepEqual(result.approval, { op: 'managed.approve', channel: 'dev', previewID: id, digest: record.digest });
  assert.match(result.warning, /does not prove the worktree is unused/);
  assert.throws(() => managedWorktreeReview({ ...record, preview: { ...preview, destination: '/different' } }, 'dev', id), /MANAGED_PREVIEW_UNAVAILABLE/);
  assert.throws(() => managedWorktreeReview(record, 'other', id), /MANAGED_PREVIEW_UNAVAILABLE/);
  assert.throws(() => managedWorktreeReview(record, 'dev', randomUUID()), /MANAGED_PREVIEW_UNAVAILABLE/);
  assert.equal(managedWorktreeReview({ ...record, status: 'rejected' }, 'dev', id).approval, undefined);
});
