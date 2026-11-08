import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { completionSchema, placementReceiptID } from './opencode-native-recovery.js';
import { samePlacementGrant } from './opencode-placement-settlement.js';
import { digest } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';

const unavailable = () => Object.assign(new Error('OPENCODE_LIVE_PROMOTION_UNAVAILABLE'), { code: 'OPENCODE_LIVE_PROMOTION_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('OPENCODE_LIVE_PROMOTION_UNCERTAIN'), { code: 'OPENCODE_LIVE_PROMOTION_UNCERTAIN' });
const location = z.strictObject({ directory: z.string().min(1), workspaceID: z.string().optional() });
const receipt = z.strictObject({ version: z.literal(1), sessionID: z.string().startsWith('ses_'), transitionID: z.string().uuid(),
  destination: location, completionLeaseIncarnation: z.string().uuid(), nativeLeaseIncarnation: z.string().uuid(), promotionID: z.string().uuid() });
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const witness = z.strictObject({ active: z.literal(true), oldTransitionID: z.string().uuid(), nextTransitionID: z.string().uuid(),
  receiverHash: hash, ownerGeneration: z.string().uuid() });
const recordSchema = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID,
  oldGrant: WorktreeTransition, nextGrant: WorktreeTransition, completion: completionSchema,
  receiverHash: hash, ownerGeneration: z.string().uuid(), promotionID: z.string().uuid(),
  phase: z.enum(['dispatching', 'promoted', 'uncertain']), receipt: receipt.optional() }).superRefine((r, context) => {
  const p = r.completion.placement;
  if (!r.agentId.startsWith('opencode:') || r.oldGrant.agentId !== r.agentId || r.nextGrant.agentId !== r.agentId ||
      r.oldGrant.channel !== r.nextGrant.channel || r.oldGrant.status !== 'moved' || r.oldGrant.purpose ||
      r.nextGrant.status !== 'prepared' || r.nextGrant.purpose || r.nextGrant.id === r.oldGrant.id ||
      r.nextGrant.from !== r.oldGrant.to || r.oldGrant.actualLocation !== r.oldGrant.to ||
      p.sessionID !== r.agentId.slice('opencode:'.length) || p.transitionID !== r.oldGrant.id ||
      p.source.directory !== r.oldGrant.from || p.destination.directory !== r.oldGrant.to ||
      p.receiverHash !== r.receiverHash || placementReceiptID(p) !== r.oldGrant.receiptID ||
      (r.phase === 'promoted') !== !!r.receipt || (r.receipt && (r.receipt.sessionID !== p.sessionID ||
        r.receipt.transitionID !== r.oldGrant.id || JSON.stringify(r.receipt.destination) !== JSON.stringify(p.destination) ||
        r.receipt.completionLeaseIncarnation !== r.completion.leaseIncarnation || r.receipt.promotionID !== r.promotionID)))
    context.addIssue({ code: 'custom', message: 'Invalid promotion record' });
});
const fileSchema = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID, records: z.array(recordSchema).max(256) });

