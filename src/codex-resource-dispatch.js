import { randomUUID } from 'node:crypto';
import { AgentID } from './protocol.js';
import { Stamp, WorktreeTransition, UUID } from './control/contracts.js';
import { ProviderEstablishmentPlan } from './control/provider-establishment-contracts.js';
import { ProviderCleanupReceipt, cleanupMatchesOwner } from './control/provider-establishment-contracts.js';
import { McpEstablishmentPlan, McpQuiescence } from './control/mcp-establishment-contracts.js';
import { waitForCodexResourceApproval } from './codex-resource-approval.js';
import { compatibleResourceHold } from './control/worktree-holds.js';

const unavailable = () => Object.assign(new Error('CODEX_RESOURCE_DISPATCH_UNAVAILABLE'), { code: 'CODEX_RESOURCE_DISPATCH_UNAVAILABLE' });
const uncertain = cause => Object.assign(new Error('CODEX_RESOURCE_DISPATCH_UNCERTAIN', cause === undefined ? undefined : { cause }), { code: 'CODEX_RESOURCE_DISPATCH_UNCERTAIN' });

// Internal owner-bound dispatcher. The caller must retain the same native
// reservation and stdio fence for this whole operation and subsequent resource
// ownership. It does not perform placement or release that fence.
export async function dispatchCodexResource({ client, credential, native, journal, agentId, channel, taskID, claimGeneration, plan, reservation, signal, guard, pollMs = 500, validateProject }) {
  AgentID.parse(agentId); UUID.parse(taskID);
  const isMcp = plan?.kind === 'mcp_runtime', selected = isMcp ? McpEstablishmentPlan.parse(plan) : ProviderEstablishmentPlan.parse(plan);
  // A binding-capture disclosure is not executable until the native owner
  // implements and advertises that exact effect under the journaled grant.
  if (isMcp && selected.effects.bindingCapture && native?.supportsMcpBindingCapture !== true) throw unavailable();
  if (isMcp && selected.effects.pluginCapture && native?.supportsMcpPluginCapture !== true) throw unavailable();
  if (isMcp && selected.effects.skillCapture && native?.supportsMcpSkillCapture !== true) throw unavailable();
  if (isMcp && selected.effects.stepPreparation && native?.supportsMcpStepPreparation !== true) throw unavailable();
  if (!agentId.startsWith('codex:') || selected.agentId !== agentId || JSON.stringify(selected.reservation) !== JSON.stringify(reservation) ||
      !client?.request || typeof credential !== 'function' || typeof guard !== 'function' || !signal ||
      (validateProject !== undefined && typeof validateProject !== 'function') ||
      typeof journal?.exclusive !== 'function' || typeof journal?.entries !== 'function' || journal.agentId !== agentId ||
      !native || typeof native.assertRetainedResourcePlan !== 'function' || typeof native.markConstructedResourceUncertain !== 'function' ||
      typeof (isMcp ? native.constructMcp : native.constructProvider) !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  const checkPlan = () => { check(); native.assertRetainedResourcePlan(selected, reservation); check(); };
  const purpose = isMcp ? 'establish-mcp' : 'establish-provider';
  const send = async command => {
    check(); const key = await credential(); check();
    const reply = await client.request('control_adapter', { agentId, credential: key, command }); check();
    if (reply?.commandID !== command.id) throw unavailable();
  };
  return journal.exclusive(async () => {
    checkPlan();
    const entries = journal.entries(), previous = entries.find(r => r.plan.id === selected.id);
    const candidate = { taskID, agentId, channel, claimGeneration, from: selected.from, to: selected.to, purpose,
      ...(isMcp ? { mcpPlan: selected } : { providerPlan: selected }) };
    if (entries.some(r => r !== previous && !['abandoned', 'aborted'].includes(r.phase) && (r.phase !== 'settled' || !compatibleResourceHold({ ...r.grant,
      status: 'established', resourceReceipt: r.receipt }, candidate))) || (previous &&
        (!['previewing', 'previewed', 'authorizing', 'prepared'].includes(previous.phase) || previous.taskID !== taskID ||
         previous.channel !== channel || previous.claimGeneration !== claimGeneration || JSON.stringify(previous.plan) !== JSON.stringify(selected)))) throw unavailable();
    let record = previous ?? journal.put({ taskID, claimGeneration, previewID: randomUUID(), transitionID: randomUUID(), receiptID: randomUUID(), channel, plan: selected, phase: 'previewing' });
    if (record.phase === 'previewing') {
      checkPlan();
      await send({ id: record.previewID, op: 'worktree.preview', channel, taskID, from: selected.from, to: selected.to,
        configurationDigest: selected.digest, purpose, ...(isMcp ? { mcpPlan: selected } : { providerPlan: selected }) });
      record = journal.put({ ...record, phase: 'previewed' });
    }
    if (['previewed', 'authorizing'].includes(record.phase)) {
      checkPlan();
      await waitForCodexResourceApproval({ client, agentId, channel, taskID, claimGeneration, previewID: record.previewID, plan: selected, signal, guard, pollMs });
      checkPlan();
      await send({ id: randomUUID(), op: 'evidence.record', channel, entityID: taskID, kind: 'capability',
        nativeProviderFactory: !isMcp, nativeMcpRuntime: isMcp });
      await send({ id: randomUUID(), op: 'evidence.record', channel, entityID: taskID, kind: 'idle' });
      if (record.phase === 'previewed') record = journal.put({ ...record, phase: 'authorizing' });
      checkPlan();
      await send({ id: record.transitionID, op: 'worktree.begin', channel, taskID, previewID: record.previewID, claimGeneration,
        configurationDigest: selected.digest, purpose });
      checkPlan();
      const page = await client.request('control_query', { agentId, channel, view: 'transitions', entityID: record.transitionID, offset: 0, limit: 1 });
      checkPlan(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      const grant = WorktreeTransition.parse(page.entries[0]);
      record = journal.put({ ...record, phase: 'prepared', grant });
    }
    checkPlan(); if (validateProject) { await validateProject(); checkPlan(); }
    const grant = record.grant;
    record = journal.put({ ...record, phase: 'dispatching' });
    let receipt;
    try {
      check(); receipt = await (isMcp ? native.constructMcp(grant, reservation) : native.constructProvider(grant, reservation)); check();
    } catch (error) {
      if (receipt) {
        try { native.markConstructedResourceUncertain(grant, reservation, receipt); }
        catch { native.close?.(); }
      }
      journal.put({ ...record, phase: 'uncertain' }); throw uncertain(error);
    }
    const settlement = { id: record.receiptID, op: 'worktree.settle', channel, transitionID: record.transitionID, purpose,
      outcome: 'established', actualLocation: selected.from, configurationDigest: selected.digest, receiptID: record.receiptID, resourceReceipt: receipt };
    try { record = journal.put({ ...record, phase: 'observed', receipt, settlement }); }
    catch (error) {
      try { native.markConstructedResourceUncertain(grant, reservation, receipt); }
      catch { native.close?.(); }
      throw error;
    }
    await send(settlement);
    record = journal.put({ ...record, phase: 'settled' });
    return { grant, receipt, transitionID: record.transitionID };
  });
}

// Retry only the durable broker acknowledgement, never the native effect.
export async function reconcileCodexResourceSettlement({ client, credential, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!client?.request || typeof credential !== 'function' || typeof guard !== 'function' || !signal ||
      typeof journal?.exclusive !== 'function' || typeof journal?.entries !== 'function' || journal.agentId !== agentId) throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record || !['observed', 'settled', 'uncertain'].includes(record.phase) || !record.settlement) throw unavailable();
    if (record.phase === 'settled') return record;
    const key = await credential(); check();
    const reply = await client.request('control_adapter', { agentId, credential: key, command: record.settlement });
    check(); if (reply?.commandID !== record.settlement.id) throw unavailable();
    return record.phase === 'uncertain' ? record : journal.put({ ...record, phase: 'settled' });
  });
}

