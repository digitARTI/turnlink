import { requireControl as check, ControlError } from './control/policy.js';

// Deliberately small read allowlist. Unknown/new native methods are mutations until audited.
const readOnly = new Set(['thread/read', 'thread/list', 'thread/turns/list', 'config/read', 'configRequirements/read', 'model/list']);
export const isCodexNativeRead = method => readOnly.has(method);
const isRead = frame => !!frame?.method && isCodexNativeRead(frame.method);
const ownerMutations = new Set(['turn/start', 'turn/steer', 'turn/interrupt']);
const publicationGuards = new WeakMap();

// Only an active fence can create this guard; a caller-provided function is
// not evidence that reads are actually held and prior reads have drained.
export function requireCodexPublicationBarrier(guard, threadID, fence) {
  const scope = typeof guard === 'function' ? publicationGuards.get(guard) : undefined;
  check(scope && (threadID === undefined || scope.threadID === threadID) &&
    (fence === undefined || scope.fence === fence), 'NATIVE_PUBLICATION_FENCED');
  guard();
}

// Single stdio-process exclusion, not a broker authorization grant or a native server-wide lock.
// Owner objects never cross JSON/RPC boundaries; editor/model input cannot manufacture one.
export class CodexAdmissionFence {
  constructor({ write, reply, activity, onRelease = () => {}, onFatal = () => {},
    publicationAvailable = () => true, queueLimit = 128, byteLimit = 256 * 1024, timeoutMs = 30000 }) {
    check([queueLimit, byteLimit, timeoutMs].every(v => Number.isSafeInteger(v) && v > 0), 'INVALID_NATIVE_FENCE_LIMIT');
    check([write, reply, activity, onRelease, onFatal, publicationAvailable].every(v => typeof v === 'function'), 'INVALID_NATIVE_FENCE_CONFIGURATION');
    Object.assign(this, { write, reply, activity, onRelease, onFatal, publicationAvailable, queueLimit, byteLimit, timeoutMs });
    this.queue = []; this.bytes = 0; this.pending = new Map(); this.serverRequests = new Set(); this.revision = 0;
    this.nativeTurns = new Map(); this.unknownNativeActivity = false;
    this.owner = null; this.tokens = new WeakMap(); this.closed = false;
  }
  get held() { return this.owner !== null; }
  get quarantined() { return !!this.owner?.invalid; }
  assertCurrentPublication(threadID) {
    const owner = this.owner;
    check(!this.closed && owner && owner.threadID === threadID && !owner.invalid && owner.publication && owner.publicationReady &&
      this.publicationAvailable() === true && !this.pending.size && !this.serverRequests.size, 'NATIVE_PUBLICATION_FENCED');
  }
  invalidate(code = 'NATIVE_FENCE_UNCERTAIN') {
    if (!this.owner) return;
    this.owner.invalid = code; this.owner.controller.abort(new ControlError(code)); this.revision++;
  }
  observeUnknownOutput() {
    this.unknownNativeActivity = true; this.revision++;
    this.invalidate('NATIVE_FENCE_UNCERTAIN');
  }
  send(line, frame, owner, internal = false) {
    // Responses cannot be reliably matched when client requests overlap on an
    // ID. Preserve transparency, but never infer idle from the ambiguous pair.
    if (frame?.method && frame.id !== undefined && this.pending.has(frame.id)) {
      this.unknownNativeActivity = true;
      this.invalidate('NATIVE_FENCE_UNCERTAIN');
    }
    if (frame?.method && !isRead(frame)) {
      this.revision++;
      if (owner) {
        owner.mutationSent = true;
        if (frame.method === 'turn/start') { owner.expectedStarts++; owner.starts.set(frame.id, {}); }
      }
    }
    if (frame?.method && frame.id !== undefined) this.pending.set(frame.id, { method: frame.method, owner });
    this.write(line, frame, internal);
  }
  editor(line) {
    check(!this.closed, 'NATIVE_FENCE_CLOSED');
    let frame; try { frame = JSON.parse(line); } catch { /* opaque input is held, never classified as a read */ }
    if (frame && !frame.method && frame.id !== undefined && this.serverRequests.has(frame.id)) {
      this.serverRequests.delete(frame.id); this.send(line, frame); return;
    }
    // Exclusion must never prevent the human from stopping native work.
    if (this.held && frame?.method === 'turn/interrupt') {
      // Any thread shares this process-wide admission boundary. Forward the
      // interrupt immediately, but its response is not proof of quiescence.
      this.invalidate('NATIVE_FENCE_INTERRUPTED');
      this.queue = this.queue.filter(item => {
        const cancelled = ['turn/start', 'turn/steer'].includes(item.frame?.method) && item.frame.params?.threadId === frame.params?.threadId;
        if (cancelled) {
          this.bytes -= item.bytes;
          if (item.frame.id !== undefined) this.reply({ id: item.frame.id, error: { code: -32098, message: 'Held native admission cancelled by human interruption' } });
        }
        return !cancelled;
      });
      this.send(line, frame); return;
    }
    if (!this.held || (isRead(frame) && !this.owner.publication)) { this.send(line, frame); return; }
    const bytes = Buffer.byteLength(line);
    if (this.queue.length >= this.queueLimit || this.bytes + bytes > this.byteLimit) {
      if (frame?.method && frame.id !== undefined) this.reply({ id: frame.id, error: { code: -32099, message: 'Turnlink native admission fence queue is full' } });
      else { this.invalidate(); this.onFatal(new ControlError('NATIVE_FENCE_QUEUE_FULL')); }
      return;
    }
    this.queue.push({ line, frame, bytes }); this.bytes += bytes;
  }
  internal(frame, token) {
    check(!this.closed, 'NATIVE_FENCE_CLOSED');
    check(typeof frame?.method === 'string' && frame.id !== undefined, 'INVALID_NATIVE_FENCE_REQUEST');
    check(isRead(frame) || !this.unknownNativeActivity, 'NATIVE_FENCE_UNCERTAIN');
    const owner = token ? this.tokens.get(token) : undefined;
    if (token) check(owner === this.owner && !owner.invalid, 'NATIVE_FENCE_UNCERTAIN');
    check(!this.held || isRead(frame) || owner === this.owner, 'NATIVE_ADMISSION_FENCED');
    check(!this.owner?.publication, 'NATIVE_PUBLICATION_FENCED');
    if (owner && !isRead(frame)) check(ownerMutations.has(frame.method) && frame.params?.threadId === owner.threadID, 'NATIVE_FENCE_SCOPE_MISMATCH');
    if (owner && frame.method === 'turn/start') check(!owner.starts.size && !owner.activeTurns.size && !owner.earlyStarts.size, 'NATIVE_IDLE_REQUIRED');
    if (owner && ['turn/steer', 'turn/interrupt'].includes(frame.method))
      check(owner.activeTurns.has(frame.method === 'turn/steer' ? frame.params?.expectedTurnId : frame.params?.turnId), 'NATIVE_FENCE_SCOPE_MISMATCH');
    this.send(JSON.stringify(frame), frame, owner, true);
  }
  observe(frame) {
    if (frame?.method && frame.id !== undefined) {
      this.serverRequests.add(frame.id);
      if (this.owner?.publication) this.invalidate('NATIVE_PUBLICATION_UNCERTAIN');
    }
    if (!frame?.method && frame?.id !== undefined) {
      const pending = this.pending.get(frame.id);
      if (pending?.owner && pending.owner === this.owner && pending.method === 'turn/start') {
        const owner = this.owner;
        if (frame.error) {
          owner.expectedStarts--; owner.starts.delete(frame.id);
          if (owner.earlyStarts.size) this.invalidate();
        } else if (typeof frame.result?.turn?.id !== 'string') this.invalidate();
        else {
          const id = frame.result.turn.id, start = owner.starts.get(frame.id); start.turnID = id;
          if (owner.earlyStarts.delete(id)) {
            owner.expectedStarts--; if (!owner.earlyCompleted.delete(id)) owner.activeTurns.add(id); owner.starts.delete(frame.id);
          }
          if (owner.earlyStarts.size && ![...owner.starts.values()].some(s => !s.turnID)) this.invalidate();
        }
      }
      this.pending.delete(frame.id);
      if (!this.pending.size && this.owner?.publicationWaiter) this.owner.publicationWaiter();
    }
    if (frame?.method === 'turn/started') {
      this.revision++;
      if (typeof frame.params?.threadId !== 'string' || typeof frame.params?.turn?.id !== 'string') this.unknownNativeActivity = true;
      else {
        if (!this.nativeTurns.has(frame.params.threadId)) this.nativeTurns.set(frame.params.threadId, new Set());
        this.nativeTurns.get(frame.params.threadId).add(frame.params.turn.id);
      }
      if (this.owner) {
        const id = frame.params?.turn?.id, owner = this.owner;
        if (frame.params?.threadId !== owner.threadID || typeof id !== 'string') this.invalidate();
        else {
          const match = [...owner.starts].find(([, start]) => start.turnID === id);
          if (match) { owner.expectedStarts--; owner.starts.delete(match[0]); owner.activeTurns.add(id); }
          else if ([...owner.starts.values()].some(start => !start.turnID)) owner.earlyStarts.add(id);
          else this.invalidate();
        }
      }
    }
    if (['turn/completed', 'thread/closed', 'thread/archived'].includes(frame?.method)) {
      this.revision++;
      if (frame.method === 'turn/completed') {
        const turns = this.nativeTurns.get(frame.params?.threadId); turns?.delete(frame.params?.turn?.id);
        if (turns && !turns.size) this.nativeTurns.delete(frame.params.threadId);
      } // Closing/archiving a thread is not execution-stop evidence; retain observed active turns until completion.
      if (this.owner && frame.method === 'turn/completed' && frame.params?.threadId === this.owner.threadID) {
        const id = frame.params?.turn?.id;
        if (!this.owner.activeTurns.delete(id) && this.owner.earlyStarts.has(id)) this.owner.earlyCompleted.add(id);
      }
      if (this.owner && ['thread/closed', 'thread/archived'].includes(frame.method) && frame.params?.threadId === this.owner.threadID) this.invalidate();
    }
  }
  guard(token) {
    const owner = this.tokens.get(token);
    check(owner && owner === this.owner && !owner.invalid && !this.closed, 'NATIVE_FENCE_UNCERTAIN');
  }
  release(owner) {
    clearTimeout(owner.timer); this.owner = null; this.tokens.delete(owner.token);
    const queued = this.queue; this.queue = []; this.bytes = 0;
    // Re-enter the ordinary forwarding path; it records requests only when they are actually sent.
    for (const item of queued) this.send(item.line, item.frame);
    this.onRelease();
  }
  async exclusive(threadID, operation) {
    check(!this.closed && !this.held, 'NATIVE_ADMISSION_FENCED');
    const snapshot = this.activity(threadID);
    check(snapshot?.known === true && snapshot.idle === true && snapshot.blocked === false && snapshot.flushing === false &&
      !this.nativeTurns.size && !this.unknownNativeActivity && !this.serverRequests.size &&
      ![...this.pending.values()].some(p => !readOnly.has(p.method)), 'NATIVE_IDLE_REQUIRED');
    const token = Object.freeze({}), owner = { token, threadID, controller: new AbortController(), mutationSent: false, expectedStarts: 0,
      externalPending: false, publication: false, publicationReady: false, publicationWaiter: null, activeTurns: new Set(), starts: new Map(), earlyStarts: new Set(), earlyCompleted: new Set() };
    this.tokens.set(token, owner); this.owner = owner;
    const publicationGuard = () => {
      this.guard(token);
      check(this.publicationAvailable() === true && owner.publication && owner.publicationReady && !this.pending.size && !this.serverRequests.size, 'NATIVE_PUBLICATION_FENCED');
    };
    publicationGuards.set(publicationGuard, { threadID, fence: this });
    const armTimer = timeout => {
      clearTimeout(owner.timer);
      owner.timer = setTimeout(() => this.invalidate('NATIVE_FENCE_EXPIRED'), timeout); owner.timer.unref();
    };
    armTimer(this.timeoutMs);
    let checkingRelease = false;
    try {
      const result = await operation({ token, signal: owner.controller.signal, guard: () => this.guard(token), publicationGuard,
        beginPublication: async () => {
          this.guard(token); check(this.publicationAvailable() === true && !owner.publication && !this.serverRequests.size, 'NATIVE_PUBLICATION_FENCED');
          owner.publication = true; owner.publicationReady = false; this.revision++;
          if (this.pending.size) await new Promise((resolve, reject) => {
            const aborted = () => { owner.publicationWaiter = null; reject(new ControlError('NATIVE_FENCE_UNCERTAIN')); };
            owner.publicationWaiter = () => { owner.publicationWaiter = null; owner.controller.signal.removeEventListener('abort', aborted); resolve(); };
            owner.controller.signal.addEventListener('abort', aborted, { once: true });
          });
          this.guard(token); check(this.publicationAvailable() === true && !this.pending.size && !this.serverRequests.size, 'NATIVE_PUBLICATION_FENCED');
          owner.publicationReady = true;
        },
        endPublication: () => {
          publicationGuard();
          owner.publication = false; owner.publicationReady = false; this.revision++;
          const remaining = [];
          for (const item of this.queue) {
            if (isRead(item.frame) && !owner.invalid) { this.bytes -= item.bytes; this.send(item.line, item.frame); }
            else remaining.push(item);
          }
          this.queue = remaining; this.guard(token);
        },
        markExternalPending: () => { this.guard(token); check(!owner.externalPending, 'NATIVE_FENCE_UNCERTAIN'); owner.externalPending = true; },
        reserveExternalRecovery: timeout => {
          this.guard(token);
          check(owner.externalPending && Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 601000, 'NATIVE_FENCE_UNCERTAIN');
          armTimer(timeout);
        },
        markExternalReleased: () => { this.guard(token); check(owner.externalPending, 'NATIVE_FENCE_UNCERTAIN'); owner.externalPending = false; } });
      checkingRelease = true;
      this.guard(token);
      check(!owner.externalPending && !owner.publication && ![...this.pending.values()].some(p => p.owner === owner || !readOnly.has(p.method)) && !owner.expectedStarts && !owner.activeTurns.size &&
        !owner.earlyStarts.size && !this.serverRequests.size, 'NATIVE_FENCE_UNCERTAIN');
      const after = this.activity(threadID);
      check(after?.known === true && after.idle === true && after.blocked === false && after.flushing === false &&
        !this.nativeTurns.size && !this.unknownNativeActivity, 'NATIVE_FENCE_UNCERTAIN');
      this.release(owner); return result;
    } catch (error) {
      // Once a native mutation was sent, callback failure/timeout is not proof that it stopped.
      // Failed release checks are themselves uncertainty, even if this owner
      // did not send a mutation. A failed callback also needs a fresh idle
      // observation before competing editor work can be forwarded.
      let idle = false;
      if (!checkingRelease && !owner.invalid) {
        try {
          const current = this.activity(threadID);
          idle = current?.known === true && current.idle === true && current.blocked === false && current.flushing === false &&
            !this.nativeTurns.size && !this.unknownNativeActivity && !this.serverRequests.size &&
            ![...this.pending.values()].some(p => !readOnly.has(p.method));
        } catch { /* unavailable activity is not idle evidence */ }
      }
      if (checkingRelease || !idle || owner.invalid || owner.externalPending || owner.publication || owner.mutationSent || [...this.pending.values()].some(p => p.owner === owner && !readOnly.has(p.method))) {
        if (this.owner === owner) this.invalidate();
        clearTimeout(owner.timer);
      } else if (this.owner === owner) this.release(owner);
      throw error;
    }
  }
  close() {
    this.closed = true;
    if (this.owner) { this.invalidate(); clearTimeout(this.owner.timer); }
    this.queue = []; this.bytes = 0;
  }
}
