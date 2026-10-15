import { z } from 'zod';
import { AgentID, Channel, Harness } from '../protocol.js';
import { posix, win32 } from 'node:path';
import { createHash } from 'node:crypto';

export const CONTROL_VERSION = 1;
export const MASTER_PROMPT_VERSION = 1;
export const MASTER_LEASE_MS = 120000;
export const PROPOSAL_TIMEOUT_MS = 120000;
export const ELECTION_TIMEOUT_MS = 60000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const Stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const UUID = z.string().uuid();
const text = max => z.string().trim().min(1).max(max).refine(value => Buffer.byteLength(value, 'utf8') <= max, 'UTF-8 byte limit exceeded');
const absolutePath = text(2048).refine(value => !value.includes('\0') && (posix.isAbsolute(value) || win32.isAbsolute(value)), 'Absolute host path required');
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const WorktreeBinding = z.strictObject({ harness: z.enum(['opencode', 'codex']), projectID: text(200),
  sourceAuthorityDigest: Digest, destinationAuthorityDigest: Digest,
  sources: z.array(z.strictObject({ path: absolutePath, digest: Digest })).min(1).max(128) })
  .refine(value => Buffer.byteLength(JSON.stringify(value)) <= 24000, 'Worktree manifest byte limit exceeded')
  .refine(value => value.sources.every((source, index) => !value.sources.slice(0, index).some(p => p.path === source.path && p.digest !== source.digest)), 'Conflicting worktree source hashes');
export const Mode = z.enum(['automatic', 'safe', 'approval']);
export const Operation = z.enum(['retry_delivery', 'pause_delivery', 'resume_delivery', 'change_wake_policy', 'cancel_queued', 'remove_member']);
export const RecoveryEvidence = z.enum(['known_unadmitted', 'native_idempotent', 'ambiguous', 'not_applicable']);
export const TaskStatus = z.enum(['open', 'claimed', 'dispatching', 'running', 'uncertain', 'review', 'completed', 'cancelled']);
export const Actor = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('operator') }),
  z.strictObject({ kind: z.literal('scheduler') }),
  z.strictObject({ kind: z.literal('participant'), agentId: AgentID }),
  z.strictObject({ kind: z.literal('adapter'), agentId: AgentID }),
]);
// Actor, membership and runtime evidence are supplied by a trusted transport boundary, NEVER model arguments.
export const Member = z.strictObject({ agentId: AgentID, channel: Channel, harness: Harness, connected: z.boolean() });
export const Context = z.strictObject({ actor: Actor, now: Stamp, members: z.array(Member).max(4096) }).superRefine((context, refinement) => {
  if (new Set(context.members.map(m => m.agentId)).size !== context.members.length ||
    context.members.some(m => !m.agentId.startsWith(`${m.harness}:`))) {
    refinement.addIssue({ code: 'custom', message: 'Incoherent membership snapshot' });
  }
});
export const Schedule = z.strictObject({ at: Stamp, missed: z.enum(['ask', 'skip', 'run_late']).default('ask'),
  maxLatenessMs: z.number().int().positive().max(30 * 86400000).default(5000) });
const payload = (op, fields = {}) => z.strictObject({ id: UUID, op: z.literal(op), channel: Channel, ...fields });
const EvidenceKind = z.enum(['admitted', 'unadmitted', 'native_idempotent', 'uncertain', 'capability', 'idle', 'busy', 'started', 'stopped', 'artifact']);
export const Evidence = z.strictObject({ id: UUID, channel: Channel, entityID: UUID, agentId: AgentID, kind: EvidenceKind, at: Stamp,
  attempt: Stamp.optional(), admissionID: text(128).regex(/^msg_[a-zA-Z0-9_-]+$/).optional(),
  sameConversationWorktree: z.boolean().optional(), artifact: z.strictObject({ type: z.literal('native_session_segment'), harness: z.literal('opencode'),
    sessionID: text(200), fromMessageID: text(128), throughMessageID: text(128), digest: Digest, finish: text(32) }).optional() });