// A successor only retries the recorded broker settlement after the reopened
// native thread independently observes the exact effect-free release. It never
// sends a begin command, reconstructs a resource, or releases a receiver.
export async function reconcileCodexUnstartedGrant({ client, credential, native, journal, agentId, taskID, claimGeneration, destination, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(taskID);
  if (!agentId.startsWith('codex:') || !client?.request || typeof credential !== 'function' ||
      typeof native?.observeRestoredAbandonment !== 'function' || !native?.usesClient?.(client) ||
      journal?.agentId !== agentId || client.hostId !== journal.hostId || !journal?.exclusive || !signal || typeof guard !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId || !native.usesClient(client)) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const records = journal.entries(), active = records.filter(value => !['abandoned', 'aborted'].includes(value.phase));
    if (active.length !== 1 || !['previewing', 'previewed', 'prepared', 'aborting'].includes(active[0].phase)) throw unavailable();
    let record = active[0];
    if (record.taskID !== taskID || record.claimGeneration !== claimGeneration || record.plan.to !== destination) throw unavailable();
    const observeNative = async () => {
      check(); const result = await native.observeRestoredAbandonment(agentId.slice(6), record.plan.reservation); check();
      if (result?.abandoned !== true || JSON.stringify(result.reservation) !== JSON.stringify(record.plan.reservation)) throw unavailable();
    };
    const readGrant = async () => {
      check(); const page = await client.request('control_query', { agentId, channel: record.channel,
        view: 'transitions', entityID: record.transitionID, offset: 0, limit: 1 });
      check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      return WorktreeTransition.parse(page.entries[0]);
    };
    const isSettled = current => {
      if (current.status !== 'failed' || !Stamp.safeParse(current.settledAt).success) return false;
      const expected = WorktreeTransition.parse({ ...record.grant, status: 'failed', actualLocation: record.plan.from,
        receiptID: record.receiptID, settledAt: current.settledAt });
      return JSON.stringify(current) === JSON.stringify(expected);
    };
    await observeNative();
    if (['previewing', 'previewed'].includes(record.phase)) {
      // No begin could be sent before the durable authorizing marker.
      await observeNative();
      return journal.put({ ...record, phase: 'abandoned' });
    }
    let current = await readGrant();
    if (record.phase === 'prepared') {
      // A prepared host record has not dispatched native construction. The
      // independent released reservation proves abandonment completed before
      // the host could record its settlement intent.
      if (JSON.stringify(current) !== JSON.stringify(record.grant)) throw unavailable();
      const settlement = { id: record.receiptID, op: 'worktree.settle', channel: record.channel,
        transitionID: record.transitionID, purpose: record.grant.purpose, outcome: 'failed', actualLocation: record.plan.from,
        configurationDigest: record.plan.digest, receiptID: record.receiptID };
      record = journal.put({ ...record, phase: 'aborting', settlement }); check();
    }
    if (!isSettled(current)) {
      if (JSON.stringify(current) !== JSON.stringify(record.grant)) throw unavailable();
      const key = await credential(); check();
      try {
        const reply = await client.request('control_adapter', { agentId, credential: key, command: record.settlement });
        check(); if (reply?.commandID !== record.settlement.id) throw unavailable();
      } catch { check(); }
      current = await readGrant();
      if (!isSettled(current)) throw uncertain();
    }
    await observeNative();
    return journal.put({ ...record, phase: 'aborted' });
  });
}

