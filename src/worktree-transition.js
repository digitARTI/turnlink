import { randomUUID } from 'node:crypto';
import { join, posix, win32 } from 'node:path';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { digest, stateDir } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { Command, UUID, WorktreeBinding, WorktreeTransition } from './control/contracts.js';
import { requireControl as check } from './control/policy.js';

const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const pathSchema = z.string().min(1).max(2048).refine(v => !v.includes('\0') && (posix.isAbsolute(v) || win32.isAbsolute(v)));
const snapshotSchema = z.object({ agentId: AgentID, directory: pathSchema, projectID: z.string().min(1).max(200),
  configurationDigest: hashSchema, authorityDigest: hashSchema,
  sources: z.array(z.strictObject({ path: pathSchema, digest: hashSchema })).min(1).max(128), idle: z.boolean(), blocked: z.boolean() });
const recordSchema = z.strictObject({ id: UUID, taskID: UUID, previewID: UUID, claimGeneration: stamp,
  phase: z.enum(['authorizing', 'prepared', 'inflight', 'observed', 'settled', 'uncertain']),
  grant: WorktreeTransition.optional(), receiptID: UUID, outcome: z.enum(['moved', 'failed', 'uncertain']).optional(),
  settlement: Command.options.find(schema => schema.shape.op.value === 'worktree.settle').optional() });

export class TransitionJournal {
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    HostID.parse(hostId); AgentID.parse(agentId); this.agentId = agentId;
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.path = join(root, `${digest(agentId)}.transitions.json`);
    this.lockDirectory = join(root, `${digest(agentId)}.transition-writer`); this.reload();
  }
  reload() {
    try {
      const value = z.strictObject({ version: z.literal(1), agentId: AgentID, records: z.array(recordSchema).max(256) }).parse(JSON.parse(readPrivate(this.path)));
      check(value.agentId === this.agentId, 'TRANSITION_IDENTITY_MISMATCH'); this.records = value.records;
      check(new Set(this.records.map(r => r.id)).size === this.records.length, 'DUPLICATE_TRANSITION_RECEIPT');
      for (const r of this.records) this.validate(r);
    } catch (error) { if (error.code !== 'ENOENT') throw error; this.records = []; }
  }
  async exclusive(operation) {
    check(!this.locked && !this.fault, 'TRANSITION_JOURNAL_UNAVAILABLE');
    const unlock = acquireStore(this.lockDirectory, () => { this.fault = true; });
    this.locked = true;
    try { this.reload(); return await operation(); }
    finally { this.locked = false; unlock(); }
  }
  validate(record) {
    if (record.grant) check(record.grant.id === record.id && record.grant.agentId === this.agentId &&
      record.grant.taskID === record.taskID && record.grant.previewID === record.previewID && record.grant.claimGeneration === record.claimGeneration, 'TRANSITION_IDENTITY_MISMATCH');
    if (record.settlement) check(record.grant && record.settlement.transitionID === record.id && record.settlement.channel === record.grant.channel &&
      record.settlement.receiptID === record.receiptID && record.settlement.outcome === record.outcome, 'INVALID_TRANSITION_RECEIPT');
  }
  put(input) {
    check(this.locked && !this.fault, 'TRANSITION_JOURNAL_UNAVAILABLE');
    const record = recordSchema.parse(input);
    this.validate(record);
    const next = this.records.filter(r => r.id !== record.id); next.push(record);
    check(next.length <= 256, 'TRANSITION_JOURNAL_FULL');
    atomicWrite(this.path, JSON.stringify({ version: 1, agentId: this.agentId, records: next })); this.records = next; return record;
  }
}