export const Command = z.discriminatedUnion('op', [
  payload('channel.configure', { mode: Mode.optional(), electionsEnabled: z.boolean().optional(), capacity: z.number().int().min(1).max(32).optional() }),
  payload('master.volunteer', { eligible: z.boolean() }),
  payload('master.appoint', { candidate: AgentID }),
  payload('master.accept', { proposalID: UUID, promptVersion: z.literal(MASTER_PROMPT_VERSION) }),
  payload('master.renew', { generation: Stamp }),
  payload('master.resign', { generation: Stamp }),
  payload('master.revoke'),
  payload('election.start'),
  payload('election.vote', { electionID: UUID, candidate: AgentID }),
  payload('clock.tick'),
  payload('member.departed', { agentId: AgentID }),
  payload('action.request', { generation: Stamp, operation: Operation, target: AgentID, messageID: UUID.optional(),
    evidence: RecoveryEvidence, evidenceID: UUID.optional(), admissionID: text(128).regex(/^msg_[a-zA-Z0-9_-]+$/).optional(), wakePolicy: z.enum(['steer', 'queue', 'paused']).optional() }),
  payload('action.approve', { actionID: UUID }),
  payload('action.reject', { actionID: UUID }),
  payload('action.begin', { actionID: UUID }),
  payload('action.revalidate', { actionID: UUID }),
  payload('action.reconcile', { actionID: UUID, outcome: z.enum(['succeeded', 'failed', 'uncertain']), evidenceID: UUID }),
  payload('action.finish', { actionID: UUID, outcome: z.enum(['succeeded', 'failed', 'uncertain']), evidenceID: UUID }),
  payload('incident.open', { category: z.enum(['connectivity', 'permission', 'question', 'admission', 'storage', 'deadline', 'capability']), entityID: UUID.optional() }),
  payload('incident.resolve', { incidentID: UUID, generation: Stamp.optional(), evidenceID: UUID }),
  payload('task.create', { generation: Stamp.optional(), title: text(200), instructions: text(12000), criteria: text(4000),
    dependencies: z.array(UUID).max(64).default([]), priority: z.number().int().min(0).max(100).default(50), schedule: Schedule.optional(),
    deadlineAt: Stamp.optional(), progressTimeoutMs: z.number().int().min(1000).max(30 * 86400000).default(300000),
    requiresWorktree: z.boolean().default(true) }),
  payload('task.claim', { taskID: UUID }),
  payload('task.release', { taskID: UUID }),
  payload('task.prepare', { taskID: UUID, capabilityEvidenceID: UUID, cwd: absolutePath.optional(), scopeDigest: Digest.optional() }),
  payload('task.uncertain', { taskID: UUID, attempt: Stamp }),
  payload('evidence.record', { entityID: UUID, kind: EvidenceKind, attempt: Stamp.optional(),
    admissionID: text(128).regex(/^msg_[a-zA-Z0-9_-]+$/).optional(), sameConversationWorktree: z.boolean().optional(),
    artifact: Evidence.shape.artifact }),
  payload('worktree.preview', { taskID: UUID, from: absolutePath, to: absolutePath, configurationDigest: Digest, binding: WorktreeBinding.optional() }),
  payload('worktree.approve', { taskID: UUID, previewID: UUID }),
  payload('worktree.begin', { taskID: UUID, previewID: UUID, claimGeneration: Stamp, configurationDigest: Digest, authorityDigest: Digest }),
  payload('worktree.settle', { transitionID: UUID, outcome: z.enum(['moved', 'failed', 'uncertain']), actualLocation: absolutePath,
    configurationDigest: Digest, authorityDigest: Digest, receiptID: UUID }),
  payload('task.admission', { taskID: UUID, attempt: Stamp, outcome: z.enum(['admitted', 'unadmitted', 'uncertain']), receiptID: UUID,
    admissionID: text(128).regex(/^msg_[a-zA-Z0-9_-]+$/).optional() }),
  payload('task.started', { taskID: UUID, attempt: Stamp, evidenceID: UUID }),
  payload('task.progress', { taskID: UUID, attempt: Stamp }),
  payload('task.stopped', { taskID: UUID, attempt: Stamp, evidenceID: UUID }),
  payload('task.reassign', { taskID: UUID, generation: Stamp.optional() }),
  payload('task.report', { taskID: UUID, summary: text(4000), evidence: z.array(UUID).min(1).max(32) }),
  payload('task.review', { taskID: UUID, generation: Stamp, accept: z.boolean(), evidenceID: UUID }),
  payload('task.missed', { taskID: UUID, run: z.boolean() }),
]);

