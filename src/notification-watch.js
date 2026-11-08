import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { Channel } from './protocol.js';
import { OperatorNotification } from './control/notification-contracts.js';
import { ControlError, requireControl as check } from './control/policy.js';

const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Page = z.strictObject({ entries: z.array(OperatorNotification).max(100), next: stamp });
export const NotificationWatchLine = z.discriminatedUnion('event', [
  z.strictObject({ version: z.literal(1), event: z.literal('notification'), notification: OperatorNotification.refine(n => n.acknowledgedAt === null) }),
  z.strictObject({ version: z.literal(1), event: z.literal('watching'), channel: Channel, intervalMs: z.number().int().min(1000).max(60000) }),
]);

// Read-only metadata delivery. Emitted is NOT seen/acknowledged, native admission,
// recovery or an OS delivery receipt. Restart can redeliver still-pending IDs.
export class NotificationWatch {
  constructor({ client, channel, emit, signal, batchSize = 30, pagesPerPoll = 4, maxEmitted = 8192 }) {
    Channel.parse(channel);
    check(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 100 &&
      Number.isInteger(pagesPerPoll) && pagesPerPoll >= 1 && pagesPerPoll <= 8 &&
      Number.isInteger(maxEmitted) && maxEmitted >= 1 && maxEmitted <= 100000, 'NOTIFICATION_WATCH_OPTIONS');
    Object.assign(this, { client, channel, emit, signal, batchSize, pagesPerPoll, maxEmitted });
    this.cursor = 0; this.emitted = new Map(); this.stopped = false;
  }
  poll() {
    if (this.stopped) return Promise.reject(Object.assign(new Error('NOTIFICATION_WATCH_STOPPED'), { code: 'NOTIFICATION_WATCH_STOPPED' }));
    if (this.pending) return this.pending;
    this.pending = this.read().catch(error => { this.stopped = true; throw error; }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async read() {
    let emitted = 0;
    for (let pageNumber = 0; pageNumber < this.pagesPerPoll; pageNumber++) {
      this.signal?.throwIfAborted();
      const page = Page.parse(await this.client.request('control_notifications', { channel: this.channel, after: this.cursor, limit: this.batchSize, pendingOnly: true }));
      this.signal?.throwIfAborted();
      const ids = new Set();
      for (const [index, notice] of page.entries.entries()) {
        check(notice.channel === this.channel && notice.acknowledgedAt === null && notice.sequence > (index ? page.entries[index - 1].sequence : this.cursor) &&
          !ids.has(notice.id), 'NOTIFICATION_WATCH_INVALID');
        ids.add(notice.id);
      }
      check(page.entries.length <= this.batchSize && page.next === (page.entries.at(-1)?.sequence ?? this.cursor), 'NOTIFICATION_WATCH_INVALID');
      for (const notice of page.entries) {
        this.signal?.throwIfAborted();
        const fingerprint = JSON.stringify(notice), prior = this.emitted.get(notice.id);
        check(prior === undefined || prior === fingerprint, 'NOTIFICATION_WATCH_INVALID');
        if (prior !== undefined) continue;
        check(this.emitted.size < this.maxEmitted, 'NOTIFICATION_WATCH_LIMIT');
        await this.emit({ version: 1, event: 'notification', notification: notice });
        this.emitted.set(notice.id, fingerprint); emitted++;
      }
      this.cursor = page.next;
      if (page.entries.length < this.batchSize) { this.cursor = 0; break; }
    }
    return { emitted, cursor: this.cursor };
  }
}

export async function watchNotifications({ client, channel, emit, signal, intervalMs = 15000, ...options }) {
  check(Number.isInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 60000, 'NOTIFICATION_WATCH_OPTIONS');
  const watch = new NotificationWatch({ client, channel, emit, signal, ...options });
  try {
    await client.connect(); signal.throwIfAborted(); check(client.admin === true, 'OPERATOR_REQUIRED');
    await watch.poll(); signal.throwIfAborted();
    await emit({ version: 1, event: 'watching', channel, intervalMs });
    while (!signal.aborted) { await delay(intervalMs, undefined, { signal }); await watch.poll(); }
  } catch (error) {
    if (!signal.aborted) throw error;
    if (signal.reason instanceof ControlError) throw signal.reason;
  }
}
