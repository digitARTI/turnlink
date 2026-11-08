import { providerEstablishment, sameProviderPlan } from './provider-establishment-contracts.js';
import { mcpEstablishment, sameMcpPlan } from './mcp-establishment-contracts.js';
import { transitionHoldsConversation, compatibleResourceHold, destinationOwnersMatch, destinationMovementHoldsOwner } from './worktree-holds.js';
import { WorktreeTransition } from './contracts.js';
import { requireControl as check } from './policy.js';

// A fresh broker-state check, not a transferable native execution capability.
// The gateway authenticates the actual adapter receiver before calling this.
// Never treat this result as a command receipt or proof of physical recovery.
export function authorizeWorktreeGrant(state, expected, agent, now, members, action) {
  const cleanup = action === 'cleanup-provider' || action === 'cleanup-mcp', observe = action === 'observe-provider' || action === 'observe-mcp',
    releaseProvider = action === 'release-provider',
    cancelDestination = action === 'cancel-destination-grant',
    shutdownSourceMcp = action === 'shutdown-source-mcp', observeSourceMcp = action === 'observe-source-mcp-shutdown',
    retireSource = action === 'retire-source-contained', observeRetirement = action === 'observe-source-contained-retirement',
    shutdownSourceModel = action === 'shutdown-source-model', observeSourceModel = action === 'observe-source-model-shutdown',
    bindDestination = action === 'bind-destination-grant' || action === 'handoff-receiver' || cancelDestination || shutdownSourceMcp || shutdownSourceModel || retireSource,
    placeWorktree = action === 'place-worktree', checkpointInspect = action === 'checkpoint-inspect',
    movedWorktree = action === 'observe-moved-worktree', checkCodexSource = action === 'check-codex-source-receiver',
    observeWorktree = action === 'observe-worktree' || action === 'seal-worktree-membership' || action === 'detach-worktree-membership' || movedWorktree || observeSourceMcp || observeSourceModel || observeRetirement || checkCodexSource, recovery = cleanup || observe || observeWorktree || releaseProvider || cancelDestination;
  check(action === undefined || recovery || placeWorktree || bindDestination || checkpointInspect, 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  const grant = WorktreeTransition.parse(expected);
  if (grant.checkpointConfigSha256) check(checkpointInspect || action === 'observe-worktree', 'CHECKPOINT_POLICY_UNVERIFIED');
  else check(!checkpointInspect, 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  // Until a complete execution graph and isolation are attested, an observed
  // provenance may be inspected for recovery but never authorize effects.
  if (grant.pluginProvenanceDigest && !['observe-worktree', 'observe-moved-worktree'].includes(action)) check(false, 'PLUGIN_PROVENANCE_UNVERIFIED');
  if (grant.nativeAuthorityObservationDigest && !['observe-worktree', 'observe-moved-worktree'].includes(action)) check(false, 'NATIVE_AUTHORITY_OBSERVATION_UNVERIFIED');
  const resource = providerEstablishment(grant) || mcpEstablishment(grant);
  if (cleanup || observe) check(action.endsWith('-mcp') ? mcpEstablishment(grant) : providerEstablishment(grant), 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (releaseProvider) check(providerEstablishment(grant), 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (observeWorktree || placeWorktree) check(!resource, 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (bindDestination) check(!resource && !!grant.destinationOwners && agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (shutdownSourceMcp || observeSourceMcp) check(!resource && !!grant.destinationOwners && grant.sourceMcpShutdown === true && agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (retireSource || observeRetirement) check(!resource && !!grant.destinationOwners && grant.sourceMcpShutdown === true && !!grant.sourceRetirement && agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (shutdownSourceModel || observeSourceModel) check(!resource && !!grant.destinationOwners && grant.sourceMcpShutdown === true && grant.sourceModelShutdown === true && agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  if (checkCodexSource) check(!resource && !!grant.destinationOwners && agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  check(grant.agentId === agent.agentId && grant.channel === agent.channel, 'TRANSITION_IDENTITY_MISMATCH');
  check(members.some(m => m.agentId === agent.agentId && m.channel === agent.channel && m.connected && m.harness === agent.harness), 'ELIGIBLE_MEMBER_REQUIRED');
  check(now >= state.lastNow, 'CLOCK_REGRESSION');
  const current = state.transitions.find(t => t.id === grant.id && t.channel === grant.channel && t.agentId === grant.agentId);
  check(releaseProvider ? providerEstablishment(grant) && current?.status === 'failed' && !!current.resourceReceipt && !!current.cleanupReceipt && current.actualLocation === current.from : observeWorktree ? !resource && (movedWorktree ? current?.status === 'moved' && !!current.receiptID && current.actualLocation === current.to : ['prepared', 'uncertain'].includes(current?.status)) : observe ? resource && !current?.cleanupReceipt && ['prepared', 'established', 'uncertain'].includes(current?.status) : cleanup ? resource && !!current?.resourceReceipt && !current.cleanupReceipt && ['established', 'uncertain'].includes(current.status) : current?.status === 'prepared', 'WORKTREE_TRANSITION_NOT_PENDING');
  check(JSON.stringify(WorktreeTransition.parse(current)) === JSON.stringify(grant), 'STALE_WORKTREE_GRANT');
  if (cleanup) check(!destinationMovementHoldsOwner(state, current), 'DESTINATION_MOVEMENT_UNRESOLVED');
  if (grant.destinationOwners) {
    check(destinationOwnersMatch(state, grant), 'DESTINATION_OWNERS_UNAVAILABLE');
    check(observeWorktree || bindDestination || checkpointInspect, 'DESTINATION_MOVEMENT_PROOF_REQUIRED');
  }
  const task = state.tasks.find(t => t.id === grant.taskID && t.channel === grant.channel);
  check((recovery ? task && ['claimed', 'cancelled'].includes(task.status) : task?.status === 'claimed') && task.claimant === grant.agentId && task.claimGeneration === grant.claimGeneration && (recovery || !task.terminalHold), 'STALE_TASK_CLAIM');
  const preview = recovery ? state.previews.find(p => p.id === grant.previewID) : [...state.previews].reverse().find(p => p.taskID === task.id && p.agentId === grant.agentId);
  check(preview?.id === grant.previewID && preview.approved && preview.claimGeneration === grant.claimGeneration && (providerEstablishment(grant) ? preview.providerPlan?.harness === agent.harness : mcpEstablishment(grant) ? preview.mcpPlan?.harness === agent.harness : preview.binding?.harness === agent.harness) &&
    preview.purpose === grant.purpose &&
    preview.channel === grant.channel && preview.from === grant.from && preview.to === grant.to && preview.configurationDigest === grant.configurationDigest &&
    preview.binding?.checkpointConfigSha256 === grant.checkpointConfigSha256 &&
    preview.binding?.pluginProvenance?.digest === grant.pluginProvenanceDigest &&
    preview.binding?.nativeAuthorityObservation?.digest === grant.nativeAuthorityObservationDigest &&
    preview.sourceMcpShutdown === grant.sourceMcpShutdown && preview.sourceModelShutdown === grant.sourceModelShutdown &&
    JSON.stringify(preview.sourceRetirement) === JSON.stringify(grant.sourceRetirement),
  'STALE_WORKTREE_PREVIEW');
  if (providerEstablishment(grant)) check(sameProviderPlan(grant.providerPlan, preview.providerPlan), 'RESOURCE_PLAN_MISMATCH');
  else if (mcpEstablishment(grant)) check(sameMcpPlan(grant.mcpPlan, preview.mcpPlan), 'RESOURCE_PLAN_MISMATCH');
  else check(preview.binding.sourceAuthorityDigest === grant.authorityDigest && preview.binding.destinationAuthorityDigest === grant.authorityDigest, 'PERMISSION_PRESERVATION_REQUIRED');
  // Recovery observation and exact unpublished-owner cleanup do not authorize
  // execution, and do not depend on a fresh construction capability.
  if (releaseProvider) {
    check(!state.transitions.some(t => t.agentId === agent.agentId && transitionHoldsConversation(t)), 'WORKTREE_TRANSITION_UNRESOLVED');
    check(!state.managedPreviews.some(p => p.agentId === agent.agentId && ['executing', 'uncertain'].includes(p.status)), 'MANAGED_WORKTREE_UNRESOLVED');
    check(!state.tasks.some(t => t.claimant === agent.agentId && (t.terminalHold || (['dispatching', 'running', 'uncertain', 'review'].includes(t.status) && !t.stoppedEvidence))), 'CONVERSATION_CAPACITY');
  }
  if (recovery) return { grant: structuredClone(current), checkedAt: now };
  check(!state.transitions.some(t => t.id !== grant.id && t.agentId === agent.agentId && transitionHoldsConversation(t) && !compatibleResourceHold(t, grant)), 'WORKTREE_TRANSITION_UNRESOLVED');
  check(!state.managedPreviews.some(p => p.agentId === agent.agentId && ['executing', 'uncertain'].includes(p.status)), 'MANAGED_WORKTREE_UNRESOLVED');
  check(!state.tasks.some(t => t.claimant === agent.agentId && (t.terminalHold || (['dispatching', 'running', 'uncertain', 'review'].includes(t.status) && !t.stoppedEvidence))), 'CONVERSATION_CAPACITY');
  const capability = [...state.evidence].reverse().find(e => e.entityID === task.id && e.agentId === agent.agentId && e.channel === grant.channel && e.kind === 'capability');
  check((providerEstablishment(grant) ? capability?.nativeProviderFactory === true : mcpEstablishment(grant) ? capability?.nativeMcpRuntime === true : capability?.sameConversationWorktree === true) && capability.at <= now && now - capability.at <= 300000, 'WORKTREE_CAPABILITY_REQUIRED');
  if (shutdownSourceMcp || retireSource) check(capability?.nativeMcpRuntime === true, 'WORKTREE_CAPABILITY_REQUIRED');
  if (shutdownSourceModel) check(capability?.nativeModelShutdown === true, 'WORKTREE_CAPABILITY_REQUIRED');
  const runtime = [...state.evidence].reverse().find(e => e.agentId === agent.agentId && ['idle', 'busy'].includes(e.kind));
  check(runtime?.kind === 'idle' && runtime.channel === grant.channel && runtime.at <= now && now - runtime.at <= 10000, 'IDLE_EVIDENCE_REQUIRED');
  return { grant: structuredClone(current), checkedAt: now };
}

// Observe both established owners in one broker snapshot. This does not
// authorize contributor preparation, native effects, movement or release.
export function observeCodexDestinationOwners(state, mcpExpected, providerExpected, agent, now, members) {
  check(agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  const mcp = authorizeWorktreeGrant(state, mcpExpected, agent, now, members, 'observe-mcp').grant;
  const provider = authorizeWorktreeGrant(state, providerExpected, agent, now, members, 'observe-provider').grant;
  check(mcp.status === 'established' && provider.status === 'established' &&
    mcp.resourceReceipt?.phase === 'constructed' && provider.resourceReceipt?.phase === 'constructed' &&
    compatibleResourceHold(mcp, provider) && compatibleResourceHold(provider, mcp), 'DESTINATION_OWNERS_UNAVAILABLE');
  const task = state.tasks.find(value => value.id === mcp.taskID && value.channel === mcp.channel);
  check(task?.status === 'claimed' && task.claimant === agent.agentId && task.claimGeneration === mcp.claimGeneration &&
    !task.terminalHold, 'DESTINATION_OWNERS_UNAVAILABLE');
  check(!state.transitions.some(value => value.agentId === agent.agentId && value.id !== mcp.id && value.id !== provider.id &&
    transitionHoldsConversation(value)) && !state.managedPreviews.some(value => value.agentId === agent.agentId &&
      ['executing', 'uncertain'].includes(value.status)), 'DESTINATION_OWNERS_UNAVAILABLE');
  return { mcpGrant: mcp, providerGrant: provider, checkedAt: now };
}

// Recovery may observe the same unpublished step after task cancellation, but
// may not start it, release either owner, or substitute a different grant.
export function observeCodexDestinationStepRecovery(state, mcpExpected, providerExpected, agent, now, members) {
  check(agent.harness === 'codex', 'WORKTREE_EFFECT_SCOPE_MISMATCH');
  const mcp = authorizeWorktreeGrant(state, mcpExpected, agent, now, members, 'observe-mcp').grant;
  const provider = authorizeWorktreeGrant(state, providerExpected, agent, now, members, 'observe-provider').grant;
  check(mcp.status === 'established' && provider.status === 'established' && mcp.mcpPlan.effects.stepPreparation === true &&
    mcp.resourceReceipt?.phase === 'constructed' && provider.resourceReceipt?.phase === 'constructed' &&
    compatibleResourceHold(mcp, provider) && compatibleResourceHold(provider, mcp), 'DESTINATION_OWNERS_UNAVAILABLE');
  return { mcpGrant: mcp, providerGrant: provider, checkedAt: now };
}

// Authorizes only disposal of an already retained unpublished step. Exact
// operation and step identity remain enforced by the host and native owner.
export function authorizeCodexDestinationStepDisposal(state, mcpExpected, providerExpected, agent, now, members) {
  const owners = observeCodexDestinationStepRecovery(state, mcpExpected, providerExpected, agent, now, members);
  check(!destinationMovementHoldsOwner(state, owners.mcpGrant) && !destinationMovementHoldsOwner(state, owners.providerGrant), 'DESTINATION_MOVEMENT_UNRESOLVED');
  return { ...owners, purpose: 'dispose-destination-step' };
}

// Fresh broker check for the separately disclosed step effect. The returned
// observation is not a durable intent, replay fence, or native execution grant.
export function authorizeCodexDestinationStep(state, mcpExpected, providerExpected, agent, now, members) {
  const owners = observeCodexDestinationOwners(state, mcpExpected, providerExpected, agent, now, members);
  const { mcpGrant: mcp, providerGrant: provider } = owners;
  check(mcp.mcpPlan.effects.stepPreparation === true, 'DESTINATION_STEP_NOT_APPROVED');
  const latest = [...state.previews].reverse().find(value => value.taskID === mcp.taskID && value.agentId === agent.agentId && value.channel === agent.channel);
  check(latest?.approved === true && [mcp.previewID, provider.previewID].includes(latest.id), 'STALE_WORKTREE_PREVIEW');
  check(!state.tasks.some(value => value.claimant === agent.agentId && (value.terminalHold ||
    (['dispatching', 'running', 'uncertain', 'review'].includes(value.status) && !value.stoppedEvidence))), 'CONVERSATION_CAPACITY');
  const capability = [...state.evidence].reverse().find(value => value.entityID === mcp.taskID && value.agentId === agent.agentId &&
    value.channel === agent.channel && value.kind === 'capability');
  check(capability?.nativeMcpRuntime === true && capability.nativeProviderFactory === true && capability.at <= now && now - capability.at <= 300000,
    'WORKTREE_CAPABILITY_REQUIRED');
  const runtime = [...state.evidence].reverse().find(value => value.agentId === agent.agentId && ['idle', 'busy'].includes(value.kind));
  check(runtime?.kind === 'idle' && runtime.channel === agent.channel && runtime.at <= now && now - runtime.at <= 10000, 'IDLE_EVIDENCE_REQUIRED');
  return { ...owners, purpose: 'prepare-destination-step' };
}
