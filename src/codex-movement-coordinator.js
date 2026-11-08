import { randomUUID } from 'node:crypto';
import { AgentID } from './protocol.js';
import { UUID, WorktreeTransition } from './control/contracts.js';
import { CodexMovementCancellationReceipt } from './codex-resource-journal.js';

const unavailable = () => Object.assign(new Error('CODEX_MOVEMENT_COORDINATION_UNAVAILABLE'), { code: 'CODEX_MOVEMENT_COORDINATION_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('CODEX_MOVEMENT_COORDINATION_UNCERTAIN'), { code: 'CODEX_MOVEMENT_COORDINATION_UNCERTAIN' });

function owner({ client, native, journal, agentId, mcpTransitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(mcpTransitionID);
  if (!agentId.startsWith('codex:') || !client?.request || !journal?.exclusive || !journal?.entries ||
      journal.agentId !== agentId || client.hostId !== journal.hostId || !signal || typeof guard !== 'function' ||
      typeof native?.bindDestinationGrant !== 'function' || typeof native?.cancelDestinationGrant !== 'function' ||
      typeof native?.observeDestinationGrantCancellation !== 'function') throw unavailable();
  return () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
}

// The caller must hold the native admission fence throughout. The broker grant
// has already been approved and prepared. No movement or settlement occurs here.
export async function bindCodexDestinationMovement(args, expected) {
  const check = owner(args), grant = WorktreeTransition.parse(expected);
  return args.journal.exclusive(async () => {
    check(); let record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID);
    if (!record?.step || record.step.phase !== 'observed' || record.step.disposal || record.step.movement || grant.agentId !== args.agentId) throw unavailable();
    const page = await args.client.request('control_query', { agentId: args.agentId, channel: record.channel,
      view: 'transitions', entityID: grant.id, offset: 0, limit: 1 });
    check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1 ||
      JSON.stringify(WorktreeTransition.parse(page.entries[0])) !== JSON.stringify(grant)) throw unavailable();
    const movement = { grant, phase: 'binding' };
    record = args.journal.put({ ...record, step: { ...record.step, movement } });
    let receipt;
    try {
      receipt = await args.native.bindDestinationGrant(grant, record.plan.reservation, record.step.receipt); check();
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'bound' } } }).step.movement;
    } catch {
      if (receipt) {
        try { args.native.markCompletedDestinationBindingUncertain(grant, record.plan.reservation, record.step.receipt); }
        catch { args.native.close?.(); }
      }
      try { args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'binding_uncertain' } } }); } catch { /* original intent remains */ }
      throw uncertain();
    }
  });
}

// Observe only the recorded binding on the original live native owner. A
// missing or uncertain observation retains the hold and never replays binding.
export async function observeCodexDestinationMovementBinding(args) {
  const check = owner(args);
  if (typeof args.native.observeDestinationGrant !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); const record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement;
    if (!movement || !['binding', 'binding_uncertain'].includes(movement.phase)) throw unavailable();
    let result;
    try {
      result = await args.native.observeDestinationGrant(movement.grant, record.plan.reservation, record.step.receipt);
      check();
      if (result?.transitionId !== movement.grant.id || JSON.stringify(result.reservation) !== JSON.stringify(record.plan.reservation)) throw unavailable();
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'bound' } } }).step.movement;
    } catch {
      if (result) {
        try { args.native.markCompletedDestinationBindingUncertain(movement.grant, record.plan.reservation, record.step.receipt); }
        catch { args.native.close?.(); }
      }
      throw uncertain();
    }
  });
}

