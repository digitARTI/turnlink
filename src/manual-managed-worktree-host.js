import { ManagedWorktreeHost } from './worktree-host.js';
import { requireControl as check } from './control/policy.js';
import { z } from 'zod';

// Operator-supervised mode. The repository journal lock excludes other
// Turnlink lifecycle hosts, not native processes or arbitrary filesystem work.
// The operator's confirmation is an attestation, never native stop evidence.
export class ManualManagedWorktreeHost extends ManagedWorktreeHost {
  #confirmation;
  #held = false;
  #operatorGuard;

  constructor(options) {
    check(typeof options.operatorGuard === 'function', 'MANUAL_WORKTREE_OPERATOR_REQUIRED');
    let owner;
    const manualPort = {
      exclusive: async operation => {
        check(owner && !owner.#held, 'WORKTREE_JOURNAL_UNAVAILABLE');
        owner.#held = true;
        try { return await operation(); } finally { owner.#held = false; }
      },
      verify: async scope => owner?.#verified(scope) === true,
    };
    super({ ...options, nativePort: manualPort });
    owner = this;
    this.#operatorGuard = options.operatorGuard;
  }

  #verified(scope) {
    const confirmation = this.#confirmation;
    return this.#held && this.client.activeSubscriptions?.has(this.agentId) === true && !!confirmation &&
      confirmation.previewID === scope.previewID && confirmation.kind === scope.operation &&
      confirmation.digest === scope.digest && scope.agentId === this.agentId;
  }

  async authorizeRequest(request) {
    let record = this.current(request.previewID);
    const confirmation = this.#confirmation;
    check(this.#verified({ agentId: this.agentId, previewID: record.id, operation: record.kind,
      digest: this.previewDigest(record) }), 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    const existing = record.coordination.manualAttestation;
    if (!existing || (!record.coordination.beginID && existing.confirmationID !== confirmation.confirmationID)) {
      const confirmedAt = this.now();
      check(confirmedAt >= record.createdAt && confirmedAt < record.expiresAt, 'STALE_WORKTREE_PREVIEW');
      record = this.update(record, { ...record.coordination, manualAttestation: { version: 1, previewID: record.id,
        confirmationID: confirmation.confirmationID, digest: confirmation.digest, confirmedAt, scope: 'operator-confirms-no-active-use' } });
    } else check(existing.confirmationID === confirmation.confirmationID && existing.digest === confirmation.digest, 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    return super.authorizeRequest(request);
  }

  async revalidate(input) {
    const record = this.current(input.id), confirmation = this.#confirmation;
    check(this.#verified({ agentId: this.agentId, previewID: record.id, operation: record.kind,
      digest: this.previewDigest(record) }), 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    check(await this.#operatorGuard({ channel: this.channel, agentId: this.agentId, previewID: record.id,
      operation: record.kind, digest: confirmation.digest, confirmationID: confirmation.confirmationID }) === true, 'MANUAL_WORKTREE_OPERATOR_REQUIRED');
    check(this.#verified({ agentId: this.agentId, previewID: record.id, operation: record.kind,
      digest: this.previewDigest(record) }), 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    const existing = record.coordination.manualAttestation;
    check(existing?.previewID === record.id && existing.digest === confirmation.digest && existing.confirmationID === confirmation.confirmationID,
      'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    await super.revalidate(input);
    check(this.#verified({ agentId: this.agentId, previewID: record.id, operation: record.kind,
      digest: this.previewDigest(record) }), 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
  }

  async create(previewID) {
    check(this.#confirmation?.previewID === previewID && this.#confirmation.kind === 'create', 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    return super.create(previewID);
  }

  async remove(previewID) {
    check(this.#confirmation?.previewID === previewID && this.#confirmation.kind === 'remove', 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    return super.remove(previewID);
  }

  async executeConfirmed(kind, previewID, digest, acknowledgement, confirmationID) {
    check(!this.#confirmation && ['create', 'remove'].includes(kind) && acknowledgement === 'operator-confirms-no-active-use',
      'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    check(z.string().uuid().safeParse(confirmationID).success, 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    const record = this.current(previewID);
    check(record.kind === kind && this.previewDigest(record) === digest, 'MANUAL_WORKTREE_ATTESTATION_REQUIRED');
    this.#confirmation = { previewID, kind, digest, confirmationID };
    try { return await this[kind](previewID); } finally { this.#confirmation = undefined; }
  }
}
