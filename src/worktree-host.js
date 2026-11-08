import { randomUUID } from 'node:crypto';
import { WorktreeLifecycle } from './worktree-lifecycle.js';
import { HostID, Channel } from './protocol.js';
import { Command, Task } from './control/contracts.js';
import { LifecyclePreview, ManagedPreview } from './control/worktree-lifecycle-contracts.js';
import { HostCoordination } from './worktree-host-contracts.js';
import { requireControl as check } from './control/policy.js';

// Definitive refusals of an EXACT broker begin command prove that this command
// did not commit. Transport/storage/fingerprint failures never imply refusal.
const refused = new Set(['MANAGED_PREVIEW_NOT_APPROVED', 'MANAGED_PREVIEW_DIGEST_MISMATCH', 'MANAGED_INTENT_MISMATCH',
  'STALE_WORKTREE_PREVIEW', 'STALE_TASK_CLAIM', 'STALE_POLICY', 'EXECUTION_MAY_BE_ACTIVE', 'WORKTREE_TRANSITION_UNRESOLVED',
  'MANAGED_WORKTREE_UNRESOLVED', 'MANAGED_EVIDENCE_UNRESOLVED', 'MANAGED_RESOURCE_REMOVED']);
const publicationRefused = new Set(['STALE_WORKTREE_PREVIEW', 'STALE_TASK_CLAIM', 'EXECUTION_MAY_BE_ACTIVE', 'WORKTREE_TRANSITION_UNRESOLVED',
  'MANAGED_WORKTREE_UNRESOLVED', 'MANAGED_EVIDENCE_UNRESOLVED', 'MANAGED_RESOURCE_REMOVED', 'ELIGIBLE_MEMBER_REQUIRED']);
const outcome = record => ['created', 'removed', 'failed', 'uncertain'].includes(record.phase) ? record.phase : undefined;