const Assignment = z.strictObject({ id: UUID, agentId: AgentID, generation: Stamp, source: z.enum(['appointment', 'election']),
  proposedAt: Stamp, acceptBy: Stamp, promptVersion: z.literal(MASTER_PROMPT_VERSION), expiresAt: Stamp.optional() });
const Election = z.strictObject({ id: UUID, startedAt: Stamp, deadline: Stamp, electorate: z.array(AgentID).min(1).max(32),
  candidates: z.array(AgentID).min(1).max(32), ballots: z.record(AgentID, AgentID) });
export const ChannelState = z.strictObject({ id: Channel, mode: Mode, policyRevision: Stamp, electionsEnabled: z.boolean(),
  capacity: z.number().int().min(1).max(32), generation: Stamp, volunteers: z.array(AgentID).max(32),
  active: Assignment.nullable(), proposal: Assignment.nullable(), election: Election.nullable() });
export const Task = z.strictObject({ id: UUID, channel: Channel, title: text(200), instructions: text(12000), criteria: text(4000),
  dependencies: z.array(UUID).max(64), priority: z.number().int().min(0).max(100), status: TaskStatus, createdAt: Stamp,
  schedule: Schedule.optional(), deadlineAt: Stamp.optional(), progressTimeoutMs: Stamp, requiresWorktree: z.boolean(),
  claimant: AgentID.nullable(), attempt: Stamp, lastProgressAt: Stamp.optional(), deadlineIncident: z.boolean().default(false),
  claimGeneration: Stamp,
  admission: z.enum(['none', 'admitted', 'unadmitted', 'uncertain']), stoppedEvidence: UUID.optional(), receiptID: UUID.optional(),
  result: z.strictObject({ summary: text(4000), evidence: z.array(UUID).min(1).max(32) }).optional(),
  missedDecision: z.enum(['run', 'skip']).optional(), dispatchIntentID: UUID.optional(),
  executionScope: z.strictObject({ cwd: absolutePath, digest: Digest }).optional(), nativeAdmissionID: text(128).regex(/^msg_[a-zA-Z0-9_-]+$/).optional() });
export const WorktreePreview = z.strictObject({ id: UUID, channel: Channel, taskID: UUID, agentId: AgentID,
  from: absolutePath, to: absolutePath, configurationDigest: Digest, approved: z.boolean(), at: Stamp, claimGeneration: Stamp,
  binding: WorktreeBinding.optional() });
export const WorktreeTransition = z.strictObject({ id: UUID, channel: Channel, taskID: UUID, agentId: AgentID, previewID: UUID,
  claimGeneration: Stamp, from: absolutePath, to: absolutePath, configurationDigest: Digest, authorityDigest: Digest,
  status: z.enum(['prepared', 'moved', 'failed', 'uncertain']), preparedAt: Stamp, settledAt: Stamp.optional(), receiptID: UUID.optional(),
  actualLocation: absolutePath.optional() });
export const Action = z.strictObject({ id: UUID, channel: Channel, requester: AgentID, generation: Stamp, policyRevision: Stamp,
  operation: Operation, target: AgentID, messageID: UUID.optional(), evidence: RecoveryEvidence, admissionID: text(128).optional(),
  wakePolicy: z.enum(['steer', 'queue', 'paused']).optional(), status: z.enum(['awaiting_approval', 'approved', 'executing', 'succeeded', 'failed', 'uncertain', 'rejected']),
  createdAt: Stamp, approvedAt: Stamp.optional(), evidenceID: UUID.optional(), recoveryEvidenceID: UUID.optional() });
export const Incident = z.strictObject({ id: UUID, channel: Channel, category: z.enum(['connectivity', 'permission', 'question', 'admission', 'storage', 'deadline', 'capability']),
  entityID: UUID.optional(), status: z.enum(['open', 'resolved']), openedAt: Stamp, resolvedAt: Stamp.optional(), evidenceID: UUID.optional() });
export const State = z.strictObject({ version: z.literal(CONTROL_VERSION), lastNow: Stamp,
  channels: z.array(ChannelState).max(128), tasks: z.array(Task).max(4096), actions: z.array(Action).max(4096), incidents: z.array(Incident).max(4096),
  evidence: z.array(Evidence).max(16384), previews: z.array(WorktreePreview).max(4096), transitions: z.array(WorktreeTransition).max(4096).default([]) });
