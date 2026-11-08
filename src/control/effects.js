import { createHash } from 'node:crypto';
import { reduceControl } from './reducer.js';
import { ControlError, requireControl as check } from './policy.js';

export const BROKER_EFFECT_OPERATIONS = Object.freeze(['pause_delivery', 'resume_delivery', 'cancel_queued', 'retry_delivery', 'change_wake_policy', 'remove_member']);
export const stableID = (id, step) => {
  const hex = createHash('sha256').update(`${id}:${step}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
// Keep the original v3 receipt fingerprint byte-for-byte for the three deployed operations.
// New operations bind every field that changes their effect or recovery authority.
export const effectFingerprint = action => {
  const value = { id: action.id, channel: action.channel, operation: action.operation, target: action.target, messageID: action.messageID ?? null,
    requester: action.requester, generation: action.generation, policyRevision: action.policyRevision };
  if (!['pause_delivery', 'resume_delivery', 'cancel_queued'].includes(action.operation)) Object.assign(value, {
    evidence: action.evidence, recoveryEvidenceID: action.recoveryEvidenceID ?? null, admissionID: action.admissionID ?? null, wakePolicy: action.wakePolicy ?? null });
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
};

// Single synchronous broker writer: no RPC/async gap between the final authority check and a local JSON commit.
// SQLite intents and broker receipts are deliberately separate commits, reconciled by immutable action ID.
export class BrokerEffectExecutor {
  constructor({ gateway, apply, lookup, afterIntent = () => {}, afterEffect = () => {} }) {
    Object.assign(this, { gateway, apply, lookup, afterIntent, afterEffect });
  }
  settle(action, result) {
    check(result.fingerprint === effectFingerprint(action), 'EFFECT_RECEIPT_CONFLICT');
    this.gateway.store.apply({ id: stableID(action.id, 'settle'), op: 'action.reconcile', channel: action.channel,
      actionID: action.id, outcome: result.outcome, evidenceID: result.id || stableID(action.id, 'receipt') }, this.gateway.context({ kind: 'scheduler' }));
  }
  authorized(action, settled = false) {
    const state = this.gateway.store.snapshot(), channel = state.channels.find(c => c.id === action.channel);
    check(channel?.active && this.gateway.store.offerAccepted(action.channel, action.requester, channel.active.id), 'ROLE_NOTICE_NOT_ADMITTED');
    if (settled) {
      const pending = state.actions.find(a => a.id === action.id);
      check(pending?.status === 'succeeded' && pending.operation === 'retry_delivery', 'ACTION_NOT_EXECUTING');
      pending.status = 'executing';
    }
    // Recheck policy, current membership/lease/generation and any required evidence without creating another effect intent.
    reduceControl(state, { id: stableID(action.id, 'check'), op: 'action.revalidate', channel: action.channel, actionID: action.id },
      this.gateway.context({ kind: 'scheduler' }), { allowArchiveExpansion: true });
  }
  run() {
    const { store } = this.gateway;
    for (const action of store.snapshot().actions.filter(a => a.status === 'approved' && BROKER_EFFECT_OPERATIONS.includes(a.operation))) {
      try {
        store.apply({ id: stableID(action.id, 'begin'), op: 'action.begin', channel: action.channel, actionID: action.id },
          this.gateway.context({ kind: 'scheduler' }));
      } catch (error) {
        if (error instanceof ControlError && ['STALE_MASTER', 'STALE_POLICY', 'ELIGIBLE_MEMBER_REQUIRED', 'HUMAN_APPROVAL_REQUIRED', 'EVIDENCE_REQUIRED', 'ADMISSION_KEY_REQUIRED'].includes(error.code)) continue;
        throw error;
      }
      this.afterIntent(action);
    }
    const state = store.snapshot();
    for (const intent of store.effectIntents()) {
      const action = state.actions.find(a => a.id === intent.id);
      check(!!action && effectFingerprint(action) === effectFingerprint(intent), 'INVALID_EFFECT_INTENT');
      if (action.status !== 'executing' || !BROKER_EFFECT_OPERATIONS.includes(action.operation)) continue;
      const receipt = this.lookup(action.id);
      // A persisted broker receipt is the outcome even if the lease/policy changed after its effect.
      if (receipt) { this.settle(action, receipt); continue; }
      try { this.authorized(action); }
      catch (error) {
        // Restart begins with no receiver sockets. A temporary disconnect is neither revocation nor permission to execute.
        if (error instanceof ControlError && error.code === 'ELIGIBLE_MEMBER_REQUIRED' &&
          [action.requester, action.target].every(id => this.gateway.members().some(m => m.agentId === id && m.channel === action.channel))) continue;
        if (!(error instanceof ControlError) || !['STALE_MASTER', 'STALE_POLICY', 'ELIGIBLE_MEMBER_REQUIRED', 'ROLE_NOTICE_NOT_ADMITTED', 'HUMAN_APPROVAL_REQUIRED', 'EVIDENCE_REQUIRED', 'ADMISSION_KEY_REQUIRED'].includes(error.code)) throw error;
        this.settle(action, { fingerprint: effectFingerprint(action), outcome: 'failed' }); continue;
      }
      const result = this.apply(action);
      this.afterEffect(action);
      this.settle(action, result);
    }
  }
}