// On the same fenced owner, an established MCP can coexist with an unstarted
// provider grant. Resolve only the provider's pre-dispatch broker state; MCP
// shutdown and physical reconciliation remain separate and retain their hold.
export async function abortCodexUnstartedProvider({ client, credential, native, journal, agentId, mcpTransitionID, plan, reservation, signal, guard, restored = false }) {
  AgentID.parse(agentId); UUID.parse(mcpTransitionID);
  const selected = ProviderEstablishmentPlan.parse(plan);
  if (!agentId.startsWith('codex:') || selected.agentId !== agentId || JSON.stringify(selected.reservation) !== JSON.stringify(reservation) ||
      !client?.request || typeof credential !== 'function' || journal?.agentId !== agentId || client.hostId !== journal.hostId ||
      !journal?.exclusive || !signal || typeof guard !== 'function' || typeof restored !== 'boolean' ||
      (restored && (!native?.usesClient?.(client) || typeof native?.observeRestoredUnstartedProvider !== 'function'))) throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId || restored && !native.usesClient(client)) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const entries = journal.entries(), mcp = entries.find(value => value.transitionID === mcpTransitionID);
    let record = entries.find(value => value.plan.id === selected.id);
    if (!mcp || mcp.plan.kind !== 'mcp_runtime' || mcp.phase !== 'settled' || mcp.step || (!restored && mcp.quiescence) ||
        JSON.stringify(mcp.plan.reservation) !== JSON.stringify(reservation)) throw unavailable();
    if (!record) return undefined;
    if (JSON.stringify(record.plan) !== JSON.stringify(selected) || !['previewing', 'previewed', 'authorizing', 'prepared', 'aborting', 'aborted', 'abandoned'].includes(record.phase)) throw unavailable();
    const observe = async () => {
      if (!restored) return;
      check(); const proof = await native.observeRestoredUnstartedProvider(agentId.slice(6), reservation, mcp.receipt); check();
      if (proof?.providerUnstarted !== true || JSON.stringify(proof.reservation) !== JSON.stringify(reservation) ||
          JSON.stringify(proof.mcpReceipt) !== JSON.stringify(mcp.receipt)) throw unavailable();
    };
    await observe();
    if (['aborted', 'abandoned'].includes(record.phase)) { await observe(); return record; }
    if (['previewing', 'previewed'].includes(record.phase)) { await observe(); return journal.put({ ...record, phase: 'abandoned' }); }
    const read = async () => {
      check(); const page = await client.request('control_query', { agentId, channel: record.channel, view: 'transitions', entityID: record.transitionID, offset: 0, limit: 1 });
      check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      return WorktreeTransition.parse(page.entries[0]);
    };
    let current = await read();
    if (record.phase === 'authorizing') {
      if (current.status !== 'prepared') throw unavailable();
      record = journal.put({ ...record, phase: 'prepared', grant: current });
    }
    if (record.phase === 'prepared') {
      if (JSON.stringify(current) !== JSON.stringify(record.grant)) throw unavailable();
      const settlement = { id: record.receiptID, op: 'worktree.settle', channel: record.channel, transitionID: record.transitionID,
        purpose: record.grant.purpose, outcome: 'failed', actualLocation: selected.from, configurationDigest: selected.digest, receiptID: record.receiptID };
      record = journal.put({ ...record, phase: 'aborting', settlement });
    }
    const settled = value => {
      if (value.status !== 'failed' || !Stamp.safeParse(value.settledAt).success) return false;
      const expected = WorktreeTransition.parse({ ...record.grant, status: 'failed', actualLocation: selected.from,
        receiptID: record.receiptID, settledAt: value.settledAt });
      return JSON.stringify(value) === JSON.stringify(expected);
    };
    if (!settled(current)) {
      if (JSON.stringify(current) !== JSON.stringify(record.grant)) throw unavailable();
      const key = await credential(); check();
      try {
        const reply = await client.request('control_adapter', { agentId, credential: key, command: record.settlement });
        check(); if (reply?.commandID !== record.receiptID) throw unavailable();
      } catch { check(); }
      current = await read(); if (!settled(current)) throw uncertain();
    }
    await observe(); check(); return journal.put({ ...record, phase: 'aborted' });
  });
}

