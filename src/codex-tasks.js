import { join, win32 } from 'node:path';
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import { Task } from './control/contracts.js';
import { requireControl as check } from './control/policy.js';
import { digest, identity, stateDir, validateCredential } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { releasedWorktreeTransition } from './worktree-task-binding.js';
import { retryBrokerPreDispatch } from './broker-rate-limit.js';

// Resolve existing Windows paths instead of assuming every volume is case-insensitive.
export function sameNativeWorktree(left, right, { platform = process.platform, canonicalize = realpathSync.native } = {}) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left === right) return true;
  if (platform !== 'win32' || !win32.isAbsolute(left) || !win32.isAbsolute(right)) return false;
  try { return canonicalize(left) === canonicalize(right); } catch { return false; }
}

const key = (id, step) => {
  const hash = digest(`${id}:${step}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const checksum = value => digest(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item));
const binding = task => checksum({ id: task.id, claimant: task.claimant, channel: task.channel, attempt: task.attempt,
  dispatchIntentID: task.dispatchIntentID, claimGeneration: task.claimGeneration, executionScope: task.executionScope, nativeAdmissionID: task.nativeAdmissionID,
  title: task.title, instructions: task.instructions, criteria: task.criteria, requiresWorktree: task.requiresWorktree });
const Record = z.strictObject({ task: Task, phase: z.enum(['prepared', 'invoking', 'admitted', 'reporting', 'notifying', 'notified', 'done', 'blocked']),
  observationGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1).optional(), worktreeTransitionID: z.string().uuid().optional(),
  turnID: z.string().min(1).max(200).optional(), started: z.boolean().optional(),
  progressDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), progressAt: z.number().nonnegative().optional(),
  artifact: z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), finish: z.enum(['completed', 'interrupted', 'failed']) }).optional() })
  .refine(r => r.observationGeneration === undefined || r.observationGeneration === r.task.stopGeneration + 1, 'Invalid admission observation generation')
  .refine(r => r.task.requiresWorktree === !!r.worktreeTransitionID, 'Invalid worktree binding')
  .refine(r => r.phase !== 'prepared' || (!r.turnID && !r.started && !r.artifact), 'Prepared task cannot contain native execution evidence')
  .refine(r => r.phase !== 'admitted' || !!r.turnID, 'Admitted task requires a native turn')
  .refine(r => !['reporting', 'notifying', 'notified'].includes(r.phase) || (!!r.turnID && r.started === true && !!r.artifact), 'Report notice requires native stop/artifact evidence');
const terminal = turn => ['completed', 'interrupted', 'failed'].includes(turn?.status);
const taskMarker = task => `TURNLINK_TASK_BINDING:${task.nativeAdmissionID}`;
const reportMarker = task => `TURNLINK_REPORT_BINDING:${task.nativeAdmissionID}`;
// Only native user-input items bind a turn. Assistant text cannot manufacture admission/stop evidence.
const includesInput = (turn, marker) => Array.isArray(turn?.items) && turn.items.some(item => item.type === 'userMessage' &&
  Array.isArray(item.content) && item.content.some(part => part.type === 'text' && typeof part.text === 'string' && part.text.split('\n').includes(marker)));

class Journal {
  constructor(client, agentID, directory, worktreeTasks) {
    const root = join(directory || process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys'), digest(client.hostId));
    privateDirectory(root); this.file = join(root, `${digest(agentID)}.codex-tasks.json`);
    this.lock = join(root, `${digest(agentID)}.codex-task-writer`); this.agentID = agentID; this.worktreeTasks = worktreeTasks;
  }
  async exclusive(callback) {
    let fault = false; const unlock = acquireStore(this.lock, () => { fault = true; });
    try {
      let records = [];
      try {
        const saved = z.strictObject({ version: z.literal(1), agentID: z.string(), records: z.array(Record).max(256) }).parse(JSON.parse(readPrivate(this.file)));
        check(saved.agentID === this.agentID, 'TASK_JOURNAL_IDENTITY_MISMATCH'); records = saved.records;
        check(new Set(records.map(r => r.task.dispatchIntentID)).size === records.length && records.every(r =>
          r.task.claimant === this.agentID && (!r.task.requiresWorktree || this.worktreeTasks) && r.task.executionScope && r.task.dispatchIntentID &&
          r.task.nativeAdmissionID === `msg_turnlink_task_${digest(r.task.dispatchIntentID)}`), 'TASK_JOURNAL_INVALID');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const save = record => {
        check(!fault, 'TASK_JOURNAL_UNAVAILABLE'); Record.parse(record);
        const next = records.filter(r => r.task.dispatchIntentID !== record.task.dispatchIntentID).concat(record);
        check(next.length <= 256, 'TASK_JOURNAL_FULL');
        atomicWrite(this.file, JSON.stringify({ version: 1, agentID: this.agentID, records: next })); records = next; return record;
      };
      return await callback(records, save);
    } finally { unlock(); }
  }
}

// Native ports belong to the proxy, not model/broker arguments. No native mutation is replayed after uncertainty.
export function makeCodexTasks({ client, threads, enabled, tokenFile, native, log, credentialDirectory, worktreeTasks = false }) {
  let closed = false; const watchAbort = new AbortController();
  const wake = state => { state.taskWakeToken = {}; state.taskPending = true; };
  const credential = () => validateCredential(readPrivate(tokenFile, 128).trim());
  const watch = async threadID => {
    const state = threads.get(threadID);
    if (closed || !enabled || !state?.channel || !tokenFile || state.taskWatchBusy) return;
    state.taskWatchBusy = true; state.taskWatchNeeded = true;
    const generation = state.generation, channel = state.channel;
    try {
      await retryBrokerPreDispatch(() => client.request('control_task_watch', { agentId: identity('codex', threadID), credential: credential() }), {
        signal: watchAbort.signal, check: () => {
          if (closed || threads.get(threadID) !== state || state.generation !== generation || state.channel !== channel) throw new Error('Task watch changed');
        },
      });
      if (!closed && threads.get(threadID) === state) { state.taskWatchNeeded = false; wake(state); }
    } catch (error) { state.taskWatchNeeded = error?.code === 'BROKER_RATE_LIMITED_BEFORE_DISPATCH'; if (!closed) log(error); }
    finally { state.taskWatchBusy = false; }
  };
  const poll = async threadID => {
    const state = threads.get(threadID), agentId = identity('codex', threadID);
    if (closed || !enabled || !tokenFile || !state?.channel || !state.taskPending || state.taskBusy || state.flushing || state.controlPolling ||
        !client.activeSubscriptions?.has(agentId) || typeof client.requestGuarded !== 'function' || native.held()) return;
    state.taskBusy = true;
    const generation = state.generation, socket = client.socket, receiverGeneration = client.subscriptionGenerations?.get(agentId);
    const valid = () => !closed && threads.get(threadID) === state && state.generation === generation && !!state.channel &&
      client.socket === socket && client.subscriptionGenerations?.get(agentId) === receiverGeneration && !!client.activeSubscriptions?.has(agentId);
    const guard = () => check(valid(), 'STALE_TASK_CLAIM');
    const request = (method, params) => client.requestGuarded(method, params, guard);
    const command = (task, step, body) => {
      check(valid(), 'STALE_TASK_CLAIM');
      return request('control_adapter', { agentId, credential: credential(), command: { id: key(task.dispatchIntentID, step), channel: task.channel,
        ...(task.stopGeneration > 0 && ['task.admission', 'task.started', 'task.progress'].includes(body.op) ? { stopGeneration: task.stopGeneration } : {}),
        ...(body.op.startsWith('task.') ? { taskID: task.id, attempt: task.attempt } : {}), ...body } });
    };
    const current = async taskID => {
      for (let offset = 0; offset < 100000;) {
        const page = await request('control_query', { agentId, channel: state.channel, view: 'tasks', offset, limit: 100 });
        const value = page.entries.find(t => t.id === taskID); if (value) return value;
        if (!page.entries.length || page.next <= offset) return; offset = page.next;
      }
    };
    const snapshot = async () => {
      const result = await native.read(threadID);
      check(valid() && result?.thread?.id === threadID && Array.isArray(result.thread.turns), 'TRANSITION_IDENTITY_MISMATCH');
      const selection = result.selection;
      check(selection && typeof selection.cwd === 'string' && typeof selection.model === 'string' &&
        typeof selection.modelProvider === 'string' && selection.sandbox !== undefined && selection.approvalPolicy !== undefined &&
        result.configuration !== undefined, 'NATIVE_SNAPSHOT_REQUIRED');
      check(sameNativeWorktree(result.thread.cwd, selection.cwd), 'CONFIGURATION_CHANGED');
      return { ...result, cwd: selection.cwd, digest: checksum({ selection, configuration: result.configuration }) };
    };
    try {
      await client.connect();
      const journal = new Journal(client, agentId, credentialDirectory, worktreeTasks);
      await journal.exclusive(async (records, save) => {
        let record = records.find(r => !['done', 'blocked'].includes(r.phase));
        if (!record) {
          if (!native.idle(threadID)) return;
          const observed = await snapshot();
          if (!native.idle(threadID) || native.revision() !== observed.revision) return;
          const wakeToken = state.taskWakeToken;
          const pulled = await request('control_task_pull', { agentId, credential: credential(), channel: state.channel,
            cwd: observed.cwd, scopeDigest: observed.digest });
          if (!pulled.task) { state.taskPending = state.taskWakeToken !== wakeToken; return; }
          const task = Task.parse(pulled.task);
          check(task.claimant === agentId && (!task.requiresWorktree || worktreeTasks === true) && task.dispatchIntentID && task.nativeAdmissionID && task.executionScope, 'TASK_SCOPE_REQUIRED');
          if (records.some(r => r.task.dispatchIntentID === task.dispatchIntentID)) { state.taskPending = false; return; }
          if (!pulled.prepared || task.status !== 'dispatching' || task.admission !== 'none') {
            await command(task, 'missing-journal', { op: 'task.uncertain' }); state.taskPending = false;
            check(false, 'TASK_RECOVERY_REQUIRED');
          }
          const worktreeTransitionID = task.requiresWorktree ? await releasedWorktreeTransition({ client, agentId, channel: state.channel, credential: credential(), task }) : undefined;
          record = save({ task, phase: 'prepared', ...(worktreeTransitionID ? { worktreeTransitionID } : {}) });
        }
        const original = record.task, latest = await current(original.id);
        if (latest?.terminalHold) { state.taskPending = false; return; }
        if (latest && (latest.stopGeneration ?? 0) !== (record.observationGeneration ?? original.stopGeneration)) {
          const ownAdmission = record.observationGeneration === undefined && record.phase === 'invoking' && !record.started && !record.artifact && !record.turnID &&
            !record.progressDigest && record.progressAt === undefined &&
            latest.status === 'uncertain' && latest.admission === 'uncertain' && !latest.stoppedEvidence &&
            latest.receiptID === key(original.dispatchIntentID, 'uncertain-admission-evidence') &&
            latest.stopGeneration === original.stopGeneration + 1 && latest.stopGeneration < Number.MAX_SAFE_INTEGER && binding(latest) === binding(original);
          if (!ownAdmission) { state.taskPending = false; return; }
          // Capture before snapshot(), never retag a cached turn/artifact.
          record = save({ ...record, observationGeneration: latest.stopGeneration });
        }
        const task = { ...original, stopGeneration: record.observationGeneration ?? original.stopGeneration };
        if (!latest || latest.dispatchIntentID !== task.dispatchIntentID || latest.claimant !== agentId || latest.attempt !== task.attempt ||
          ['completed', 'cancelled', 'open'].includes(latest.status) || (latest.status === 'review' && latest.stoppedEvidence)) {
          save({ ...record, phase: 'done' }); return;
        }
        check(binding(latest) === binding(task), 'TASK_JOURNAL_INVALID');
        if (task.requiresWorktree) check(worktreeTasks === true && record.worktreeTransitionID === await releasedWorktreeTransition({ client, agentId, channel: state.channel, credential: credential(), task }), 'TASK_RECEIVER_REQUIRED');
        let observed;
        try { observed = await snapshot(); }
        catch (error) {
          if (error.code === 'NATIVE_SNAPSHOT_CHANGED') return; // Native start/completion raced an observational read; collect a fresh snapshot.
          if (valid()) {
            await command(task, 'snapshot-uncertain', { op: 'task.uncertain' });
            save({ ...record, phase: 'blocked' }); state.taskPending = false;
          }
          throw error;
        }
        if (observed.cwd !== task.executionScope.cwd || observed.digest !== task.executionScope.digest) {
          await command(task, 'scope-uncertain', { op: 'task.uncertain' }); save({ ...record, phase: 'blocked' }); state.taskPending = false; return;
        }
        if (record.phase === 'prepared') {
          const existing = observed.thread.turns.filter(turn => includesInput(turn, taskMarker(task)));
          check(existing.length <= 1, 'TASK_RECEIPT_MISMATCH');
          if (existing.length) record = save({ ...record, phase: 'admitted', turnID: existing[0].id });
        }
        if (record.phase === 'prepared') {
          if (!valid() || !native.idle(threadID) || native.revision() !== observed.revision) return;
          const text = `Turnlink task execution in your existing thread and cwd. Preserve all existing global/project instructions, model, tools, sandbox and approval policy. Do not change location.\n` +
            `${taskMarker(task)}\nTask ${task.id}, attempt ${task.attempt}.\n${task.title}\nInstructions:\n${task.instructions}\nAcceptance criteria:\n${task.criteria}\n` +
            'Perform the work and state the actual result. The adapter supplies artifact/stop evidence and a separate report notice; do not self-complete or poll for evidence.';
          // Persist invocation before RPC. JSON-RPC request IDs are NOT native idempotency keys.
          record = save({ ...record, phase: 'invoking' });
          try {
            const response = await native.start(threadID, text, observed.revision);
            check(typeof response?.turn?.id === 'string', 'TASK_RECEIPT_MISMATCH');
            record = save({ ...record, phase: 'admitted', turnID: response.turn.id });
          } catch (error) {
            await command(task, 'uncertain-admission', { op: 'task.admission', outcome: 'uncertain', admissionID: task.nativeAdmissionID,
              receiptID: key(task.dispatchIntentID, 'uncertain-admission-evidence') }); throw error;
          }
          return; // Observe exact native turn input/completion on a later pass, never infer it from RPC success.
        }
        if (['invoking', 'admitted'].includes(record.phase)) {
          const matches = observed.thread.turns.filter(turn => includesInput(turn, taskMarker(task)));
          check(matches.length <= 1, 'TASK_RECEIPT_MISMATCH');
          const turn = matches[0];
          if (!turn) { state.taskPending = false; return; }
          check(!record.turnID || turn.id === record.turnID, 'TASK_RECEIPT_MISMATCH');
          record = save({ ...record, phase: 'admitted', turnID: turn.id });
          await command(task, 'admitted', { op: 'task.admission', outcome: 'admitted', admissionID: task.nativeAdmissionID,
            receiptID: key(task.dispatchIntentID, 'admission-evidence') });
          if (!record.started) {
            await command(task, 'started', { op: 'task.started', evidenceID: key(task.dispatchIntentID, 'start-evidence') });
            record = save({ ...record, started: true });
          }
          const progressDigest = checksum(turn);
          if (progressDigest !== record.progressDigest && Date.now() - (record.progressAt || 0) >= 30000) {
            await command(task, `progress:${progressDigest}`, { op: 'task.progress' });
            record = save({ ...record, progressDigest, progressAt: Date.now() });
          }
          if (!terminal(turn) || !native.idle(threadID)) return;
          if (!record.artifact) record = save({ ...record, artifact: { digest: checksum(turn), finish: turn.status } });
          await command(task, 'artifact', { op: 'evidence.record', entityID: task.id, kind: 'artifact', attempt: task.attempt, artifact: {
            type: 'native_turn', harness: 'codex', sessionID: threadID, turnID: record.turnID, admissionID: task.nativeAdmissionID,
            digest: record.artifact.digest, finish: record.artifact.finish } });
          await command(task, 'stopped', { op: 'task.stopped', evidenceID: key(task.dispatchIntentID, 'stop-evidence'),
            ...(task.stopGeneration > 0 ? { stopGeneration: task.stopGeneration } : {}) });
          const settled = await current(task.id);
          if (!settled || settled.terminalHold || !settled.stoppedEvidence || (settled.stopGeneration ?? 0) !== task.stopGeneration) { state.taskPending = false; return; }
          record = save({ ...record, phase: record.artifact.finish === 'interrupted' ? 'blocked' : 'reporting' });
          if (record.phase === 'blocked') { state.taskPending = false; return; } // A human stop must not immediately wake another native turn.
        }
        if (record.phase === 'reporting') {
          const settled = await current(task.id);
          // Snapshot reads and deferred retries can outlive the stop receipt.
          if (!settled || settled.terminalHold || settled.status !== 'uncertain' || binding(settled) !== binding(task) ||
            settled.stoppedEvidence !== key(task.dispatchIntentID, 'stop-evidence') || (settled.stopGeneration ?? 0) !== task.stopGeneration) {
            state.taskPending = false; return;
          }
          if (!valid() || !native.idle(threadID) || native.revision() !== observed.revision) return;
          const text = `Turnlink task result report. Native execution stopped. Artifact references are not correctness certification. Report the actual result, including failures, with channel_control task.report and these evidence IDs. Final acceptance belongs to the current master.\n` +
            `${reportMarker(task)}\nTASK_RESULT_DATA\n${JSON.stringify({ taskID: task.id, evidence: [key(task.dispatchIntentID, 'artifact')], finish: record.artifact.finish })}`;
          record = save({ ...record, phase: 'notifying' });
          try { await native.start(threadID, text, observed.revision); }
          catch (error) { state.taskPending = false; throw error; }
          save({ ...record, phase: 'notified' });
        }
        if (['notifying', 'notified', 'reporting'].includes(record.phase)) state.taskPending = false;
        // Lost report admission response is never replayed. A native notification or participant report can settle it.
      });
    } catch (error) { if (!closed) log(error); }
    finally { state.taskBusy = false; }
  };
  return { watch, poll, notify: threadID => { const s = threads.get(threadID); if (s) wake(s); }, close: () => { closed = true; watchAbort.abort(); } };
}