// Persist the cancellation identity before invoking native code. Neither a
// failed reply nor a failed receipt write permits cancellation to be replayed.
export async function cancelCodexDestinationMovement(args) {
  const check = owner(args);
  return args.journal.exclusive(async () => {
    check(); let record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID);
    if (record?.step?.movement?.phase !== 'bound') throw unavailable();
    const movement = { ...record.step.movement, phase: 'cancelling', cancellationID: randomUUID() };
    record = args.journal.put({ ...record, step: { ...record.step, movement } });
    try {
      const receipt = CodexMovementCancellationReceipt.parse(await args.native.cancelDestinationGrant(movement.grant, record.plan.reservation,
        record.step.receipt, movement.cancellationID));
      check();
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'cancelled', cancellationReceipt: receipt } } }).step.movement;
    } catch {
      try { args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'cancel_uncertain' } } }); } catch { /* original intent remains */ }
      throw uncertain();
    }
  });
}

// Same-owner observation only. A successor cannot infer that this owner still
// exists from the durable record, and this function never resends cancellation.
export async function observeCodexDestinationMovementCancellation(args) {
  const check = owner(args);
  return args.journal.exclusive(async () => {
    check(); const record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement;
    if (!movement || !['cancelling', 'cancel_uncertain'].includes(movement.phase)) throw unavailable();
    try {
      const receipt = CodexMovementCancellationReceipt.parse(await args.native.observeDestinationGrantCancellation(movement.grant, record.plan.reservation,
        record.step.receipt, movement.cancellationID));
      check();
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'cancelled', cancellationReceipt: receipt } } }).step.movement;
    } catch { throw uncertain(); }
  });
}

// The broker command is idempotent by its durable command ID. A lost response
// may be retried with that exact ID; it never repeats native cancellation.
export async function settleCodexDestinationCancellation(args) {
  const check = owner(args);
  if (typeof args.credential !== 'function' || (args.verifierService !== undefined &&
      typeof args.verifierService?.register !== 'function')) throw unavailable();
  return args.journal.exclusive(async () => {
    check(); let record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement;
    if (!movement || !['cancelled', 'settling', 'settlement_uncertain'].includes(movement.phase)) throw unavailable();
    if (movement.phase === 'cancelled') {
      movement = { ...movement, phase: 'settling', settlementID: randomUUID() };
      record = args.journal.put({ ...record, step: { ...record.step, movement } });
    }
    const grant = movement.grant, command = { id: movement.settlementID, op: 'worktree.settle', channel: grant.channel,
      transitionID: grant.id, outcome: 'failed', actualLocation: grant.from, configurationDigest: grant.configurationDigest,
      authorityDigest: grant.authorityDigest, receiptID: movement.settlementID, destinationCancellation: movement.cancellationReceipt };
    let unregister;
    try {
      if (args.verifierService) {
        const release = args.verifierService.register({ native: args.native,
          journal: args.journal, client: args.client, guard: check, signal: args.signal, grant });
        if (typeof release !== 'function') throw unavailable();
        unregister = release;
      }
      const key = await args.credential(); check();
      const result = await args.client.request('control_adapter', { agentId: args.agentId, credential: key, command });
      check(); if (result?.commandID !== movement.settlementID) throw unavailable();
      const page = await args.client.request('control_query', { agentId: args.agentId, channel: grant.channel,
        view: 'transitions', entityID: grant.id, offset: 0, limit: 1 });
      check();
      if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      const current = WorktreeTransition.parse(page.entries[0]);
      if (current.status !== 'failed' || current.receiptID !== movement.settlementID || current.actualLocation !== grant.from ||
          JSON.stringify(current.destinationCancellation) !== JSON.stringify(movement.cancellationReceipt) ||
          JSON.stringify(current.destinationOwners) !== JSON.stringify(grant.destinationOwners)) throw unavailable();
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'settled' } } }).step.movement;
    } catch {
      if (movement.phase === 'settling') {
        try { args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'settlement_uncertain' } } }); } catch { /* original intent remains */ }
      }
      throw uncertain();
    } finally {
      unregister?.();
    }
  });
}