// Reconcile only through the same live native owner. An observed retained
// resource stays uncertain at the broker; observation is not physical cleanup.
export async function observeCodexResourceUncertainty({ client, credential, native, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!client?.request || typeof credential !== 'function' || typeof guard !== 'function' || !signal ||
      typeof journal?.exclusive !== 'function' || typeof journal?.entries !== 'function' || journal.agentId !== agentId) throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record || !['dispatching', 'uncertain'].includes(record.phase) || record.settlement) throw unavailable();
    const isMcp = record.plan.kind === 'mcp_runtime';
    if (typeof (isMcp ? native?.observeMcp : native?.observeProvider) !== 'function') throw unavailable();
    const observation = await (isMcp ? native.observeMcp(record.grant, record.plan.reservation) : native.observeProvider(record.grant, record.plan.reservation));
    check(); if (observation.status !== 'owned' || !observation.resource || observation.cleanup) throw unavailable();
    const settlement = { id: record.receiptID, op: 'worktree.settle', channel: record.channel, transitionID, purpose: record.grant.purpose,
      outcome: 'uncertain', actualLocation: record.plan.from, configurationDigest: record.plan.digest, receiptID: record.receiptID, resourceReceipt: observation.resource };
    record = journal.put({ ...record, phase: 'uncertain', receipt: observation.resource, settlement });
    const key = await credential(); check();
    const reply = await client.request('control_adapter', { agentId, credential: key, command: settlement });
    check(); if (reply?.commandID !== settlement.id) throw unavailable();
    return record;
  });
}

