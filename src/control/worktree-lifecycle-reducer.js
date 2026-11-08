import { transitionHoldsConversation } from './worktree-holds.js';
import { lifecycleDigest } from './worktree-lifecycle-contracts.js';
import { requireControl as check } from './policy.js';

// Filesystem approvals/intents/receipts only. No reducer performs Git or native
// effects; execution still needs a trusted participant-host exclusion port.
export function reduceManagedWorktree({ state, command, actor, channel, now, member, emit, incident }) {
  const lookup = () => {
    const value = state.managedPreviews.find(p => p.id === command.previewID && p.channel === channel.id);
    check(value, 'MANAGED_PREVIEW_NOT_FOUND'); return value;
  };
  const adapter = value => {
    check(actor.kind === 'adapter' && actor.agentId === value.agentId, 'ADAPTER_REQUIRED'); member(actor.agentId, true);
  };
  const claim = value => {
    const p = value.preview, task = state.tasks.find(t => t.id === p.taskID && t.channel === channel.id);
    check(task?.claimant === value.agentId && task.claimGeneration === p.claimGeneration &&
      (p.kind === 'create' ? task.status === 'claimed' : ['claimed', 'completed', 'cancelled'].includes(task.status)), 'STALE_TASK_CLAIM');
    if (p.kind === 'remove') {
      check(!state.incidents.some(i => i.channel === channel.id && i.status === 'open' && [p.taskID, p.resourceID, p.id].includes(i.entityID)), 'MANAGED_EVIDENCE_UNRESOLVED');
      check(!state.managedPreviews.some(v => v.id !== value.id && v.preview.resourceID === p.resourceID && v.status === 'removed'), 'MANAGED_RESOURCE_REMOVED');
    }
    return task;
  };
  const fresh = value => {
    check(value.preview.createdAt <= now && value.preview.expiresAt > now, 'STALE_WORKTREE_PREVIEW');
    check(value.digest === command.digest, 'MANAGED_PREVIEW_DIGEST_MISMATCH'); claim(value);
  };
  const idle = value => {
    check(!state.tasks.some(t => t.claimant === value.agentId && (t.terminalHold || ['dispatching', 'running', 'uncertain'].includes(t.status) ||
      (t.status === 'review' && !t.stoppedEvidence))), 'EXECUTION_MAY_BE_ACTIVE');
    check(!state.transitions.some(t => t.agentId === value.agentId && transitionHoldsConversation(t)), 'WORKTREE_TRANSITION_UNRESOLVED');
    check(!state.managedPreviews.some(v => v.id !== value.id && v.agentId === value.agentId && ['executing', 'uncertain'].includes(v.status)), 'MANAGED_WORKTREE_UNRESOLVED');
  };
  if (command.op === 'managed.preview') {
    const p = command.preview;
    adapter(p);
    check(!state.managedPreviews.some(v => v.id === p.id), 'MANAGED_PREVIEW_EXISTS');
    check(p.createdAt <= now && p.expiresAt > now, 'STALE_WORKTREE_PREVIEW');
    const value = { id: p.id, channel: channel.id, agentId: p.agentId, hostId: command.hostId, preview: p, digest: lifecycleDigest(p),
      status: 'pending', policyRevision: channel.policyRevision, at: now };
    claim(value); idle(value);
    state.managedPreviews.push(value); emit('managed.previewed', value.id); return;
  }
  const value = lookup();
  if (command.op === 'managed.approve' || command.op === 'managed.reject') {
    check(actor.kind === 'operator', 'OPERATOR_REQUIRED');
    check(value.status === 'pending', 'MANAGED_PREVIEW_NOT_PENDING');
    check(value.digest === command.digest, 'MANAGED_PREVIEW_DIGEST_MISMATCH');
    if (command.op === 'managed.reject') { value.status = 'rejected'; emit('managed.rejected', value.id); return; }
    fresh(value); idle(value); value.status = 'approved'; value.approvedAt = now; value.policyRevision = channel.policyRevision;
    emit('managed.approved', value.id); return;
  }
  if (command.op === 'managed.confirm_manual') {
    check(actor.kind === 'operator', 'OPERATOR_REQUIRED');
    check(value.status === 'approved', 'MANAGED_PREVIEW_NOT_APPROVED');
    fresh(value); idle(value); check(value.policyRevision === channel.policyRevision, 'STALE_POLICY');
    value.manualConfirmation = { id: command.id, at: now, scope: command.acknowledgement };
    emit('managed.manual_confirmed', value.id); return;
  }
  adapter(value);
  if (command.op === 'managed.begin' || command.op === 'managed.revalidate') {
    check(value.status === (command.op === 'managed.begin' ? 'approved' : 'executing'), 'MANAGED_PREVIEW_NOT_APPROVED');
    fresh(value); idle(value); check(value.policyRevision === channel.policyRevision, 'STALE_POLICY');
    if (command.manualConfirmationID) check(value.manualConfirmation?.id === command.manualConfirmationID, 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    if (command.op === 'managed.begin') {
      value.status = 'executing'; value.intentID = command.id; emit('managed.executing', value.id);
    } else check(value.intentID === command.intentID, 'MANAGED_INTENT_MISMATCH');
    return;
  }
  check(['executing', 'uncertain'].includes(value.status) && value.intentID === command.intentID, 'MANAGED_INTENT_MISMATCH');
  check(command.receiptID === command.id, 'MANAGED_RECEIPT_MISMATCH');
  const p = value.preview;
  check(command.outcome !== 'created' || (p.kind === 'create' && !!command.directory), 'MANAGED_OUTCOME_MISMATCH');
  check(command.outcome !== 'removed' || p.kind === 'remove', 'MANAGED_OUTCOME_MISMATCH');
  check(command.outcome === 'created' || command.directory === undefined, 'MANAGED_OUTCOME_MISMATCH');
  // No-effect failure needs host-journal proof before native invocation; an
  // uncertain admitted operation cannot later be recast as never invoked.
  check(value.status !== 'uncertain' || command.outcome !== 'failed', 'MANAGED_RECOVERY_EVIDENCE_REQUIRED');
  value.status = command.outcome; value.receiptID = command.receiptID; value.settledAt = now;
  if (command.directory) value.directory = command.directory;
  emit(`managed.${command.outcome}`, value.id);
  if (command.outcome === 'uncertain') incident('admission', value.id);
}
