import { AgentID } from './protocol.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { digest } from './config.js';
import { destinationMembershipSchema, placementReceiptID, placementReceiptSchema } from './opencode-native-recovery.js';

const unavailable = () => Object.assign(new Error('NATIVE_RECOVERY_UNAVAILABLE'), { code: 'NATIVE_RECOVERY_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('NATIVE_RECOVERY_UNCERTAIN'), { code: 'NATIVE_RECOVERY_UNCERTAIN' });

// Receiver-bound broker checks bracket recovery observation. This is not a
// transferable capability, physical cleanup proof, or authority to move.
export class OpenCodeAuthorizedRecovery {
  #client; #credential; #recovery; #journal; #membershipJournal; #detachmentJournal; #agent; #session; #plugin; #channel; #closed = false; #busy = false; #intent; #claim; #observed;
  #disconnected; #removed;
  constructor({ client, credential, recovery, journal, membershipJournal, detachmentJournal, sessionID, channel, pluginID = 'turnlink' }) {
    if (!client?.request || !client?.on || !client?.off || typeof credential !== 'function' ||
      !recovery?.inspect || !recovery?.claimRecovery || !recovery?.inspectRecovery || !recovery?.observeRecoveryRecord || !recovery?.close ||
      !journal?.exclusive || !journal?.get || !journal?.put ||
      typeof channel !== 'string' || !channel || typeof pluginID !== 'string' || !pluginID) throw unavailable();
    this.#agent = AgentID.parse(`opencode:${sessionID}`); this.#session = sessionID; this.#plugin = pluginID; this.#channel = channel;
    if (journal.agentId !== this.#agent) throw unavailable();
    this.#client = client; this.#credential = credential; this.#recovery = recovery; this.#journal = journal; this.#membershipJournal = membershipJournal; this.#detachmentJournal = detachmentJournal;
    this.#disconnected = () => this.close();
    this.#removed = event => { if (event.agentId === this.#agent) this.close(); };
    client.on('disconnected', this.#disconnected); client.on('membership_removed', this.#removed);
  }
  #grant(value, allowMoved = false) {
    const grant = WorktreeTransition.parse(value);
    if (grant.agentId !== this.#agent || grant.channel !== this.#channel || grant.purpose !== undefined ||
      !['prepared', 'uncertain', ...(allowMoved ? ['moved'] : [])].includes(grant.status)) throw unavailable();
    return grant;
  }
  #matches(grant, intent) {
    if (intent.sessionID !== this.#session || intent.pluginID !== this.#plugin || grant.id !== intent.transitionID ||
      grant.from !== intent.source.directory || grant.to !== intent.directory) throw unavailable();
  }
  #sameGrant(saved, grant) {
    if (saved.agentId !== grant.agentId || saved.channel !== grant.channel || saved.taskID !== grant.taskID ||
      saved.previewID !== grant.previewID || saved.claimGeneration !== grant.claimGeneration || saved.from !== grant.from ||
      saved.to !== grant.to || saved.configurationDigest !== grant.configurationDigest ||
      saved.authorityDigest !== grant.authorityDigest || saved.preparedAt !== grant.preparedAt) throw unavailable();
  }
  async #authorize(grant, action = 'observe-worktree') {
    if (this.#closed) throw unavailable();
    if (action === 'observe-worktree' && grant.status === 'moved') action = 'observe-moved-worktree';
    const result = await this.#client.request('control_worktree_authorize', {
      agentId: this.#agent, channel: this.#channel, credential: await this.#credential(), grant, action,
    });
    if (this.#closed || this.#client.hostId !== this.#journal.hostId || !Stamp.safeParse(result.checkedAt).success || result.checkedAt < grant.preparedAt ||
      JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw unavailable();
    if (grant.status === 'moved') {
      const hold = await this.#client.request('control_receiver_observe', { agentId: this.#agent, channel: this.#channel,
        credential: await this.#credential(), transitionID: grant.id });
      if (this.#closed || hold.transitionID !== grant.id || hold.status !== 'held' || hold.sourceDetached !== true) throw unavailable();
    }
  }
  async #receiverHeld(grant, requireUndetached) {
    const result = await this.#client.request('control_receiver_observe', { agentId: this.#agent, channel: this.#channel,
      credential: await this.#credential(), transitionID: grant.id });
    if (this.#closed || result.transitionID !== grant.id || result.status !== 'held' || typeof result.sourceDetached !== 'boolean' ||
      (requireUndetached && result.sourceDetached)) throw unavailable();
  }
  async claim(value) {
    if (this.#closed || this.#busy || this.#claim) throw unavailable();
    this.#busy = true; let attempted = false, grant;
    try {
      return await this.#journal.exclusive(async () => {
        grant = this.#grant(value, true);
        if (this.#journal.get(grant.id)) throw unavailable();
        const intent = await this.#recovery.inspect();
        this.#matches(grant, intent);
        await this.#authorize(grant);
        this.#journal.put({ grant, pluginID: this.#plugin, phase: 'claiming' });
        attempted = true;
        try {
          const claim = await this.#recovery.claimRecovery(grant.id);
          await this.#authorize(grant);
          this.#journal.put({ grant, pluginID: this.#plugin, phase: 'claimed', claim });
          this.#intent = intent; this.#claim = claim;
          return structuredClone(claim);
        } catch (error) {
          try { this.#journal.put({ grant, pluginID: this.#plugin, phase: 'uncertain' }); } catch { /* A durable claiming record remains conservative. */ }
          throw error;
        }
      });
    } catch {
      this.close();
      throw attempted ? uncertain() : unavailable();
    } finally { this.#busy = false; }
  }
  async reconcile(value) {
    if (this.#closed || this.#busy || this.#claim) throw unavailable();
    this.#busy = true;
    try {
      return await this.#journal.exclusive(async () => {
        const grant = this.#grant(value, true), saved = this.#journal.get(grant.id);
        if (!saved || saved.pluginID !== this.#plugin) throw unavailable();
        const intent = await this.#recovery.inspect();
        this.#matches(grant, intent);
        this.#sameGrant(saved.grant, grant);
        await this.#authorize(grant);
        const observed = await this.#recovery.observeRecoveryRecord();
        await this.#authorize(grant);
        // Absence or the unchanged predecessor is never permission to replay a dispatch.
        if (!observed.recovery) return { status: 'unresolved' };
        const claim = observed.recovery;
        const pending = ['taking', 'takeover-uncertain'].includes(saved.phase);
        const unchanged = pending && JSON.stringify(saved.claim) === JSON.stringify(claim);
        if (unchanged && observed.currentLease === saved.observedByLease) return { status: 'unresolved' };
        if (claim.sessionID !== this.#session || claim.transitionID !== grant.id ||
          claim.previousLeaseIncarnation !== intent.leaseIncarnation || observed.currentLease === intent.leaseIncarnation ||
          claim.leaseIncarnation === intent.leaseIncarnation || claim.incarnation === intent.incarnation ||
          claim.activation === intent.activation || claim.generation <= intent.generation ||
          (pending && !unchanged ? claim.leaseIncarnation !== saved.observedByLease || claim.generation <= saved.claim.generation ||
            claim.incarnation === saved.claim.incarnation || claim.activation === saved.claim.activation :
            saved.claim && JSON.stringify(saved.claim) !== JSON.stringify(claim)) ||
          (unchanged && observed.currentLease === claim.leaseIncarnation)) throw unavailable();
        this.#journal.put({ ...saved, phase: 'observed', claim, observedByLease: observed.currentLease });
        this.#intent = intent; this.#observed = { claim, lease: observed.currentLease };
        return { status: 'observed', recovery: structuredClone(claim) };
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async takeover(value) {
    if (this.#closed || this.#busy || this.#claim || !this.#observed || !this.#recovery.takeoverRecovery) throw unavailable();
    this.#busy = true; let attempted = false;
    try {
      return await this.#journal.exclusive(async () => {
        const grant = this.#grant(value, true), saved = this.#journal.get(grant.id);
        this.#matches(grant, this.#intent);
        if (!saved || saved.phase !== 'observed' || saved.pluginID !== this.#plugin ||
          JSON.stringify(saved.claim) !== JSON.stringify(this.#observed.claim) || saved.observedByLease !== this.#observed.lease ||
          saved.claim.leaseIncarnation === saved.observedByLease) throw unavailable();
        this.#sameGrant(saved.grant, grant);
        await this.#authorize(grant);
        this.#journal.put({ ...saved, phase: 'taking' });
        attempted = true;
        try {
          const claim = await this.#recovery.takeoverRecovery(saved.claim, saved.observedByLease);
          if (claim.sessionID !== this.#session || claim.transitionID !== grant.id ||
            claim.previousLeaseIncarnation !== this.#intent.leaseIncarnation || claim.leaseIncarnation !== saved.observedByLease ||
            claim.generation <= saved.claim.generation || claim.incarnation === saved.claim.incarnation ||
            claim.activation === saved.claim.activation) throw uncertain();
          await this.#authorize(grant);
          this.#journal.put({ grant: saved.grant, pluginID: this.#plugin, phase: 'claimed', claim });
          this.#claim = claim; this.#observed = undefined;
          return structuredClone(claim);
        } catch (error) {
          try { this.#journal.put({ ...saved, phase: 'takeover-uncertain' }); } catch { /* Keep the durable taking record. */ }
          throw error;
        }
      });
    } catch { this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  async inspect(value) {
    if (this.#closed || this.#busy || !this.#claim) throw unavailable();
    this.#busy = true;
    try {
      const grant = this.#grant(value);
      this.#matches(grant, this.#intent);
      await this.#authorize(grant);
      const result = await this.#recovery.inspectRecovery();
      await this.#authorize(grant);
      return result;
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async commitPreparedPlacement(value, staged) {
    if (this.#closed || this.#busy || !this.#claim || !this.#recovery.commitPreparedPlacement) throw unavailable();
    this.#busy = true; let attempted = false;
    try {
      const grant = this.#grant(value), stage = destinationMembershipSchema.parse(staged);
      this.#matches(grant, this.#intent);
      if (stage.sessionID !== this.#session || stage.transitionID !== grant.id || stage.pluginID !== this.#plugin ||
        JSON.stringify(stage.source) !== JSON.stringify(this.#intent.source) || stage.destination !== grant.to) throw unavailable();
      const key = this.#client.receiverKeys?.get(this.#agent);
      if (!/^[a-f0-9]{64}$/.test(key || '') || digest(key) !== stage.receiverHash) throw unavailable();
      await this.#authorize(grant, 'place-worktree');
      await this.#receiverHeld(grant, false);
      attempted = true;
      const receipt = placementReceiptSchema.parse(await this.#recovery.commitPreparedPlacement(stage));
      if (receipt.sessionID !== this.#session || receipt.transitionID !== grant.id ||
        JSON.stringify(receipt.source) !== JSON.stringify(this.#intent.source) || receipt.destination.directory !== grant.to ||
        receipt.archiveNonce !== stage.archiveNonce || receipt.stageNonce !== stage.nonce || receipt.receiverHash !== stage.receiverHash)
        throw uncertain();
      await this.#authorize(grant, 'place-worktree');
      await this.#receiverHeld(grant, false);
      return structuredClone(receipt);
    } catch (error) {
      if (attempted) { this.close(); throw uncertain(); }
      throw error?.code === 'NATIVE_RECOVERY_UNAVAILABLE' ? error : unavailable();
    } finally { this.#busy = false; }
  }
  async completePlacement(value, staged) {
    if (this.#closed || this.#busy || !this.#claim || !this.#recovery.completePlacement) throw unavailable();
    this.#busy = true; let attempted = false;
    try {
      const grant = this.#grant(value, true), stage = destinationMembershipSchema.parse(staged);
      this.#matches(grant, this.#intent);
      if (grant.status !== 'moved' || stage.sessionID !== this.#session || stage.transitionID !== grant.id ||
        stage.pluginID !== this.#plugin || JSON.stringify(stage.source) !== JSON.stringify(this.#intent.source) ||
        stage.destination !== grant.to) throw unavailable();
      const key = this.#client.receiverKeys?.get(this.#agent);
      if (!/^[a-f0-9]{64}$/.test(key || '') || digest(key) !== stage.receiverHash) throw unavailable();
      await this.#authorize(grant);
      await this.#receiverHeld(grant, false);
      if (!this.#recovery.observePlacement) throw unavailable();
      const observed = placementReceiptSchema.parse(await this.#recovery.observePlacement(stage));
      if (placementReceiptID(observed) !== grant.receiptID || observed.sessionID !== this.#session ||
        observed.transitionID !== grant.id || JSON.stringify(observed.source) !== JSON.stringify(this.#intent.source) ||
        observed.destination.directory !== grant.to || observed.archiveNonce !== stage.archiveNonce ||
        observed.stageNonce !== stage.nonce || observed.receiverHash !== stage.receiverHash) throw unavailable();
      await this.#authorize(grant);
      await this.#receiverHeld(grant, false);
      attempted = true;
      const completion = await this.#recovery.completePlacement(stage);
      const receipt = placementReceiptSchema.parse(completion.placement);
      if (placementReceiptID(receipt) !== grant.receiptID || receipt.transitionID !== grant.id ||
        receipt.destination.directory !== grant.to || receipt.receiverHash !== stage.receiverHash)
        throw uncertain();
      await this.#authorize(grant);
      await this.#receiverHeld(grant, false);
      return structuredClone(completion);
    } catch (error) {
      if (attempted) { this.close(); throw uncertain(); }
      throw error?.code === 'NATIVE_RECOVERY_UNAVAILABLE' ? error : unavailable();
    } finally { this.#busy = false; }
  }
  // Observe a committed placement without replaying it. The stage must still
  // belong to the exact held receiver when the native receipt is read.
  async observePlacement(value, staged) {
    if (this.#closed || this.#busy || !this.#claim || !this.#recovery.observePlacement) throw unavailable();
    this.#busy = true;
    try {
      const grant = this.#grant(value, true), stage = destinationMembershipSchema.parse(staged);
      this.#matches(grant, this.#intent);
      if (stage.sessionID !== this.#session || stage.transitionID !== grant.id || stage.pluginID !== this.#plugin ||
        JSON.stringify(stage.source) !== JSON.stringify(this.#intent.source) || stage.destination !== grant.to) throw unavailable();
      const key = this.#client.receiverKeys?.get(this.#agent);
      if (!/^[a-f0-9]{64}$/.test(key || '') || digest(key) !== stage.receiverHash) throw unavailable();
      const held = async () => {
        await this.#authorize(grant);
        const result = await this.#client.request('control_receiver_observe', { agentId: this.#agent, channel: this.#channel,
          credential: await this.#credential(), transitionID: grant.id });
        if (this.#closed || this.#client.receiverKeys?.get(this.#agent) !== key || result.transitionID !== grant.id ||
          result.status !== 'held' || result.sourceDetached !== true) throw unavailable();
      };
      await held();
      const observed = await this.#recovery.observePlacement(stage);
      await held();
      if (observed === null) return null;
      const receipt = placementReceiptSchema.parse(observed);
      if (receipt.sessionID !== this.#session || receipt.transitionID !== grant.id ||
        JSON.stringify(receipt.source) !== JSON.stringify(this.#intent.source) || receipt.destination.directory !== grant.to ||
        receipt.destination.workspaceID !== this.#intent.source.workspaceID ||
        receipt.archiveNonce !== stage.archiveNonce || receipt.stageNonce !== stage.nonce || receipt.receiverHash !== stage.receiverHash ||
        (grant.status === 'moved' && grant.receiptID !== placementReceiptID(receipt)))
        throw unavailable();
      return structuredClone(receipt);
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async sealMembership(value) {
    const journal = this.#membershipJournal;
    if (this.#closed || this.#busy || !this.#claim || this.#intent?.membershipFence !== 1 ||
      !journal?.exclusive || !journal?.get || !journal?.put || journal.agentId !== this.#agent || journal.hostId !== this.#client.hostId ||
      !this.#recovery.sealMembership) throw unavailable();
    this.#busy = true; let attempted = false, saved;
    try {
      return await journal.exclusive(async () => {
        const grant = this.#grant(value); this.#matches(grant, this.#intent);
        if (journal.get(grant.id)) throw unavailable();
        await this.#authorize(grant, 'seal-worktree-membership');
        const observed = await this.#recovery.inspectRecovery();
        if (observed.membershipPresent !== false || observed.membershipSeal !== null) throw unavailable();
        await this.#authorize(grant, 'seal-worktree-membership');
        saved = journal.put({ grant, pluginID: this.#plugin, claim: this.#claim, phase: 'sealing' });
        attempted = true;
        try {
          const seal = await this.#recovery.sealMembership();
          if (seal.leaseIncarnation !== saved.claim.leaseIncarnation || JSON.stringify(seal.source) !== JSON.stringify(this.#intent.source)) throw uncertain();
          await this.#authorize(grant, 'seal-worktree-membership');
          journal.put({ ...saved, phase: 'sealed', seal });
          return structuredClone(seal);
        } catch (error) {
          try { journal.put({ ...saved, phase: 'uncertain' }); } catch { /* Keep the durable dispatch record. */ }
          throw error;
        }
      });
    } catch { this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  async observeMembershipSeal(value) {
    const journal = this.#membershipJournal;
    if (this.#closed || this.#busy || !this.#claim || !journal?.exclusive || !journal?.get || !journal?.put ||
      journal.agentId !== this.#agent || journal.hostId !== this.#client.hostId) throw unavailable();
    this.#busy = true;
    try {
      return await journal.exclusive(async () => {
        const grant = this.#grant(value), saved = journal.get(grant.id);
        if (!saved || saved.pluginID !== this.#plugin) throw unavailable();
        this.#matches(grant, this.#intent); this.#sameGrant(saved.grant, grant);
        await this.#authorize(grant);
        const observed = await this.#recovery.inspectRecovery();
        await this.#authorize(grant);
        if (!observed.membershipSeal) return { status: 'unresolved' };
        if (observed.membershipPresent || observed.membershipSeal.leaseIncarnation !== saved.claim.leaseIncarnation ||
          JSON.stringify(observed.membershipSeal.source) !== JSON.stringify(this.#intent.source)) throw unavailable();
        const record = journal.put({ ...saved, phase: 'sealed', seal: observed.membershipSeal });
        return { status: 'sealed', seal: structuredClone(record.seal) };
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  async detachMembership(value) {
    const journal = this.#detachmentJournal;
    if (this.#closed || this.#busy || !this.#claim || this.#intent?.membershipFence !== 1 ||
      !journal?.exclusive || !journal?.get || !journal?.put || journal.agentId !== this.#agent || journal.hostId !== this.#client.hostId ||
      !this.#recovery.detachMembership || !this.#recovery.observeDetachedMembership) throw unavailable();
    this.#busy = true; let attempted = false, saved;
    try {
      return await journal.exclusive(async () => {
        const grant = this.#grant(value); this.#matches(grant, this.#intent);
        if (journal.get(grant.id)) throw unavailable();
        await this.#authorize(grant, 'detach-worktree-membership');
        await this.#receiverHeld(grant, true);
        const observed = await this.#recovery.inspectRecovery();
        if (observed.membershipPresent !== true || observed.membershipSeal !== null || await this.#recovery.observeDetachedMembership() !== null) throw unavailable();
        await this.#authorize(grant, 'detach-worktree-membership');
        await this.#receiverHeld(grant, true);
        saved = journal.put({ grant, pluginID: this.#plugin, claim: this.#claim, phase: 'detaching' });
        attempted = true;
        try {
          const seal = await this.#recovery.detachMembership(this.#channel);
          if (seal.leaseIncarnation !== saved.claim.leaseIncarnation || JSON.stringify(seal.source) !== JSON.stringify(this.#intent.source)) throw uncertain();
          await this.#authorize(grant, 'detach-worktree-membership');
          await this.#receiverHeld(grant, true);
          journal.put({ ...saved, phase: 'detached', seal });
          return structuredClone(seal);
        } catch (error) {
          try { journal.put({ ...saved, phase: 'uncertain' }); } catch { /* Keep the durable dispatch record. */ }
          throw error;
        }
      });
    } catch { this.close(); throw attempted ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  async observeDetachedMembership(value) {
    const journal = this.#detachmentJournal;
    if (this.#closed || this.#busy || !this.#claim || !journal?.exclusive || !journal?.get || !journal?.put ||
      journal.agentId !== this.#agent || journal.hostId !== this.#client.hostId || !this.#recovery.observeDetachedMembership) throw unavailable();
    this.#busy = true;
    try {
      return await journal.exclusive(async () => {
        const grant = this.#grant(value), saved = journal.get(grant.id);
        if (!saved || saved.pluginID !== this.#plugin) throw unavailable();
        this.#matches(grant, this.#intent); this.#sameGrant(saved.grant, grant);
        await this.#authorize(grant); await this.#receiverHeld(grant, false);
        const seal = await this.#recovery.observeDetachedMembership();
        await this.#authorize(grant); await this.#receiverHeld(grant, false);
        if (!seal) return { status: 'unresolved' };
        if (seal.leaseIncarnation !== saved.claim.leaseIncarnation || JSON.stringify(seal.source) !== JSON.stringify(this.#intent.source)) throw unavailable();
        const record = journal.put({ ...saved, phase: 'detached', seal });
        return { status: 'detached', seal: structuredClone(record.seal) };
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#client.off('disconnected', this.#disconnected); this.#client.off('membership_removed', this.#removed);
    this.#recovery.close();
  }
}