function acknowledgeDisposedStep(journal, native, transitionID) {
  const record = journal.entries().find(value => value.step &&
    (value.transitionID === transitionID || value.step.providerGrant.id === transitionID));
  if (!record) return;
  if (record.step.disposal?.phase !== 'observed' || typeof native?.acknowledgeRecordedStepDisposal !== 'function') throw unavailable();
  native.acknowledgeRecordedStepDisposal(record.step, journal);
}

// Release the unpublished provider owner under the same live reservation. The
// journal records intent before the native effect and its receipt before the
// broker acknowledgement. This does not certify MCP cleanup or release a fence.
export async function cleanupCodexProvider({ client, credential, native, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!client?.request || typeof credential !== 'function' || typeof guard !== 'function' || !signal ||
      typeof journal?.exclusive !== 'function' || journal.agentId !== agentId || typeof native?.cleanupProvider !== 'function' ||
      typeof native?.markCompletedResourceStopUncertain !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record || record.plan.kind === 'mcp_runtime' || record.phase !== 'settled') throw unavailable();
    if (!record.cleanup) {
      const page = await client.request('control_query', { agentId, channel: record.channel, view: 'transitions', entityID: transitionID, offset: 0, limit: 1 });
      check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      const grant = WorktreeTransition.parse(page.entries[0]);
      record = journal.put({ ...record, cleanup: { cleanupID: randomUUID(), receiptID: randomUUID(), phase: 'dispatching', grant } });
      let receipt;
      try {
        check(); acknowledgeDisposedStep(journal, native, transitionID); check();
        receipt = await native.cleanupProvider(grant, record.plan.reservation, record.cleanup.cleanupID); check();
      } catch {
        if (receipt) { try { native.markCompletedResourceStopUncertain(grant, record.plan.reservation, receipt); } catch { native.close?.(); } }
        journal.put({ ...record, cleanup: { ...record.cleanup, phase: 'uncertain' } }); throw uncertain();
      }
      try { record = recordProviderCleanup(journal, record, receipt); }
      catch (error) {
        try { native.markCompletedResourceStopUncertain(grant, record.plan.reservation, receipt); } catch { native.close?.(); }
        throw error;
      }
    }
    if (!['observed', 'settled'].includes(record.cleanup.phase)) throw uncertain();
    if (record.cleanup.phase === 'settled') return record.cleanup;
    const key = await credential(); check();
    const reply = await client.request('control_adapter', { agentId, credential: key, command: record.cleanup.settlement });
    check(); if (reply?.commandID !== record.cleanup.receiptID) throw unavailable();
    return journal.put({ ...record, cleanup: { ...record.cleanup, phase: 'settled' } }).cleanup;
  });
}