// Recover only a cancellation already recorded by the prior native owner.
// The original cancellation is never reissued and resource holds remain.
export async function recoverRestoredCodexDestinationCancellation(args) {
  const { client, native, journal, agentId, mcpTransitionID, credential, signal, guard, verifierService } = args;
  AgentID.parse(agentId); UUID.parse(mcpTransitionID);
  if (!agentId.startsWith('codex:') || !client?.request || !(client.subscriptions instanceof Set) ||
      !native?.usesClient?.(client) || typeof native.observeRestoredDestinationCancellation !== 'function' ||
      !journal?.exclusive || !journal?.entries || journal.agentId !== agentId || journal.hostId !== client.hostId ||
      typeof credential !== 'function' || !signal || typeof guard !== 'function' || typeof verifierService?.register !== 'function') throw unavailable();
  const socket = client.socket, generation = client.subscriptionGenerations?.get(agentId);
  const check = () => {
    if (signal.aborted || journal.hostId !== client.hostId || client.socket !== socket || client.subscriptionGenerations?.get(agentId) !== generation || (!client.subscriptions.has(agentId) || !client.activeSubscriptions?.has(agentId)) || !native.usesClient(client)) throw unavailable();
    guard();
  };
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement;
    if (!movement || !['cancelling', 'cancel_uncertain', 'cancelled', 'settling', 'settlement_uncertain'].includes(movement.phase) ||
        !movement.cancellationID || movement.publication || !record.step.receipt) throw unavailable();
    const grant = WorktreeTransition.parse(movement.grant);
    if (grant.agentId !== agentId || grant.destinationOwners?.mcpTransitionID !== mcpTransitionID || grant.destinationOwners?.stepID !== record.step.receipt.stepID) throw unavailable();
    let unregister;
    try {
      const receipt = CodexMovementCancellationReceipt.parse(await native.observeRestoredDestinationCancellation(
        grant, record.plan.reservation, record.step.receipt, movement.cancellationID));
      check();
      if (receipt.cancellationID !== movement.cancellationID || receipt.transitionID !== grant.id || receipt.stepID !== record.step.receipt.stepID ||
          movement.cancellationReceipt && JSON.stringify(movement.cancellationReceipt) !== JSON.stringify(receipt)) throw unavailable();
      if (['cancelling', 'cancel_uncertain'].includes(movement.phase)) {
        movement = { ...movement, phase: 'cancelled', cancellationReceipt: receipt };
        record = journal.put({ ...record, step: { ...record.step, movement } }); check();
      }
      if (movement.phase === 'cancelled') {
        movement = { ...movement, phase: 'settling', settlementID: randomUUID() };
        record = journal.put({ ...record, step: { ...record.step, movement } }); check();
      }
      const command = { id: movement.settlementID, op: 'worktree.settle', channel: grant.channel,
        transitionID: grant.id, outcome: 'failed', actualLocation: grant.from, configurationDigest: grant.configurationDigest,
        authorityDigest: grant.authorityDigest, receiptID: movement.settlementID, destinationCancellation: receipt };
      unregister = verifierService.register({ native, journal, client, guard: check, signal, grant, restored: true });
      if (typeof unregister !== 'function') throw unavailable();
      const send = async () => { const key = await credential(); check(); return client.request('control_adapter', { agentId, credential: key, command }); };
      let result;
      try { result = await send(); }
      catch { check(); result = await send(); }
      check(); if (result?.commandID !== movement.settlementID) throw unavailable();
      const page = await client.request('control_query', { agentId, channel: grant.channel, view: 'transitions', entityID: grant.id, offset: 0, limit: 1 });
      check();
      if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      const current = WorktreeTransition.parse(page.entries[0]);
      if (current.status !== 'failed' || current.receiptID !== movement.settlementID || current.actualLocation !== grant.from ||
          JSON.stringify(current.destinationCancellation) !== JSON.stringify(receipt) ||
          JSON.stringify(current.destinationOwners) !== JSON.stringify(grant.destinationOwners)) throw unavailable();
      return journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'settled' } } }).step.movement;
    } catch {
      if (movement.phase === 'settling') {
        try { journal.put({ ...record, step: { ...record.step, movement: { ...movement, phase: 'settlement_uncertain' } } }); } catch { /* durable intent remains */ }
      }
      throw uncertain();
    } finally { unregister?.(); }
  });
}
