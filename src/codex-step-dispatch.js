import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AgentID } from './protocol.js';
import { Stamp, UUID, WorktreeTransition } from './control/contracts.js';
import { CodexStepPreparationReceipt, CodexStepDisposalReceipt } from './codex-resource-journal.js';

const unavailable = () => Object.assign(new Error('CODEX_STEP_PREPARATION_UNAVAILABLE'), { code: 'CODEX_STEP_PREPARATION_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('CODEX_STEP_PREPARATION_UNCERTAIN'), { code: 'CODEX_STEP_PREPARATION_UNCERTAIN' });
const disposalUncertain = () => Object.assign(new Error('CODEX_STEP_DISPOSAL_UNCERTAIN'), { code: 'CODEX_STEP_DISPOSAL_UNCERTAIN' });
const observation = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('uncertain') }),
  z.strictObject({ status: z.literal('retained'), receipt: CodexStepPreparationReceipt }),
]);

function requireOwner({ client, native, journal, agentId, signal, guard }) {
  AgentID.parse(agentId);
  if (!agentId.startsWith('codex:') || !client?.request || !journal?.exclusive || !journal?.entries || journal.agentId !== agentId ||
      native?.supportsMcpStepPreparation !== true || typeof guard !== 'function' || !signal ||
      typeof native?.markCompletedStepUncertain !== 'function') throw unavailable();
  return () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
}

// The caller holds the exact admission fence and retained native owner for the
// entire operation. The native method must recheck broker authorization before
// and after its effect and keep the resulting step unpublished.
export async function dispatchCodexDestinationStep({ client, credential, native, journal, agentId, mcpTransitionID,
  providerTransitionID, candidateId, signal, guard }) {
  UUID.parse(mcpTransitionID); UUID.parse(providerTransitionID); UUID.parse(candidateId);
  const check = requireOwner({ client, native, journal, agentId, signal, guard });
  if (typeof credential !== 'function' || typeof native?.prepareDestinationStep !== 'function' || typeof native?.preflightDestinationStep !== 'function' ||
      typeof native?.validateDestination !== 'function' || typeof native?.assertRetainedDestinationOwners !== 'function') throw unavailable();
  return journal.exclusive(async () => {
    check();
    const records = journal.entries(), mcp = records.find(value => value.transitionID === mcpTransitionID),
      provider = records.find(value => value.transitionID === providerTransitionID);
    if (!mcp || !provider || mcp.plan.kind !== 'mcp_runtime' || provider.plan.kind === 'mcp_runtime' ||
        !mcp.plan.effects.stepPreparation || mcp.step || mcp.quiescence || provider.cleanup ||
        mcp.phase !== 'settled' || provider.phase !== 'settled') throw unavailable();
    const reservation = mcp.plan.reservation, threadId = agentId.slice('codex:'.length);
    const current = async record => {
      check(); const page = await client.request('control_query', { agentId, channel: record.channel,
        view: 'transitions', entityID: record.transitionID, offset: 0, limit: 1 });
      check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      return WorktreeTransition.parse(page.entries[0]);
    };
    const mcpGrant = await current(mcp), providerGrant = await current(provider);
    const retained = () => {
      check(); native.assertRetainedDestinationOwners({ mcpGrant, providerGrant, candidateId, reservation }); check();
    };
    retained(); const key = await credential(); retained();
    const checked = await client.request('control_worktree_authorize', { agentId, channel: mcp.channel, credential: key,
      action: 'prepare-destination-step', grant: mcpGrant, peerGrant: providerGrant });
    retained();
    if (checked?.purpose !== 'prepare-destination-step' || !Stamp.safeParse(checked.checkedAt).success ||
        JSON.stringify(WorktreeTransition.parse(checked.mcpGrant)) !== JSON.stringify(mcpGrant) ||
        JSON.stringify(WorktreeTransition.parse(checked.providerGrant)) !== JSON.stringify(providerGrant)) throw unavailable();
    await native.validateDestination(threadId, reservation, candidateId); retained();
    let allowed;
    for (let attempt = 0; attempt < 3; attempt++) {
      retained();
      try {
        allowed = await native.preflightDestinationStep({ threadId, reservation, candidateId, mcpGrant, providerGrant });
        break;
      } catch (error) {
        if (error?.code !== 'NATIVE_PREFLIGHT_REFUSED') throw error;
        if (attempt === 2) throw unavailable();
        check();
        try { await delay(50 * (attempt + 1), undefined, { signal }); } catch { throw unavailable(); }
        retained();
      }
    }
    retained(); if (allowed !== true) throw unavailable();
    const step = { operationID: randomUUID(), candidateID: candidateId, checkedAt: checked.checkedAt,
      mcpGrant, providerGrant, phase: 'dispatching' };
    let record = journal.put({ ...mcp, step });
    let receipt;
    try {
      retained();
      receipt = await native.prepareDestinationStep({ threadId, reservation, candidateId, operationID: step.operationID, mcpGrant, providerGrant, guard: check });
      retained();
      receipt = CodexStepPreparationReceipt.parse(receipt);
    } catch {
      if (receipt) { try { native.markCompletedStepUncertain(step, receipt); } catch { native.close?.(); } }
      try { journal.put({ ...record, step: { ...step, phase: 'uncertain' } }); } catch { /* dispatching remains held */ }
      throw uncertain();
    }
    try { record = journal.put({ ...record, step: { ...step, phase: 'observed', receipt } }); }
    catch {
      try { native.markCompletedStepUncertain(step, receipt); } catch { native.close?.(); }
      throw uncertain();
    }
    return record.step;
  });
}

