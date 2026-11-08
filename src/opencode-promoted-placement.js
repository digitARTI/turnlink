import { randomUUID } from 'node:crypto';
import { WorktreeTransition, Stamp } from './control/contracts.js';
import { digest } from './config.js';
import { completionSchema, placementReceiptID, placementReceiptSchema } from './opencode-native-recovery.js';

const unavailable = () => Object.assign(new Error('OPENCODE_PROMOTED_PLACEMENT_UNAVAILABLE'), { code: 'OPENCODE_PROMOTED_PLACEMENT_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('OPENCODE_PROMOTED_PLACEMENT_UNCERTAIN'), { code: 'OPENCODE_PROMOTED_PLACEMENT_UNCERTAIN' });

// Owns only the promoted native descriptor and the exact held destination
// receiver. Every mutation has a durable dispatch record before the call.
export class OpenCodePromotedPlacement {
  #client; #credential; #native; #journal; #promotion; #busy = false; #closed = false;
  constructor({ client, credential, native, journal, promotion }) {
    if (!client?.request || !(client.receiverKeys instanceof Map) || typeof credential !== 'function' ||
        !native?.promotion || !native?.observePlacement || !native?.commitPreparedPlacement || !native?.completePlacement ||
        !journal?.exclusive || !journal?.get || !journal?.put || promotion?.phase !== 'promoted') throw unavailable();
    this.#client = client; this.#credential = credential; this.#native = native; this.#journal = journal; this.#promotion = promotion;
  }
  async #check(grant, action) {
    if (this.#closed || JSON.stringify(this.#native.promotion()) !== JSON.stringify(this.#promotion.receipt)) throw unavailable();
    const key = this.#client.receiverKeys.get(grant.agentId);
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
    const params = { agentId: grant.agentId, channel: grant.channel, credential: await this.#credential() };
    const checked = await this.#client.request('control_worktree_authorize', { ...params, grant, action });
    const hold = await this.#client.request('control_receiver_observe', { ...params, transitionID: grant.id });
    if (this.#closed || this.#client.receiverKeys.get(grant.agentId) !== key || !Stamp.safeParse(checked?.checkedAt).success ||
        checked.checkedAt < grant.preparedAt || JSON.stringify(WorktreeTransition.parse(checked.grant)) !== JSON.stringify(grant) ||
        hold?.status !== 'held' || hold.transitionID !== grant.id || hold.sourceDetached !== true) throw unavailable();
    return digest(key);
  }
  async commit(value) {
    if (this.#closed || this.#busy) throw unavailable();
    const grant = WorktreeTransition.parse(value); this.#busy = true; let dispatched = false;
    try { return await this.#journal.exclusive(async () => {
      const saved = this.#journal.get(grant.id);
      if (grant.status !== 'prepared' || JSON.stringify(this.#promotion.nextGrant) !== JSON.stringify(grant) || saved?.phase !== 'staged' || saved.commit || saved.settlement) throw unavailable();
      const receiverHash = await this.#check(grant, 'place-worktree');
      if (receiverHash !== saved.receiverHash || receiverHash !== saved.destination.receiverHash || await this.#native.observePlacement(saved.destination) !== null) throw unavailable();
      const pending = this.#journal.put({ ...saved, commit: { phase: 'dispatching', leases: [this.#promotion.receipt.nativeLeaseIncarnation] } });
      dispatched = true;
      try {
        const placement = placementReceiptSchema.parse(await this.#native.commitPreparedPlacement(saved.destination));
        await this.#check(grant, 'place-worktree');
        this.#journal.put({ ...pending, commit: { ...pending.commit, phase: 'committed', placement } });
        return placement;
      } catch { try { this.#journal.put({ ...pending, commit: { ...pending.commit, phase: 'uncertain' } }); } catch {} throw uncertain(); }
    }); } catch { throw dispatched ? uncertain() : unavailable(); } finally { this.#busy = false; }
  }
  async settle(value) {
    if (this.#closed || this.#busy || typeof this.#client.settlePlacement !== 'function') throw unavailable();
    const grant = WorktreeTransition.parse(value); this.#busy = true; let dispatched = false;
    try { return await this.#journal.exclusive(async () => {
      const saved = this.#journal.get(grant.id);
      if (grant.status !== 'prepared' || saved?.phase !== 'staged' || saved.commit?.phase !== 'committed' || saved.settlement) throw unavailable();
      await this.#check(grant, 'observe-worktree');
      const placement = await this.#native.observePlacement(saved.destination);
      if (JSON.stringify(placement) !== JSON.stringify(saved.commit.placement)) throw unavailable();
      const settlement = { commandID: randomUUID(), receiptID: placementReceiptID(placement), placement, phase: 'dispatching' };
      const pending = this.#journal.put({ ...saved, settlement }); dispatched = true;
      try {
        const moved = WorktreeTransition.parse(await this.#client.settlePlacement({ commandID: settlement.commandID, receiptID: settlement.receiptID }));
        if (moved.id !== grant.id || moved.status !== 'moved' || moved.receiptID !== settlement.receiptID || moved.actualLocation !== grant.to) throw uncertain();
        await this.#check(moved, 'observe-moved-worktree');
        if (JSON.stringify(await this.#native.observePlacement(saved.destination)) !== JSON.stringify(placement)) throw uncertain();
        this.#journal.put({ ...pending, settlement: { ...settlement, phase: 'settled', moved } }); return moved;
      } catch { try { this.#journal.put({ ...pending, settlement: { ...settlement, phase: 'uncertain' } }); } catch {} throw uncertain(); }
    }); } catch { throw dispatched ? uncertain() : unavailable(); } finally { this.#busy = false; }
  }
  async complete(value) {
    if (this.#closed || this.#busy) throw unavailable();
    const grant = WorktreeTransition.parse(value); this.#busy = true; let dispatched = false;
    try { return await this.#journal.exclusive(async () => {
      const saved = this.#journal.get(grant.id);
      if (grant.status !== 'moved' || saved?.phase !== 'staged' || saved.settlement?.phase !== 'settled' || saved.placementCompletion ||
          JSON.stringify(saved.settlement.moved) !== JSON.stringify(grant)) throw unavailable();
      await this.#check(grant, 'observe-moved-worktree');
      const pending = this.#journal.put({ ...saved, placementCompletion: { phase: 'dispatching' } }); dispatched = true;
      try {
        const proof = completionSchema.parse(await this.#native.completePlacement(saved.destination));
        await this.#check(grant, 'observe-moved-worktree');
        if (JSON.stringify(proof.placement) !== JSON.stringify(saved.settlement.placement)) throw uncertain();
        this.#journal.put({ ...pending, placementCompletion: { phase: 'completed', proof } }); return proof;
      } catch { try { this.#journal.put({ ...pending, placementCompletion: { phase: 'uncertain' } }); } catch {} throw uncertain(); }
    }); } catch { throw dispatched ? uncertain() : unavailable(); } finally { this.#busy = false; }
  }
  close() { this.#closed = true; }
}