function recordProviderCleanup(journal, record, value) {
  const receipt = ProviderCleanupReceipt.parse(value), c = record.cleanup;
  if (receipt.cleanupID !== c.cleanupID || !cleanupMatchesOwner(receipt, c.grant)) throw unavailable();
  const settlement = { id: c.receiptID, op: 'worktree.settle', channel: record.channel, transitionID: record.transitionID,
    purpose: 'establish-provider', outcome: 'failed', actualLocation: record.plan.from, configurationDigest: record.plan.digest,
    receiptID: c.receiptID, cleanupReceipt: receipt };
  return journal.put({ ...record, cleanup: { ...c, phase: 'observed', receipt, settlement } });
}

// Lost native replies can only be observed under the same live owner; neither
// a dispatching record nor an owned observation permits a second cleanup call.
export async function observeCodexProviderCleanup({ client, native, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!client?.request || typeof guard !== 'function' || !signal || typeof journal?.exclusive !== 'function' ||
      journal.agentId !== agentId || typeof native?.observeProvider !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record?.cleanup || !['dispatching', 'uncertain'].includes(record.cleanup.phase)) throw unavailable();
    const observation = await native.observeProvider(record.cleanup.grant, record.plan.reservation); check();
    if (observation.status !== 'released' || !observation.cleanup) throw uncertain();
    return recordProviderCleanup(journal, record, observation.cleanup).cleanup;
  });
}

// A restarted owner can corroborate an already persisted native cleanup, but
// must leave the restored MCP quarantine intact. Retry only the exact broker
// settlement; never call the cleanup effect or resume resource ownership.
export async function reconcileRestoredCodexProviderCleanup({ client, credential, native, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!agentId.startsWith('codex:') || !client?.request || typeof credential !== 'function' ||
      !native?.usesClient?.(client) || typeof native?.observeRestoredProviderCleanup !== 'function' ||
      journal?.agentId !== agentId || client.hostId !== journal.hostId || !journal?.exclusive || !signal || typeof guard !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId || !native.usesClient(client)) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record || record.phase !== 'settled' || record.plan.kind === 'mcp_runtime' ||
        !record.cleanup || !['dispatching', 'uncertain', 'observed', 'settled'].includes(record.cleanup.phase)) throw unavailable();
    const observe = async () => {
      check(); const receipt = ProviderCleanupReceipt.parse(await native.observeRestoredProviderCleanup(agentId.slice(6), record.plan.reservation, record.cleanup.cleanupID));
      check(); if (receipt.cleanupID !== record.cleanup.cleanupID || !cleanupMatchesOwner(receipt, record.cleanup.grant) ||
          JSON.stringify(receipt.resource) !== JSON.stringify(record.receipt)) throw unavailable();
      return receipt;
    };
    const receipt = await observe();
    if (record.cleanup.receipt && JSON.stringify(record.cleanup.receipt) !== JSON.stringify(receipt)) throw unavailable();
    if (['dispatching', 'uncertain'].includes(record.cleanup.phase)) record = recordProviderCleanup(journal, record, receipt);
    const read = async () => {
      check(); const page = await client.request('control_query', { agentId, channel: record.channel,
        view: 'transitions', entityID: transitionID, offset: 0, limit: 1 });
      check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      return WorktreeTransition.parse(page.entries[0]);
    };
    const settled = current => {
      if (current.status !== 'failed' || !Stamp.safeParse(current.settledAt).success) return false;
      const expected = WorktreeTransition.parse({ ...record.cleanup.grant, status: 'failed', actualLocation: record.plan.from,
        receiptID: record.cleanup.receiptID, cleanupReceipt: receipt, settledAt: current.settledAt });
      return JSON.stringify(current) === JSON.stringify(expected);
    };
    let current = await read();
    if (!settled(current)) {
      if (record.cleanup.phase === 'settled' || JSON.stringify(current) !== JSON.stringify(record.cleanup.grant)) throw unavailable();
      await observe();
      const key = await credential(); check();
      try {
        const reply = await client.request('control_adapter', { agentId, credential: key, command: record.cleanup.settlement });
        check(); if (reply?.commandID !== record.cleanup.receiptID) throw unavailable();
      } catch { check(); }
      current = await read(); if (!settled(current)) throw uncertain();
    }
    await observe();
    if (record.cleanup.phase !== 'settled') record = journal.put({ ...record, cleanup: { ...record.cleanup, phase: 'settled' } });
    return record.cleanup;
  });
}