// This append-only dispatch record is separate from historical placement
// journals. An uncertain dispatch never authorizes a second native call.
export class OpenCodeLivePromotionJournal {
  #path; #lock; #host; #agent; #locked = false; #fault = false;
  constructor(hostId, agentId, directory) {
    this.#host = HostID.parse(hostId); this.#agent = AgentID.parse(agentId);
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#path = join(root, `${digest(agentId)}.native-live-promotion.json`);
    this.#lock = join(root, `${digest(agentId)}.native-live-promotion-writer`);
  }
  get hostId() { return this.#host; }
  get agentId() { return this.#agent; }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lock, () => { this.#fault = true; }); this.#locked = true;
    try { return await operation(); } finally { this.#locked = false; unlock(); }
  }
  #records() {
    if (!this.#locked || this.#fault) throw unavailable();
    try {
      const file = fileSchema.parse(JSON.parse(readPrivate(this.#path)));
      if (file.hostId !== this.#host || file.agentId !== this.#agent || file.records.some(record => record.hostId !== this.#host || record.agentId !== this.#agent) ||
          new Set(file.records.map(record => record.promotionID)).size !== file.records.length ||
          file.records.some((record, index) => index > 0 && (file.records[index - 1].phase !== 'promoted' ||
            !samePlacementGrant(file.records[index - 1].nextGrant, record.oldGrant)))) throw unavailable();
      return file.records;
    } catch (error) { if (error.code === 'ENOENT') return []; throw unavailable(); }
  }
  get() { return this.#records().at(-1); }
  put(value) {
    if (!this.#locked || this.#fault) throw unavailable();
    const next = recordSchema.parse(value), records = this.#records(), previous = records.at(-1);
    if (next.hostId !== this.#host || next.agentId !== this.#agent) throw unavailable();
    const append = !previous || (previous.phase === 'promoted' && next.phase === 'dispatching' && samePlacementGrant(previous.nextGrant, next.oldGrant));
    if (append ? next.phase !== 'dispatching' || records.some(record => record.promotionID === next.promotionID) :
      previous.phase !== 'dispatching' || !['promoted', 'uncertain'].includes(next.phase) ||
      JSON.stringify({ ...previous, phase: next.phase, ...(next.receipt ? { receipt: next.receipt } : {}) }) !== JSON.stringify(next)) throw unavailable();
    if (append) records.push(next); else records[records.length - 1] = next;
    if (records.length > 256) throw unavailable();
    atomicWrite(this.#path, JSON.stringify({ version: 1, hostId: this.#host, agentId: this.#agent, records })); return structuredClone(next);
  }
}

// Host-only controller. The caller supplies an authority observation tied to
// both grants and the exact active broker generation. A positive response is
// bracketed by fresh observations; it is not an atomic cross-process lock.
export class OpenCodeAuthorizedLivePromotion {
  #journal; #native; #completion; #authority; #history; #closed = false; #busy = false;
  constructor({ journal, native, completion, authority, history }) {
    if (!journal?.exclusive || !journal?.get || !journal?.put || typeof native?.promoteLive !== 'function' ||
        typeof completion?.observeReleased !== 'function' || typeof authority !== 'function' || (history !== undefined && typeof history !== 'function')) throw unavailable();
    this.#journal = journal; this.#native = native; this.#completion = completion; this.#authority = authority; this.#history = history;
  }
  async promote(oldValue, nextValue, binding) {
    if (this.#closed || this.#busy) throw unavailable();
    const oldGrant = WorktreeTransition.parse(oldValue), nextGrant = WorktreeTransition.parse(nextValue);
    const expected = witness.parse({ active: true, oldTransitionID: oldGrant.id, nextTransitionID: nextGrant.id, ...binding });
    const check = async () => {
      if (this.#closed || JSON.stringify(witness.parse(await this.#authority(oldGrant, nextGrant))) !== JSON.stringify(expected)) throw unavailable();
    };
    this.#busy = true; let dispatched = false, saved;
    try {
      return await this.#journal.exclusive(async () => {
        const previous = this.#journal.get();
        if (previous && (previous.phase !== 'promoted' || !samePlacementGrant(previous.nextGrant, oldGrant))) throw unavailable();
        await check(); const completion = completionSchema.parse(await this.#completion.observeReleased(oldGrant));
        if (this.#history && await this.#history(oldGrant, nextGrant, completion) !== true) throw unavailable();
        await check();
        saved = this.#journal.put({ version: 1, hostId: this.#journal.hostId, agentId: this.#journal.agentId,
          oldGrant, nextGrant, completion, receiverHash: expected.receiverHash, ownerGeneration: expected.ownerGeneration,
          promotionID: randomUUID(), phase: 'dispatching' });
        dispatched = true;
        try {
          const result = receipt.parse(await this.#native.promoteLive(oldGrant.id, saved.promotionID, saved.receiverHash));
          await check();
          if (this.#history && await this.#history(oldGrant, nextGrant, completion) !== true) throw unavailable();
          return this.#journal.put({ ...saved, phase: 'promoted', receipt: result });
        } catch {
          try { this.#journal.put({ ...saved, phase: 'uncertain' }); } catch { /* Preserve the dispatch record. */ }
          throw uncertain();
        }
      });
    } catch { throw dispatched ? uncertain() : unavailable(); }
    finally { this.#busy = false; }
  }
  close() { this.#closed = true; }
}

// Build observations only through the currently bound receiver and its broker
// generation. The new grant is separately authorized on that same socket.
export function openCodePromotionAuthority({ receiver, credential, ownerGeneration }) {
  if (!receiver?.request || !(receiver.receiverKeys instanceof Map) || typeof credential !== 'function' ||
      !z.string().uuid().safeParse(ownerGeneration).success) throw unavailable();
  return async (oldValue, nextValue) => {
    const oldGrant = WorktreeTransition.parse(oldValue), nextGrant = WorktreeTransition.parse(nextValue);
    const key = receiver.receiverKeys.get(oldGrant.agentId);
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw unavailable();
    const params = { agentId: oldGrant.agentId, channel: oldGrant.channel, credential: await credential(), ownerGeneration };
    const current = async () => {
      const value = await receiver.request('control_receiver_owner_status', { ...params, transitionID: oldGrant.id });
      if (value?.active !== true || value.transitionID !== oldGrant.id || value.ownerGeneration !== ownerGeneration ||
          receiver.receiverKeys.get(oldGrant.agentId) !== key) throw unavailable();
    };
    await current();
    const checked = await receiver.request('control_worktree_authorize_next', { ...params, grant: nextGrant });
    if (!Stamp.safeParse(checked?.checkedAt).success || checked.checkedAt < nextGrant.preparedAt ||
        JSON.stringify(WorktreeTransition.parse(checked.grant)) !== JSON.stringify(nextGrant)) throw unavailable();
    await current();
    return { active: true, oldTransitionID: oldGrant.id, nextTransitionID: nextGrant.id, receiverHash: digest(key), ownerGeneration };
  };
}

const drainRecord = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID, oldTransitionID: z.string().uuid(),
  nextGrant: WorktreeTransition, ownerGeneration: z.string().uuid(), receiverHash: hash, promotionID: z.string().uuid(), drainID: z.string().uuid(),
  phase: z.enum(['dispatching', 'draining', 'uncertain', 'detached']) }).superRefine((record, context) => {
  if (!record.agentId.startsWith('opencode:') || record.nextGrant.agentId !== record.agentId || record.nextGrant.status !== 'prepared' ||
      record.nextGrant.purpose || record.oldTransitionID === record.nextGrant.id)
    context.addIssue({ code: 'custom', message: 'Invalid owner drain record' });
});

// The marker is durable before asking the broker to fence. An ambiguous result
// remains uncertain and cannot be silently treated as a live source.
export class OpenCodeOwnerDrainJournal {
  #path; #lock; #host; #agent; #locked = false; #fault = false;
  constructor(hostId, agentId, directory) {
    this.#host = HostID.parse(hostId); this.#agent = AgentID.parse(agentId);
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#path = join(root, `${digest(agentId)}.owner-drain.json`);
    this.#lock = join(root, `${digest(agentId)}.owner-drain-writer`);
  }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lock, () => { this.#fault = true; }); this.#locked = true;
    try { return await operation(); } finally { this.#locked = false; unlock(); }
  }
  get() {
    if (!this.#locked || this.#fault) throw unavailable();
    try { const record = drainRecord.parse(JSON.parse(readPrivate(this.#path)));
      if (record.hostId !== this.#host || record.agentId !== this.#agent) throw unavailable(); return record; }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw unavailable(); }
  }
  put(value) {
    if (!this.#locked || this.#fault) throw unavailable();
    const next = drainRecord.parse(value), previous = this.get();
    if (next.hostId !== this.#host || next.agentId !== this.#agent || (!previous ? next.phase !== 'dispatching' :
      !((previous.phase === 'dispatching' && ['draining', 'uncertain'].includes(next.phase)) ||
        (previous.phase === 'uncertain' && next.phase === 'draining') || (previous.phase === 'draining' && next.phase === 'detached')) ||
      JSON.stringify({ ...previous, phase: next.phase }) !== JSON.stringify(next))) throw unavailable();
    atomicWrite(this.#path, JSON.stringify(next)); return structuredClone(next);
  }
}
