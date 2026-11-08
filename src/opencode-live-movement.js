import { join } from 'node:path';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { digest, stateDir } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { completionSchema, intentSchema, membershipSealSchema, destinationMembershipSchema } from './opencode-native-recovery.js';
import { placementSettlementSchema, placementSettlementMatches, validPlacementSettlementChange, samePlacementGrant } from './opencode-placement-settlement.js';
import { placementCommitSchema, placementCommitMatches, validPlacementCommitChange } from './opencode-placement-commit.js';

const unavailable = () => Object.assign(new Error('NATIVE_LIVE_MOVEMENT_UNAVAILABLE'), { code: 'NATIVE_LIVE_MOVEMENT_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('NATIVE_LIVE_MOVEMENT_UNCERTAIN'), { code: 'NATIVE_LIVE_MOVEMENT_UNCERTAIN' });
const busy = () => Object.assign(new Error('NATIVE_LIVE_MOVEMENT_BUSY'), { code: 'NATIVE_LIVE_MOVEMENT_BUSY' });
const receiptSchema = z.strictObject({ sessionID: z.string().startsWith('ses_'), family: z.literal('session-model-websocket'), released: z.number().int().nonnegative().safe() });
const completionRecord = z.strictObject({ phase: z.enum(['dispatching', 'uncertain', 'completed']), proof: completionSchema.optional() })
  .refine(value => (value.phase === 'completed') === !!value.proof);
const recordSchema = z.strictObject({ grant: WorktreeTransition, pluginID: z.string().min(1).max(256),
  phase: z.enum(['preparing', 'busy', 'prepared', 'releasing', 'released', 'uncertain-prepare', 'uncertain-release', 'detaching', 'detached', 'uncertain-detach', 'staging', 'staged', 'uncertain-stage']),
  intent: intentSchema.optional(), receipt: receiptSchema.optional(), seal: membershipSealSchema.optional(),
  receiverHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), destination: destinationMembershipSchema.optional(), settlement: placementSettlementSchema.optional(), commit: placementCommitSchema.optional(),
  placementCompletion: completionRecord.optional() }).superRefine((r, context) => {
  const stagePhase = ['staging', 'staged', 'uncertain-stage'].includes(r.phase);
  const intentRequired = ['prepared', 'releasing', 'released', 'uncertain-release', 'detaching', 'detached', 'uncertain-detach', 'staging', 'staged', 'uncertain-stage'].includes(r.phase);
  const receiptRequired = ['released', 'detaching', 'detached', 'uncertain-detach', 'staging', 'staged', 'uncertain-stage'].includes(r.phase);
  if (r.grant.purpose !== undefined || r.grant.status !== 'prepared' || intentRequired !== !!r.intent ||
    receiptRequired !== !!r.receipt || (r.phase === 'detached' || stagePhase) !== !!r.seal || stagePhase !== !!r.receiverHash ||
    (r.phase === 'staged') !== !!r.destination || (r.intent && (r.grant.agentId !== `opencode:${r.intent.sessionID}` ||
      r.intent.transitionID !== r.grant.id || r.intent.pluginID !== r.pluginID || r.intent.source.directory !== r.grant.from ||
      r.intent.directory !== r.grant.to || r.intent.membershipFence !== 1 || !r.intent.leaseIncarnation)) ||
    (r.receipt && r.receipt.sessionID !== r.intent?.sessionID) || (r.seal && (r.seal.sessionID !== r.intent?.sessionID ||
      r.seal.transitionID !== r.grant.id || r.seal.pluginID !== r.pluginID || r.seal.leaseIncarnation !== r.intent?.leaseIncarnation ||
      JSON.stringify(r.seal.source) !== JSON.stringify(r.intent?.source) || r.seal.destination !== r.grant.to)) ||
    (r.destination && (r.destination.sessionID !== r.intent?.sessionID || r.destination.transitionID !== r.grant.id ||
      r.destination.pluginID !== r.pluginID || r.destination.leaseIncarnation !== r.intent?.leaseIncarnation ||
      r.destination.archiveNonce !== r.seal?.nonce || r.destination.receiverHash !== r.receiverHash ||
      JSON.stringify(r.destination.source) !== JSON.stringify(r.intent?.source) || r.destination.destination !== r.grant.to)) ||
    (r.settlement && (r.phase !== 'staged' || !placementSettlementMatches(r.settlement, r.grant, r.destination))) ||
    (r.commit && (r.phase !== 'staged' || !placementCommitMatches(r.commit, r.grant, r.destination))) ||
    (r.commit && r.settlement && (r.commit.phase !== 'committed' || JSON.stringify(r.commit.placement) !== JSON.stringify(r.settlement.placement))) ||
    (r.placementCompletion && (r.commit?.phase !== 'committed' || r.settlement?.phase !== 'settled' ||
      (r.placementCompletion.proof && JSON.stringify(r.placementCompletion.proof.placement) !== JSON.stringify(r.commit.placement)))))
    context.addIssue({ code: 'custom', message: 'Invalid live movement record' });
});
const fileSchema = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID, records: z.array(recordSchema).max(256) });