// Journal a tracked MCP shutdown, which is not physical cleanup or permission
// to clear its broker hold. The exact native owner and fence must remain live.
export async function quiesceCodexMcp({ client, native, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!client?.request || typeof guard !== 'function' || !signal || typeof journal?.exclusive !== 'function' ||
      journal.agentId !== agentId || typeof native?.quiesceMcp !== 'function' ||
      typeof native?.markCompletedResourceStopUncertain !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); let record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record || record.plan.kind !== 'mcp_runtime' || record.phase !== 'settled') throw unavailable();
    if (!record.quiescence) {
      const page = await client.request('control_query', { agentId, channel: record.channel, view: 'transitions', entityID: transitionID, offset: 0, limit: 1 });
      check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
      const grant = WorktreeTransition.parse(page.entries[0]);
      record = journal.put({ ...record, quiescence: { shutdownID: randomUUID(), phase: 'dispatching', grant } });
      let receipt;
      try {
        check(); acknowledgeDisposedStep(journal, native, transitionID); check();
        receipt = await native.quiesceMcp(grant, record.plan.reservation, record.quiescence.shutdownID); check();
      } catch {
        if (receipt) { try { native.markCompletedResourceStopUncertain(grant, record.plan.reservation, receipt); } catch { native.close?.(); } }
        journal.put({ ...record, quiescence: { ...record.quiescence, phase: 'uncertain' } }); throw uncertain();
      }
      try { record = recordMcpQuiescence(journal, record, receipt); }
      catch (error) {
        try { native.markCompletedResourceStopUncertain(grant, record.plan.reservation, receipt); } catch { native.close?.(); }
        throw error;
      }
    }
    if (record.quiescence.phase !== 'observed') throw uncertain();
    return record.quiescence;
  });
}

function recordMcpQuiescence(journal, record, value) {
  const receipt = McpQuiescence.parse(value), q = record.quiescence;
  if (receipt.shutdownID !== q.shutdownID || JSON.stringify(receipt.resource) !== JSON.stringify(record.receipt)) throw unavailable();
  return journal.put({ ...record, quiescence: { ...q, phase: 'observed', receipt } });
}

export async function observeCodexMcpQuiescence({ client, native, journal, agentId, transitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(transitionID);
  if (!client?.request || typeof guard !== 'function' || !signal || typeof journal?.exclusive !== 'function' ||
      journal.agentId !== agentId || typeof native?.observeMcp !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const record = journal.entries().find(value => value.transitionID === transitionID);
    if (!record?.quiescence || !['dispatching', 'uncertain'].includes(record.quiescence.phase)) throw unavailable();
    const observation = await native.observeMcp(record.quiescence.grant, record.plan.reservation); check();
    if (observation.status !== 'owned' || !observation.quiescence || observation.cleanup) throw uncertain();
    return recordMcpQuiescence(journal, record, observation.quiescence).quiescence;
  });
}
