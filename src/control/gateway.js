import { randomUUID } from 'node:crypto';
import { ControlStore } from './store.js';
import { Command } from './contracts.js';
import { ControlError, requireControl as check } from './policy.js';
import { digest, matches } from '../config.js';
import { MAX_RESPONSE_BYTES } from '../protocol.js';
import { PARTICIPANT_OPERATIONS, OPERATOR_OPERATIONS, ADAPTER_OPERATIONS } from './operations.js';
import { BROKER_EFFECT_OPERATIONS } from './effects.js';

const participantOps = new Set(PARTICIPANT_OPERATIONS);
const operatorOps = new Set(OPERATOR_OPERATIONS);
const adapterOps = new Set(ADAPTER_OPERATIONS);
const masterOps = new Set(['action.request', 'incident.resolve', 'task.create', 'task.review', 'task.reassign']);

// All identity/clock/membership inputs below originate in the broker. No caller can provide an Actor or scheduler role.
export class ControlGateway {
  constructor({ directory, now, members, member, receiver, messages, hosts, adminDigest, options, effectsEnabled = false, worktreeGrants = false }) {
    this.store = new ControlStore(directory, options);
    Object.assign(this, { now, members, member, receiver, messages, hosts, adminDigest });
    this.effectsEnabled = effectsEnabled;
    this.worktreeGrants = worktreeGrants;
  }
  capabilities() { return { effectsEnabled: this.effectsEnabled, effectOperations: this.effectsEnabled ? BROKER_EFFECT_OPERATIONS : [], taskDispatchEnabled: false,
    worktreeGrantsEnabled: this.worktreeGrants, worktreeExecutionEnabled: false }; }
  context(actor) { return { actor, now: this.now(), members: this.members() }; }
  boundMember(principal, agentId, proof, channel) {
    try { return this.member(principal, agentId, proof, channel); }
    catch { throw new ControlError('CONTROL_ACCESS_DENIED'); }
  }
  page(values, offset = 0, limit = 30) {
    const entries = []; let bytes = 256;
    for (const entry of values.slice(offset, offset + limit)) {
      const size = Buffer.byteLength(JSON.stringify(entry));
      check(size <= MAX_RESPONSE_BYTES - 4096, 'CONTROL_ITEM_TOO_LARGE');
      if (bytes + size > MAX_RESPONSE_BYTES - 4096) break;
      entries.push(entry); bytes += size;
    }
    return { entries, next: offset + entries.length };
  }
  adapter(socket, params, channel) {
    check(!socket.principal.admin, 'ADAPTER_HOST_REQUIRED');
    const agent = this.boundMember(socket.principal, params.agentId, params.proof, channel);
    check(this.receiver(agent.agentId) === socket, 'ADAPTER_RECEIVER_REQUIRED');
    const credentialDigest = this.store.adapterDigest(socket.principal.hostId);
    check(!!credentialDigest && matches(params.credential, credentialDigest), 'ADAPTER_CREDENTIAL_REQUIRED');
    return agent;
  }
  command(socket, params, adapter = false) {
    const command = Command.parse(params.command);
    let actor;
    if (adapter) {
      const agent = this.adapter(socket, params, command.channel);
      check(adapterOps.has(command.op), 'CONTROL_OPERATION_DISABLED'); actor = { kind: 'adapter', agentId: agent.agentId };
      if (['worktree.begin', 'worktree.settle'].includes(command.op)) check(this.worktreeGrants, 'WORKTREE_GRANTS_DISABLED');
      if (command.op === 'master.renew') {
        const active = this.store.snapshot().channels.find(c => c.id === command.channel)?.active;
        check(active?.agentId === agent.agentId && this.store.offerAccepted(command.channel, agent.agentId, active.id), 'ROLE_NOTICE_NOT_ADMITTED');
      }
    } else if (socket.principal.admin) {
      check(operatorOps.has(command.op), 'CONTROL_OPERATION_DISABLED'); actor = { kind: 'operator' };
    } else {
      const agent = this.boundMember(socket.principal, params.agentId, params.proof, command.channel);
      check(participantOps.has(command.op), 'CONTROL_OPERATION_DISABLED'); actor = { kind: 'participant', agentId: agent.agentId };
      if (command.op === 'master.accept') check(this.store.offerAccepted(command.channel, agent.agentId, command.proposalID), 'ROLE_NOTICE_NOT_ADMITTED');
      if (masterOps.has(command.op)) {
        const active = this.store.snapshot().channels.find(c => c.id === command.channel)?.active;
        check(active?.agentId === agent.agentId && this.store.offerAccepted(command.channel, agent.agentId, active.id), 'ROLE_NOTICE_NOT_ADMITTED');
      }
    }
    // Models cannot invoke execution, reconciliation or adapter worktree grants; task dispatch stays disabled.
    return { ...this.store.apply(command, this.context(actor)), ...this.capabilities() };
  }
  query(socket, params) {
    const agent = socket.principal.admin ? undefined : this.boundMember(socket.principal, params.agentId, params.proof, params.channel);
    const state = this.store.snapshot(), channel = state.channels.find(c => c.id === params.channel);
    check(this.now() >= state.lastNow, 'CLOCK_REGRESSION');
    check(!!channel, 'CHANNEL_NOT_CONFIGURED');
    const verifiedActive = channel.active && channel.active.expiresAt > this.now() &&
      this.members().some(m => m.agentId === channel.active.agentId && m.channel === params.channel) &&
      this.store.offerAccepted(params.channel, channel.active.agentId, channel.active.id) ? channel.active : null;
    const master = agent && verifiedActive?.agentId === agent.agentId &&
      this.members().some(m => m.agentId === agent.agentId && m.channel === params.channel && m.connected);
    if (params.view === 'channel') {
      return { channel: { ...channel, active: verifiedActive },
        members: this.members().filter(m => m.channel === params.channel), ...this.capabilities() };
    }
    if (params.view === 'messages') {
      check(socket.principal.admin || (master && params.generation === channel.active.generation), 'MASTER_MESSAGE_ACCESS_REQUIRED');
      const result = this.page(this.messages().filter(m => m.channel === params.channel).slice().reverse(), params.offset, params.limit);
      if (result.entries.length) this.store.recordMessageAccess(params.channel, socket.principal.admin ? { kind: 'operator' } : { kind: 'participant', agentId: agent.agentId },
        result.entries.at(-1).id, this.now(), master ? channel.active.generation : undefined);
      return result;
    }
    if (params.view === 'notices') {
      const recipient = agent?.agentId || (socket.principal.admin ? params.agentId : undefined);
      check(!!recipient, 'NOTICE_RECIPIENT_REQUIRED');
      const result = this.store.notices(params.channel, recipient, { after: params.after, limit: params.limit });
      const bounded = this.page(result.entries, 0, params.limit);
      return { entries: bounded.entries, next: bounded.entries.at(-1)?.sequence ?? (params.after || 0) };
    }
    if (params.view === 'events') {
      const result = this.store.events(params.channel, { after: params.after, limit: params.limit });
      const bounded = this.page(result.entries, 0, params.limit);
      return { entries: bounded.entries, next: bounded.entries.at(-1)?.sequence ?? (params.after || 0) };
    }
    const values = state[params.view].filter(value => value.channel === params.channel);
    if (['previews', 'transitions'].includes(params.view)) return this.page(socket.principal.admin || master ? values : values.filter(v => v.agentId === agent.agentId), params.offset, params.limit);
    // Tasks/incident metadata is shared channel coordination data; action targets/evidence are visible only to the operator/master/requester.
    return this.page(params.view === 'actions' && !socket.principal.admin && !master ? values.filter(a => a.requester === agent.agentId) : values,
      params.offset, params.limit);
  }
  handle(socket, method, params) {
    try {
      if (method === 'control_info') return { version: 1, enabled: true, ...this.capabilities(), adaptersRequireEnrollment: true };
      if (method === 'control_command') return this.command(socket, params);
      if (method === 'control_adapter') return this.command(socket, params, true);
      if (method === 'control_query') return this.query(socket, params);
      if (method === 'control_notice_ack') {
        const agent = this.adapter(socket, params);
        this.store.acceptNotice(agent.channel, agent.agentId, params.id, params.receiptID, this.now());
        return { accepted: true };
      }
      check(socket.principal.admin, 'OPERATOR_REQUIRED');
      const registry = this.hosts();
      check(Object.hasOwn(registry, params.hostId), 'ENROLLED_HOST_REQUIRED');
      const host = registry[params.hostId]; check(!host.revoked, 'ENROLLED_HOST_REQUIRED');
      if (method === 'control_enroll_adapter') {
        const hash = digest(params.credential);
        check(hash !== this.adminDigest && !Object.values(this.hosts()).some(h => h.tokenHash === hash), 'SEPARATE_ADAPTER_CREDENTIAL_REQUIRED');
        this.store.enrollAdapter(params.hostId, hash, this.now()); return { enrolled: true, hostId: params.hostId };
      }
      if (method === 'control_revoke_adapter') { this.store.revokeAdapter(params.hostId, this.now()); return { revoked: true, hostId: params.hostId }; }
      throw new ControlError('CONTROL_OPERATION_DISABLED');
    } catch (error) {
      if (error.name === 'ZodError') throw error;
      // Do not send SQLite errors, filesystem paths, credentials, or request bodies to remote clients.
      throw new ControlError(error instanceof ControlError ? error.code : 'CONTROL_UNAVAILABLE');
    }
  }
  departed(agentId, channel) {
    try {
      if (!this.store.snapshot().channels.some(c => c.id === channel)) return;
      this.store.apply({ id: randomUUID(), op: 'member.departed', channel, agentId }, this.context({ kind: 'scheduler' }));
    } catch { throw new ControlError('CONTROL_UNAVAILABLE'); }
  }
  tick() {
    const state = this.store.snapshot(), now = this.now(), members = this.members();
    for (const channel of state.channels) {
      const absent = id => !members.some(m => m.agentId === id && m.channel === channel.id);
      const due = (channel.active && (channel.active.expiresAt <= now || absent(channel.active.agentId))) ||
        (channel.proposal && (channel.proposal.acceptBy <= now || absent(channel.proposal.agentId))) || channel.election?.deadline <= now ||
        state.tasks.some(t => t.channel === channel.id && !['completed', 'cancelled'].includes(t.status) &&
          ((!t.deadlineIncident && ((t.deadlineAt && t.deadlineAt <= now) || (t.status === 'running' && t.lastProgressAt + t.progressTimeoutMs <= now))) ||
          (t.schedule && ['open', 'claimed'].includes(t.status) && !t.missedDecision && t.schedule.missed !== 'run_late' &&
            t.schedule.at + t.schedule.maxLatenessMs < now && !state.incidents.some(i => i.entityID === t.id && i.status === 'open' && i.category === 'deadline'))));
      if (due) this.store.apply({ id: randomUUID(), op: 'clock.tick', channel: channel.id }, this.context({ kind: 'scheduler' }));
    }
  }
  close() { this.store.close(); }
}
