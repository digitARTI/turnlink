import { digest, receiverHandoffKey, validateCredential } from './config.js';
import { Stamp, UUID, WorktreeTransition } from './control/contracts.js';

const unavailable = () => Object.assign(new Error('CODEX_DESTINATION_RECEIVER_UNAVAILABLE'), { code: 'CODEX_DESTINATION_RECEIVER_UNAVAILABLE' });

// Owns only the held receiver on the caller's dedicated ChannelClient. It
// neither publishes a native destination nor releases queued work.
export class CodexDestinationReceiver {
  #client; #credential; #grant; #directory; #closed = false; #busy = false; #offered = false; #epoch = 0; #disconnect; #removed;
  constructor({ client, credential, grant, credentialDirectory }) {
    if (!client?.request || !client?.on || !client?.off || !(client.receiverKeys instanceof Map) ||
        !(client.subscriptions instanceof Set) || typeof client.offerReceiverHandoff !== 'function' ||
        typeof client.resumeReceiverHandoff !== 'function' || typeof client.unsubscribe !== 'function' || typeof client.close !== 'function' || typeof credential !== 'function') throw unavailable();
    this.#grant = WorktreeTransition.parse(grant);
    if (!this.#grant.agentId.startsWith('codex:') || this.#grant.purpose || !this.#grant.destinationOwners ||
        this.#grant.sourceMcpShutdown !== true || this.#grant.sourceModelShutdown !== true ||
        !['prepared', 'uncertain'].includes(this.#grant.status)) throw unavailable();
    this.#client = client; this.#credential = credential; this.#directory = credentialDirectory;
    this.#disconnect = () => { this.#epoch++; };
    this.#removed = event => { if (event.agentId === this.#grant.agentId) this.#epoch++; };
    client.on('disconnected', this.#disconnect); client.on('membership_removed', this.#removed);
  }
  async offer() {
    if (this.#closed || this.#busy || this.#offered || this.#grant.status !== 'prepared') throw unavailable();
    this.#busy = true;
    try {
      const secret = validateCredential(await this.#credential());
      if (this.#closed) throw unavailable();
      this.#offered = true;
      const result = await this.#client.offerReceiverHandoff(this.#grant.agentId, secret, this.#grant);
      if (this.#closed || !UUID.safeParse(result?.offerID).success) throw unavailable();
      return { offerID: result.offerID };
    } finally { this.#busy = false; }
  }
  async resume() {
    if (this.#closed || this.#busy) throw unavailable();
    this.#busy = true;
    let owned = false;
    try {
      if (!this.#client.subscriptions.has(this.#grant.agentId))
        await this.#client.resumeReceiverHandoff(this.#grant.agentId, this.#grant.id);
      owned = true;
      return await this.#observe();
    } catch (error) {
      if (owned) {
        try { await this.#client.unsubscribe(this.#grant.agentId); }
        catch { this.#client.socket?.terminate(); }
      }
      throw error;
    } finally { this.#busy = false; }
  }
  async observe() {
    if (this.#closed || this.#busy) throw unavailable();
    this.#busy = true;
    try { return await this.#observe(); } finally { this.#busy = false; }
  }
  async #observe() {
    const client = this.#client, grant = this.#grant, epoch = this.#epoch, hostId = client.hostId,
      socket = client.socket, generation = client.subscriptionGenerations?.get(grant.agentId);
    if (!hostId || (!client.subscriptions.has(grant.agentId) || !client.activeSubscriptions?.has(grant.agentId))) throw unavailable();
    const key = receiverHandoffKey(hostId, grant.agentId, grant.id, this.#directory);
    const current = () => {
      if (this.#closed || this.#epoch !== epoch || client.hostId !== hostId || client.socket !== socket ||
          client.subscriptionGenerations?.get(grant.agentId) !== generation ||
          (!client.subscriptions.has(grant.agentId) || !client.activeSubscriptions?.has(grant.agentId)) || client.receiverKeys.get(grant.agentId) !== key) throw unavailable();
    };
    current(); const secret = validateCredential(await this.#credential()); current();
    const check = async () => {
      for (const action of ['observe-source-mcp-shutdown', 'observe-source-model-shutdown']) {
        const result = await client.request('control_worktree_authorize', { agentId: grant.agentId, channel: grant.channel, credential: secret, grant, action });
        current();
        if (!Stamp.safeParse(result?.checkedAt).success || result.checkedAt < grant.preparedAt ||
            JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw unavailable();
      }
      const hold = await client.request('control_receiver_observe', { agentId: grant.agentId, channel: grant.channel, credential: secret, transitionID: grant.id });
      current();
      if (hold?.status !== 'held' || hold.transitionID !== grant.id || typeof hold.sourceDetached !== 'boolean') throw unavailable();
      return hold;
    };
    const hold = await check(), after = await check();
    if (JSON.stringify(hold) !== JSON.stringify(after)) throw unavailable();
    return { status: 'held', transitionID: grant.id, receiverHash: digest(key), sourceDetached: hold.sourceDetached };
  }
  close() {
    if (this.#closed) return;
    this.#closed = true; this.#client.off('disconnected', this.#disconnect); this.#client.off('membership_removed', this.#removed); this.#client.close();
  }
}
