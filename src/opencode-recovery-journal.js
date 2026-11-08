import { join } from 'node:path';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { digest, stateDir } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';

const unavailable = () => Object.assign(new Error('NATIVE_RECOVERY_JOURNAL_UNAVAILABLE'), { code: 'NATIVE_RECOVERY_JOURNAL_UNAVAILABLE' });
const claimSchema = z.strictObject({
  version: z.literal(1), sessionID: z.string().startsWith('ses_'), transitionID: z.string().uuid(),
  previousLeaseIncarnation: z.string().uuid(), leaseIncarnation: z.string().uuid(), incarnation: z.string().uuid(),
  activation: z.string().uuid(), generation: z.number().int().positive().safe(),
});
const recordSchema = z.strictObject({
  grant: WorktreeTransition, pluginID: z.string().min(1).max(256),
  phase: z.enum(['claiming', 'claimed', 'uncertain', 'observed', 'taking', 'takeover-uncertain']), claim: claimSchema.optional(),
  observedByLease: z.string().uuid().optional(),
}).superRefine((record, context) => {
  if (record.grant.purpose !== undefined || !['prepared', 'uncertain', 'moved'].includes(record.grant.status) ||
    (['claimed', 'observed', 'taking', 'takeover-uncertain'].includes(record.phase) && !record.claim) ||
    (['observed', 'taking', 'takeover-uncertain'].includes(record.phase) ? !record.observedByLease : record.observedByLease !== undefined) ||
    (record.claim && (record.claim.transitionID !== record.grant.id || record.grant.agentId !== `opencode:${record.claim.sessionID}`)))
    context.addIssue({ code: 'custom', message: 'Invalid recovery record' });
});
const successorOf = (previous, next, targetLease) => Boolean(previous && next &&
  next.sessionID === previous.sessionID && next.transitionID === previous.transitionID &&
  next.previousLeaseIncarnation === previous.previousLeaseIncarnation && next.leaseIncarnation === targetLease &&
  next.generation > previous.generation && next.incarnation !== previous.incarnation && next.activation !== previous.activation);
const fileSchema = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID, records: z.array(recordSchema).max(256) });

// Separate from the movement journal: a record is only a recovery-claim receipt,
// never evidence of release, placement, rebind, or permission preservation.
export class OpenCodeRecoveryJournal {
  #hostId; #agentId; #path; #lockDirectory; #records; #locked = false; #fault = false;
  get hostId() { return this.#hostId; }
  get agentId() { return this.#agentId; }
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    this.#hostId = HostID.parse(hostId); this.#agentId = AgentID.parse(agentId);
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#path = join(root, `${digest(agentId)}.native-recovery.json`);
    this.#lockDirectory = join(root, `${digest(agentId)}.native-recovery-writer`);
    this.#reload();
  }
  #reload() {
    try {
      const value = fileSchema.parse(JSON.parse(readPrivate(this.#path)));
      if (value.hostId !== this.hostId || value.agentId !== this.agentId ||
        value.records.some(r => r.grant.agentId !== this.agentId) ||
        new Set(value.records.map(r => r.grant.id)).size !== value.records.length) throw unavailable();
      this.#records = value.records;
    } catch (error) { if (error.code !== 'ENOENT') throw error; this.#records = []; }
  }
  snapshot() {
    if (this.#locked || this.#fault) throw unavailable();
    this.#reload();
    return structuredClone(this.#records);
  }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lockDirectory, () => { this.#fault = true; });
    this.#locked = true;
    try { this.#reload(); return await operation(); }
    finally { this.#locked = false; unlock(); }
  }
  get(transitionID) {
    if (!this.#locked || this.#fault) throw unavailable();
    const value = this.#records.find(record => record.grant.id === transitionID);
    return value && structuredClone(value);
  }
  put(value) {
    if (!this.#locked || this.#fault) throw unavailable();
    const record = recordSchema.parse(value);
    if (record.grant.agentId !== this.agentId) throw unavailable();
    const previous = this.#records.find(item => item.grant.id === record.grant.id);
    if (previous && (JSON.stringify(previous.grant) !== JSON.stringify(record.grant) || previous.pluginID !== record.pluginID ||
      !(previous.phase === 'claiming' && ['claimed', 'uncertain'].includes(record.phase) ||
        ['claiming', 'claimed', 'uncertain'].includes(previous.phase) && record.phase === 'observed' ||
        previous.phase === 'observed' && record.phase === 'observed' && JSON.stringify(previous.claim) === JSON.stringify(record.claim) ||
        previous.phase === 'observed' && record.phase === 'taking' &&
          JSON.stringify(previous.claim) === JSON.stringify(record.claim) && previous.observedByLease === record.observedByLease ||
        previous.phase === 'taking' && record.phase === 'takeover-uncertain' &&
          JSON.stringify(previous.claim) === JSON.stringify(record.claim) && previous.observedByLease === record.observedByLease ||
        previous.phase === 'taking' && record.phase === 'claimed' && successorOf(previous.claim, record.claim, previous.observedByLease) ||
        ['taking', 'takeover-uncertain'].includes(previous.phase) && record.phase === 'observed' &&
          (successorOf(previous.claim, record.claim, previous.observedByLease) ||
            JSON.stringify(previous.claim) === JSON.stringify(record.claim) && record.observedByLease !== previous.observedByLease &&
            record.observedByLease !== previous.claim?.leaseIncarnation)))) throw unavailable();
    if (!previous && record.phase !== 'claiming') throw unavailable();
    const next = [...this.#records.filter(item => item.grant.id !== record.grant.id), record];
    if (next.length > 256) throw unavailable();
    atomicWrite(this.#path, JSON.stringify({ version: 1, hostId: this.hostId, agentId: this.agentId, records: next }));
    this.#records = next;
    return structuredClone(record);
  }
}
