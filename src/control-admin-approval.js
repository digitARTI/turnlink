import { WorktreePreview } from './control/contracts.js';
import { ManagedPreview, lifecycleDigest } from './control/worktree-lifecycle-contracts.js';

// Read-only preparation for a separately authorized managed Git operation.
export function managedWorktreeReview(input, channel, previewID) {
  const record = ManagedPreview.parse(input);
  if (record.channel !== channel || record.id !== previewID || record.preview.id !== previewID ||
      lifecycleDigest(record.preview) !== record.digest) throw new Error('MANAGED_PREVIEW_UNAVAILABLE');
  return { preview: record, ...(record.status === 'pending' ? { approval: {
    op: 'managed.approve', channel, previewID, digest: record.digest,
  } } : {}), warning: record.preview.kind === 'remove'
    ? 'Removal requires separate operator approval and verified use-safety; this review does not prove the worktree is unused or authorize deletion.'
    : 'This review does not authorize creation or prove native exclusion; the broker and host must still enforce their checks.' };
}

// Produce the exact acknowledgement required by the preview. This only
// prepares a command for operator review; it does not approve the move.
export function worktreeApprovalForPreview(input) {
  const preview = WorktreePreview.parse(input);
  return { op: 'worktree.approve', channel: preview.channel, taskID: preview.taskID, previewID: preview.id,
    ...(preview.binding?.checkpointConfigSha256 ? { checkpointConfigSha256: preview.binding.checkpointConfigSha256 } : {}),
    ...(preview.binding?.nativeAuthorityObservation ? { nativeAuthorityObservationDigest: preview.binding.nativeAuthorityObservation.digest } : {}),
    ...(preview.sourceRetirement?.version === 2 ? { sourceRetirementDigest: preview.sourceRetirement.digest, admittedEffectAfterNativeLoss: 'may_complete' } : {}) };
}

// Used only by the local operator CLI. It discloses the exact preview before
// sending approval and requires the caller's acknowledgement and digest.
export function discloseWorktreeApproval(command, page) {
  if (command?.op !== 'worktree.approve' || !Array.isArray(page?.entries) || page.entries.length !== 1) throw new Error('WORKTREE_PREVIEW_UNAVAILABLE');
  const preview = WorktreePreview.parse(page.entries[0]);
  if (preview.id !== command.previewID || preview.taskID !== command.taskID || preview.channel !== command.channel) throw new Error('WORKTREE_PREVIEW_UNAVAILABLE');
  if (preview.manualResume) return { warning: 'Manual session resume: this preview identifies the task and paths. Its digest does not verify effective configuration, native writer exclusion or receiver transfer.',
    previewID: preview.id, from: preview.from, to: preview.to };
  const plan = preview.sourceRetirement;
  if (plan?.version !== 2) return null;
  if (command.sourceRetirementDigest !== plan.digest || command.admittedEffectAfterNativeLoss !== 'may_complete')
    throw new Error('SOURCE_RETIREMENT_ACK_REQUIRED');
  return { warning: 'An already admitted contained-source operation may complete after native owner loss. Session, host and adapter revocation are intended to prevent new admissions; an uncertain operation must remain held until reconciled. Version 2 execution is currently disabled.',
    previewID: preview.id, sourceRetirement: plan };
}
