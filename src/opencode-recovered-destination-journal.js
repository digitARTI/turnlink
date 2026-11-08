import { join } from 'node:path';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { digest, stateDir } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { destinationMembershipSchema, membershipSealSchema } from './opencode-native-recovery.js';
import { placementSettlementSchema, placementSettlementMatches, validPlacementSettlementChange } from './opencode-placement-settlement.js';
import { placementCommitSchema, placementCommitMatches, validPlacementCommitChange } from './opencode-placement-commit.js';

const unavailable = () => Object.assign(new Error('RECOVERED_DESTINATION_JOURNAL_UNAVAILABLE'), { code: 'RECOVERED_DESTINATION_JOURNAL_UNAVAILABLE' });
const claim = z.strictObject({ version: z.literal(1), sessionID: z.string().startsWith('ses_'), transitionID: z.string().uuid(),
  previousLeaseIncarnation: z.string().uuid(), leaseIncarnation: z.string().uuid(), incarnation: z.string().uuid(),
  activation: z.string().uuid(), generation: z.number().int().positive().safe() });
const record = z.strictObject({ grant: WorktreeTransition, pluginID: z.string().min(1).max(256), claim,
  seal: membershipSealSchema, receiverHash: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['staging', 'uncertain', 'staged']), destination: destinationMembershipSchema.optional(), settlement: placementSettlementSchema.optional(), commit: placementCommitSchema.optional() }).superRefine((r, context) => {
  const d = r.destination;
  if (r.grant.purpose !== undefined || !['prepared', 'uncertain'].includes(r.grant.status) ||
    r.grant.agentId !== `opencode:${r.claim.sessionID}` || r.grant.id !== r.claim.transitionID ||
    r.claim.previousLeaseIncarnation === r.claim.leaseIncarnation || r.seal.sessionID !== r.claim.sessionID ||
    r.seal.transitionID !== r.grant.id || r.seal.pluginID !== r.pluginID || r.seal.source.directory !== r.grant.from ||
    r.seal.destination !== r.grant.to || (r.phase === 'staged') !== !!d ||
    (d && (d.sessionID !== r.claim.sessionID || d.transitionID !== r.grant.id || d.pluginID !== r.pluginID ||
      d.archiveNonce !== r.seal.nonce || d.leaseIncarnation !== r.seal.leaseIncarnation || d.receiverHash !== r.receiverHash ||
      JSON.stringify(d.source) !== JSON.stringify(r.seal.source) || d.destination !== r.grant.to)) ||
    (r.settlement && (r.phase !== 'staged' || !placementSettlementMatches(r.settlement, r.grant, d))) ||
    (r.commit && (r.phase !== 'staged' || !placementCommitMatches(r.commit, r.grant, d))) ||
    (r.commit && r.settlement && (r.commit.phase !== 'committed' || JSON.stringify(r.commit.placement) !== JSON.stringify(r.settlement.placement))))
    context.addIssue({ code: 'custom', message: 'Invalid recovered destination journal' });
});
const file = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID, records: z.array(record).max(256) });

// Preserve dispatch uncertainty across host failure; observation never replays it.
export class OpenCodeRecoveredDestinationJournal {
  #hostId; #agentId; #file; #lock; #records; #locked = false; #fault = false;
  get hostId() { return this.#hostId; }
  get agentId() { return this.#agentId; }
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    this.#hostId = HostID.parse(hostId); this.#agentId = AgentID.parse(agentId);
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#file = join(root, `${digest(agentId)}.recovered-destinations.json`);
    this.#lock = join(root, `${digest(agentId)}.recovered-destination-writer`); this.#reload();
  }
  #reload() {
    try {
      const data = file.parse(JSON.parse(readPrivate(this.#file)));
      if (data.hostId !== this.hostId || data.agentId !== this.agentId || data.records.some(r => r.grant.agentId !== this.agentId) ||
        new Set(data.records.map(r => r.grant.id)).size !== data.records.length) throw unavailable();
      this.#records = data.records;
    } catch (error) { if (error.code !== 'ENOENT') throw error; this.#records = []; }
  }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lock, () => { this.#fault = true; }); this.#locked = true;
    try { this.#reload(); return await operation(); } finally { this.#locked = false; unlock(); }
  }
  get(id) { if (!this.#locked || this.#fault) throw unavailable(); const value = this.#records.find(r => r.grant.id === id); return value && structuredClone(value); }
  put(value) {
    if (!this.#locked || this.#fault) throw unavailable();
    const next = record.parse(value), previous = this.#records.find(r => r.grant.id === next.grant.id);
    if (next.grant.agentId !== this.agentId || (!previous && next.phase !== 'staging') || (previous &&
      (JSON.stringify(previous.grant) !== JSON.stringify(next.grant) || previous.pluginID !== next.pluginID ||
        JSON.stringify(previous.claim) !== JSON.stringify(next.claim) || JSON.stringify(previous.seal) !== JSON.stringify(next.seal) ||
        previous.receiverHash !== next.receiverHash ||
        !validPlacementSettlementChange(previous.settlement, next.settlement) ||
        !validPlacementCommitChange(previous.commit, next.commit) ||
        !((previous.phase === 'staging' && ['uncertain', 'staged'].includes(next.phase)) ||
          (previous.phase === 'uncertain' && next.phase === 'staged') ||
          (previous.phase === 'staged' && next.phase === 'staged' && JSON.stringify(previous.destination) === JSON.stringify(next.destination)))))) throw unavailable();
    const records = [...this.#records.filter(r => r.grant.id !== next.grant.id), next];
    if (records.length > 256) throw unavailable();
    atomicWrite(this.#file, JSON.stringify({ version: 1, hostId: this.hostId, agentId: this.agentId, records }));
    this.#records = records; return structuredClone(next);
  }
}
