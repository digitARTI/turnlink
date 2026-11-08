import { join } from 'node:path';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { digest, stateDir } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { membershipSealSchema } from './opencode-native-recovery.js';

const unavailable = () => Object.assign(new Error('MEMBERSHIP_JOURNAL_UNAVAILABLE'), { code: 'MEMBERSHIP_JOURNAL_UNAVAILABLE' });
const claimSchema = z.strictObject({ version: z.literal(1), sessionID: z.string().startsWith('ses_'), transitionID: z.string().uuid(),
  previousLeaseIncarnation: z.string().uuid(), leaseIncarnation: z.string().uuid(), incarnation: z.string().uuid(),
  activation: z.string().uuid(), generation: z.number().int().positive().safe() });
const recordSchema = z.strictObject({ grant: WorktreeTransition, pluginID: z.string().min(1).max(256), claim: claimSchema,
  phase: z.enum(['sealing', 'uncertain', 'sealed']), seal: membershipSealSchema.optional() }).superRefine((r, context) => {
  const s = r.seal;
  if (r.grant.purpose !== undefined || !['prepared', 'uncertain'].includes(r.grant.status) ||
    r.grant.agentId !== `opencode:${r.claim.sessionID}` || r.grant.id !== r.claim.transitionID ||
    (r.phase === 'sealed') !== !!s || (s && (s.sessionID !== r.claim.sessionID || s.transitionID !== r.grant.id ||
      s.pluginID !== r.pluginID || s.source.directory !== r.grant.from || s.destination !== r.grant.to ||
      s.leaseIncarnation !== r.claim.leaseIncarnation))) context.addIssue({ code: 'custom', message: 'Invalid membership seal journal' });
});
const fileSchema = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID, records: z.array(recordSchema).max(256) });

// A dispatch record is durable before the native call. A missing native seal
// after an uncertain call never authorizes a second dispatch.
export class OpenCodeMembershipJournal {
  #hostId; #agentId; #file; #lock; #records; #locked = false; #fault = false;
  get hostId() { return this.#hostId; }
  get agentId() { return this.#agentId; }
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    this.#hostId = HostID.parse(hostId); this.#agentId = AgentID.parse(agentId);
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#file = join(root, `${digest(agentId)}.membership-seals.json`);
    this.#lock = join(root, `${digest(agentId)}.membership-seal-writer`);
    this.#reload();
  }
  #reload() {
    try {
      const data = fileSchema.parse(JSON.parse(readPrivate(this.#file)));
      if (data.hostId !== this.hostId || data.agentId !== this.agentId || data.records.some(r => r.grant.agentId !== this.agentId) ||
        new Set(data.records.map(r => r.grant.id)).size !== data.records.length) throw unavailable();
      this.#records = data.records;
    } catch (error) { if (error.code !== 'ENOENT') throw error; this.#records = []; }
  }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lock, () => { this.#fault = true; }); this.#locked = true;
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
    const record = recordSchema.parse(value), previous = this.#records.find(item => item.grant.id === record.grant.id);
    if (record.grant.agentId !== this.agentId || (!previous && record.phase !== 'sealing') || (previous &&
      (JSON.stringify(previous.grant) !== JSON.stringify(record.grant) || previous.pluginID !== record.pluginID ||
       JSON.stringify(previous.claim) !== JSON.stringify(record.claim) ||
       !((previous.phase === 'sealing' && ['uncertain', 'sealed'].includes(record.phase)) ||
         (previous.phase === 'uncertain' && record.phase === 'sealed') ||
         (previous.phase === 'sealed' && record.phase === 'sealed' && JSON.stringify(previous.seal) === JSON.stringify(record.seal)))))) throw unavailable();
    const records = [...this.#records.filter(item => item.grant.id !== record.grant.id), record];
    if (records.length > 256) throw unavailable();
    atomicWrite(this.#file, JSON.stringify({ version: 1, hostId: this.hostId, agentId: this.agentId, records }));
    this.#records = records; return structuredClone(record);
  }
}
