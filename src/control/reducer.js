import { randomUUID, createHash } from 'node:crypto';
import { Command, Context, validateControlState, Event, MASTER_LEASE_MS, MASTER_PROMPT_VERSION, PROPOSAL_TIMEOUT_MS, ELECTION_TIMEOUT_MS } from './contracts.js';
import { requireControl as check, actionDecision } from './policy.js';

const occupiesSlot = task => ['dispatching', 'running', 'uncertain', 'review'].includes(task.status) && !task.stoppedEvidence;

// Pure state transitions: no model calls, worktree changes, broker cancellation, or permission mutations.
export function reduceControl(previous, input, suppliedContext) {
  const state = structuredClone(validateControlState(previous));
  const command = Command.parse(input), context = Context.parse(suppliedContext);
  const { actor, now, members } = context;
  check(now >= state.lastNow, 'CLOCK_REGRESSION'); state.lastNow = now;
  const events = [];
  const emit = (type, entityID, generation, durable = true) => {
    const current = state.channels.find(c => c.id === command.channel);
    const assignment = [current?.active, current?.proposal].find(value => value?.id === entityID);
    events.push(Event.parse({ id: randomUUID(), channel: command.channel, type, actor, at: now,
      ...(entityID ? { entityID } : {}), ...(generation !== undefined ? { generation } : {}),
      ...(type.startsWith('master.') && assignment ? { agentId: assignment.agentId } : {}), durable }));
  };
  const operator = () => check(actor.kind === 'operator', 'OPERATOR_REQUIRED');
  const scheduler = () => check(actor.kind === 'scheduler', 'SCHEDULER_REQUIRED');
  const member = (id, connected = false) => {
    const entry = members.find(m => m.agentId === id && m.channel === command.channel);
    check(!!entry && (!connected || entry.connected), 'ELIGIBLE_MEMBER_REQUIRED'); return entry;
  };
  const participant = () => { check(actor.kind === 'participant', 'PARTICIPANT_REQUIRED'); return member(actor.agentId, true); };
  let channel = state.channels.find(c => c.id === command.channel);
  if (!channel) {
    check(command.op === 'channel.configure', 'CHANNEL_NOT_CONFIGURED'); operator();
    channel = { id: command.channel, mode: 'safe', policyRevision: 0, electionsEnabled: true, capacity: 32,
      generation: 0, volunteers: [], active: null, proposal: null, election: null };
    state.channels.push(channel);
  }
  const master = generation => {
    participant();
    check(channel.active?.agentId === actor.agentId && channel.active.generation === generation && channel.active.expiresAt > now, 'STALE_MASTER');
  };
  const manager = generation => { if (actor.kind !== 'operator') master(generation); };
  const expire = () => {
    if (channel.active && (channel.active.expiresAt <= now || !members.some(m => m.agentId === channel.active.agentId && m.channel === channel.id))) {
      emit('master.ended', channel.active.id, channel.active.generation); channel.active = null;
    }
    if (channel.proposal && (channel.proposal.acceptBy <= now || !members.some(m => m.agentId === channel.proposal.agentId && m.channel === channel.id))) {
      emit('master.ended', channel.proposal.id, channel.proposal.generation); channel.proposal = null;
    }
  };
  expire();
  const propose = (id, candidate, source) => {
    member(candidate, true); check(channel.volunteers.includes(candidate), 'VOLUNTEER_REQUIRED');
    if (channel.proposal) emit('master.ended', channel.proposal.id, channel.proposal.generation);
    if (channel.election) emit(source === 'election' ? 'election.won' : 'election.cancelled', channel.election.id);
    channel.generation++;
    channel.proposal = { id, agentId: candidate, generation: channel.generation, source, proposedAt: now,
      acceptBy: now + PROPOSAL_TIMEOUT_MS, promptVersion: MASTER_PROMPT_VERSION };
    channel.election = null; emit('master.proposed', id, channel.generation);
  };
  const settleElection = () => {
    const election = channel.election; if (!election) return;
    const quorum = Math.floor(election.electorate.length / 2) + 1;
    const winner = election.candidates.find(candidate => Object.values(election.ballots).filter(v => v === candidate).length >= quorum);
    const eligible = winner && channel.volunteers.includes(winner) && members.some(m => m.agentId === winner && m.channel === channel.id && m.connected);
    if (eligible) propose(election.id, winner, 'election');
    else if (election.deadline <= now || winner) { emit('election.inconclusive', election.id); channel.election = null; }
  };
  if (channel.election?.deadline <= now) settleElection();
  const task = () => {
    const value = state.tasks.find(t => t.id === command.taskID && t.channel === channel.id);
    check(!!value, 'UNKNOWN_TASK'); return value;
  };
  const adapter = value => {
    check(actor.kind === 'adapter' && actor.agentId === value.claimant && command.attempt === value.attempt, 'STALE_TASK_ATTEMPT');
    member(actor.agentId); // A disconnected transport is not an execution-stop signal.
  };
  const transitionPending = taskID => state.transitions.some(t => t.taskID === taskID && ['prepared', 'uncertain'].includes(t.status));
  const incident = (category, entityID) => {
    const existing = state.incidents.find(i => i.channel === channel.id && i.category === category && i.entityID === entityID && i.status === 'open');
    if (existing) return existing;
    const value = { id: randomUUID(), channel: channel.id, category, ...(entityID ? { entityID } : {}), status: 'open', openedAt: now };
    state.incidents.push(value); emit('incident.opened', value.id); return value;
  };
  const action = () => {
    const value = state.actions.find(a => a.id === command.actionID && a.channel === channel.id);
    check(!!value, 'UNKNOWN_ACTION'); return value;
  };
  const currentAction = value => {
    check(channel.active?.agentId === value.requester && channel.active.generation === value.generation && channel.active.expiresAt > now, 'STALE_MASTER');
    member(value.requester, true); member(value.target);
    check(value.policyRevision === channel.policyRevision, 'STALE_POLICY');
    check(actionDecision(channel.mode, value.operation, value.evidence) !== 'blocked', 'EVIDENCE_REQUIRED');
    if (value.operation === 'retry_delivery') {
      const record = [...state.evidence].reverse().find(e => e.entityID === value.messageID && e.agentId === value.target && e.channel === channel.id);
      check(!!record && record.id === value.recoveryEvidenceID && ['unadmitted', 'native_idempotent'].includes(record.kind), 'EVIDENCE_REQUIRED');
      check(record.kind !== 'native_idempotent' || record.admissionID === value.admissionID, 'ADMISSION_KEY_REQUIRED');
    }
  };

  switch (command.op) {
    case 'channel.configure':
      operator();
      for (const field of ['mode', 'electionsEnabled', 'capacity']) if (command[field] !== undefined) channel[field] = command[field];
      channel.policyRevision++;
      if (!channel.electionsEnabled && channel.election) { emit('election.cancelled', channel.election.id); channel.election = null; }
      emit('channel.configured'); break;
    case 'master.volunteer':
      participant();
      channel.volunteers = channel.volunteers.filter(id => id !== actor.agentId);
      if (command.eligible) channel.volunteers.push(actor.agentId);
      else {
        if (channel.active?.agentId === actor.agentId) { emit('master.ended', channel.active.id, channel.active.generation); channel.active = null; }
        if (channel.proposal?.agentId === actor.agentId) { emit('master.ended', channel.proposal.id, channel.proposal.generation); channel.proposal = null; }
      }
      emit('master.volunteered'); break;
    case 'master.appoint':
      operator(); propose(command.id, command.candidate, 'appointment'); break;
    case 'master.accept': {
      participant(); const proposal = channel.proposal;
      check(proposal?.id === command.proposalID && proposal.agentId === actor.agentId && proposal.acceptBy > now, 'STALE_PROPOSAL');
      check(channel.volunteers.includes(actor.agentId), 'VOLUNTEER_REQUIRED');
      if (channel.active) emit('master.ended', channel.active.id, channel.active.generation);
      channel.active = { ...proposal, expiresAt: now + MASTER_LEASE_MS }; channel.proposal = null;
      emit('master.activated', proposal.id, proposal.generation); break;
    }
    case 'master.renew':
      check(actor.kind === 'adapter', 'ADAPTER_REQUIRED'); member(actor.agentId, true);
      check(channel.active?.agentId === actor.agentId && channel.active.generation === command.generation, 'STALE_MASTER');
      channel.active.expiresAt = now + MASTER_LEASE_MS;
      emit('master.renewed', channel.active.id, channel.active.generation, false); break;
    case 'master.resign':
      master(command.generation); emit('master.ended', channel.active.id, command.generation); channel.active = null; break;
    case 'master.revoke':
      operator(); if (channel.active) emit('master.ended', channel.active.id, channel.active.generation);
      if (channel.proposal) emit('master.ended', channel.proposal.id, channel.proposal.generation);
      if (channel.election) emit('election.cancelled', channel.election.id);
      channel.active = null; channel.proposal = null; channel.election = null; emit('master.revoked'); break;
    case 'member.departed':
      scheduler(); channel.volunteers = channel.volunteers.filter(id => id !== command.agentId);
      if (channel.active?.agentId === command.agentId) { emit('master.ended', channel.active.id, channel.active.generation); channel.active = null; }
      if (channel.proposal?.agentId === command.agentId) { emit('master.ended', channel.proposal.id, channel.proposal.generation); channel.proposal = null; }
      emit('member.departed'); break;
    case 'election.start': {
      participant(); check(channel.electionsEnabled, 'ELECTIONS_DISABLED');
      check(!channel.active && !channel.proposal && !channel.election, 'MASTER_SELECTION_IN_PROGRESS');
      const electorate = members.filter(m => m.channel === channel.id && m.connected).map(m => m.agentId);
      check(new Set(electorate).size === electorate.length && electorate.length <= 32, 'INVALID_ELECTORATE');
      const candidates = channel.volunteers.filter(id => electorate.includes(id)); check(candidates.length > 0, 'NO_CANDIDATES');
      channel.election = { id: command.id, startedAt: now, deadline: now + ELECTION_TIMEOUT_MS, electorate, candidates, ballots: {} };
      emit('election.started', command.id); break;
    }
    case 'election.vote': {
      participant(); const election = channel.election;
      check(election?.id === command.electionID && election.deadline > now, 'STALE_ELECTION');
      check(election.electorate.includes(actor.agentId) && election.candidates.includes(command.candidate), 'INVALID_BALLOT');
      member(command.candidate, true); check(channel.volunteers.includes(command.candidate), 'VOLUNTEER_REQUIRED');
      check(!Object.hasOwn(election.ballots, actor.agentId), 'BALLOT_ALREADY_CAST');
      election.ballots[actor.agentId] = command.candidate; emit('election.voted', election.id); settleElection(); break;
    }
    case 'action.request': {
      master(command.generation); member(command.target);
      const status = actionDecision(channel.mode, command.operation, command.evidence); check(status !== 'blocked', 'EVIDENCE_REQUIRED');
      if (command.operation === 'retry_delivery') {
        check(!!command.messageID, 'MESSAGE_REQUIRED');
        if (command.evidence === 'native_idempotent') check(!!command.admissionID, 'ADMISSION_KEY_REQUIRED');
        const record = [...state.evidence].reverse().find(e => e.entityID === command.messageID && e.agentId === command.target && e.channel === channel.id);
        check(!!record && record.id === command.evidenceID && record.kind === (command.evidence === 'known_unadmitted' ? 'unadmitted' : 'native_idempotent'), 'EVIDENCE_REQUIRED');
        check(record.kind !== 'native_idempotent' || record.admissionID === command.admissionID, 'ADMISSION_KEY_REQUIRED');
      }
      if (command.operation === 'change_wake_policy') check(!!command.wakePolicy, 'WAKE_POLICY_REQUIRED');
      state.actions.push({ id: command.id, channel: channel.id, requester: actor.agentId, generation: command.generation,
        policyRevision: channel.policyRevision, operation: command.operation, target: command.target, evidence: command.evidence,
        ...(command.messageID ? { messageID: command.messageID } : {}), ...(command.admissionID ? { admissionID: command.admissionID } : {}),
        ...(command.wakePolicy ? { wakePolicy: command.wakePolicy } : {}), status, createdAt: now });
      if (command.evidenceID) state.actions.at(-1).recoveryEvidenceID = command.evidenceID;
      emit('action.requested', command.id, command.generation); break;
    }
    case 'action.approve': {
      operator(); const value = action(); check(value.status === 'awaiting_approval', 'ACTION_NOT_PENDING');
      // Human approval cannot resurrect stale generations; approving a changed policy refreshes only this explicit request.
      check(channel.active?.generation === value.generation && channel.active.agentId === value.requester, 'STALE_MASTER');
      value.policyRevision = channel.policyRevision; currentAction(value);
      value.status = 'approved'; value.approvedAt = now; emit('action.approved', value.id, value.generation); break;
    }
    case 'action.reject': {
      operator(); const value = action(); check(['awaiting_approval', 'approved'].includes(value.status), 'ACTION_NOT_PENDING');
      value.status = 'rejected'; emit('action.rejected', value.id); break;
    }
    case 'action.begin': {
      scheduler(); const value = action(); currentAction(value); check(value.status === 'approved', 'ACTION_NOT_APPROVED');
      check(channel.mode !== 'approval' || value.approvedAt !== undefined, 'HUMAN_APPROVAL_REQUIRED');
      value.status = 'executing'; emit('action.executing', value.id, value.generation); break;
    }
    case 'action.revalidate': {
      scheduler(); const value = action(); currentAction(value);
      check(value.status === 'executing', 'ACTION_NOT_EXECUTING');
      check(channel.mode !== 'approval' || value.approvedAt !== undefined, 'HUMAN_APPROVAL_REQUIRED'); break;
    }
    case 'action.reconcile': {
      scheduler(); const value = action(); check(value.status === 'executing', 'ACTION_NOT_EXECUTING');
      check(['pause_delivery', 'resume_delivery', 'cancel_queued'].includes(value.operation), 'CONTROL_OPERATION_DISABLED');
      value.status = command.outcome; value.evidenceID = command.evidenceID;
      emit(`action.${command.outcome}`, value.id);
      if (command.outcome === 'uncertain') incident('admission', value.id); break;
    }
    case 'action.finish': {
      check(actor.kind === 'adapter', 'ADAPTER_REQUIRED'); const value = action();
      check(value.target === actor.agentId && value.status === 'executing', 'ACTION_NOT_EXECUTING');
      value.status = command.outcome; value.evidenceID = command.evidenceID; emit(`action.${command.outcome}`, value.id);
      if (command.outcome === 'uncertain') incident('admission', value.id); break;
    }
    case 'incident.open':
      if (actor.kind !== 'operator' && actor.kind !== 'scheduler') member(actor.agentId);
      incident(command.category, command.entityID); break;
    case 'incident.resolve': {
      manager(command.generation); const value = state.incidents.find(i => i.id === command.incidentID && i.channel === channel.id);
      check(value?.status === 'open', 'INCIDENT_NOT_OPEN');
      check(state.evidence.some(e => e.id === command.evidenceID && e.channel === channel.id && [value.id, value.entityID].includes(e.entityID)), 'INCIDENT_EVIDENCE_REQUIRED');
      value.status = 'resolved'; value.resolvedAt = now; value.evidenceID = command.evidenceID;
      emit('incident.resolved', value.id); break;
    }
    case 'task.create': {
      manager(command.generation);
      check(new Set(command.dependencies).size === command.dependencies.length, 'DUPLICATE_DEPENDENCY');
      check(command.dependencies.every(id => state.tasks.some(t => t.id === id && t.channel === channel.id)), 'UNKNOWN_DEPENDENCY');
      check(!command.deadlineAt || command.deadlineAt > now, 'DEADLINE_IN_PAST');
      state.tasks.push({ id: command.id, channel: channel.id, title: command.title, instructions: command.instructions, criteria: command.criteria,
        dependencies: command.dependencies, priority: command.priority, status: 'open', createdAt: now,
        ...(command.schedule ? { schedule: command.schedule } : {}), ...(command.deadlineAt ? { deadlineAt: command.deadlineAt } : {}),
        progressTimeoutMs: command.progressTimeoutMs, requiresWorktree: command.requiresWorktree, claimant: null, attempt: 0, claimGeneration: 0, admission: 'none', deadlineIncident: false });
      emit('task.created', command.id); break;
    }
    case 'task.claim': {
      const entry = participant(), value = task();
      check(entry.harness !== 'claude', 'HARNESS_EXECUTION_DEFERRED');
      check(value.status === 'open', 'TASK_ALREADY_CLAIMED');
      value.claimant = actor.agentId; value.status = 'claimed'; value.claimGeneration++; emit('task.claimed', value.id); break;
    }
    case 'task.release': {
      participant(); const value = task();
      check(!transitionPending(value.id), 'WORKTREE_TRANSITION_UNRESOLVED');
      check(value.claimant === actor.agentId && value.status === 'claimed' && ['none', 'unadmitted'].includes(value.admission), 'EXECUTION_MAY_BE_ACTIVE');
      value.claimant = null; value.status = 'open'; value.admission = 'none';
      delete value.stoppedEvidence; delete value.receiptID; delete value.dispatchIntentID;
      delete value.executionScope;
      delete value.nativeAdmissionID;
      emit('task.released', value.id); break;
    }
    case 'task.prepare': {
      scheduler(); const value = task(); member(value.claimant, true);
      check(!transitionPending(value.id), 'WORKTREE_TRANSITION_UNRESOLVED');
      check(value.status === 'claimed', 'TASK_NOT_CLAIMED');
      check(!state.tasks.some(t => t.id !== value.id && t.claimant === value.claimant && occupiesSlot(t)), 'CONVERSATION_CAPACITY');
      const capability = [...state.evidence].reverse().find(e => e.channel === channel.id && e.entityID === value.id && e.agentId === value.claimant && e.kind === 'capability');
      check(!!capability && capability.id === command.capabilityEvidenceID && now - capability.at <= 300000, 'VERIFIED_CAPABILITY_REQUIRED');
      const runtime = [...state.evidence].reverse().find(e => e.agentId === value.claimant && ['idle', 'busy'].includes(e.kind));
      check(runtime?.kind === 'idle' && runtime.channel === channel.id && now - runtime.at <= 10000, 'IDLE_EVIDENCE_REQUIRED');
      if (value.requiresWorktree) {
        check(capability.sameConversationWorktree === true, 'WORKTREE_CAPABILITY_REQUIRED');
        const preview = [...state.previews].reverse().find(p => p.taskID === value.id && p.agentId === value.claimant);
        check(preview?.approved === true && preview.claimGeneration === value.claimGeneration, 'WORKTREE_PREVIEW_APPROVAL_REQUIRED');
      }
      check(value.dependencies.every(id => state.tasks.find(t => t.id === id)?.status === 'completed'), 'DEPENDENCIES_NOT_COMPLETE');
      check(state.tasks.filter(t => t.channel === channel.id && occupiesSlot(t)).length < channel.capacity, 'CHANNEL_CAPACITY');
      check(!value.deadlineAt || now < value.deadlineAt, 'DEADLINE_EXPIRED');
      if (value.schedule) {
        check(now >= value.schedule.at, 'TASK_NOT_DUE');
        if (now > value.schedule.at + value.schedule.maxLatenessMs) {
          check(value.missedDecision === 'run' || value.schedule.missed === 'run_late', 'MISSED_SCHEDULE_DECISION_REQUIRED');
        }
        check(value.missedDecision !== 'skip', 'TASK_SKIPPED');
      }
      // This is only a durable dispatch intent. An executor must verify capability evidence and an approved location preview.
      value.attempt++; value.status = 'dispatching'; value.admission = 'none'; value.dispatchIntentID = command.id;
      if (command.cwd && command.scopeDigest) {
        value.executionScope = { cwd: command.cwd, digest: command.scopeDigest };
        value.nativeAdmissionID = `msg_turnlink_task_${createHash('sha256').update(command.id).digest('hex')}`;
      }
      else { delete value.executionScope; delete value.nativeAdmissionID; }
      delete value.stoppedEvidence; delete value.receiptID; value.lastProgressAt = now; value.deadlineIncident = false;
      emit('task.dispatching', value.id); break;
    }
    case 'evidence.record': {
      check(actor.kind === 'adapter', 'ADAPTER_REQUIRED'); member(actor.agentId);
      if (command.kind === 'artifact') {
        const value = state.tasks.find(t => t.id === command.entityID && t.channel === channel.id);
        check(value?.claimant === actor.agentId && value.attempt === command.attempt && ['running', 'uncertain', 'review'].includes(value.status), 'STALE_ARTIFACT_EVIDENCE');
        if (command.artifact) check(actor.agentId === `${command.artifact.harness}:${command.artifact.sessionID}`, 'ARTIFACT_IDENTITY_MISMATCH');
        if (command.artifact && value.nativeAdmissionID) check(command.artifact.fromMessageID === value.nativeAdmissionID, 'ARTIFACT_IDENTITY_MISMATCH');
      }
      check(!command.artifact || command.kind === 'artifact', 'INVALID_ARTIFACT_EVIDENCE');
      state.evidence.push({ id: command.id, channel: channel.id, entityID: command.entityID, agentId: actor.agentId, kind: command.kind, at: now,
        ...(command.attempt !== undefined ? { attempt: command.attempt } : {}), ...(command.admissionID ? { admissionID: command.admissionID } : {}),
        ...(command.sameConversationWorktree !== undefined ? { sameConversationWorktree: command.sameConversationWorktree } : {}),
        ...(command.artifact ? { artifact: command.artifact } : {}) });
      emit('evidence.recorded', command.id); break;
    }
    case 'worktree.preview': {
      check(actor.kind === 'adapter', 'ADAPTER_REQUIRED'); const value = task();
      check(!transitionPending(value.id), 'WORKTREE_TRANSITION_UNRESOLVED');
      check(value.claimant === actor.agentId && value.status === 'claimed', 'TASK_NOT_CLAIMED');
      if (command.binding) check(command.binding.harness === member(actor.agentId).harness, 'HARNESS_BINDING_MISMATCH');
      check(command.from !== command.to, 'WORKTREE_MUST_DIFFER');
      state.previews.push({ id: command.id, channel: channel.id, taskID: value.id, agentId: actor.agentId, from: command.from, to: command.to,
        configurationDigest: command.configurationDigest, approved: false, at: now, claimGeneration: value.claimGeneration,
        ...(command.binding ? { binding: command.binding } : {}) });
      emit('worktree.previewed', command.id); break;
    }
    case 'worktree.approve': {
      operator(); const value = task();
      check(!transitionPending(value.id), 'WORKTREE_TRANSITION_UNRESOLVED');
      const preview = [...state.previews].reverse().find(p => p.taskID === value.id && p.agentId === value.claimant);
      check(preview?.id === command.previewID && value.status === 'claimed' && preview.claimGeneration === value.claimGeneration, 'STALE_WORKTREE_PREVIEW');
      preview.approved = true; emit('worktree.approved', preview.id); break;
    }
    case 'worktree.begin': {
      check(actor.kind === 'adapter', 'ADAPTER_REQUIRED'); const value = task(); member(actor.agentId, true);
      check(value.claimant === actor.agentId && value.status === 'claimed' && value.claimGeneration === command.claimGeneration, 'STALE_TASK_CLAIM');
      check(!state.transitions.some(t => t.agentId === actor.agentId && ['prepared', 'uncertain'].includes(t.status)), 'WORKTREE_TRANSITION_UNRESOLVED');
      check(!state.tasks.some(t => t.claimant === actor.agentId && occupiesSlot(t)), 'CONVERSATION_CAPACITY');
      const preview = [...state.previews].reverse().find(p => p.taskID === value.id && p.agentId === actor.agentId);
      check(preview?.id === command.previewID && preview.approved && preview.claimGeneration === value.claimGeneration && preview.binding, 'STALE_WORKTREE_PREVIEW');
      check(!state.transitions.some(t => t.previewID === preview.id), 'WORKTREE_PREVIEW_CONSUMED');
      check(preview.configurationDigest === command.configurationDigest, 'CONFIGURATION_CHANGED');
      check(preview.binding.sourceAuthorityDigest === command.authorityDigest && preview.binding.destinationAuthorityDigest === command.authorityDigest, 'PERMISSION_PRESERVATION_REQUIRED');
      const capability = [...state.evidence].reverse().find(e => e.entityID === value.id && e.agentId === actor.agentId && e.channel === channel.id && e.kind === 'capability');
      check(capability?.sameConversationWorktree === true && now - capability.at <= 300000, 'WORKTREE_CAPABILITY_REQUIRED');
      const runtime = [...state.evidence].reverse().find(e => e.agentId === actor.agentId && ['idle', 'busy'].includes(e.kind));
      check(runtime?.kind === 'idle' && runtime.channel === channel.id && now - runtime.at <= 10000, 'IDLE_EVIDENCE_REQUIRED');
      state.transitions.push({ id: command.id, channel: channel.id, taskID: value.id, agentId: actor.agentId, previewID: preview.id,
        claimGeneration: value.claimGeneration, from: preview.from, to: preview.to, configurationDigest: preview.configurationDigest,
        authorityDigest: command.authorityDigest, status: 'prepared', preparedAt: now });
      emit('worktree.prepared', command.id); break;
    }
    case 'worktree.settle': {
      check(actor.kind === 'adapter', 'ADAPTER_REQUIRED'); member(actor.agentId);
      const value = state.transitions.find(t => t.id === command.transitionID && t.channel === channel.id && t.agentId === actor.agentId);
      check(value && ['prepared', 'uncertain'].includes(value.status), 'WORKTREE_TRANSITION_NOT_PENDING');
      const claimed = state.tasks.find(t => t.id === value.taskID);
      check(claimed.claimant === actor.agentId && claimed.claimGeneration === value.claimGeneration, 'STALE_TASK_CLAIM');
      if (command.outcome !== 'uncertain') {
        check(command.configurationDigest === value.configurationDigest && command.authorityDigest === value.authorityDigest, 'CONFIGURATION_CHANGED');
        check(command.actualLocation === (command.outcome === 'moved' ? value.to : value.from), 'UNEXPECTED_WORKTREE_LOCATION');
      }
      Object.assign(value, { status: command.outcome, actualLocation: command.actualLocation, receiptID: command.receiptID, settledAt: now });
      emit(`worktree.${command.outcome}`, value.id);
      if (command.outcome === 'uncertain') incident('capability', value.id); break;
    }
    case 'task.admission': {
      const value = task(); adapter(value);
      const recovering = value.status === 'uncertain' && !!value.executionScope && !value.stoppedEvidence && command.outcome === 'admitted' && command.admissionID === value.nativeAdmissionID;
      check(value.status === 'dispatching' || recovering, 'TASK_NOT_DISPATCHING');
      if (value.executionScope) check(command.admissionID === value.nativeAdmissionID, 'ADMISSION_KEY_REQUIRED');
      value.admission = command.outcome; value.receiptID = command.receiptID;
      if (recovering) value.status = 'dispatching';
      state.evidence.push({ id: command.receiptID, channel: channel.id, entityID: value.id, agentId: actor.agentId, kind: command.outcome, at: now, attempt: value.attempt });
      if (command.outcome === 'unadmitted') value.status = 'claimed';
      if (command.outcome === 'uncertain') { value.status = 'uncertain'; incident('admission', value.id); }
      emit(`task.${command.outcome}`, value.id); break;
    }
    case 'task.started': {
      const value = task(); adapter(value); check(value.status === 'dispatching' && value.admission === 'admitted', 'ADMISSION_REQUIRED');
      state.evidence.push({ id: command.evidenceID, channel: channel.id, entityID: value.id, agentId: actor.agentId, kind: 'started', at: now, attempt: value.attempt });
      value.status = 'running'; value.lastProgressAt = now; value.deadlineIncident = false; emit('task.started', value.id); break;
    }
    case 'task.uncertain': {
      const value = task(); adapter(value); check(['dispatching', 'running', 'uncertain'].includes(value.status), 'TASK_NOT_ACTIVE');
      value.status = 'uncertain'; incident('admission', value.id); emit('task.uncertain', value.id); break;
    }
    case 'task.progress': {
      const value = task(); adapter(value); check(value.status === 'running', 'TASK_NOT_RUNNING');
      value.lastProgressAt = now; value.deadlineIncident = false; emit('task.progress', value.id, undefined, false); break;
    }
    case 'task.stopped': {
      const value = task(); adapter(value); check(['dispatching', 'running', 'uncertain', 'review'].includes(value.status), 'TASK_NOT_ACTIVE');
      value.stoppedEvidence = command.evidenceID;
      state.evidence.push({ id: command.evidenceID, channel: channel.id, entityID: value.id, agentId: actor.agentId, kind: 'stopped', at: now, attempt: value.attempt });
      if (value.status !== 'review') value.status = 'uncertain'; emit('task.stopped', value.id); break;
    }
    case 'task.reassign': {
      check(!transitionPending(command.taskID), 'WORKTREE_TRANSITION_UNRESOLVED');
      manager(command.generation); const value = task();
      check(['claimed', 'running', 'uncertain'].includes(value.status), 'TASK_NOT_REASSIGNABLE');
      check(value.admission === 'unadmitted' || !!value.stoppedEvidence || (value.status === 'claimed' && value.admission === 'none' && !value.dispatchIntentID), 'STOP_EVIDENCE_REQUIRED');
      value.attempt++; value.claimant = null; value.status = 'open'; value.admission = 'none';
      delete value.result; delete value.stoppedEvidence; delete value.receiptID; delete value.dispatchIntentID;
      delete value.executionScope;
      delete value.nativeAdmissionID;
      emit('task.reassigned', value.id); break;
    }
    case 'task.report': {
      participant(); const value = task(); check(value.claimant === actor.agentId && (value.status === 'running' || (value.status === 'uncertain' && value.stoppedEvidence)), 'TASK_NOT_RUNNING');
      check(command.evidence.every(id => state.evidence.some(e => e.id === id && e.entityID === value.id && e.channel === channel.id && e.agentId === value.claimant && e.kind === 'artifact' && e.attempt === value.attempt)), 'ARTIFACT_EVIDENCE_REQUIRED');
      value.result = { summary: command.summary, evidence: command.evidence }; value.status = 'review'; emit('task.reported', value.id); break;
    }
    case 'task.review': {
      master(command.generation); const value = task(); check(value.status === 'review' && !!value.result, 'TASK_NOT_IN_REVIEW');
      check(!!value.stoppedEvidence, 'STOP_EVIDENCE_REQUIRED');
      check(value.result.evidence.includes(command.evidenceID), 'REVIEW_EVIDENCE_REQUIRED');
      value.status = command.accept ? 'completed' : 'claimed';
      if (!command.accept) { value.admission = 'none'; delete value.result; value.claimGeneration++; }
      emit(command.accept ? 'task.completed' : 'task.changes_requested', value.id); break;
    }
    case 'task.missed': {
      operator(); const value = task(); check(!!value.schedule && ['open', 'claimed'].includes(value.status), 'TASK_NOT_SCHEDULED');
      value.missedDecision = command.run ? 'run' : 'skip';
      if (!command.run) value.status = 'cancelled'; emit('task.missed', value.id); break;
    }
    case 'clock.tick':
      scheduler();
      for (const value of state.tasks.filter(t => t.channel === channel.id)) {
        if (['completed', 'cancelled'].includes(value.status)) continue;
        if ((value.deadlineAt && now >= value.deadlineAt) || (value.status === 'running' && now >= value.lastProgressAt + value.progressTimeoutMs)) {
          incident('deadline', value.id); value.deadlineIncident = true;
        }
        if (value.schedule && now > value.schedule.at + value.schedule.maxLatenessMs && ['open', 'claimed'].includes(value.status) && !value.missedDecision) {
          if (value.schedule.missed === 'skip') { value.missedDecision = 'skip'; value.status = 'cancelled'; emit('task.missed', value.id); }
          if (value.schedule.missed === 'ask') incident('deadline', value.id);
        }
      }
      break;
  }
  return { state: validateControlState(state), events };
}

export function readyTasks(state, channel, now) {
  return state.tasks.filter(t => t.channel === channel && t.status === 'claimed' && (!t.schedule || t.schedule.at <= now) &&
    !state.tasks.some(other => other.id !== t.id && other.claimant === t.claimant && occupiesSlot(other)) &&
    (!t.schedule || now <= t.schedule.at + t.schedule.maxLatenessMs || t.schedule.missed === 'run_late' || t.missedDecision === 'run') &&
    t.missedDecision !== 'skip' &&
    (!t.deadlineAt || t.deadlineAt > now) && t.dependencies.every(id => state.tasks.find(dep => dep.id === id)?.status === 'completed'))
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