// Recover only the existing operation on the same live native owner. Native
// observation may retry it only with its live, exact pre-intent refusal proof.
// Pending or lost replies leave the original durable intent held.
export async function observeCodexDestinationStep({ client, native, journal, agentId, mcpTransitionID, signal, guard }) {
  UUID.parse(mcpTransitionID);
  const check = requireOwner({ client, native, journal, agentId, signal, guard });
  if (typeof native?.observeDestinationStep !== 'function') throw unavailable();
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === mcpTransitionID);
    if (!record?.step || !['dispatching', 'uncertain'].includes(record.step.phase)) throw unavailable();
    const step = record.step;
    let result;
    try {
      result = observation.parse(await native.observeDestinationStep({ threadId: agentId.slice('codex:'.length),
        reservation: record.plan.reservation, candidateId: step.candidateID, operationID: step.operationID,
        mcpGrant: step.mcpGrant, providerGrant: step.providerGrant, guard: check }));
      check();
    } catch { throw uncertain(); }
    if (result.status !== 'retained') {
      if (step.phase === 'dispatching') record = journal.put({ ...record, step: { ...step, phase: 'uncertain' } });
      throw uncertain();
    }
    try { return journal.put({ ...record, step: { ...step, phase: 'observed', receipt: result.receipt } }).step; }
    catch {
      try { native.markCompletedStepUncertain(step, result.receipt); } catch { native.close?.(); }
      throw uncertain();
    }
  });
}

function requireDisposalReceipt(value, step, disposalID) {
  const receipt = CodexStepDisposalReceipt.parse(value), retained = step.receipt;
  if (!retained || receipt.disposalID !== disposalID || receipt.operationID !== retained.operationID ||
      receipt.candidateID !== retained.candidateID || receipt.stepID !== retained.stepID ||
      receipt.mcpResourceID !== retained.mcpResourceID || receipt.providerResourceID !== retained.providerResourceID) throw unavailable();
  return receipt;
}