// A receipt proves only this owner's tracked local WebSocket release. It does
// not certify remote cancellation, other resource families, or native placement.
export class OpenCodeLiveMovementJournal {
  #hostId; #agentId; #path; #lock; #records; #locked = false; #fault = false;
  get hostId() { return this.#hostId; }
  get agentId() { return this.#agentId; }
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    this.#hostId = HostID.parse(hostId); this.#agentId = AgentID.parse(agentId);
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#path = join(root, `${digest(agentId)}.native-live-movement.json`);
    this.#lock = join(root, `${digest(agentId)}.native-live-movement-writer`); this.#reload();
  }
  #reload() {
    try {
      const value = fileSchema.parse(JSON.parse(readPrivate(this.#path)));
      if (value.hostId !== this.hostId || value.agentId !== this.agentId || value.records.some(r => r.grant.agentId !== this.agentId) ||
        new Set(value.records.map(r => r.grant.id)).size !== value.records.length) throw unavailable();
      this.#records = value.records;
    } catch (error) { if (error.code !== 'ENOENT') throw error; this.#records = []; }
  }
  snapshot() { if (this.#locked || this.#fault) throw unavailable(); this.#reload(); return structuredClone(this.#records); }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lock, () => { this.#fault = true; }); this.#locked = true;
    try { this.#reload(); return await operation(); } finally { this.#locked = false; unlock(); }
  }
  get(id) { if (!this.#locked || this.#fault) throw unavailable(); const value = this.#records.find(r => r.grant.id === id); return value && structuredClone(value); }
  otherRecords(id) { if (!this.#locked || this.#fault) throw unavailable(); return structuredClone(this.#records.filter(record => record.grant.id !== id)); }
  hasRecords() { if (!this.#locked || this.#fault) throw unavailable(); return this.#records.length > 0; }
  hasOtherRecords(id) { if (!this.#locked || this.#fault) throw unavailable(); return this.#records.some(record => record.grant.id !== id); }
  put(value) {
    if (!this.#locked || this.#fault) throw unavailable();
    const record = recordSchema.parse(value), previous = this.#records.find(r => r.grant.id === record.grant.id);
    const completionChange = !previous?.placementCompletion ? !record.placementCompletion || record.placementCompletion.phase === 'dispatching' :
      !!record.placementCompletion && (JSON.stringify(previous.placementCompletion) === JSON.stringify(record.placementCompletion) ||
        (previous.placementCompletion.phase === 'dispatching' && ['uncertain', 'completed'].includes(record.placementCompletion.phase)));
    if (!completionChange || record.grant.agentId !== this.agentId || (!previous && record.phase !== 'preparing') || (previous &&
      (JSON.stringify(previous.grant) !== JSON.stringify(record.grant) || previous.pluginID !== record.pluginID ||
       (previous.intent && JSON.stringify(previous.intent) !== JSON.stringify(record.intent)) ||
       (previous.receipt && JSON.stringify(previous.receipt) !== JSON.stringify(record.receipt)) ||
       (previous.seal && JSON.stringify(previous.seal) !== JSON.stringify(record.seal)) ||
       (previous.receiverHash && previous.receiverHash !== record.receiverHash) ||
       !validPlacementSettlementChange(previous.settlement, record.settlement) ||
       !validPlacementCommitChange(previous.commit, record.commit) ||
       !((previous.phase === 'preparing' && ['busy', 'prepared', 'uncertain-prepare'].includes(record.phase)) ||
         (previous.phase === 'busy' && record.phase === 'preparing') ||
         (previous.phase === 'prepared' && record.phase === 'releasing') ||
         (previous.phase === 'releasing' && ['released', 'uncertain-release'].includes(record.phase)) ||
         (previous.phase === 'released' && record.phase === 'detaching') ||
         (previous.phase === 'detaching' && ['detached', 'uncertain-detach'].includes(record.phase)) ||
         (previous.phase === 'uncertain-detach' && record.phase === 'detached') ||
         (previous.phase === 'detached' && record.phase === 'detached' && JSON.stringify(previous.seal) === JSON.stringify(record.seal)) ||
         (previous.phase === 'detached' && record.phase === 'staging') ||
         (previous.phase === 'staging' && ['staged', 'uncertain-stage'].includes(record.phase)) ||
         (previous.phase === 'uncertain-stage' && record.phase === 'staged') ||
         (previous.phase === 'staged' && record.phase === 'staged' && JSON.stringify(previous.destination) === JSON.stringify(record.destination)))))) throw unavailable();
    const records = [...this.#records.filter(r => r.grant.id !== record.grant.id), record];
    if (records.length > 256) throw unavailable();
    atomicWrite(this.#path, JSON.stringify({ version: 1, hostId: this.hostId, agentId: this.agentId, records }));
    this.#records = records; return structuredClone(record);
  }
}

// This bridge is only for an explicitly constructed private live native owner.
// It has no normal launcher or adapter activation and never moves a Session.
export class OpenCodeAuthorizedLiveMovement {
  #client; #credential; #native; #journal; #agent; #session; #plugin; #channel; #promotion; #closed = false; #busy = false; #intent;
  #disconnect; #removed;
  constructor({ client, credential, native, journal, sessionID, channel, pluginID = 'turnlink', promotion }) {
    if (!client?.connect || !client?.request || !client?.on || !client?.off || typeof credential !== 'function' ||
      !native?.inspect || !native?.prepare || !native?.releaseTransport || !native?.close || !journal?.exclusive || !journal?.get || !journal?.put || !journal?.hasRecords || !journal?.hasOtherRecords ||
      typeof channel !== 'string' || !channel || typeof pluginID !== 'string' || !pluginID) throw unavailable();
    this.#agent = AgentID.parse(`opencode:${sessionID}`); this.#session = sessionID; this.#plugin = pluginID; this.#channel = channel;
    if (journal.agentId !== this.#agent) throw unavailable();
    this.#client = client; this.#credential = credential; this.#native = native; this.#journal = journal;
    if (promotion !== undefined && (!promotion?.journal?.exclusive || !promotion?.journal?.get || typeof promotion.authority !== 'function' ||
        typeof native.promotion !== 'function' || typeof journal.otherRecords !== 'function')) throw unavailable();
    this.#promotion = promotion;
    this.#disconnect = () => this.close(); this.#removed = event => { if (event.agentId === this.#agent) this.close(); };
    client.on('disconnected', this.#disconnect); client.on('membership_removed', this.#removed);
  }
  #grant(value) {
    const grant = WorktreeTransition.parse(value);
    if (grant.agentId !== this.#agent || grant.channel !== this.#channel || grant.purpose !== undefined || grant.status !== 'prepared' || grant.pluginProvenanceDigest || grant.nativeAuthorityObservationDigest) throw unavailable();
    return grant;
  }
  async #authorize(grant) {
    if (this.#closed) throw unavailable();
    await this.#client.connect();
    if (this.#closed || this.#client.hostId !== this.#journal.hostId) throw unavailable();
    const result = await this.#client.request('control_worktree_authorize', { agentId: this.#agent, channel: this.#channel, credential: await this.#credential(), grant });
    if (this.#closed || !Stamp.safeParse(result.checkedAt).success || result.checkedAt < grant.preparedAt ||
      JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw unavailable();
  }
  async #historicalAuthority(grant, records) {
    if (!records.length) return;
    if (!this.#promotion || records.length !== 1) throw unavailable();
    const promoted = await this.#promotion.journal.exclusive(() => this.#promotion.journal.get()), old = records[0];
    if (!promoted || promoted.phase !== 'promoted' || JSON.stringify(promoted.nextGrant) !== JSON.stringify(grant) ||
        !samePlacementGrant(old.grant, promoted.oldGrant) || old.phase !== 'staged' || old.commit?.phase !== 'committed' || old.settlement?.phase !== 'settled' ||
        JSON.stringify(old.commit.placement) !== JSON.stringify(promoted.completion.placement) ||
        JSON.stringify(old.settlement.placement) !== JSON.stringify(promoted.completion.placement) ||
        JSON.stringify(this.#native.promotion()) !== JSON.stringify(promoted.receipt)) throw unavailable();
    const checked = await this.#promotion.authority(promoted.oldGrant, grant);
    if (checked?.active !== true || checked.oldTransitionID !== promoted.oldGrant.id || checked.nextTransitionID !== grant.id ||
        checked.receiverHash !== promoted.receiverHash || checked.ownerGeneration !== promoted.ownerGeneration) throw unavailable();
  }
  async prepare(value) {
    if (this.#closed || this.#busy || this.#intent) throw unavailable();
    this.#busy = true; let attempted = false, saved;
    try {
      return await this.#journal.exclusive(async () => {
        const grant = this.#grant(value);
        const previous = this.#journal.get(grant.id);
        const history = typeof this.#journal.otherRecords === 'function' ? this.#journal.otherRecords(grant.id) : undefined;
        if (history?.length) await this.#historicalAuthority(grant, history);
        else if (!history && this.#journal.hasOtherRecords(grant.id)) throw unavailable();
        if ((previous && (previous.phase !== 'busy' || previous.pluginID !== this.#plugin || JSON.stringify(previous.grant) !== JSON.stringify(grant))) ||
          (!previous && this.#journal.hasRecords() && !history?.length) || await this.#native.inspect() !== null) throw unavailable();
        await this.#authorize(grant);
        saved = this.#journal.put({ grant, pluginID: this.#plugin, phase: 'preparing' });
        attempted = true;
        try {
          const intent = intentSchema.parse(await this.#native.prepare(grant.id, grant.to));
          if (intent.sessionID !== this.#session || intent.pluginID !== this.#plugin || intent.transitionID !== grant.id ||
            intent.source.directory !== grant.from || intent.directory !== grant.to || intent.membershipFence !== 1 || !intent.leaseIncarnation) throw uncertain();
          await this.#authorize(grant);
          if (history?.length) await this.#historicalAuthority(grant, history);
          this.#journal.put({ ...saved, phase: 'prepared', intent }); this.#intent = intent;
          return structuredClone(intent);
        } catch (error) {
          if (error?.code === 'NATIVE_MOVEMENT_BUSY') {
            this.#journal.put({ ...saved, phase: 'busy' });
            throw busy();
          }
          try { this.#journal.put({ ...saved, phase: 'uncertain-prepare' }); } catch { /* Keep the durable dispatch record. */ }
          throw error;
        }
      });
    } catch (error) { if (error?.code === 'NATIVE_LIVE_MOVEMENT_BUSY') throw error; this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  async releaseTransport(value) {
    if (this.#closed || this.#busy || !this.#intent) throw unavailable();
    this.#busy = true; let attempted = false, saved;
    try {
      return await this.#journal.exclusive(async () => {
        const grant = this.#grant(value); saved = this.#journal.get(grant.id);
        if (!saved || saved.phase !== 'prepared' || saved.pluginID !== this.#plugin || JSON.stringify(saved.grant) !== JSON.stringify(grant) ||
          JSON.stringify(saved.intent) !== JSON.stringify(this.#intent)) throw unavailable();
        await this.#authorize(grant);
        saved = this.#journal.put({ ...saved, phase: 'releasing' }); attempted = true;
        try {
          const receipt = receiptSchema.parse(await this.#native.releaseTransport(grant.id));
          if (receipt.sessionID !== this.#session) throw uncertain();
          await this.#authorize(grant);
          this.#journal.put({ ...saved, phase: 'released', receipt }); return structuredClone(receipt);
        } catch (error) {
          try { this.#journal.put({ ...saved, phase: 'uncertain-release' }); } catch { /* Keep the durable dispatch record. */ }
          throw error;
        }
      });
    } catch { this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.#client.off('disconnected', this.#disconnect); this.#client.off('membership_removed', this.#removed); this.#native.close();
  }
}

// The destination receiver authorizes the original, still-live native owner to
// archive source membership. This does not acknowledge the source to the broker.
export class OpenCodeAuthorizedLiveDetachment {
  #client; #credential; #native; #journal; #agent; #session; #channel; #plugin; #closed = false; #busy = false; #disconnect; #removed;
  constructor({ client, credential, native, journal, sessionID, channel, pluginID = 'turnlink' }) {
    if (!client?.request || !client?.on || !client?.off || typeof credential !== 'function' ||
      !native?.inspect || !native?.detachLiveMembership || !native?.close || !journal?.exclusive || !journal?.get || !journal?.put ||
      journal.agentId !== `opencode:${sessionID}` || !channel || !pluginID) throw unavailable();
    this.#agent = AgentID.parse(`opencode:${sessionID}`); this.#session = sessionID; this.#channel = channel; this.#plugin = pluginID;
    this.#client = client; this.#credential = credential; this.#native = native; this.#journal = journal;
    this.#disconnect = () => this.close(); this.#removed = event => { if (event.agentId === this.#agent) this.close(); };
    client.on('disconnected', this.#disconnect); client.on('membership_removed', this.#removed);
  }
  async #authorize(grant) {
    if (this.#closed || this.#client.hostId !== this.#journal.hostId) throw unavailable();
    const credential = await this.#credential();
    const result = await this.#client.request('control_worktree_authorize', { agentId: this.#agent, channel: this.#channel,
      credential, grant, action: 'detach-worktree-membership' });
    if (this.#closed || !Stamp.safeParse(result.checkedAt).success || result.checkedAt < grant.preparedAt ||
      JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw unavailable();
    const hold = await this.#client.request('control_receiver_observe', { agentId: this.#agent, channel: this.#channel,
      credential, transitionID: grant.id });
    if (this.#closed || hold.transitionID !== grant.id || hold.status !== 'held' || hold.sourceDetached !== false) throw unavailable();
  }
  async detach(value) {
    if (this.#closed || this.#busy) throw unavailable();
    this.#busy = true; let attempted = false, saved;
    try {
      return await this.#journal.exclusive(async () => {
        const grant = WorktreeTransition.parse(value);
        saved = this.#journal.get(grant.id);
        if (grant.agentId !== this.#agent || grant.channel !== this.#channel || grant.status !== 'prepared' || grant.purpose ||
          !saved || saved.phase !== 'released' || saved.pluginID !== this.#plugin || JSON.stringify(saved.grant) !== JSON.stringify(grant) ||
          JSON.stringify(await this.#native.inspect()) !== JSON.stringify(saved.intent)) throw unavailable();
        await this.#authorize(grant);
        saved = this.#journal.put({ ...saved, phase: 'detaching' }); attempted = true;
        try {
          const seal = membershipSealSchema.parse(await this.#native.detachLiveMembership(grant.id, grant.channel));
          if (seal.sessionID !== this.#session || seal.transitionID !== grant.id || seal.pluginID !== this.#plugin ||
            seal.leaseIncarnation !== saved.intent.leaseIncarnation || JSON.stringify(seal.source) !== JSON.stringify(saved.intent.source) ||
            seal.destination !== grant.to) throw uncertain();
          await this.#authorize(grant);
          this.#journal.put({ ...saved, phase: 'detached', seal });
          return structuredClone(seal);
        } catch (error) {
          try { this.#journal.put({ ...saved, phase: 'uncertain-detach' }); } catch { /* Preserve dispatch evidence. */ }
          throw error;
        }
      });
    } catch { this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.#client.off('disconnected', this.#disconnect); this.#client.off('membership_removed', this.#removed);
    this.#native.close();
  }
}

// Creates only an inert native destination record; no placement or release is implied.
export class OpenCodeAuthorizedDestinationStage {
  #client; #credential; #native; #journal; #agent; #session; #channel; #plugin; #closed = false; #busy = false; #disconnect; #removed;
  constructor({ client, credential, native, journal, sessionID, channel, pluginID = 'turnlink' }) {
    if (!client?.request || !client?.on || !client?.off || !(client.receiverKeys instanceof Map) || typeof credential !== 'function' ||
      !native?.inspect || !native?.stageDestinationMembership || !native?.close || !journal?.exclusive || !journal?.get || !journal?.put ||
      journal.agentId !== `opencode:${sessionID}` || !channel || !pluginID) throw unavailable();
    this.#agent = AgentID.parse(`opencode:${sessionID}`); this.#session = sessionID; this.#channel = channel; this.#plugin = pluginID;
    this.#client = client; this.#credential = credential; this.#native = native; this.#journal = journal;
    this.#disconnect = () => this.close(); this.#removed = event => { if (event.agentId === this.#agent) this.close(); };
    client.on('disconnected', this.#disconnect); client.on('membership_removed', this.#removed);
  }
  #receiverHash() {
    const key = this.#client.receiverKeys.get(this.#agent);
    if (this.#closed || this.#client.hostId !== this.#journal.hostId || !/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
    return digest(key);
  }
  async #authorize(grant, receiverHash) {
    if (this.#receiverHash() !== receiverHash) throw unavailable();
    const credential = await this.#credential();
    const result = await this.#client.request('control_worktree_authorize', { agentId: this.#agent, channel: this.#channel,
      credential, grant, action: 'observe-worktree' });
    if (this.#closed || !Stamp.safeParse(result.checkedAt).success || result.checkedAt < grant.preparedAt ||
      JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw unavailable();
    const hold = await this.#client.request('control_receiver_observe', { agentId: this.#agent, channel: this.#channel,
      credential, transitionID: grant.id });
    if (hold.transitionID !== grant.id || hold.status !== 'held' || hold.sourceDetached !== true || this.#receiverHash() !== receiverHash) throw unavailable();
  }
  async stage(value) {
    if (this.#closed || this.#busy) throw unavailable();
    this.#busy = true; let attempted = false, saved;
    try {
      return await this.#journal.exclusive(async () => {
        const grant = WorktreeTransition.parse(value);
        saved = this.#journal.get(grant.id);
        if (grant.agentId !== this.#agent || grant.channel !== this.#channel || grant.status !== 'prepared' || grant.purpose ||
          !saved || saved.phase !== 'detached' || saved.pluginID !== this.#plugin || JSON.stringify(saved.grant) !== JSON.stringify(grant) ||
          JSON.stringify(await this.#native.inspect()) !== JSON.stringify(saved.intent)) throw unavailable();
        const receiverHash = this.#receiverHash();
        await this.#authorize(grant, receiverHash);
        saved = this.#journal.put({ ...saved, phase: 'staging', receiverHash }); attempted = true;
        try {
          const destination = destinationMembershipSchema.parse(await this.#native.stageDestinationMembership(grant.id, grant.channel, receiverHash));
          if (destination.sessionID !== this.#session || destination.transitionID !== grant.id || destination.pluginID !== this.#plugin ||
            destination.leaseIncarnation !== saved.intent.leaseIncarnation || destination.archiveNonce !== saved.seal.nonce ||
            destination.receiverHash !== receiverHash || JSON.stringify(destination.source) !== JSON.stringify(saved.intent.source) ||
            destination.destination !== grant.to) throw uncertain();
          await this.#authorize(grant, receiverHash);
          this.#journal.put({ ...saved, phase: 'staged', destination });
          return structuredClone(destination);
        } catch (error) {
          try { this.#journal.put({ ...saved, phase: 'uncertain-stage' }); } catch { /* Preserve dispatch evidence. */ }
          throw error;
        }
      });
    } catch { if (attempted) this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.#client.off('disconnected', this.#disconnect); this.#client.off('membership_removed', this.#removed);
    this.#native.close();
  }
}
