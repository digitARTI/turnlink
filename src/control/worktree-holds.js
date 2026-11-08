// Established provider contexts still own native resources. They cannot release
// task/conversation exclusion merely because construction returned successfully.
export const transitionHoldsConversation = transition => ['prepared', 'uncertain'].includes(transition.status) ||
  (['establish-provider', 'establish-mcp'].includes(transition.purpose) && transition.status === 'established');

// Only a retained, settled resource may coexist with the other resource scope
// for the same native reservation. A pending/uncertain effect never permits a
// second effect; these holds do not authorize movement or release.
export const compatibleResourceHold = (existing, candidate) => {
  if (candidate?.destinationOwners && ['establish-provider', 'establish-mcp'].includes(existing.purpose)) {
    const refs = candidate.destinationOwners;
    const isMcp = existing.purpose === 'establish-mcp';
    return existing.status === 'established' && existing.resourceReceipt?.phase === 'constructed' &&
      existing.id === (isMcp ? refs.mcpTransitionID : refs.providerTransitionID) &&
      existing.resourceReceipt.resourceID === (isMcp ? refs.mcpResourceID : refs.providerResourceID) &&
      existing.taskID === candidate.taskID && existing.agentId === candidate.agentId &&
      existing.channel === candidate.channel && existing.claimGeneration === candidate.claimGeneration &&
      existing.from === candidate.from && existing.to === candidate.to;
  }
  if (existing.status !== 'established' || !existing.resourceReceipt || !candidate ||
      !['establish-provider', 'establish-mcp'].includes(existing.purpose) ||
      !['establish-provider', 'establish-mcp'].includes(candidate.purpose) || existing.purpose === candidate.purpose) return false;
  const left = existing.providerPlan ?? existing.mcpPlan, right = candidate.providerPlan ?? candidate.mcpPlan;
  return !!left && !!right && existing.taskID === candidate.taskID && existing.agentId === candidate.agentId &&
    existing.channel === candidate.channel && existing.claimGeneration === candidate.claimGeneration &&
    existing.from === candidate.from && existing.to === candidate.to &&
    left.processGeneration === right.processGeneration && left.reservation.generation === right.reservation.generation &&
    left.reservation.revision === right.reservation.revision;
};

// Both references must resolve together, to the same native reservation. IDs in
// a command are assertions, never a substitute for the authoritative receipts.
export const destinationOwnersMatch = (state, candidate, historical = false) => {
  const refs = candidate.destinationOwners;
  if (!refs || candidate.purpose || candidate.binding?.harness !== 'codex' && !candidate.authorityDigest) return false;
  const originalMcp = state.transitions.find(t => t.id === refs.mcpTransitionID);
  const originalProvider = state.transitions.find(t => t.id === refs.providerTransitionID);
  const mcp = historical && originalMcp ? { ...originalMcp, status: 'established' } : originalMcp;
  const provider = historical && originalProvider ? { ...originalProvider, status: 'established' } : originalProvider;
  const previewID = candidate.previewID ?? candidate.id;
  return !!mcp && !!provider && previewID !== mcp.previewID && previewID !== provider.previewID &&
    candidate.id !== mcp.id && candidate.id !== provider.id &&
    mcp.purpose === 'establish-mcp' && provider.purpose === 'establish-provider' &&
    mcp.mcpPlan.effects.stepPreparation === true && compatibleResourceHold(mcp, candidate) &&
    compatibleResourceHold(provider, candidate) && compatibleResourceHold(mcp, provider) && compatibleResourceHold(provider, mcp);
};

export const destinationMovementHoldsOwner = (state, owner) => state.transitions.some(t =>
  t.destinationOwners && transitionHoldsConversation(t) &&
  [t.destinationOwners.mcpTransitionID, t.destinationOwners.providerTransitionID].includes(owner.id));
