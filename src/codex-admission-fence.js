import { requireControl as check, ControlError } from './control/policy.js';

// Deliberately small read allowlist. Unknown/new native methods are mutations until audited.
const readOnly = new Set(['thread/read', 'thread/list', 'config/read', 'configRequirements/read', 'model/list']);
const isRead = frame => !!frame?.method && readOnly.has(frame.method);
const ownerMutations = new Set(['turn/start', 'turn/steer', 'turn/interrupt']);

// Single stdio-process exclusion, not a broker authorization grant or a native server-wide lock.
// Owner objects never cross JSON/RPC boundaries; editor/model input cannot manufacture one.
export class CodexAdmissionFence {
  constructor({ write, reply, activity, onRelease = () => {}, onFatal = () => {},
    queueLimit = 128, byteLimit = 256 * 1024, timeoutMs = 30000 }) {
    check([queueLimit, byteLimit, timeoutMs].every(v => Number.isSafeInteger(v) && v > 0), 'INVALID_NATIVE_FENCE_LIMIT');
    check([write, reply, activity, onRelease, onFatal].every(v => typeof v === 'function'), 'INVALID_NATIVE_FENCE_CONFIGURATION');
    Object.assign(this, { write, reply, activity, onRelease, onFatal, queueLimit, byteLimit, timeoutMs });
    this.queue = []; this.bytes = 0; this.pending = new Map(); this.serverRequests = new Set(); this.revision = 0;
    this.nativeTurns = new Map(); this.unknownNativeActivity = false;
    this.owner = null; this.tokens = new WeakMap(); this.closed = false;
  }
  get held() { return this.owner !== null; }
  get quarantined() { return !!this.owner?.invalid; }
  invalidate(code = 'NATIVE_FENCE_UNCERTAIN') {
    if (!this.owner) return;
    this.owner.invalid = code; this.owner.controller.abort(new ControlError(code)); this.revision++;
  }
  send(line, frame, owner, internal = false) {
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
      if (frame.params?.threadId === this.owner.threadID) this.invalidate('NATIVE_FENCE_INTERRUPTED');
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
    if (!this.held || isRead(frame)) { this.send(line, frame); return; }
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
    const owner = token ? this.tokens.get(token) : undefined;
    if (token) check(owner === this.owner && !owner.invalid, 'NATIVE_FENCE_UNCERTAIN');
    check(!this.held || isRead(frame) || owner === this.owner, 'NATIVE_ADMISSION_FENCED');
    if (owner && !isRead(frame)) check(ownerMutations.has(frame.method) && frame.params?.threadId === owner.threadID, 'NATIVE_FENCE_SCOPE_MISMATCH');
    if (owner && frame.method === 'turn/start') check(!owner.starts.size && !owner.activeTurns.size && !owner.earlyStarts.size, 'NATIVE_IDLE_REQUIRED');
    if (owner && ['turn/steer', 'turn/interrupt'].includes(frame.method))
      check(owner.activeTurns.has(frame.method === 'turn/steer' ? frame.params?.expectedTurnId : frame.params?.turnId), 'NATIVE_FENCE_SCOPE_MISMATCH');
    this.send(JSON.stringify(frame), frame, owner, true);
  }
  observe(frame) {
    if (frame?.method && frame.id !== undefined) this.serverRequests.add(frame.id);
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
      activeTurns: new Set(), starts: new Map(), earlyStarts: new Set(), earlyCompleted: new Set() };
    this.tokens.set(token, owner); this.owner = owner;
    owner.timer = setTimeout(() => this.invalidate('NATIVE_FENCE_EXPIRED'), this.timeoutMs); owner.timer.unref();
    try {
      const result = await operation({ token, signal: owner.controller.signal, guard: () => this.guard(token) });
      this.guard(token);
      check(![...this.pending.values()].some(p => p.owner === owner) && !owner.expectedStarts && !owner.activeTurns.size &&
        !owner.earlyStarts.size && !this.serverRequests.size, 'NATIVE_FENCE_UNCERTAIN');
      const after = this.activity(threadID);
      check(after?.known === true && after.idle === true && after.blocked === false && !this.nativeTurns.size && !this.unknownNativeActivity, 'NATIVE_FENCE_UNCERTAIN');
      this.release(owner); return result;
    } catch (error) {
      // Once a native mutation was sent, callback failure/timeout is not proof that it stopped.
      if (owner.mutationSent || [...this.pending.values()].some(p => p.owner === owner && !readOnly.has(p.method))) {
        this.invalidate(); clearTimeout(owner.timer);
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
