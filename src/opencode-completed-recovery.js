import { digest } from './config.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { completionSchema, intentSchema, placementReceiptID } from './opencode-native-recovery.js';

const unavailable = () => Object.assign(new Error('NATIVE_COMPLETION_RECOVERY_UNAVAILABLE'), { code: 'NATIVE_COMPLETION_RECOVERY_UNAVAILABLE' });
const identity = ['id', 'agentId', 'channel', 'taskID', 'previewID', 'claimGeneration', 'from', 'to', 'configurationDigest', 'authorityDigest', 'pluginProvenanceDigest', 'nativeAuthorityObservationDigest', 'preparedAt'];

// Observation only. A completed native quarantine has no recovery claim to
// acquire; the prior durable stage and exact broker receiver still fence reads.
export class OpenCodeCompletedRecovery {
  #client; #credential; #native; #live; #destination; #agent; #plugin; #channel; #closed = false; #busy = false; #disconnect; #removed; #nativeOff; #closeListeners = new Set(); #diagnostic;
  constructor({ client, credential, recovery, liveJournal, destinationJournal, sessionID, channel, pluginID = 'turnlink', onDiagnostic }) {
    if (!client?.request || !client?.on || !client?.off || !(client.receiverKeys instanceof Map) || typeof credential !== 'function' ||
      !recovery?.observeCompletion || !recovery?.close || !recovery?.onClose || !liveJournal?.exclusive || !liveJournal?.get ||
      liveJournal.agentId !== `opencode:${sessionID}` || !channel || !pluginID) throw unavailable();
    this.#client = client; this.#credential = credential; this.#native = recovery; this.#live = liveJournal; this.#destination = destinationJournal; this.#diagnostic = onDiagnostic;
    this.#agent = `opencode:${sessionID}`; this.#plugin = pluginID; this.#channel = channel;
    this.#disconnect = () => this.close(); this.#removed = event => { if (event.agentId === this.#agent) this.close(); };
    client.on('disconnected', this.#disconnect); client.on('membership_removed', this.#removed);
    try {
      this.#nativeOff = recovery.onClose(() => this.close());
      if (typeof this.#nativeOff !== 'function' || this.#closed) throw unavailable();
    } catch {
      if (typeof this.#nativeOff === 'function') this.#nativeOff();
      this.#nativeOff = undefined; this.close(); throw unavailable();
    }
  }
  async observeReleased(value) { return this.observe(value, { released: true }); }
  async observe(value, { released = false } = {}) {
    if (this.#closed || this.#busy) throw unavailable();
    this.#busy = true;
    try {
      return await this.#live.exclusive(async () => {
        const grant = WorktreeTransition.parse(value), live = this.#live.get(grant.id);
        if (released && (grant.status !== 'moved' || typeof this.#client.status !== 'function')) throw unavailable();
        if (grant.agentId !== this.#agent || grant.channel !== this.#channel || grant.purpose ||
          !['prepared', 'uncertain', 'moved'].includes(grant.status) || !live || live.pluginID !== this.#plugin ||
          !identity.every(field => live.grant[field] === grant[field]) || this.#client.hostId !== this.#live.hostId) throw unavailable();
        const intent = live.intent === undefined ? undefined : intentSchema.parse(live.intent);
        if (intent && (intent.sessionID !== this.#agent.slice('opencode:'.length) || intent.pluginID !== this.#plugin ||
          intent.transitionID !== grant.id || intent.source.directory !== grant.from || intent.directory !== grant.to)) throw unavailable();
        const observe = async stage => {
          const receiverKey = this.#client.receiverKeys.get(this.#agent);
          if (!/^[a-f0-9]{64}$/.test(receiverKey || '') || digest(receiverKey) !== stage.receiverHash) throw unavailable();
          const check = async () => {
            if (released) {
              const status = await this.#client.status();
              if (this.#closed || this.#client.hostId !== this.#live.hostId || this.#client.receiverKeys.get(this.#agent) !== receiverKey ||
                  !['prepared', 'released'].includes(status.state) || status.hostId !== this.#live.hostId || status.receiverHash !== digest(receiverKey) ||
                  status.sourceDetached !== true || status.receiptID !== grant.receiptID) throw unavailable();
              return;
            }
            const credential = await this.#credential();
            const checked = await this.#client.request('control_worktree_authorize', { agentId: this.#agent, channel: this.#channel,
              credential, grant, action: grant.status === 'moved' ? 'observe-moved-worktree' : 'observe-worktree' });
            const hold = await this.#client.request('control_receiver_observe', { agentId: this.#agent, channel: this.#channel,
              credential, transitionID: grant.id });
            if (this.#closed || this.#client.hostId !== this.#live.hostId || this.#client.receiverKeys.get(this.#agent) !== receiverKey ||
              !Stamp.safeParse(checked.checkedAt).success || checked.checkedAt < grant.preparedAt ||
              JSON.stringify(WorktreeTransition.parse(checked.grant)) !== JSON.stringify(grant) ||
              hold.status !== 'held' || hold.sourceDetached !== true || hold.transitionID !== grant.id) throw unavailable();
          };
          this.#diagnostic?.('completion-before-check'); await check();
          this.#diagnostic?.('completion-native-observe'); const completed = await this.#native.observeCompletion(stage);
          this.#diagnostic?.('completion-after-check'); await check(); this.#diagnostic?.('completion-after-check-done');
          this.#diagnostic?.(completed ? 'completion-present' : 'completion-absent');
          if (completed && grant.status === 'moved' && grant.receiptID !== placementReceiptID(completed.placement)) { this.#diagnostic?.('completion-receipt-mismatch'); throw unavailable(); }
          return completed;
        };
        if (live.phase === 'staged') {
          if (!intent) throw unavailable();
          return await observe(live.destination);
        }
        const journal = this.#destination;
        if (!journal?.exclusive || !journal?.get || journal.agentId !== this.#agent || journal.hostId !== this.#live.hostId) throw unavailable();
        return await journal.exclusive(async () => {
          const stage = journal.get(grant.id);
          if (!stage || stage.phase !== 'staged' || stage.pluginID !== this.#plugin ||
            !identity.every(field => stage.grant[field] === grant[field]) ||
            stage.claim.sessionID !== this.#agent.slice('opencode:'.length) || stage.claim.transitionID !== grant.id ||
            stage.claim.previousLeaseIncarnation === stage.claim.leaseIncarnation ||
            (intent && stage.claim.previousLeaseIncarnation !== intent.leaseIncarnation)) throw unavailable();
          return await observe(stage.destination);
        });
      });
    } catch { this.close(); throw unavailable(); }
    finally { this.#busy = false; }
  }
  onClose(listener) {
    if (typeof listener !== 'function') throw unavailable();
    if (this.#closed) { listener(); return () => {}; }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners) { try { listener(); } catch { /* Closing must continue. */ } }
    this.#closeListeners.clear(); this.#nativeOff?.();
    this.#client.off('disconnected', this.#disconnect); this.#client.off('membership_removed', this.#removed); this.#native.close();
  }
}

// Construct only inside the trusted broker host. No request-supplied receipt
// can replace the native observation or the plugin-owned receiver binding.
export function makeOpenCodeCompletionVerifier({ recovery, client, historical = false }) {
  if (!recovery?.observe || !(client?.receiverKeys instanceof Map)) throw unavailable();
  if (historical && typeof recovery.observeReleased !== 'function') throw unavailable();
  return async ({ grant: value, hostId, receiverHash, signal }) => {
    const grant = WorktreeTransition.parse(value);
    const current = () => !signal?.aborted && client.hostId === hostId &&
      digest(client.receiverKeys.get(grant.agentId) || '') === receiverHash;
    if (!current() || !grant.agentId.startsWith('opencode:') || grant.status !== 'moved' || grant.purpose) throw unavailable();
    const result = completionSchema.parse(await (historical ? recovery.observeReleased(grant) : recovery.observe(grant)));
    if (!current() || result.placement.sessionID !== grant.agentId.slice('opencode:'.length) ||
      result.placement.transitionID !== grant.id || result.placement.source.directory !== grant.from ||
      result.placement.destination.directory !== grant.to || result.placement.receiverHash !== receiverHash ||
      placementReceiptID(result.placement) !== grant.receiptID) throw unavailable();
    return result;
  };
}
