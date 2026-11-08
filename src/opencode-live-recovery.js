import { WorktreeTransition } from './control/contracts.js';
import { destinationMembershipSchema, intentSchema } from './opencode-native-recovery.js';
import { OpenCodeAuthorizedRecovery } from './opencode-authorized-recovery.js';
import { digest } from './config.js';
import { randomUUID } from 'node:crypto';
import { placementReceiptID, placementReceiptSchema } from './opencode-native-recovery.js';

const unavailable = () => Object.assign(new Error('NATIVE_LIVE_RECOVERY_UNAVAILABLE'), { code: 'NATIVE_LIVE_RECOVERY_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('NATIVE_LIVE_RECOVERY_UNCERTAIN'), { code: 'NATIVE_LIVE_RECOVERY_UNCERTAIN' });
const identityFields = ['id', 'agentId', 'channel', 'taskID', 'previewID', 'claimGeneration', 'from', 'to', 'configurationDigest', 'authorityDigest', 'pluginProvenanceDigest', 'nativeAuthorityObservationDigest', 'preparedAt'];
const sameIdentity = (saved, current) => identityFields.every(key => saved[key] === current[key]);

// Connects the existing live, recovery and membership journals under one grant.
// It can claim quarantine and seal an already absent membership, never move it.
export class OpenCodeLiveRecovery {
  #native; #live; #authorized; #client; #credential; #destinationJournal; #claim; #session; #plugin; #channel; #closed = false; #busy = false; #claimed = false; #observed = false;
  constructor({ client, credential, recovery, journal, liveJournal, membershipJournal, detachmentJournal, destinationJournal, sessionID, channel, pluginID = 'turnlink' }) {
    if (!recovery?.inspect || !liveJournal?.exclusive || !liveJournal?.get || !journal ||
      liveJournal.hostId !== journal.hostId || liveJournal.agentId !== journal.agentId ||
      liveJournal.agentId !== `opencode:${sessionID}`) throw unavailable();
    this.#native = recovery; this.#live = liveJournal; this.#client = client; this.#credential = credential; this.#destinationJournal = destinationJournal; this.#session = sessionID; this.#plugin = pluginID; this.#channel = channel;
    this.#authorized = new OpenCodeAuthorizedRecovery({ client, credential, recovery, journal, membershipJournal, detachmentJournal, sessionID, channel, pluginID });
  }
  #grant(value, allowMoved = false) {
    const grant = WorktreeTransition.parse(value);
    if (grant.agentId !== `opencode:${this.#session}` || grant.channel !== this.#channel || grant.purpose !== undefined ||
      !['prepared', 'uncertain', ...(allowMoved ? ['moved'] : [])].includes(grant.status)) throw unavailable();
    return grant;
  }
  #match(grant, record, intent) {
    if (!record || record.pluginID !== this.#plugin || !sameIdentity(record.grant, grant) ||
      !['preparing', 'uncertain-prepare', 'prepared', 'releasing', 'uncertain-release', 'released', 'detaching', 'uncertain-detach', 'detached', 'staging', 'uncertain-stage', 'staged'].includes(record.phase) ||
      intent.sessionID !== this.#session || intent.pluginID !== this.#plugin || intent.transitionID !== grant.id ||
      intent.source.directory !== grant.from || intent.directory !== grant.to || intent.membershipFence !== 1 || !intent.leaseIncarnation ||
      (record.intent && JSON.stringify(record.intent) !== JSON.stringify(intent))) throw unavailable();
  }
  async #withStage(grant, record, intent, operation) {
    if (record.phase === 'staged') return operation(this.#live, record, record.destination, false);
    const journal = this.#destinationJournal;
    if (!journal?.exclusive || !journal?.get || !journal?.put || journal.agentId !== `opencode:${this.#session}` ||
        journal.hostId !== this.#client.hostId) throw unavailable();
    return journal.exclusive(async () => {
      const saved = journal.get(grant.id);
      if (!saved || saved.phase !== 'staged' || saved.pluginID !== this.#plugin || !sameIdentity(saved.grant, grant) ||
          saved.claim.previousLeaseIncarnation !== intent.leaseIncarnation) throw unavailable();
      return operation(journal, saved, saved.destination, true);
    });
  }
  async claim(value) {
    if (this.#closed || this.#busy || this.#claimed) throw unavailable();
    this.#busy = true; let dispatched = false, completed = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value, true), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        dispatched = true;
        const claim = await this.#authorized.claim(grant);
        completed = true;
        this.#claimed = true; this.#claim = claim;
        return { livePhase: record.phase, claim };
      });
    } catch (error) {
      this.close();
      throw completed || (dispatched && error?.code === 'NATIVE_RECOVERY_UNCERTAIN') ? uncertain() : unavailable();
    } finally { this.#busy = false; }
  }
  async inspect(value) {
    if (this.#closed || this.#busy || !this.#claimed) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        return await this.#authorized.inspect(grant);
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async reconcile(value) {
    if (this.#closed || this.#busy || this.#claimed || this.#observed) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value, true), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        const result = await this.#authorized.reconcile(grant);
        if (result.status === 'observed') this.#observed = true;
        return result;
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async takeover(value) {
    if (this.#closed || this.#busy || this.#claimed || !this.#observed) throw unavailable();
    this.#busy = true; let dispatched = false, completed = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value, true), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        dispatched = true;
        const claim = await this.#authorized.takeover(grant);
        completed = true;
        this.#claimed = true; this.#claim = claim; this.#observed = false;
        return { livePhase: record.phase, claim };
      });
    } catch (error) {
      this.close();
      throw completed || (dispatched && error?.code === 'NATIVE_RECOVERY_UNCERTAIN') ? uncertain() : unavailable();
    } finally { this.#busy = false; }
  }
  async sealMembership(value) {
    if (this.#closed || this.#busy || !this.#claimed) throw unavailable();
    this.#busy = true; let dispatched = false, completed = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        dispatched = true;
        const seal = await this.#authorized.sealMembership(grant);
        completed = true;
        return seal;
      });
    } catch (error) {
      this.close();
      throw completed || (dispatched && error?.code === 'NATIVE_RECOVERY_UNCERTAIN') ? uncertain() : unavailable();
    } finally { this.#busy = false; }
  }
  async observeMembershipSeal(value) {
    if (this.#closed || this.#busy || !this.#claimed) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        return await this.#authorized.observeMembershipSeal(grant);
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async detachMembership(value) {
    if (this.#closed || this.#busy || !this.#claimed) throw unavailable();
    this.#busy = true; let dispatched = false, completed = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        dispatched = true;
        const seal = await this.#authorized.detachMembership(grant);
        completed = true;
        return seal;
      });
    } catch (error) {
      this.close();
      throw completed || (dispatched && error?.code === 'NATIVE_RECOVERY_UNCERTAIN') ? uncertain() : unavailable();
    } finally { this.#busy = false; }
  }
  async observeDetachedMembership(value) {
    if (this.#closed || this.#busy || !this.#claimed) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        return await this.#authorized.observeDetachedMembership(grant);
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async observeLiveDetachment(value) {
    if (this.#closed || this.#busy || !this.#claimed || !this.#native.observeDetachedMembership) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        if (!['detaching', 'uncertain-detach', 'detached'].includes(record.phase)) throw unavailable();
        const held = async () => {
          const result = await this.#client.request('control_receiver_observe', { agentId: grant.agentId, channel: grant.channel,
            credential: await this.#credential(), transitionID: grant.id });
          if (result.transitionID !== grant.id || result.status !== 'held' || typeof result.sourceDetached !== 'boolean') throw unavailable();
        };
        await this.#authorized.inspect(grant); await held();
        const seal = await this.#native.observeDetachedMembership();
        await this.#authorized.inspect(grant); await held();
        if (!seal) return { status: 'unresolved' };
        if (seal.leaseIncarnation !== intent.leaseIncarnation || JSON.stringify(seal.source) !== JSON.stringify(intent.source)) throw unavailable();
        const saved = this.#live.put({ ...record, phase: 'detached', seal });
        return { status: 'detached', seal: structuredClone(saved.seal) };
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async observeLiveDestination(value) {
    if (this.#closed || this.#busy || !this.#claimed || !this.#native.observeDestinationMembership) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        if (!['staging', 'uncertain-stage', 'staged'].includes(record.phase)) throw unavailable();
        const held = async () => {
          const key = this.#client.receiverKeys?.get(grant.agentId);
          if (!/^[a-f0-9]{64}$/.test(key || '') || digest(key) !== record.receiverHash) throw unavailable();
          const result = await this.#client.request('control_receiver_observe', { agentId: grant.agentId, channel: grant.channel,
            credential: await this.#credential(), transitionID: grant.id });
          if (result.transitionID !== grant.id || result.status !== 'held' || result.sourceDetached !== true ||
            this.#client.receiverKeys?.get(grant.agentId) !== key) throw unavailable();
        };
        await this.#authorized.inspect(grant); await held();
        const destination = await this.#native.observeDestinationMembership();
        await this.#authorized.inspect(grant); await held();
        if (!destination) return { status: 'unresolved' };
        if (destination.leaseIncarnation !== intent.leaseIncarnation || destination.archiveNonce !== record.seal.nonce ||
          destination.receiverHash !== record.receiverHash || JSON.stringify(destination.source) !== JSON.stringify(intent.source)) throw unavailable();
        const saved = this.#live.put({ ...record, phase: 'staged', destination });
        return { status: 'staged', destination: structuredClone(saved.destination) };
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async commitPreparedPlacement(value) {
    if (this.#closed || this.#busy || !this.#claimed || !this.#native.commitPreparedPlacement) throw unavailable();
    this.#busy = true; let attempted = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        return this.#withStage(grant, record, intent, async (ownerJournal, saved, stage) => {
          let leases;
          if (saved.commit) {
            const observed = await this.#authorized.observePlacement(grant, stage);
            if (observed) {
              if (saved.commit.placement && JSON.stringify(saved.commit.placement) !== JSON.stringify(observed)) throw unavailable();
              if (saved.commit.phase !== 'committed') ownerJournal.put({ ...saved, commit: { ...saved.commit, phase: 'committed', placement: observed } });
              return observed;
            }
            // A successor owns a different exclusive native storage lease. The
            // preceding transaction either committed atomically with a receipt
            // or rolled back; never retry under the same or an unknown lease.
            const lease = this.#claim?.leaseIncarnation;
            if (saved.commit.phase === 'committed' || !saved.commit.leases || !lease || saved.commit.leases.includes(lease) || saved.commit.leases.length >= 32)
              throw unavailable();
            leases = [...saved.commit.leases, lease];
          } else {
            // Existing native placement without a matching dispatch record is not
            // authority to adopt or replay a mutation.
            if (await this.#authorized.observePlacement(grant, stage)) throw unavailable();
            if (!this.#claim?.leaseIncarnation) throw unavailable();
            leases = [this.#claim.leaseIncarnation];
          }
          const pending = ownerJournal.put({ ...saved, commit: { phase: 'dispatching', leases } });
          attempted = true;
          try {
            const placement = await this.#authorized.commitPreparedPlacement(grant, stage);
            ownerJournal.put({ ...pending, commit: { phase: 'committed', placement, leases } });
            return placement;
          } catch (error) {
            try { ownerJournal.put({ ...pending, commit: { phase: 'uncertain', leases } }); } catch { /* Durable dispatch remains conservative. */ }
            throw error;
          }
        });
      });
    } catch (error) {
      if (attempted) { this.close(); throw uncertain(); }
      throw unavailable();
    } finally { this.#busy = false; }
  }
  // The broker settlement is idempotent by its persisted command ID. Native
  // placement is observed, never replayed, before completion is allowed.
  async settlePlacement(value) {
    if (this.#closed || this.#busy || !this.#claimed || typeof this.#client.settlePlacement !== 'function' || !this.#native.observePlacement) throw unavailable();
    this.#busy = true; let dispatched = false, saved, recoveredStage = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value, true), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        return this.#withStage(grant, record, intent, async (ownerJournal, ownerRecord, stage, recovered) => {
        recoveredStage = recovered;
        let settlement = ownerRecord.settlement;
        if (!settlement) {
          if (grant.status === 'moved') throw unavailable();
          const placement = placementReceiptSchema.parse(await this.#authorized.observePlacement(grant, stage));
          settlement = { commandID: randomUUID(), receiptID: placementReceiptID(placement), placement, phase: 'dispatching' };
          saved = ownerJournal.put({ ...ownerRecord, settlement });
        } else {
          saved = ownerRecord;
          if (grant.status === 'moved') {
            const observed = await this.#authorized.observePlacement(grant, stage);
            if (JSON.stringify(observed) !== JSON.stringify(settlement.placement) || grant.receiptID !== settlement.receiptID) throw unavailable();
          }
          if (settlement.phase === 'settled') {
            if (grant.status !== 'moved' || JSON.stringify(settlement.moved) !== JSON.stringify(grant)) throw unavailable();
            return structuredClone(grant);
          }
        }
        dispatched = true;
        const moved = WorktreeTransition.parse(await this.#client.settlePlacement({ commandID: settlement.commandID, receiptID: settlement.receiptID }));
        if (!sameIdentity(grant, moved) || moved.status !== 'moved' || moved.actualLocation !== grant.to || moved.receiptID !== settlement.receiptID) throw uncertain();
        const observed = await this.#authorized.observePlacement(moved, stage);
        if (JSON.stringify(observed) !== JSON.stringify(settlement.placement)) throw uncertain();
        ownerJournal.put({ ...saved, settlement: { ...settlement, phase: 'settled', moved } });
        return structuredClone(moved);
        });
      });
    } catch {
      if (dispatched) {
        if (saved?.settlement?.phase === 'dispatching') {
          try { await this.#live.exclusive(() => recoveredStage ? this.#destinationJournal.exclusive(() =>
            this.#destinationJournal.put({ ...saved, settlement: { ...saved.settlement, phase: 'uncertain' } })) :
            this.#live.put({ ...saved, settlement: { ...saved.settlement, phase: 'uncertain' } })); }
          catch { /* The durable dispatch record remains conservative. */ }
        }
        this.close(); throw uncertain();
      }
      throw unavailable();
    } finally { this.#busy = false; }
  }
  async completePlacement(value) {
    if (this.#closed || this.#busy || !this.#claimed || !this.#native.completePlacement) throw unavailable();
    this.#busy = true; let attempted = false;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value, true), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        if (grant.status !== 'moved') throw unavailable();
        return this.#withStage(grant, record, intent, async (_journal, _saved, stage) => {
          attempted = true;
          return this.#authorized.completePlacement(grant, stage);
        });
      });
    } catch {
      if (attempted) { this.close(); throw uncertain(); }
      throw unavailable();
    } finally { this.#busy = false; }
  }
  // Once placement commits, ordinary source inspection no longer applies.
  // Use the durable staged binding and receipt-aware native observation.
  async observePlacement(value) {
    if (this.#closed || this.#busy || !this.#claimed || !this.#native.observePlacement) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = this.#grant(value, true), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        return this.#withStage(grant, record, intent, (_journal, _saved, stage) => this.#authorized.observePlacement(grant, stage));
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async #destinationHold(grant, receiverHash) {
    const key = this.#client.receiverKeys?.get(grant.agentId);
    if (!/^[a-f0-9]{64}$/.test(key || '') || digest(key) !== receiverHash) throw unavailable();
    const hold = await this.#client.request('control_receiver_observe', { agentId: grant.agentId, channel: grant.channel,
      credential: await this.#credential(), transitionID: grant.id });
    if (this.#closed || hold.transitionID !== grant.id || hold.status !== 'held' || hold.sourceDetached !== true ||
      this.#client.receiverKeys?.get(grant.agentId) !== key) throw unavailable();
  }
  async stageRecoveredDestination(value) {
    const journal = this.#destinationJournal;
    if (this.#closed || this.#busy || !this.#claimed || !this.#claim || !this.#native.stageRecoveredDestinationMembership ||
      !this.#native.observeDetachedMembership || !journal?.exclusive || !journal?.get || !journal?.put ||
      journal.agentId !== `opencode:${this.#session}` || journal.hostId !== this.#client.hostId) throw unavailable();
    this.#busy = true; let attempted = false;
    try {
      return await this.#live.exclusive(() => journal.exclusive(async () => {
        const grant = this.#grant(value), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        if (journal.get(grant.id)) throw unavailable();
        const key = this.#client.receiverKeys?.get(grant.agentId);
        if (!/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
        const receiverHash = digest(key);
        await this.#destinationHold(grant, receiverHash);
        const inspection = await this.#authorized.inspect(grant);
        if (JSON.stringify(inspection.recovery) !== JSON.stringify(this.#claim) || inspection.membershipPresent || !inspection.membershipSeal)
          throw unavailable();
        const seal = await this.#native.observeDetachedMembership();
        if (!seal || JSON.stringify(seal) !== JSON.stringify(inspection.membershipSeal)) throw unavailable();
        await this.#destinationHold(grant, receiverHash);
        await this.#authorized.inspect(grant);
        const saved = journal.put({ grant, pluginID: this.#plugin, claim: this.#claim, seal, receiverHash, phase: 'staging' });
        attempted = true;
        try {
          const destination = destinationMembershipSchema.parse(await this.#native.stageRecoveredDestinationMembership(grant.channel, receiverHash));
          if (destination.sessionID !== this.#session || destination.transitionID !== grant.id || destination.pluginID !== this.#plugin ||
            JSON.stringify(destination.source) !== JSON.stringify(seal.source) || destination.destination !== grant.to ||
            destination.archiveNonce !== seal.nonce || destination.leaseIncarnation !== seal.leaseIncarnation || destination.receiverHash !== receiverHash)
            throw uncertain();
          await this.#authorized.inspect(grant); await this.#destinationHold(grant, receiverHash);
          return journal.put({ ...saved, phase: 'staged', destination }).destination;
        } catch (error) {
          try { journal.put({ ...saved, phase: 'uncertain' }); } catch { /* Keep the durable dispatch record. */ }
          throw error;
        }
      }));
    } catch { if (attempted) this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  async observeRecoveredDestination(value) {
    const journal = this.#destinationJournal;
    if (this.#closed || this.#busy || !this.#claimed || !journal?.exclusive || !journal?.get || !journal?.put ||
      journal.agentId !== `opencode:${this.#session}` || journal.hostId !== this.#client.hostId) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(() => journal.exclusive(async () => {
        const grant = this.#grant(value), saved = journal.get(grant.id), record = this.#live.get(grant.id);
        const intent = intentSchema.parse(await this.#native.inspect());
        this.#match(grant, record, intent);
        if (!saved || saved.pluginID !== this.#plugin || !sameIdentity(saved.grant, grant) ||
          saved.claim.previousLeaseIncarnation !== intent.leaseIncarnation) throw unavailable();
        const before = await this.#authorized.inspect(grant);
        if (before.membershipPresent || JSON.stringify(before.membershipSeal) !== JSON.stringify(saved.seal)) throw unavailable();
        await this.#destinationHold(grant, saved.receiverHash);
        const destination = await this.#native.observeDestinationMembership();
        await this.#authorized.inspect(grant); await this.#destinationHold(grant, saved.receiverHash);
        if (!destination) return { status: 'unresolved' };
        if (destination.sessionID !== this.#session || destination.transitionID !== grant.id || destination.pluginID !== this.#plugin ||
          JSON.stringify(destination.source) !== JSON.stringify(saved.seal.source) || destination.destination !== grant.to ||
          destination.archiveNonce !== saved.seal.nonce || destination.leaseIncarnation !== saved.seal.leaseIncarnation ||
          destination.receiverHash !== saved.receiverHash) throw unavailable();
        return { status: 'staged', destination: journal.put({ ...saved, phase: 'staged', destination }).destination };
      }));
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  close() { if (!this.#closed) { this.#closed = true; this.#authorized.close(); } }
}