// Internal adapter coordinator, NOT a model tool. Ports must be harness-bound and supply a native exclusion boundary.
// It performs no worktree creation/removal, permission mutation, credential discovery or membership handoff.
export class WorktreeCoordinator {
  constructor({ client, agentId, channel, credential, journal, port }) {
    AgentID.parse(agentId); check(journal.agentId === agentId, 'TRANSITION_IDENTITY_MISMATCH');
    Object.assign(this, { client, agentId, channel, credential, journal, port });
  }
  async send(command) {
    return this.client.request('control_adapter', { agentId: this.agentId, credential: await this.credential(), command: { channel: this.channel, ...command } });
  }
  async find(view, id) {
    let offset = 0;
    for (let pages = 0; pages < 4096; pages++) {
      const page = await this.client.request('control_query', { agentId: this.agentId, channel: this.channel, view, offset, limit: 100 });
      const value = page.entries.find(v => v.id === id); if (value) return value;
      if (page.next <= offset || !page.entries.length) return;
      offset = page.next;
    }
    throw new Error('Transition query budget exhausted');
  }
  async inspect(from, to) {
    const source = snapshotSchema.parse(await this.port.inspect(from)), destination = snapshotSchema.parse(await this.port.inspect(to));
    for (const snapshot of [source, destination]) check(snapshot.agentId === this.agentId, 'TRANSITION_IDENTITY_MISMATCH');
    check(source.directory === from && destination.directory === to && from !== to, 'UNEXPECTED_WORKTREE_LOCATION');
    check(source.projectID === destination.projectID, 'WORKTREE_PROJECT_MISMATCH');
    const binding = WorktreeBinding.parse({ harness: this.agentId.split(':')[0], projectID: source.projectID,
      sourceAuthorityDigest: source.authorityDigest, destinationAuthorityDigest: destination.authorityDigest,
      sources: [...source.sources, ...destination.sources] });
    check(binding.sourceAuthorityDigest === binding.destinationAuthorityDigest, 'PERMISSION_PRESERVATION_REQUIRED');
    // The port hashes complete applicable config/instruction discovery. Never persist their raw contents or credentials.
    const configurationDigest = digest(JSON.stringify({ from, to, binding, source: source.configurationDigest, destination: destination.configurationDigest }));
    return { source, destination, binding, configurationDigest };
  }
  async preview(taskID, to) {
    check(this.port.sameConversationWorktree === true, 'WORKTREE_CAPABILITY_REQUIRED');
    const task = await this.find('tasks', taskID);
    check(task?.status === 'claimed' && task.claimant === this.agentId, 'TASK_NOT_CLAIMED');
    const actual = snapshotSchema.parse(await this.port.observe());
    check(actual.agentId === this.agentId, 'TRANSITION_IDENTITY_MISMATCH');
    const snapshot = await this.inspect(actual.directory, to), id = randomUUID();
    check(actual.projectID === snapshot.binding.projectID && actual.authorityDigest === snapshot.source.authorityDigest &&
      actual.configurationDigest === snapshot.source.configurationDigest, 'WORKTREE_PROJECT_MISMATCH');
    await this.send({ id: randomUUID(), op: 'evidence.record', entityID: taskID, kind: 'capability', sameConversationWorktree: true });
    await this.send({ id, op: 'worktree.preview', taskID, from: actual.directory, to,
      configurationDigest: snapshot.configurationDigest, binding: snapshot.binding });
    return { previewID: id, configurationDigest: snapshot.configurationDigest, binding: snapshot.binding, from: actual.directory, to };
  }
  async verify(preview, claimGeneration) {
    const task = await this.find('tasks', preview.taskID), latest = await this.find('previews', preview.id);
    check(task?.status === 'claimed' && task.claimant === this.agentId && task.claimGeneration === claimGeneration &&
      latest?.approved && latest.claimGeneration === claimGeneration, 'STALE_WORKTREE_PREVIEW');
    const actual = snapshotSchema.parse(await this.port.observe());
    check(actual.agentId === this.agentId && actual.directory === preview.from, 'UNEXPECTED_WORKTREE_LOCATION');
    check(actual.projectID === preview.binding?.projectID, 'WORKTREE_PROJECT_MISMATCH');
    check(actual.idle === true && actual.blocked === false, 'NATIVE_IDLE_REQUIRED');
    const snapshot = await this.inspect(preview.from, preview.to);
    check(snapshot.configurationDigest === preview.configurationDigest && snapshot.binding.sourceAuthorityDigest === preview.binding?.sourceAuthorityDigest,
      'CONFIGURATION_CHANGED');
    check(actual.authorityDigest === snapshot.source.authorityDigest && actual.configurationDigest === snapshot.source.configurationDigest, 'CONFIGURATION_CHANGED');
    return snapshot;
  }
  async report(record, outcome, actual) {
    const grant = record.grant;
    check(actual.agentId === this.agentId, 'TRANSITION_IDENTITY_MISMATCH');
    const command = { id: record.receiptID, channel: this.channel, op: 'worktree.settle', transitionID: record.id, outcome,
      actualLocation: actual.directory, configurationDigest: grant.configurationDigest, authorityDigest: actual.authorityDigest,
      receiptID: record.receiptID };
    // Preserve the observed result BEFORE acknowledging the broker; retries never invoke the native effect again.
    record = this.journal.put({ ...record, phase: 'observed', outcome, settlement: command });
    await this.send(command);
    return this.journal.put({ ...record, phase: outcome === 'uncertain' ? 'uncertain' : 'settled' });
  }
  async execute(taskID, previewID) {
    check(this.port.sameConversationWorktree === true, 'WORKTREE_CAPABILITY_REQUIRED');
    check(typeof this.port.exclusive === 'function', 'NATIVE_EXCLUSION_REQUIRED');
    return this.journal.exclusive(() => this.port.exclusive(async () => {
      check(!this.journal.records.some(r => r.phase !== 'settled'), 'WORKTREE_TRANSITION_UNRESOLVED');
      const preview = await this.find('previews', previewID);
      check(preview?.taskID === taskID && preview.agentId === this.agentId && preview.binding, 'STALE_WORKTREE_PREVIEW');
      const snapshot = await this.verify(preview, preview.claimGeneration);
      await this.send({ id: randomUUID(), op: 'evidence.record', entityID: taskID, kind: 'idle' });
      let record = this.journal.put({ id: randomUUID(), taskID, previewID, claimGeneration: preview.claimGeneration, phase: 'authorizing', receiptID: randomUUID() });
      // Unknown grant admission is recovered by its exact ID, never by constructing a second begin command.
      try {
        await this.send({ id: record.id, op: 'worktree.begin', taskID, previewID, claimGeneration: preview.claimGeneration,
          configurationDigest: snapshot.configurationDigest, authorityDigest: snapshot.binding.sourceAuthorityDigest });
      } catch (error) {
        // Only an enumerated definitive broker refusal proves that no grant was admitted; transport/storage failures remain unknown.
        if (['WORKTREE_GRANTS_DISABLED', 'STALE_WORKTREE_PREVIEW', 'STALE_TASK_CLAIM', 'WORKTREE_PREVIEW_CONSUMED', 'CONFIGURATION_CHANGED',
          'PERMISSION_PRESERVATION_REQUIRED', 'WORKTREE_CAPABILITY_REQUIRED', 'WORKTREE_TRANSITION_UNRESOLVED', 'IDLE_EVIDENCE_REQUIRED',
          'CONVERSATION_CAPACITY', 'ELIGIBLE_MEMBER_REQUIRED', 'CLOCK_REGRESSION'].includes(error.code))
          this.journal.put({ ...record, phase: 'settled', outcome: 'failed' });
        throw error;
      }
      const grant = await this.find('transitions', record.id); check(grant?.status === 'prepared', 'WORKTREE_TRANSITION_NOT_PENDING');
      record = this.journal.put({ ...record, grant, phase: 'prepared' });
      try { await this.verify(preview, preview.claimGeneration); }
      catch (error) {
        const actual = snapshotSchema.parse(await this.port.observe());
        if (actual.agentId === this.agentId && actual.directory === grant.from && actual.authorityDigest === grant.authorityDigest && actual.projectID === preview.binding.projectID)
          await this.report(record, 'failed', actual);
        else await this.report(record, 'uncertain', actual);
        throw error;
      }
      record = this.journal.put({ ...record, phase: 'inflight' });
      let actual;
      try {
        await this.port.move({ agentId: this.agentId, from: grant.from, to: grant.to, transitionID: grant.id });
        actual = snapshotSchema.parse(await this.port.observe());
        check(actual.agentId === this.agentId && actual.directory === grant.to && actual.authorityDigest === grant.authorityDigest &&
          actual.projectID === preview.binding.projectID && actual.idle === true && actual.blocked === false, 'UNVERIFIED_WORKTREE_EFFECT');
        const finalSnapshot = await this.inspect(grant.from, grant.to);
        check(finalSnapshot.configurationDigest === grant.configurationDigest && actual.configurationDigest === finalSnapshot.destination.configurationDigest, 'CONFIGURATION_CHANGED');
      } catch (error) {
        // A timeout/rejection after invocation is not proof that a queued move was never applied.
        const actual = snapshotSchema.parse(await this.port.observe());
        await this.report(record, 'uncertain', actual); throw error;
      }
      // Broker acknowledgement loss must preserve a moved receipt, not recast it as an uncertain native effect.
      return this.report(record, 'moved', actual);
    }));
  }
  async recover() {
    check(typeof this.port.exclusive === 'function', 'NATIVE_EXCLUSION_REQUIRED');
    return this.journal.exclusive(() => this.port.exclusive(async () => {
      for (let record of this.journal.records.filter(r => r.phase !== 'settled')) {
        if (record.settlement && record.phase === 'observed') {
          await this.send(record.settlement);
          record = this.journal.put({ ...record, phase: record.outcome === 'uncertain' ? 'uncertain' : 'settled' });
          if (record.phase === 'settled') continue;
        }
        const grant = await this.find('transitions', record.id);
        // Absence of a grant does not prove a still-outstanding begin RPC was rejected. Never create another ID or invoke a move here.
        if (!grant) continue;
        check(grant.agentId === this.agentId && grant.taskID === record.taskID && grant.previewID === record.previewID &&
          grant.claimGeneration === record.claimGeneration, 'TRANSITION_IDENTITY_MISMATCH');
        if (['moved', 'failed'].includes(grant.status)) {
          check(record.outcome === grant.status && record.receiptID === grant.receiptID, 'INVALID_TRANSITION_RECEIPT');
          this.journal.put({ ...record, grant, phase: 'settled' }); continue;
        }
        const preview = await this.find('previews', grant.previewID), task = await this.find('tasks', grant.taskID);
        check(preview?.approved && task?.claimant === this.agentId && task.claimGeneration === grant.claimGeneration, 'STALE_TASK_CLAIM');
        const actual = snapshotSchema.parse(await this.port.observe());
        check(actual.agentId === this.agentId, 'TRANSITION_IDENTITY_MISMATCH');
        record = this.journal.put({ ...record, grant });
        let unchanged = false;
        try {
          const snapshot = await this.inspect(grant.from, grant.to);
          unchanged = snapshot.configurationDigest === grant.configurationDigest && actual.authorityDigest === grant.authorityDigest &&
            actual.configurationDigest === (actual.directory === grant.to ? snapshot.destination : snapshot.source).configurationDigest;
        } catch { /* Changed/undiscoverable configuration cannot justify a moved or no-effect receipt. */ }
        const outcome = actual.directory === grant.to && actual.projectID === preview.binding.projectID && unchanged && actual.idle && !actual.blocked ? 'moved' :
          actual.directory === grant.from && ['authorizing', 'prepared'].includes(record.phase) && unchanged ? 'failed' : 'uncertain';
        if (outcome === 'uncertain' && record.phase === 'uncertain' && record.settlement?.outcome === 'uncertain' &&
          record.settlement.actualLocation === actual.directory && record.settlement.authorityDigest === actual.authorityDigest) continue;
        // A previous uncertain receipt has its own immutable command ID. Resolution gets a new receipt, never a conflicting replay.
        if (record.settlement) record = { ...record, receiptID: randomUUID(), settlement: undefined };
        await this.report(record, outcome, actual);
      }
    }));
  }
}