// Disposal can only consume the exact observed step, under a fresh paired-owner
// recovery authorization. The durable intent precedes the native effect.
export async function disposeCodexDestinationStep({ client, credential, native, journal, agentId, mcpTransitionID, signal, guard }) {
  UUID.parse(mcpTransitionID);
  const check = requireOwner({ client, native, journal, agentId, signal, guard });
  if (native.supportsMcpStepDisposal !== true || typeof credential !== 'function' ||
      typeof native.assertRetainedStepDisposal !== 'function' || typeof native.disposeDestinationStep !== 'function' ||
      typeof native.markCompletedStepDisposalUncertain !== 'function') throw unavailable();
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === mcpTransitionID);
    if (!record?.step || record.step.phase !== 'observed' || record.step.disposal ||
        record.step.movement && record.step.movement.phase !== 'settled') throw unavailable();
    const step = record.step, reservation = record.plan.reservation, threadId = agentId.slice('codex:'.length);
    const retained = () => { check(); native.assertRetainedStepDisposal({ threadId, reservation, step }); check(); };
    retained(); const key = await credential(); retained();
    const checked = await client.request('control_worktree_authorize', { agentId, channel: record.channel, credential: key,
      action: 'dispose-destination-step', grant: step.mcpGrant, peerGrant: step.providerGrant });
    retained();
    if (checked?.purpose !== 'dispose-destination-step' || !Stamp.safeParse(checked.checkedAt).success || checked.checkedAt < step.checkedAt ||
        JSON.stringify(WorktreeTransition.parse(checked.mcpGrant)) !== JSON.stringify(step.mcpGrant) ||
        JSON.stringify(WorktreeTransition.parse(checked.providerGrant)) !== JSON.stringify(step.providerGrant)) throw unavailable();
    const disposal = { disposalID: randomUUID(), phase: 'dispatching' };
    record = journal.put({ ...record, step: { ...step, disposal } });
    let receipt;
    try {
      retained();
      receipt = await native.disposeDestinationStep({ threadId, reservation, step, disposalID: disposal.disposalID });
      check(); receipt = requireDisposalReceipt(receipt, step, disposal.disposalID);
    } catch {
      if (receipt) { try { native.markCompletedStepDisposalUncertain(step, disposal, receipt); } catch { native.close?.(); } }
      try { journal.put({ ...record, step: { ...step, disposal: { ...disposal, phase: 'uncertain' } } }); } catch { /* intent remains held */ }
      throw disposalUncertain();
    }
    try { return journal.put({ ...record, step: { ...step, disposal: { ...disposal, phase: 'observed', receipt } } }).step.disposal; }
    catch {
      try { native.markCompletedStepDisposalUncertain(step, disposal, receipt); } catch { native.close?.(); }
      throw disposalUncertain();
    }
  });
}

// Recover only the already written disposal ID on its original live owner.
// This observes native state and never repeats the drop operation.
export async function observeCodexDestinationStepDisposal({ client, native, journal, agentId, mcpTransitionID, signal, guard }) {
  UUID.parse(mcpTransitionID);
  const check = requireOwner({ client, native, journal, agentId, signal, guard });
  if (native.supportsMcpStepDisposal !== true || typeof native.observeDestinationStepDisposal !== 'function' ||
      typeof native.markCompletedStepDisposalUncertain !== 'function') throw unavailable();
  return journal.exclusive(async () => {
    check(); const record = journal.entries().find(value => value.transitionID === mcpTransitionID), step = record?.step, disposal = step?.disposal;
    if (!disposal || !['dispatching', 'uncertain'].includes(disposal.phase)) throw unavailable();
    let result;
    try {
      result = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('pending') }),
        z.strictObject({ status: z.literal('uncertain') }), z.strictObject({ status: z.literal('disposed'), receipt: CodexStepDisposalReceipt })])
        .parse(await native.observeDestinationStepDisposal({ threadId: agentId.slice('codex:'.length), reservation: record.plan.reservation, step, disposal }));
      check(); if (result.receipt) result.receipt = requireDisposalReceipt(result.receipt, step, disposal.disposalID);
    } catch { throw disposalUncertain(); }
    if (result.status !== 'disposed') {
      if (disposal.phase === 'dispatching') journal.put({ ...record, step: { ...step, disposal: { ...disposal, phase: 'uncertain' } } });
      throw disposalUncertain();
    }
    try { return journal.put({ ...record, step: { ...step, disposal: { ...disposal, phase: 'observed', receipt: result.receipt } } }).step.disposal; }
    catch {
      try { native.markCompletedStepDisposalUncertain(step, disposal, result.receipt); } catch { native.close?.(); }
      throw disposalUncertain();
    }
  });
}