export const Event = z.strictObject({ id: UUID, channel: Channel, type: z.enum([
  'channel.configured', 'master.volunteered', 'master.proposed', 'master.activated', 'master.renewed', 'master.ended',
  'election.started', 'election.voted', 'election.inconclusive', 'election.cancelled', 'election.won', 'master.revoked', 'member.departed', 'action.requested', 'action.approved', 'action.rejected',
  'action.executing', 'action.succeeded', 'action.failed', 'action.uncertain', 'incident.opened', 'incident.resolved',
  'task.created', 'task.claimed', 'task.released', 'task.dispatching', 'task.admitted', 'task.unadmitted', 'task.uncertain',
  'task.started', 'task.progress', 'task.stopped', 'task.reassigned', 'task.reported', 'task.completed', 'task.changes_requested', 'task.missed',
  'evidence.recorded', 'worktree.previewed', 'worktree.approved', 'worktree.prepared', 'worktree.moved', 'worktree.failed', 'worktree.uncertain', 'notice.accepted', 'messages.viewed',
]), actor: Actor, at: Stamp, entityID: UUID.optional(), generation: Stamp.optional(), agentId: AgentID.optional(), durable: z.boolean() });
export const Notice = z.strictObject({ id: UUID, channel: Channel, agentId: AgentID, assignmentID: UUID, generation: Stamp,
  promptVersion: z.literal(MASTER_PROMPT_VERSION), kind: z.enum(['offer', 'active', 'ended', 'task_review']), text: text(6000), at: Stamp,
  status: z.enum(['pending', 'accepted', 'cancelled']), receiptID: text(128).regex(/^msg_[a-zA-Z0-9_-]+$/).optional() });
export const freshControlState = () => ({ version: CONTROL_VERSION, lastNow: 0, channels: [], tasks: [], actions: [], incidents: [], evidence: [], previews: [], transitions: [] });