// Internal host bridge only. No harness installs it until its nativePort proves
// actual exclusion and destination-use safety. It never moves a conversation,
// selects an agent/model, answers permissions or retries a Git/native effect.
export class ManagedWorktreeHost extends WorktreeLifecycle {
  constructor({ client, hostId, channel, credential, nativePort, ...options }) {
    HostID.parse(hostId); Channel.parse(channel);
    check(typeof credential === 'function' && typeof nativePort?.exclusive === 'function' && typeof nativePort?.verify === 'function', 'WORKTREE_HOST_PORT_REQUIRED');
    let owner;
    super({ ...options, port: { coordinated: true, exclusive: fn => nativePort.exclusive(fn),
      claim: id => owner.readTask(id), authorize: request => owner.authorizeRequest(request), revalidate: record => owner.revalidate(record) } });
    owner = this;
    Object.assign(this, { client, hostId, channel, credential, nativePort });
    for (const r of this.records.filter(r => r.agentId === this.agentId)) this.bound(r);
  }
  bound(record) {
    const c = record.coordination;
    check(c && c.hostId === this.hostId && c.channel === this.channel, 'MANAGED_HOST_JOURNAL_MISMATCH');
    return c;
  }
  put(record) {
    // Publication identity is in the SAME atomic snapshot as the first local
    // preview. A process death before the first RPC cannot leave an adoptable,
    // unbound preview or require a new publication command ID on restart.
    if (!record.coordination && record.phase === 'preview' && record.agentId === this.agentId && this.hostId) {
      record = { ...record, coordination: { hostId: this.hostId, channel: this.channel,
        publicationID: randomUUID(), publicationAck: false, settlements: [] } };
    }
    return super.put(record);
  }
  previewOf(record) {
    const { coordination, directory, ...value } = record;
    return LifecyclePreview.parse({ ...value, phase: 'preview', ...(record.kind === 'remove' ? { directory } : {}) });
  }
  update(record, coordination) {
    return this.put({ ...record, coordination: HostCoordination.parse(coordination) });
  }
  current(id) { const r = this.records.find(r => r.id === id && r.agentId === this.agentId); check(r, 'WORKTREE_PREVIEW_NOT_FOUND'); return r; }
  async connected() {
    await this.client.connect(); check(this.client.hostId === this.hostId && !this.client.admin, 'MANAGED_HOST_MISMATCH');
  }
  async send(fields) {
    await this.connected();
    return this.client.request('control_adapter', { agentId: this.agentId, credential: await this.credential(), command: Command.parse({ channel: this.channel, ...fields }) });
  }
  async read(view, entityID) {
    await this.connected();
    const result = await this.client.request('control_query', { agentId: this.agentId, channel: this.channel, view, entityID, limit: 1 });
    check(Array.isArray(result.entries) && result.entries.length <= 1 && result.entries.every(v => v.id === entityID && v.channel === this.channel), 'MANAGED_HOST_QUERY_MISMATCH');
    return result.entries[0];
  }
  async readTask(id) { const value = await this.read('tasks', id); return value && Task.parse(value); }
  async remote(record) {
    const value = await this.read('managedPreviews', record.id);
    if (!value) return;
    const r = ManagedPreview.parse(value), c = this.bound(record);
    check(r.hostId === c.hostId && r.agentId === this.agentId && r.digest === this.previewDigest(record), 'MANAGED_HOST_QUERY_MISMATCH');
    return r;
  }
  async publish(record) {
    if (!record.coordination) {
      check(record.phase === 'preview', 'MANAGED_HOST_JOURNAL_MISMATCH');
      record = this.update(record, { hostId: this.hostId, channel: this.channel, publicationID: randomUUID(), publicationAck: false, settlements: [] });
    }
    const c = this.bound(record);
    if (c.publicationAck || c.publicationRefused) return record;
    try { await this.send({ id: c.publicationID, op: 'managed.preview', hostId: c.hostId, preview: this.previewOf(record) }); }
    catch (error) {
      if (publicationRefused.has(error.code)) this.update({ ...record, phase: 'failed' }, { ...c, publicationRefused: true });
      throw error;
    }
    return this.update(record, { ...c, publicationAck: true });
  }
  async admit(record, recovery = false) {
    let c = this.bound(record);
    if (!c.beginID) {
      check(!recovery, 'MANAGED_HOST_JOURNAL_MISMATCH');
      const remote = await this.remote(record);
      check(remote?.status === 'approved', 'WORKTREE_APPROVAL_REQUIRED');
      record = this.update(record, { ...c, beginID: randomUUID(), beginState: 'prepared' }); c = record.coordination;
    }
    if (c.beginState !== 'prepared') return record;
    // The exact outbox command is journaled before sending. Recovery may replay
    // this broker-only transaction, never the filesystem operation it gates.
    try { await this.send({ id: c.beginID, op: 'managed.begin', previewID: record.id, digest: this.previewDigest(record),
      ...(c.manualAttestation ? { manualConfirmationID: c.manualAttestation.confirmationID } : {}) }); }
    catch (error) {
      if (refused.has(error.code)) this.update(record, { ...c, beginState: 'refused' });
      throw error;
    }
    return this.update(record, { ...c, beginState: 'admitted' });
  }
  async authorizeRequest(request) {
    let record = this.current(request.previewID);
    check(request.digest === this.previewDigest(record), 'MANAGED_PREVIEW_DIGEST_MISMATCH');
    record = await this.admit(record);
    check(record.coordination.beginState === 'admitted', 'WORKTREE_APPROVAL_REQUIRED'); return true;
  }
  async revalidate(input) {
    const record = this.current(input.id), c = this.bound(record);
    check(c.beginState === 'admitted' && !c.settlements.length, 'WORKTREE_RECOVERY_REQUIRED');
    check(await this.nativePort.verify({ agentId: this.agentId, operation: record.kind, taskID: record.taskID,
      repository: record.repository, destination: record.destination, previewID: record.id, digest: this.previewDigest(record) }) === true, 'NATIVE_EXCLUSION_REQUIRED');
    // Fresh ID each time: an old command receipt is not current authority.
    await this.send({ id: randomUUID(), op: 'managed.revalidate', previewID: record.id, intentID: c.beginID, digest: this.previewDigest(record),
      ...(c.manualAttestation ? { manualConfirmationID: c.manualAttestation.confirmationID } : {}) });
  }
  failUninvoked() {
    for (const record of this.records.filter(r => r.agentId === this.agentId && r.coordination?.beginID && ['preview', 'reserved'].includes(r.phase)))
      this.put({ ...record, phase: 'failed' }); // Journal proves Git admission was never recorded. Reserved files are preserved.
  }
  async reconcile() {
    for (let record of this.records.filter(r => r.agentId === this.agentId)) {
      record = await this.publish(record);
      let c = this.bound(record);
      if (!c.beginID) continue;
      if (c.beginState === 'prepared') {
        try { record = await this.admit(record, true); }
        catch (error) {
          record = this.current(record.id);
          if (record.coordination.beginState !== 'refused') throw error;
        }
        c = record.coordination;
      }
      if (c.beginState === 'refused') { check(record.phase === 'failed', 'MANAGED_HOST_JOURNAL_MISMATCH'); continue; }
      // Retry any durable unacknowledged receipt byte-for-byte before publishing
      // a later observation (notably uncertain -> verified created/removed).
      for (;;) {
        let pending = c.settlements.find(s => !s.acknowledged);
        const result = outcome(record), last = c.settlements.at(-1);
        if (!pending && result && last?.outcome !== result) {
          pending = { id: randomUUID(), outcome: result, acknowledged: false, ...(result === 'created' ? { directory: record.directory } : {}) };
          record = this.update(record, { ...c, settlements: [...c.settlements, pending] }); c = record.coordination;
        }
        if (!pending) break;
        await this.send({ id: pending.id, op: 'managed.settle', previewID: record.id, intentID: c.beginID,
          receiptID: pending.id, outcome: pending.outcome, ...(pending.directory ? { directory: pending.directory } : {}) });
        record = this.update(record, { ...c, settlements: c.settlements.map(s => s.id === pending.id ? { ...s, acknowledged: true } : s) }); c = record.coordination;
      }
    }
  }
  async exclusive(operation) {
    return super.exclusive(async () => {
      await this.connected();
      this.failUninvoked();
      await this.reconcile(); // Held/lost receipts prevent any subsequent Git effect.
      let result;
      try { result = await operation(); }
      catch (error) {
        this.failUninvoked();
        // Keep the original error, but retain the durable outbox on sync failure.
        try { await this.reconcile(); } catch { /* Recovery is explicit; no native retry. */ }
        throw error;
      }
      await this.reconcile();
      return result;
    });
  }
}
