import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { digest, identity, stateDir } from './config.js';
import { z } from 'zod';
import { Command } from './control/contracts.js';
import { PARTICIPANT_OPERATIONS } from './control/operations.js';
import { sessionRecord, completeSessionRecord, parseSessionJSON, sessionEvidenceStatus, isSessionRecordMessage } from './session-evidence.js';
import { diagnosticCode } from './diagnostics.js';
import { atomicWrite, privateDirectory } from './storage.js';
import { MAX_TEXT_BYTES } from './protocol.js';

const str = { type: 'string', minLength: 1 };
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const tools = [
  { name: 'channel_join', description: 'Join with your role and project. Use the session ID supplied by the harness onboarding context.', inputSchema: schema({
    harness: { type: 'string', enum: ['codex', 'claude', 'opencode'] }, sessionId: str, channel: str, name: str, role: str,
    project: schema({ name: str, root: str }),
  }) },
  { name: 'channel_members', description: 'List channel members, roles, projects and receiver connectivity.', inputSchema: schema({ channel: str }) },
  { name: 'channel_send', description: 'Send a task or reply to an agentId, or * to broadcast. Incoming messages wake idle agents with an installed adapter.', inputSchema: schema({ to: str, text: str, messageId: str }, ['to', 'text']) },
  { name: 'channel_history', description: 'Read channel history and delivery state, newest first. For older pages, increase offset by the number of messages actually returned; an empty page ends history.', inputSchema: schema({ channel: str, limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 10000 } }, ['channel']) },
  { name: 'channel_ack', description: 'Confirm an incoming message was seen by the model. Required for Claude channel delivery confirmation.', inputSchema: schema({ id: str }) },
  { name: 'channel_leave', description: 'Leave the channel.', inputSchema: schema({}) },
];
const ParticipantCommand = z.discriminatedUnion('op', Command.options.filter(schema => PARTICIPANT_OPERATIONS.includes(schema.shape.op.value)));
export const controlTools = [
  { name: 'channel_control', description: 'Opt-in Turnlink governance and task coordination. Identity is harness-bound. Only participant operations are offered; query channel status for supported broker effects and native task execution capabilities.',
    inputSchema: schema({ command: z.toJSONSchema(ParticipantCommand) }) },
  { name: 'channel_status', description: 'Read authenticated channel state, tasks, incidents or audit events. Message bodies require the current master generation; ordinary history visibility is unchanged.',
    inputSchema: schema({ channel: str, view: { type: 'string', enum: ['channel', 'tasks', 'actions', 'incidents', 'events', 'messages', 'notices', 'previews', 'transitions', 'evidence', 'health'] },
      generation: { type: 'integer', minimum: 0 }, after: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0, maximum: 100000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['channel', 'view']) },
  { name: 'channel_prepare_session', description: 'Ask the claimed task agent to prepare a private session record before an approved manual move. This request does not authorize or execute the move.',
    inputSchema: schema({ taskID: { type: 'string', format: 'uuid' }, previewID: { type: 'string', format: 'uuid' }, messageId: str }, ['taskID', 'previewID', 'messageId']) },
  { name: 'channel_request_session_takeover', description: 'Ask the resumed agent to forward its existing sanitized record to the current coordinator for operator-reviewed recovery. This does not authorize task execution.',
    inputSchema: schema({ taskID: { type: 'string', format: 'uuid' }, previewID: { type: 'string', format: 'uuid' }, messageId: str }, ['taskID', 'previewID', 'messageId']) },
  { name: 'channel_manual_preview', description: 'Create an operator-reviewable preview for a claimed task whose existing session will be stopped and resumed manually. It does not verify configuration or execute a move.',
    inputSchema: schema({ taskID: { type: 'string', format: 'uuid' }, destination: str }) },
  { name: 'channel_verify_session', description: 'Ask the claimed task agent to compare its private session record after a manual move. The reply is an agent report and does not release the worktree task.',
    inputSchema: schema({ taskID: { type: 'string', format: 'uuid' }, previewID: { type: 'string', format: 'uuid' }, messageId: str }, ['taskID', 'previewID', 'messageId']) },
  { name: 'channel_session_status', description: 'Read the claimant’s structured comparison report for the approved worktree preview. This is agent-reported information, not authorization to release a task.',
    inputSchema: schema({ taskID: { type: 'string', format: 'uuid' }, previewID: { type: 'string', format: 'uuid' } }) },
];
export class ToolSession {
  constructor(client, { harness, sessionId, onJoin, restoreWatchesOnJoin = false } = {}) {
    Object.assign(this, { client, harness, sessionId, onJoin, restoreWatchesOnJoin });
  }
  startSessionRecovery() {
    if (typeof this.client.on !== 'function') return;
    if (!this.sessionRecoveryListener) {
      this.sessionRecoveryListener = () => {
        if (this.sessionRecoveryPending) { this.sessionRecoveryAgain = true; return; }
        this.sessionRecoveryPending = true;
        void this.restoreSessionWatches().then(() => { this.sessionRecoveryFailed = false; }, () => { this.sessionRecoveryFailed = true; })
          .finally(() => {
            this.sessionRecoveryPending = false;
            if (this.sessionRecoveryAgain && this.sessionRecoveryListener) { this.sessionRecoveryAgain = false; this.sessionRecoveryListener(); }
          });
      };
      this.client.on('connected', this.sessionRecoveryListener);
    }
    this.sessionRecoveryListener();
  }
  stopSessionRecovery() {
    if (this.sessionRecoveryListener) this.client.off('connected', this.sessionRecoveryListener);
    this.sessionRecoveryListener = undefined; this.sessionRecoveryAgain = false;
  }
  async findChannelMember(owner, channel, target) {
    let firstPage;
    for (let offset = 0; offset <= 10000;) {
      const page = await this.client.request('members', { agentId: owner, channel, offset, limit: 100 });
      if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed');
      if (!Array.isArray(page)) throw new Error('Channel members unavailable');
      firstPage ??= page;
      const member = page.find(value => value.agentId === target);
      if (member || !page.length) return { member, firstPage };
      offset += page.length;
    }
    throw new Error('Channel members query budget exhausted');
  }
  async requireSessionCoordinator(owner, channel) {
    const state = await this.client.request('control_query', { agentId: owner, channel, view: 'channel' });
    if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed');
    if (state.channel?.active?.agentId !== owner || !Number.isSafeInteger(state.channel.active.generation)) throw new Error('Active master required');
    return state.channel.active;
  }
  async savePreparedRecord(record, text, recipient, messageId) {
    const owner = this.agentId, channel = this.channel;
    const guard = () => { if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed'); };
    const query = (view, entityID) => this.client.request('control_query', { agentId: owner, channel, view, entityID, limit: 1 });
    const [tasks, previews] = await Promise.all([query('tasks', record.taskID), query('previews', record.previewID)]);
    guard();
    const task = tasks.entries?.length === 1 ? tasks.entries[0] : null, preview = previews.entries?.length === 1 ? previews.entries[0] : null;
    if (!task || !preview || task.id !== record.taskID || task.channel !== channel || task.claimant !== owner || task.status !== 'claimed' ||
        task.requiresWorktree !== true || preview.id !== record.previewID || preview.taskID !== task.id || preview.agentId !== owner ||
        preview.channel !== channel || preview.claimGeneration !== task.claimGeneration || preview.approved !== true || preview.purpose ||
        preview.from !== record.source || preview.to !== record.destination) throw new Error('Approved session record required');
    const { member } = await this.findChannelMember(owner, channel, owner); guard();
    // The destination may forward an unchanged record for coordinator takeover.
    // It must not overwrite the private source copy in its own profile.
    if (member?.project?.root === preview.to) return false;
    if (member?.project?.root !== preview.from || preview.sessionCoordinator !== recipient) throw new Error('Session record source or coordinator changed');
    let latest;
    for (let offset = 0, pageCount = 0; pageCount < 4096; pageCount++) {
      const page = await this.client.request('control_query', { agentId: owner, channel, view: 'previews', offset, limit: 100 });
      guard();
      if (!Array.isArray(page.entries) || page.entries.length > 100 || !Number.isSafeInteger(page.next) || page.next !== offset + page.entries.length)
        throw new Error('Worktree previews unavailable');
      for (const value of page.entries) if (value.taskID === task.id && value.agentId === owner) latest = value;
      if (!page.entries.length) break;
      if (pageCount === 4095) throw new Error('Worktree preview query budget exhausted');
      offset = page.next;
    }
    if (latest?.id !== preview.id || latest.approved !== true) throw new Error('Approved session record required');
    // A rejected retry must not replace the private copy of an earlier message.
    // History is checked before writing, while the per-preview queue serializes
    // this session's concurrent sends. The broker remains the final authority.
    let newerRecord = false;
    history: for (let offset = 0; offset <= 10000;) {
      const page = await this.client.request('history', { agentId: owner, channel, offset, limit: 100 });
      guard();
      if (!Array.isArray(page) || page.length > 100) throw new Error('Session history unavailable');
      for (const message of page) {
        if (message.from?.agentId !== owner) continue;
        if (message.messageId === messageId) {
          if (message.text !== text || message.to !== recipient || message.channel !== channel)
            throw new Error('Idempotency key reused with different payload');
          // An older accepted message cannot replace a newer source copy.
          if (newerRecord) return false;
          // The latest exact message was already committed; rewrite its private
          // copy if necessary before confirming a retry after a lost reply.
          break history;
        }
        const candidate = sessionRecord.safeParse(parseSessionJSON(message.text));
        if (candidate.success && candidate.data.session === owner && candidate.data.taskID === record.taskID && candidate.data.previewID === record.previewID)
          newerRecord = true;
      }
      if (!page.length) break;
      offset += page.length;
      if (offset > 10000) throw new Error('Session history query budget exhausted');
    }
    const base = this.client.options?.credentialDirectory || process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys');
    const records = join(base, 'manual-session-records'), directory = join(records, digest(owner));
    privateDirectory(base); privateDirectory(records); privateDirectory(directory);
    guard(); atomicWrite(join(directory, `${record.taskID}-${record.previewID}.json`), text);
    return true;
  }
  async approvedSessionTask(input, owner, channel) {
    const guard = () => { if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed'); };
    const query = (view, entityID) => this.client.request('control_query', { agentId: owner, channel, view, entityID, limit: 1 });
    const [tasks, previews] = await Promise.all([query('tasks', input.taskID), query('previews', input.previewID)]);
    guard();
    const task = tasks.entries?.length === 1 ? tasks.entries[0] : null;
    const preview = previews.entries?.length === 1 ? previews.entries[0] : null;
    if (!task || !preview || task.id !== input.taskID || preview.id !== input.previewID || task.channel !== channel ||
        preview.channel !== channel || task.requiresWorktree !== true || task.status !== 'claimed' || !task.claimant ||
        task.claimant === owner || preview.taskID !== task.id || preview.agentId !== task.claimant || !preview.approved || preview.purpose ||
        preview.claimGeneration !== task.claimGeneration) throw new Error('Approved claimed worktree preview required');
    let latest;
    for (let offset = 0, pageCount = 0; pageCount < 4096; pageCount++) {
      const page = await this.client.request('control_query', { agentId: owner, channel, view: 'previews', offset, limit: 100 });
      guard();
      if (!Array.isArray(page.entries) || !Number.isSafeInteger(page.next)) throw new Error('Worktree previews unavailable');
      for (const item of page.entries) if (item.taskID === task.id && item.agentId === task.claimant) latest = item;
      if (!page.entries.length || page.next <= offset) break;
      if (pageCount === 4095) throw new Error('Worktree preview query budget exhausted');
      offset = page.next;
    }
    if (latest?.id !== preview.id || latest.approved !== true) throw new Error('Approved claimed worktree preview required');
    return { task, preview };
  }
  async restoreSessionWatches() {
    const owner = this.agentId, channel = this.channel;
    if (!owner || !channel || typeof this.client.on !== 'function') return;
    const valid = () => this.agentId === owner && this.channel === channel;
    const latest = new Map();
    for (let offset = 0; offset <= 10000;) {
      const page = await this.client.request('history', { agentId: owner, channel, offset, limit: 100 });
      if (!valid()) return;
      if (!Array.isArray(page)) throw new Error('Session history unavailable');
      if (!page.length) break;
      for (const message of page) {
        if (message.from?.agentId !== owner || typeof message.to !== 'string') continue;
        const match = /^Turnlink requests (session preparation|a session comparison after a manual move)\. Task ([0-9a-f-]{36}), approved preview ([0-9a-f-]{36}), session ([a-zA-Z0-9:._-]+),/.exec(message.text || '');
        if (!match || message.to !== match[4] || !z.string().uuid().safeParse(match[2]).success || !z.string().uuid().safeParse(match[3]).success) continue;
        const key = `${match[2]}:${match[3]}:${match[4]}`;
        if (!latest.has(key)) latest.set(key, { kind: match[1], taskID: match[2], previewID: match[3], target: match[4] });
      }
      offset += page.length;
      if (offset > 10000) throw new Error('Session history query budget exhausted');
    }
    for (const item of latest.values()) {
      if (!valid()) return;
      if (item.kind !== 'session preparation' || this.sessionWatches?.has(item.previewID)) continue;
      try {
        const { task, preview } = await this.approvedSessionTask(item, owner, channel);
        if (valid() && task.claimant === item.target) this.watchSession(task, preview);
      } catch (error) {
        if (error.message !== 'Approved claimed worktree preview required') throw error;
        // A stale preview cannot be resumed.
      }
    }
  }
  watchSession(task, preview) {
    if (typeof this.client.on !== 'function') return;
    this.sessionWatches ??= new Map();
    this.sessionWatches.set(preview.id, { task, preview, channel: this.channel, owner: this.agentId, busy: false });
    if (!this.sessionWatchListener) {
      this.sessionWatchListener = () => { for (const entry of this.sessionWatches.values()) void this.trySessionWatch(entry); };
      for (const event of ['presence', 'message', 'connected']) this.client.on(event, this.sessionWatchListener);
    }
    this.sessionWatchListener();
  }
  clearSessionWatches() {
    if (this.sessionWatchListener) for (const event of ['presence', 'message', 'connected']) this.client.off(event, this.sessionWatchListener);
    for (const entry of this.sessionWatches?.values() || []) if (entry.retryTimer) clearTimeout(entry.retryTimer);
    this.sessionWatchListener = undefined; this.sessionWatches?.clear();
  }
  removeSessionWatch(previewID) {
    const entry = this.sessionWatches?.get(previewID); if (entry?.retryTimer) clearTimeout(entry.retryTimer);
    this.sessionWatches?.delete(previewID);
    if (this.sessionWatches?.size === 0) this.clearSessionWatches();
  }
  async trySessionWatch(entry) {
    const valid = () => this.agentId === entry.owner && this.channel === entry.channel && this.sessionWatches?.get(entry.preview.id) === entry;
    if (!valid()) return;
    if (entry.busy) { entry.recheck = true; return; }
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = undefined; }
    entry.busy = true;
    let safeObservationRetry = false, comparisonPending = false, comparisonID;
    try {
      if (entry.uncertainComparison) {
        // A lost send response is not permission to repeat the effect. Only
        // reconcile the exact request from retained history; absence is not
        // proof that an in-flight request will never commit.
        for (let offset = 0; offset <= 10000;) {
          const page = await this.client.request('history', { agentId: entry.owner, channel: entry.channel, offset, limit: 100 });
          if (!valid()) return;
          if (!Array.isArray(page)) throw new Error('Session history unavailable');
          if (page.some(message => message.from?.agentId === entry.owner && message.to === entry.task.claimant &&
              message.messageId === entry.uncertainComparison && typeof message.text === 'string' &&
              message.text.startsWith(`Turnlink requests a session comparison after a manual move. Task ${entry.task.id}, approved preview ${entry.preview.id}, session ${entry.task.claimant},`))) {
            this.removeSessionWatch(entry.preview.id); return;
          }
          if (!page.length) return;
          offset += page.length;
        }
        throw new Error('Session history query budget exhausted');
      }
      entry.retryRequired = false;
      const { member: worker } = await this.findChannelMember(entry.owner, entry.channel, entry.task.claimant);
      if (!valid()) return;
      if (!worker || ![entry.preview.from, entry.preview.to].includes(worker.project?.root)) return;
      let record, invalidRecord;
      for (let offset = 0; offset <= 10000 && !record && !invalidRecord;) {
        const page = await this.client.request('history', { agentId: entry.owner, channel: entry.channel, offset, limit: 100 });
        if (!valid()) return;
        if (!Array.isArray(page)) throw new Error('Session history unavailable');
        if (!page.length) return;
        const candidate = page.find(message => {
          if (message.from?.agentId !== entry.task.claimant || message.to !== entry.owner) return false;
          return isSessionRecordMessage(message.text, entry.task.id, entry.preview.id);
        });
        if (candidate) {
          const value = sessionRecord.safeParse(parseSessionJSON(candidate.text));
          if (value.success && value.data.runtime !== null && (worker.project.root !== entry.preview.from || completeSessionRecord(value.data)) && value.data.session === entry.task.claimant && value.data.source === entry.preview.from && value.data.destination === entry.preview.to)
            record = candidate;
          else invalidRecord = candidate;
        }
        offset += page.length;
      }
      if (valid() && invalidRecord && worker.project.root === entry.preview.from && entry.repairRecordID !== invalidRecord.id) {
        const active = await this.requireSessionCoordinator(entry.owner, entry.channel);
        if (!valid()) return;
        await this.client.request('send', { agentId: entry.owner, to: entry.task.claimant, masterGeneration: active.generation, messageId: `turnlink-record-repair-${invalidRecord.id}`,
          text: `Turnlink could not use your session record ${invalidRecord.id} for task ${entry.task.id} and preview ${entry.preview.id}. ` +
            'Correct your private record using the current preparation request and v2 format, including the runtime name and version of the process hosting this session. If that version is unverified, use JSON null and do not stop. Use JSON null, not the string "unknown", for information you cannot verify. ' +
            'The move cannot be armed while any observation is null: find the missing information or tell the operator if it cannot be verified. Each known field must be a string; verify the session and paths, and do not guess. Send the complete corrected JSON object alone to this sender with a new messageId. ' +
            'Do not stop or move until Turnlink confirms the corrected record.' });
        if (valid()) entry.repairRecordID = invalidRecord.id;
        return;
      }
      if (!valid() || !record) return;
      if (entry.preview.manualResume) {
        if (worker.project.root === entry.preview.from) {
          let status;
          try { status = await this.client.request('control_manual_resume_status', { agentId: entry.owner, channel: entry.channel, taskID: entry.task.id, previewID: entry.preview.id }); }
          catch (error) { if (error.message !== 'MANUAL_RESUME_UNAVAILABLE') throw error; }
          if (!valid()) return;
          if (status?.status === 'uncertain') {
            if (entry.refreshRecordID !== record.id) {
              const active = await this.requireSessionCoordinator(entry.owner, entry.channel);
              if (!valid()) return;
              await this.client.request('send', { agentId: entry.owner, to: entry.task.claimant, masterGeneration: active.generation, messageId: `turnlink-record-refresh-${record.id}`,
                text: `Turnlink needs a fresh session record for task ${entry.task.id} and preview ${entry.preview.id} because the source connection became uncertain. ` +
                  'Recheck the existing session and work, update the private record using the original preparation instructions, and send the complete sanitized JSON object alone to this sender with a new messageId. ' +
                  'Use JSON null for unknown information and do not guess. Wait for confirmation of the new record before stopping.' });
              if (valid()) entry.refreshRecordID = record.id;
            }
            return;
          }
        }
        const method = worker.project.root === entry.preview.from ? 'control_manual_resume_arm' : 'control_manual_resume_status';
        let observation;
        try { observation = await this.client.request(method, { agentId: entry.owner, channel: entry.channel, taskID: entry.task.id, previewID: entry.preview.id }); }
        catch (error) {
          // This read-only observation was explicitly rejected; no comparison
          // request has been sent yet. Ambiguous sends must never be retried here.
          if (method === 'control_manual_resume_status' && error.message === 'MANUAL_RESUME_UNAVAILABLE') safeObservationRetry = true;
          throw error;
        }
        if (!valid()) return;
        if (worker.project.root === entry.preview.from) {
          if (observation.status !== 'armed') return;
          const active = await this.requireSessionCoordinator(entry.owner, entry.channel);
          if (!valid()) return;
          await this.client.request('send', { agentId: entry.owner, to: entry.task.claimant, masterGeneration: active.generation, messageId: `turnlink-armed-${record.id}`,
            text: `Turnlink recorded the receiver for manual stop (task ${entry.task.id}, preview ${entry.preview.id}, record ${record.id}). The session may now be stopped and resumed manually in ${JSON.stringify(entry.preview.to)}. If you change or resend the record, wait for a new confirmation for that record before stopping. The broker observes receiver disconnection only; it does not verify that the native process stopped. Do not start the worktree task yet.` });
          entry.retryCount = 0;
          return;
        }
        if (observation.status !== 'detached') return;
      } else if (worker.project.root !== entry.preview.to) return;
      comparisonPending = true;
      comparisonID = `turnlink-verify-${record.id}`;
      await this.call('channel_verify_session', { taskID: entry.task.id, previewID: entry.preview.id, messageId: comparisonID });
      comparisonPending = false;
      if (valid()) this.removeSessionWatch(entry.preview.id);
    } catch (error) {
      entry.retryRequired = true; entry.lastError = diagnosticCode(error);
      if (comparisonPending && error.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH') entry.uncertainComparison = comparisonID;
      // Only explicit pre-dispatch rejections or the rejected read above are safe to retry.
      if (valid() && (safeObservationRetry || (error.code === 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' && (entry.retryCount || 0) < 6))) {
        const attempt = entry.retryCount || 0; entry.retryCount = Math.min(attempt + 1, 6);
        // Destination status is read-only and may remain unavailable longer
        // than the initial retry window. Keep polling with a capped backoff;
        // never apply this rule to an ambiguous comparison send.
        const wait = Math.min(100 * 2 ** attempt, safeObservationRetry ? 5000 : 1600);
        entry.retryTimer = setTimeout(() => { entry.retryTimer = undefined; void this.trySessionWatch(entry); }, wait);
        entry.retryTimer.unref?.();
      }
    }
    finally {
      entry.busy = false;
      if (entry.recheck && valid()) { entry.recheck = false; queueMicrotask(() => void this.trySessionWatch(entry)); }
    }
  }
  async call(name, args) {
    if (name === 'channel_join') {
      if (!this.harness || !this.sessionId) throw new Error('Harness-supplied session binding is required; the model cannot choose its session identity');
      if (this.harness && args.harness !== this.harness) throw new Error('Wrong harness');
      if (this.sessionId && args.sessionId !== this.sessionId) throw new Error('Wrong session');
      if (this.agentId && this.agentId !== identity(args.harness, args.sessionId)) throw new Error('MCP instance already bound to another session');
      const result = await this.client.request('join', args);
      if (this.channel && this.channel !== args.channel) this.clearSessionWatches();
      this.agentId = result.agent.agentId;
      this.channel = args.channel;
      if (this.onJoin) {
        await this.onJoin(result.agent);
        // A receiver is connected only after subscription; the join reply was
        // produced before that point and otherwise reports a stale reservation.
        const { member: current, firstPage: members } = await this.findChannelMember(this.agentId, args.channel, this.agentId);
        if (!current) throw new Error('Joined receiver is no longer a channel member');
        if (this.restoreWatchesOnJoin) this.startSessionRecovery();
        return { ...result, agent: current, members };
      }
      if (this.restoreWatchesOnJoin) this.startSessionRecovery();
      return result;
    }
    if (!this.agentId) throw new Error('Call channel_join first');
    if (name === 'channel_control') {
      let command;
      try { command = ParticipantCommand.parse(args.command); } catch { throw new Error('Invalid participant control command'); }
      return this.client.request('control_command', { agentId: this.agentId, command });
    }
    if (name === 'channel_status') return this.client.request('control_query', { ...args, agentId: this.agentId });
    if (name === 'channel_manual_preview') {
      const { taskID, destination } = z.strictObject({ taskID: z.string().uuid(), destination: z.string().min(1).max(2048) }).parse(args);
      const owner = this.agentId, channel = this.channel;
      const [state, page] = await Promise.all([
        this.client.request('control_query', { agentId: owner, channel, view: 'channel' }),
        this.client.request('control_query', { agentId: owner, channel, view: 'tasks', entityID: taskID, limit: 1 }),
      ]);
      if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed');
      const task = page.entries?.length === 1 ? page.entries[0] : null;
      const worker = task?.claimant ? (await this.findChannelMember(owner, channel, task.claimant)).member : undefined;
      if (state.channel?.active?.agentId !== owner || !Number.isSafeInteger(state.channel.active.generation) || task?.id !== taskID ||
          task.status !== 'claimed' || task.requiresWorktree !== true || worker?.channel !== channel || !worker.connected || typeof worker.project?.root !== 'string')
        throw new Error('Active master and connected claimant required');
      const command = Command.parse({ id: randomUUID(), op: 'worktree.manual_preview', channel, generation: state.channel.active.generation,
        taskID, from: worker.project.root, to: destination });
      return this.client.request('control_command', { agentId: owner, command });
    }
    if (['channel_prepare_session', 'channel_verify_session', 'channel_session_status', 'channel_request_session_takeover'].includes(name)) {
      const owner = this.agentId, channel = this.channel;
      const guard = () => { if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed'); };
      const fields = { taskID: z.string().uuid(), previewID: z.string().uuid() };
      const input = z.strictObject(name === 'channel_session_status' ? fields : { ...fields, messageId: z.string().min(1).max(128) }).parse(args);
      const { task, preview } = await this.approvedSessionTask(input, owner, channel);
      const active = name === 'channel_session_status' ? undefined : await this.requireSessionCoordinator(owner, channel);
      if (name === 'channel_request_session_takeover') {
        const { member: worker } = await this.findChannelMember(owner, channel, task.claimant); guard();
        if (!preview.manualResume || !preview.sessionCoordinator || preview.sessionCoordinator === owner || !worker?.connected || worker.project?.root !== preview.to)
          throw new Error('Resumed claimant and a different original coordinator are required');
        const text = `Turnlink requests recovery of an existing session record. Task ${task.id}, approved preview ${preview.id}, session ${task.claimant}. ` +
          'Use channel_history to find the latest complete sanitized turnlink.session_record.v2 that this session sent for this exact task and preview. ' +
          'Send its original JSON text unchanged to this sender with channel_send and a new messageId. Do not include credentials or additional text. ' +
          'If the original record is unavailable, report that instead; do not reconstruct or guess it. This request does not authorize the task.';
        const sent = await this.client.request('send', { agentId: owner, to: task.claimant, text, messageId: input.messageId, masterGeneration: active.generation });
        guard(); return sent;
      }
      if (name === 'channel_prepare_session' && preview.sessionCoordinator !== owner) {
        await this.client.request('control_command', { agentId: owner, command: { id: randomUUID(), op: 'worktree.session_require', channel,
          generation: active.generation, taskID: task.id, previewID: preview.id } });
        guard();
      } else if (preview.sessionCoordinator !== owner) throw new Error('Session preparation is not assigned to this coordinator');
      if (name === 'channel_session_status') {
        const messages = [];
        for (let offset = 0; offset <= 10000;) {
          const page = await this.client.request('history', { agentId: owner, channel, limit: 100, offset });
          guard();
          if (!Array.isArray(page)) throw new Error('Session history unavailable');
          if (!page.length) break;
          messages.push(...page);
          offset += page.length;
          if (offset > 10000) throw new Error('Session history query budget exhausted');
        }
        const result = sessionEvidenceStatus(messages, { task, preview, owner });
        if (result.status === 'reported_match' && preview.manualResume) {
          let baseline;
          try { baseline = await this.client.request('control_manual_resume_status', { agentId: owner, channel, taskID: task.id, previewID: preview.id }); }
          catch (error) {
            if (!['MANUAL_RESUME_UNAVAILABLE', 'Invalid request schema or protocol version'].includes(error.message)) throw error;
          }
          guard();
          if (!baseline || typeof baseline.baselineMatches !== 'boolean' || baseline.currentRecordID !== result.recordID)
            return { status: 'baseline_unavailable', reason: 'manual_observation_unavailable', agentReported: true };
          if (!baseline.baselineMatches) return { status: 'invalid_record', reason: 'record_differs_from_baseline', agentReported: true };
        }
        if (result.status === 'awaiting_request') {
          const watch = this.sessionWatches?.get(preview.id);
          return { ...result, watch: { active: !!watch, retryRequired: watch?.retryRequired === true,
            recoveryFailed: this.sessionRecoveryFailed === true,
            ...(watch?.uncertainComparison ? { uncertainComparison: true, comparisonMessageId: watch.uncertainComparison,
              guidance: 'The comparison send outcome is unknown. Check retained history; do not repeat the request until the original send is no longer in flight. If retrying explicitly, reuse its messageId and identical request.' } : {}) } };
        }
        return result;
      }
      const context = `Task ${task.id}, approved preview ${preview.id}, session ${task.claimant}, source ${JSON.stringify(preview.from)}, destination ${JSON.stringify(preview.to)}. `;
      const text = name === 'channel_prepare_session' ? `Turnlink requests session preparation. ${context}` +
        'In this existing conversation, collect the session identity, actual current directory, the name and version of the runtime hosting this session, accessible model/provider and permission settings, and a concise summary of saved and unfinished work. ' +
        'You can inspect your own channel_join result for your agentId and project.root; verify that the root reflects your current directory, especially if you supplied it yourself. ' +
        'If channel_session_context is available, use it to observe your runtime, selected model, provider and native permission-rule fingerprint. Record runtime as the product name followed by the exact three-part version, for example "opencode 2.2.5". Include any model variant; the fingerprint covers only the native rules stated by that tool, not OS or remote policy. Do not assume a binary found on PATH is the process hosting this session. ' +
        'For a Codex session without channel_session_context, you may request channel_status with this channel and view="health". Use "codex " followed by report.nativeVersion only when the entry is for your own agentId, connected, fresh and contains that version; otherwise record runtime as null. Health reporting is optional and observational. ' +
        'The coordinator already called channel_prepare_session; do not call it yourself. To check the claim and approval, use channel_status views tasks and previews; channel_session_status is for the coordinator. ' +
        'In the work summary, include any known pending approvals, background jobs, or external actions that may still finish, and what needs reconciliation. If you cannot verify their status, say so instead of asserting they are clear. ' +
        'Mark information you cannot verify as unknown; do not guess. Do not include credentials, tokens, environment dumps, or conversation transcripts. ' +
        'Prepare a JSON session record with exactly these fields: type="turnlink.session_record.v2", taskID, previewID, session, source, destination, runtime, model, provider, permissions, work. Each field must be a string, not an object or array; runtime must identify the hosting runtime and exact version, session is your full agentId and work is a concise summary of saved and unfinished task work, excluding the session record itself and migration steps. Use null only for unknown runtime, model, provider, permissions or work. Source must be the current directory you actually observe, not a copied claim; if you cannot verify the session identity or current directory, report this instead of sending a complete record. Keep it under 4000 bytes and make it current before sending it for confirmation. ' +
        'Use channel_send to send this sender the complete sanitized record as the entire message text: one JSON object only, with no introduction, notes, or Markdown. Choose a messageId for this record and reuse the same messageId and identical text if the send reply is lost; use a new messageId for a changed record. Turnlink saves a private source copy when this is the approved current preparation; check that channel_send reports privateRecordSaved=true. The same session can retrieve the sent record from channel_history after reconnecting on another host. If this is a manual preview, wait for the coordinator to confirm that Turnlink recorded the source receiver for this record before stopping. If you send an updated record, wait for a new confirmation for the updated record. ' +
        'Include any unknowns in that record. Turnlink retains this message, so include only information you are permitted to share with this channel. ' +
        'Do not move the session, assert the receiver has transferred, or start the worktree task from this request.' :
        `Turnlink requests a session comparison after a manual move. ${context}` +
        'Use channel_history, paging with offset if necessary, to retrieve the last complete record sent by this session for this exact task and preview; verify its identifiers before using it. The source copy is private to the original host and may not be available here. ' +
        'Compare the actual session identity and current directory, runtime name and exact version, accessible model/provider and permission settings, and saved and unfinished work. Runtime matches only when the product and exact version match the baseline; ignore product-name capitalization and an optional v before the version, but do not ignore any version or prerelease differences. An executable on PATH alone does not prove the hosting process version. For work, check whether the prior work and context are still available; the expected stop, rejoin, and verification steps are not by themselves lost or changed work. If work is missing or cannot be verified, report different or unknown respectively. The session record may be recovered from channel history. ' +
        'If channel_session_context was used for the baseline, call it again and compare the same model, variant, provider and native permission-rule fingerprint; its scope excludes OS and remote policies. For Codex health observations, repeat channel_status with view="health" and use only a fresh, connected entry for your own agentId; if unavailable, report the runtime as unknown. ' +
        'Use channel_send to reply to this sender with only a JSON object containing type="turnlink.session_report.v2", taskID, previewID, session, recordID (the broker id of the saved record message), requestID (the id of this request message), runtime (the actual destination product name and exact version, or null if unknown), and checks. ' +
        'Checks must contain exactly session, destination, runtime, model, provider, permissions and work, each set to match, different or unknown. A missing baseline is unknown. Do not guess or include credentials, tokens, environment dumps, or conversation transcripts. ' +
        'If the record is missing, mismatched or inaccessible, report that instead. This report does not transfer the receiver or authorize the worktree task.';
      guard();
      const result = await this.client.request('send', { agentId: owner, to: task.claimant, text, messageId: input.messageId, masterGeneration: active.generation });
      guard();
      if (name === 'channel_prepare_session') this.watchSession(task, preview);
      else this.removeSessionWatch(preview.id);
      return result;
    }
    if (name === 'channel_members') return this.client.request('members', { ...args, agentId: this.agentId });
    if (name === 'channel_history') return this.client.request('history', { ...args, agentId: this.agentId });
    if (name === 'channel_send') {
      const owner = this.agentId, channel = this.channel;
      const messageId = args.messageId || randomUUID();
      const parsed = this.restoreWatchesOnJoin ? sessionRecord.safeParse(parseSessionJSON(args.text)) : undefined;
      const send = async () => {
        if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed');
        let privateRecordSaved = false;
        if (parsed?.success && parsed.data.session === owner) {
          if (Buffer.byteLength(args.text) > MAX_TEXT_BYTES) throw new Error('Session record exceeds the message size limit');
          privateRecordSaved = await this.savePreparedRecord(parsed.data, args.text, args.to, messageId);
        }
        if (this.agentId !== owner || this.channel !== channel) throw new Error('Session membership changed');
        const result = await this.client.request('send', { ...args, agentId: owner, messageId });
        return privateRecordSaved ? { ...result, privateRecordSaved: true } : result;
      };
      if (!parsed?.success || parsed.data.session !== owner) return send();
      const key = `${parsed.data.taskID}:${parsed.data.previewID}`;
      this.recordSends ??= new Map();
      const previous = this.recordSends.get(key) || Promise.resolve();
      const current = previous.catch(() => {}).then(send); this.recordSends.set(key, current);
      try { return await current; } finally { if (this.recordSends.get(key) === current) this.recordSends.delete(key); }
    }
    if (name === 'channel_ack') return this.client.request('ack', { ...args, agentId: this.agentId });
    if (name === 'channel_leave') {
      const agentId = this.agentId;
      const result = await this.client.request('leave', { agentId });
      await this.client.unsubscribe(agentId);
      this.clearSessionWatches();
      this.stopSessionRecovery();
      this.agentId = null;
      this.channel = null;
      return result;
    }
    throw new Error('Unknown tool');
  }
}