export function validateControlState(input) {
  const state = State.parse(input);
  const channels = new Map(state.channels.map(c => [c.id, c]));
  const tasks = new Map(state.tasks.map(t => [t.id, t]));
  const evidence = new Map(state.evidence.map(e => [e.id, e]));
  for (const entries of [state.channels, state.tasks, state.actions, state.incidents, state.evidence, state.previews, state.transitions]) {
    if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate control entity');
  }
  for (const entry of [...state.tasks, ...state.actions, ...state.incidents, ...state.evidence, ...state.previews, ...state.transitions]) {
    if (!channels.has(entry.channel)) throw new Error('Unknown control channel');
  }
  for (const channel of state.channels) {
    for (const assignment of [channel.active, channel.proposal].filter(Boolean)) {
      if (assignment.generation < 1 || assignment.generation > channel.generation || assignment.acceptBy <= assignment.proposedAt ||
        !channel.volunteers.includes(assignment.agentId)) throw new Error('Invalid master assignment');
    }
    if (channel.active && (!channel.active.expiresAt || channel.active.expiresAt <= channel.active.proposedAt)) throw new Error('Invalid master lease');
    if (channel.proposal && channel.active && channel.proposal.generation <= channel.active.generation) throw new Error('Invalid replacement generation');
    if (new Set(channel.volunteers).size !== channel.volunteers.length) throw new Error('Duplicate volunteer');
    if (channel.election) {
      const election = channel.election;
      if (channel.active || channel.proposal || election.deadline <= election.startedAt ||
        new Set(election.electorate).size !== election.electorate.length || new Set(election.candidates).size !== election.candidates.length ||
        election.candidates.some(id => !election.electorate.includes(id)) ||
        Object.entries(election.ballots).some(([voter, candidate]) => !election.electorate.includes(voter) || !election.candidates.includes(candidate))) {
        throw new Error('Invalid election state');
      }
    }
  }
  for (const task of state.tasks) {
    if (task.executionScope && (!task.dispatchIntentID || task.nativeAdmissionID !== `msg_turnlink_task_${createHash('sha256').update(task.dispatchIntentID).digest('hex')}`)) throw new Error('Invalid native task admission binding');
    if (new Set(task.dependencies).size !== task.dependencies.length || task.dependencies.some(id => tasks.get(id)?.channel !== task.channel) || task.dependencies.includes(task.id)) {
      throw new Error('Invalid task dependency');
    }
    if ((task.status === 'open' && task.claimant !== null) || (!['open', 'cancelled'].includes(task.status) && !task.claimant) ||
      (['dispatching', 'running', 'uncertain', 'review', 'completed'].includes(task.status) && (!task.dispatchIntentID || task.attempt < 1)) ||
      (task.status === 'running' && (task.admission !== 'admitted' || task.lastProgressAt === undefined)) ||
      (['review', 'completed'].includes(task.status) && !task.result)) throw new Error('Invalid task lifecycle');
    if (task.stoppedEvidence) {
      const stopped = evidence.get(task.stoppedEvidence);
      if (!stopped || stopped.kind !== 'stopped' || stopped.entityID !== task.id || stopped.agentId !== task.claimant ||
        stopped.attempt !== task.attempt || stopped.channel !== task.channel) throw new Error('Invalid task stop evidence');
    }
    if (task.result && task.result.evidence.some(id => {
      const artifact = evidence.get(id);
      return !artifact || artifact.kind !== 'artifact' || artifact.entityID !== task.id || artifact.agentId !== task.claimant ||
        artifact.attempt !== task.attempt || artifact.channel !== task.channel;
    })) throw new Error('Invalid result evidence');
    if (task.status === 'completed' && !task.stoppedEvidence) throw new Error('Completion without stop evidence');
  }
  for (const item of state.evidence) if (item.artifact && (item.kind !== 'artifact' || item.agentId !== `${item.artifact.harness}:${item.artifact.sessionID}` ||
    tasks.get(item.entityID)?.channel !== item.channel)) throw new Error('Invalid native task artifact');
  for (const preview of state.previews) {
    if (tasks.get(preview.taskID)?.channel !== preview.channel || preview.from === preview.to) throw new Error('Invalid worktree preview');
    if (preview.binding && !preview.agentId.startsWith(`${preview.binding.harness}:`)) throw new Error('Invalid worktree harness binding');
  }
  const unresolved = new Set();
  for (const transition of state.transitions) {
    const preview = state.previews.find(p => p.id === transition.previewID), task = tasks.get(transition.taskID);
    if (!preview?.approved || !preview.binding || task?.channel !== transition.channel || preview.taskID !== task.id ||
      preview.agentId !== transition.agentId || preview.channel !== transition.channel || preview.claimGeneration !== transition.claimGeneration ||
      transition.from !== preview.from || transition.to !== preview.to || transition.configurationDigest !== preview.configurationDigest ||
      transition.authorityDigest !== preview.binding.sourceAuthorityDigest || transition.authorityDigest !== preview.binding.destinationAuthorityDigest) throw new Error('Invalid worktree transition');
    if (['prepared', 'uncertain'].includes(transition.status)) {
      if (unresolved.has(transition.agentId) || task.claimant !== transition.agentId || task.claimGeneration !== transition.claimGeneration) throw new Error('Invalid worktree continuity');
      unresolved.add(transition.agentId);
    }
    if (transition.status !== 'prepared' && (!transition.receiptID || transition.settledAt === undefined || !transition.actualLocation)) throw new Error('Missing worktree receipt');
    if (transition.status === 'moved' && transition.actualLocation !== transition.to) throw new Error('Invalid moved location');
    if (transition.status === 'failed' && transition.actualLocation !== transition.from) throw new Error('Unproven worktree failure');
  }
  // Kahn's algorithm avoids recursive stack exhaustion for a long, otherwise valid dependency chain.
  const indegree = new Map(state.tasks.map(t => [t.id, t.dependencies.length])), dependants = new Map();
  for (const task of state.tasks) for (const id of task.dependencies) {
    if (!dependants.has(id)) dependants.set(id, []); dependants.get(id).push(task.id);
  }
  const ready = state.tasks.filter(t => !t.dependencies.length).map(t => t.id); let consumed = 0;
  for (let i = 0; i < ready.length; i++) {
    consumed++;
    for (const id of dependants.get(ready[i]) || []) { indegree.set(id, indegree.get(id) - 1); if (!indegree.get(id)) ready.push(id); }
  }
  if (consumed !== state.tasks.length) throw new Error('Cyclic task dependencies');
  return state;
}
