import { join } from 'node:path';
import { z } from 'zod';
import { Task } from '../src/control/contracts.js';
import { requireControl as check } from '../src/control/policy.js';
import { digest, identity, stateDir } from '../src/config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from '../src/storage.js';

const keyID = (id, step) => {
  const value = digest(`${id}:${step}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
};
const taskBinding = task => digest(JSON.stringify({ id: task.id, channel: task.channel, claimant: task.claimant, title: task.title,
  instructions: task.instructions, criteria: task.criteria, dispatchIntentID: task.dispatchIntentID, attempt: task.attempt,
  executionScope: task.executionScope, nativeAdmissionID: task.nativeAdmissionID, requiresWorktree: task.requiresWorktree }));
const Record = z.strictObject({ task: Task, phase: z.enum(['admitting', 'admitted', 'reporting', 'done', 'blocked']),
  promptID: z.string(), reportID: z.string(), started: z.boolean().optional(), progressDigest: z.string().optional(), progressAt: z.number().optional(),
  throughMessageID: z.string().optional(), outputDigest: z.string().optional(), finish: z.string().optional() });

class TaskJournal {
  constructor(hostId, agentId, directory) {
    const root = join(directory || process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys'), digest(hostId));
    privateDirectory(root); this.file = join(root, `${digest(agentId)}.tasks.json`); this.lock = join(root, `${digest(agentId)}.task-writer`);
    this.agentId = agentId; this.records = [];
  }
  async exclusive(callback) {
    let fault = false; const unlock = acquireStore(this.lock, () => { fault = true; });
    try {
      try {
        const saved = z.strictObject({ version: z.literal(1), agentId: z.string(), records: z.array(Record).max(256) }).parse(JSON.parse(readPrivate(this.file)));
        check(saved.agentId === this.agentId, 'TASK_JOURNAL_IDENTITY_MISMATCH'); this.records = saved.records;
        check(new Set(this.records.map(r => r.task.dispatchIntentID)).size === this.records.length, 'TASK_JOURNAL_INVALID');
        check(this.records.every(r => r.task.claimant === this.agentId && r.task.executionScope && r.task.dispatchIntentID && !r.task.requiresWorktree &&
          r.promptID === r.task.nativeAdmissionID && r.promptID === `msg_turnlink_task_${digest(r.task.dispatchIntentID)}` &&
          r.reportID === `msg_turnlink_result_${digest(r.task.dispatchIntentID)}`), 'TASK_JOURNAL_INVALID');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.save = record => {
        check(!fault, 'TASK_JOURNAL_UNAVAILABLE'); Record.parse(record);
        const records = this.records.filter(r => r.task.dispatchIntentID !== record.task.dispatchIntentID); records.push(record);
        check(records.length <= 256, 'TASK_JOURNAL_FULL');
        atomicWrite(this.file, JSON.stringify({ version: 1, agentId: this.agentId, records })); this.records = records; return record;
      };
      return await callback();
    } finally { this.save = undefined; unlock(); }
  }
}

export function makeOpenCodeTasks({ ctx, channel, sessions, options, signal, ownSession, refreshBlockers, credential, log }) {
  const watch = async sessionID => {
    const state = sessions.get(sessionID);
    if (signal.aborted || options.tasks !== true || !state?.tools.agentId) return;
    try {
      await channel.request('control_task_watch', { agentId: state.tools.agentId, credential: credential() });
      state.taskPending = true;
    } catch (error) { if (!signal.aborted) log(error); }
  };
  const poll = async sessionID => {
    const state = sessions.get(sessionID);
    if (signal.aborted || options.tasks !== true || !state?.tools.agentId || !state.controlChannel || !state.taskPending || state.taskBusy || state.flushing || state.controlPolling) return;
    state.taskBusy = true;
    const generation = state.generation, agentId = identity('opencode', sessionID);
    const valid = () => !signal.aborted && state.generation === generation && state.tools.agentId === agentId;
    const scope = async () => {
      const session = await ownSession(sessionID);
      check(valid(), 'STALE_TASK_CLAIM');
      check(typeof session.agent === 'string' && typeof ctx.agent?.get === 'function' && typeof ctx.tool?.list === 'function', 'NATIVE_SNAPSHOT_REQUIRED');
      const agentResult = await ctx.agent.get({ agentID: session.agent }, { signal });
      const agent = agentResult.data ?? agentResult;
      check(agent.id === session.agent, 'TRANSITION_IDENTITY_MISMATCH');
      let model = session.model ?? agent.model;
      if (!model) { const result = await ctx.model.default(undefined, { signal }); model = result.data; }
      check(model && typeof model.providerID === 'string' && typeof model.id === 'string', 'NATIVE_MODEL_REQUIRED');
      const toolResult = await ctx.tool.list(), catalogue = Array.isArray(toolResult) ? toolResult : toolResult.data;
      check(Array.isArray(catalogue), 'NATIVE_SNAPSHOT_REQUIRED');
      const tools = catalogue.map(t => ({ id: t.id, description: t.description, input: t.input }));
      return { cwd: session.location.directory, digest: digest(JSON.stringify({ agent, model, permissions: session.permissions, tools })) };
    };
    const idle = async () => {
      if (!await refreshBlockers(sessionID, state, valid)) return false;
      try { await ctx.session.wait({ sessionID }, { signal: AbortSignal.any([signal, AbortSignal.timeout(300)]) }); }
      catch { return false; }
      return valid() && !state.blocked.size;
    };
    const command = async (task, step, body) => {
      check(valid(), 'STALE_TASK_CLAIM');
      return channel.request('control_adapter', { agentId, credential: credential(), command: {
        id: keyID(task.dispatchIntentID, step), channel: task.channel,
        ...(body.op.startsWith('task.') ? { taskID: task.id, attempt: task.attempt } : {}), ...body,
      } });
    };
    const taskState = async id => {
      let offset = 0;
      for (let i = 0; i < 4096; i++) {
        const page = await channel.request('control_query', { agentId, channel: state.controlChannel, view: 'tasks', offset, limit: 100 });
        const task = page.entries.find(t => t.id === id); if (task) return task;
        if (page.next <= offset || !page.entries.length) return; offset = page.next;
      }
    };
    try {
      await channel.connect();
      state.taskJournal ??= new TaskJournal(channel.hostId, agentId, options.credentialDirectory);
      await state.taskJournal.exclusive(async () => {
        let record = state.taskJournal.records.find(r => !['done', 'blocked'].includes(r.phase));
        if (!record) {
          if (!await idle()) return;
          const location = await scope();
          const pulled = await channel.request('control_task_pull', { agentId, credential: credential(), channel: state.controlChannel, cwd: location.cwd, scopeDigest: location.digest });
          if (!pulled.task) { state.taskPending = false; return; }
          const task = Task.parse(pulled.task);
          check(!task.requiresWorktree && task.claimant === agentId && task.executionScope && task.dispatchIntentID && task.nativeAdmissionID, 'TASK_SCOPE_REQUIRED');
          const prior = state.taskJournal.records.find(r => r.task.dispatchIntentID === task.dispatchIntentID);
          if (prior) { state.taskPending = false; return; }
          check(task.status === 'dispatching' && task.admission === 'none', 'TASK_RECOVERY_REQUIRED');
          record = state.taskJournal.save({ task, phase: 'admitting', promptID: task.nativeAdmissionID,
            reportID: `msg_turnlink_result_${digest(task.dispatchIntentID)}` });
        }
        const task = record.task, latest = await taskState(task.id);
        if (!latest || latest.claimant !== agentId || latest.attempt !== task.attempt || latest.dispatchIntentID !== task.dispatchIntentID ||
          ['completed', 'cancelled', 'open'].includes(latest.status) || (latest.status === 'review' && latest.stoppedEvidence)) {
          state.taskJournal.save({ ...record, phase: 'done' }); return;
        }
        check(taskBinding(latest) === taskBinding(task), 'TASK_JOURNAL_INVALID');
        const location = await scope();
        if (location.cwd !== task.executionScope.cwd || location.digest !== task.executionScope.digest) {
          await command(task, 'scope-uncertain', { op: 'task.uncertain' });
          state.taskJournal.save({ ...record, phase: 'blocked' }); state.taskPending = false; return;
        }
        if (record.phase === 'admitting') {
          const text = `Turnlink task execution. This is claimed work in your existing conversation and cwd; it does not replace global/project instructions, your agent/model, tools or permissions. Do not change the session location.\n` +
            `Task ${task.id}, attempt ${task.attempt}.\n${task.title}\nInstructions:\n${task.instructions}\nAcceptance criteria:\n${task.criteria}\n` +
            'Perform the work and state the result. Do not claim task completion or poll for evidence: the adapter will supply a result-report notice after native execution has stopped.';
          let receipt;
          try {
            check(valid(), 'STALE_TASK_CLAIM');
            receipt = await ctx.session.prompt({ sessionID, id: record.promptID, text, delivery: 'queue', resume: true,
              metadata: { source: 'turnlink-task', taskID: task.id, attempt: task.attempt, dispatchIntentID: task.dispatchIntentID } }, { signal });
          } catch (error) {
            await command(task, 'uncertain-admission', { op: 'task.admission', outcome: 'uncertain', admissionID: record.promptID,
              receiptID: keyID(task.dispatchIntentID, 'uncertain-admission-evidence') });
            throw error;
          }
          check(receipt.id === record.promptID && receipt.sessionID === sessionID, 'TASK_RECEIPT_MISMATCH');
          record = state.taskJournal.save({ ...record, phase: 'admitted' });
        }
        if (record.phase === 'admitted') {
          await command(task, 'admitted', { op: 'task.admission', outcome: 'admitted', admissionID: record.promptID, receiptID: keyID(task.dispatchIntentID, 'admission-evidence') });
          if (!record.outputDigest) {
            const context = await ctx.session.context({ sessionID }, { signal });
            const index = context.findIndex(m => m.type === 'user' && m.id === record.promptID);
            if (index < 0) return;
            check(context[index].metadata?.taskID === task.id && context[index].metadata?.dispatchIntentID === task.dispatchIntentID, 'TASK_RECEIPT_MISMATCH');
            const nextInput = context.findIndex((m, i) => i > index && m.type === 'user');
            const segment = context.slice(index + 1, nextInput < 0 ? undefined : nextInput).filter(m => m.type === 'assistant');
            if (!segment.length) return;
            if (!record.started) {
              await command(task, 'started', { op: 'task.started', evidenceID: keyID(task.dispatchIntentID, 'start-evidence') });
              record = state.taskJournal.save({ ...record, started: true });
            }
            const observed = digest(JSON.stringify(segment));
            if (observed !== record.progressDigest && Date.now() - (record.progressAt || 0) >= 30000) {
              await command(task, `progress:${observed}`, { op: 'task.progress' });
              record = state.taskJournal.save({ ...record, progressDigest: observed, progressAt: Date.now() });
            }
            if (!await idle()) return;
            const output = segment.filter(m => m.time?.completed !== undefined), last = output.at(-1);
            if (!last || last.finish === 'tool-calls') return;
            record = state.taskJournal.save({ ...record, throughMessageID: last.id, outputDigest: digest(JSON.stringify(output)), finish: last.finish || 'unknown' });
          } else if (!await idle()) return;
          await command(task, 'artifact', { op: 'evidence.record', attempt: task.attempt, entityID: task.id, kind: 'artifact', artifact: {
            type: 'native_session_segment', harness: 'opencode', sessionID, fromMessageID: record.promptID, throughMessageID: record.throughMessageID,
            digest: record.outputDigest, finish: record.finish,
          } });
          await command(task, 'stopped', { op: 'task.stopped', evidenceID: keyID(task.dispatchIntentID, 'stop-evidence') });
          if ((await taskState(task.id))?.status === 'review') { state.taskJournal.save({ ...record, phase: 'done' }); return; }
          record = state.taskJournal.save({ ...record, phase: 'reporting' });
        }
        if (record.phase === 'reporting') {
          const text = 'Turnlink task result report. Native execution is stopped; the following evidence is adapter-recorded, not proof of correctness. ' +
            'Recall the work and report the actual result (including failures) using channel_control task.report with this taskID and evidence array. Do not review/complete the task yourself unless you are the current master. No polling is needed.\nTASK_RESULT_DATA\n' +
            JSON.stringify({ taskID: task.id, evidence: [keyID(task.dispatchIntentID, 'artifact')], finish: record.finish });
          check(valid(), 'STALE_TASK_CLAIM');
          const receipt = await ctx.session.prompt({ sessionID, id: record.reportID, text, delivery: 'queue', resume: true,
            metadata: { source: 'turnlink-task-result', taskID: task.id, attempt: task.attempt } }, { signal });
          check(receipt.id === record.reportID && receipt.sessionID === sessionID, 'TASK_RECEIPT_MISMATCH');
        }
      });
    } catch (error) { if (!signal.aborted) log(error); }
    finally { state.taskBusy = false; }
  };
  return { watch, poll };
}
