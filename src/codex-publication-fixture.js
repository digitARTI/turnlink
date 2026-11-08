import { randomUUID } from 'node:crypto';
import { AgentID } from './protocol.js';
import { UUID } from './control/contracts.js';
import { CodexPublicationReceipt, CodexSourceMcpShutdownReceipt, CodexSourceModelShutdownReceipt } from './codex-resource-journal.js';
import { requireCodexPublicationBarrier } from './codex-admission-fence.js';
import { captureContainedSourceInventory, captureContainedSourceRetirementProposal } from './codex-contained-mcp-inventory.js';

const unavailable = () => Object.assign(new Error('CODEX_PUBLICATION_FIXTURE_UNAVAILABLE'), { code: 'CODEX_PUBLICATION_FIXTURE_UNAVAILABLE' });
const uncertain = () => Object.assign(new Error('CODEX_PUBLICATION_FIXTURE_UNCERTAIN'), { code: 'CODEX_PUBLICATION_FIXTURE_UNCERTAIN' });

// Only for an explicitly enabled native debug fixture. The caller must retain
// the admission and publication barriers across this entire operation and any
// subsequent observation. Nothing here releases or settles the transition.
function owner(args) {
  AgentID.parse(args.agentId); UUID.parse(args.mcpTransitionID);
  if (!args.agentId.startsWith('codex:') || args.journal?.agentId !== args.agentId ||
      args.client?.hostId !== args.journal?.hostId || !args.journal?.exclusive || !args.journal?.entries ||
      args.native?.supportsPublicationFixture !== true || typeof args.native.assertPublicationBarrier !== 'function' ||
      !args.signal || typeof args.guard !== 'function') throw unavailable();
  return () => {
    if (args.signal.aborted || args.client.hostId !== args.journal.hostId) throw unavailable();
    args.guard(); requireCodexPublicationBarrier(args.publicationGuard, args.agentId.slice(6));
    args.native.assertPublicationBarrier(args.publicationGuard, args.agentId.slice(6));
  };
}

function publicationReceipt(value, record, operationID) {
  const receipt = CodexPublicationReceipt.parse(value);
  if (receipt.operationID !== operationID || receipt.transitionID !== record.step.movement.grant.id ||
      receipt.stepID !== record.step.receipt.stepID) throw unavailable();
  return receipt;
}

function shutdownReceipt(value, record, shutdownID) {
  const receipt = CodexSourceMcpShutdownReceipt.parse(value), movement = record.step.movement;
  if (receipt.shutdownID !== shutdownID || receipt.operationID !== movement.publication.operationID ||
      receipt.transitionID !== movement.grant.id || receipt.stepID !== record.step.receipt.stepID) throw unavailable();
  return receipt;
}

function modelShutdownReceipt(value, record, shutdownID) {
  const receipt = CodexSourceModelShutdownReceipt.parse(value), movement = record.step.movement;
  if (receipt.shutdownID !== shutdownID || receipt.operationID !== movement.publication.operationID ||
      receipt.transitionID !== movement.grant.id || receipt.stepID !== record.step.receipt.stepID) throw unavailable();
  return receipt;
}

export async function stageCodexPublicationFixture(args) {
  const check = owner(args);
  if (typeof args.native.stageDestinationFixture !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); let record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement;
    if (movement?.phase !== 'bound' || movement.publication) throw unavailable();
    let contained;
    if (movement.grant.sourceRetirement) {
      if (!args.containedInventory) throw unavailable();
      const proposal = await captureContainedSourceRetirementProposal(args.containedInventory,
        { native: args.native, threadId: args.agentId.slice(6), reservation: record.plan.reservation,
          permitAdmittedEffectAfterNativeLoss: movement.grant.sourceRetirement.version === 2 });
      check();
      if (JSON.stringify(proposal) !== JSON.stringify(movement.grant.sourceRetirement)) throw unavailable();
    }
    if (args.containedInventory) contained = await captureContainedSourceInventory(args.containedInventory,
      { native: args.native, threadId: args.agentId.slice(6), reservation: record.plan.reservation });
    const publication = { operationID: randomUUID(), phase: 'dispatching', ...(contained ? { contained } : {}) };
    try { check(); record = args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, publication } } }); }
    finally { if (contained) args.containedInventory.release(); }
    try {
      let result;
      try {
        result = await args.native.stageDestinationFixture(movement.grant, record.plan.reservation,
          record.step.receipt, publication.operationID, args.publicationGuard);
      } catch (error) {
        if (error?.code !== 'NATIVE_CONTINUITY_UNCERTAIN' || typeof args.native.observeStagedDestinationFixture !== 'function') throw error;
        check();
        result = await args.native.observeStagedDestinationFixture(movement.grant, record.plan.reservation,
          record.step.receipt, publication.operationID, args.publicationGuard);
        if (result === null) throw error;
      }
      const receipt = publicationReceipt(result, record, publication.operationID);
      check(); movement = { ...movement, publication: { ...publication, phase: 'observed', receipt } };
      return args.journal.put({ ...record, step: { ...record.step, movement } }).step.movement.publication;
    } catch {
      try { args.journal.put({ ...record, step: { ...record.step, movement: { ...movement, publication: { ...publication, phase: 'uncertain' } } } }); } catch { /* retain intent */ }
      throw uncertain();
    }
  });
}

export async function observeCodexPublicationFixture(args) {
  const check = owner(args);
  if (typeof args.native.observeStagedDestinationFixture !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); const record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement,
      publication = movement?.publication;
    if (movement?.phase !== 'bound' || !publication || !['dispatching', 'uncertain'].includes(publication.phase)) throw unavailable();
    try {
      const result = await args.native.observeStagedDestinationFixture(movement.grant, record.plan.reservation,
        record.step.receipt, publication.operationID, args.publicationGuard);
      check(); if (result === null) return null;
      const receipt = publicationReceipt(result, record, publication.operationID);
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement,
        publication: { ...publication, phase: 'observed', receipt } } } }).step.movement.publication;
    } catch { throw uncertain(); }
  });
}

export async function shutdownCodexSourceFixture(args) {
  const check = owner(args);
  if (typeof args.native.shutdownSourceFixture !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); let record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement;
    if (movement?.phase !== 'bound' || movement.grant.sourceMcpShutdown !== true ||
        movement.publication?.phase !== 'observed' || movement.publication.sourceShutdown) throw unavailable();
    const sourceShutdown = { shutdownID: randomUUID(), phase: 'dispatching' };
    movement = { ...movement, publication: { ...movement.publication, sourceShutdown } };
    record = args.journal.put({ ...record, step: { ...record.step, movement } });
    try {
      const receipt = shutdownReceipt(await args.native.shutdownSourceFixture(movement.grant, record.plan.reservation,
        record.step.receipt, movement.publication.operationID, sourceShutdown.shutdownID, args.publicationGuard), record, sourceShutdown.shutdownID);
      check(); movement = { ...movement, publication: { ...movement.publication, sourceShutdown: { ...sourceShutdown, phase: 'observed', receipt } } };
      return args.journal.put({ ...record, step: { ...record.step, movement } }).step.movement.publication.sourceShutdown;
    } catch {
      try { args.journal.put({ ...record, step: { ...record.step, movement: { ...movement,
        publication: { ...movement.publication, sourceShutdown: { ...sourceShutdown, phase: 'uncertain' } } } } }); } catch { /* retain intent */ }
      throw uncertain();
    }
  });
}

export async function shutdownCodexSourceModelFixture(args) {
  const check = owner(args);
  if (typeof args.native.shutdownSourceModelFixture !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); let record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement;
    if (movement?.phase !== 'bound' || movement.grant.sourceModelShutdown !== true ||
        movement.publication?.phase !== 'observed' || movement.publication.sourceShutdown?.phase !== 'observed' ||
        movement.publication.sourceModelShutdown) throw unavailable();
    const sourceModelShutdown = { shutdownID: randomUUID(), phase: 'dispatching' };
    movement = { ...movement, publication: { ...movement.publication, sourceModelShutdown } };
    record = args.journal.put({ ...record, step: { ...record.step, movement } });
    try {
      const receipt = modelShutdownReceipt(await args.native.shutdownSourceModelFixture(movement.grant,
        record.plan.reservation, record.step.receipt, movement.publication.operationID, sourceModelShutdown.shutdownID, args.publicationGuard), record, sourceModelShutdown.shutdownID);
      check(); movement = { ...movement, publication: { ...movement.publication, sourceModelShutdown: { ...sourceModelShutdown, phase: 'observed', receipt } } };
      return args.journal.put({ ...record, step: { ...record.step, movement } }).step.movement.publication.sourceModelShutdown;
    } catch {
      try { args.journal.put({ ...record, step: { ...record.step, movement: { ...movement,
        publication: { ...movement.publication, sourceModelShutdown: { ...sourceModelShutdown, phase: 'uncertain' } } } } }); } catch { /* retain intent */ }
      throw uncertain();
    }
  });
}

export async function observeCodexSourceModelFixture(args) {
  const check = owner(args);
  if (typeof args.native.observeSourceModelShutdownFixture !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); const record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement,
      source = movement?.publication?.sourceModelShutdown;
    if (!source || !['dispatching', 'uncertain'].includes(source.phase)) throw unavailable();
    try {
      const observation = await args.native.observeSourceModelShutdownFixture(movement.grant, record.plan.reservation,
        record.step.receipt, movement.publication.operationID, source.shutdownID, args.publicationGuard);
      check(); if (observation === null) return null;
      const receipt = modelShutdownReceipt(observation, record, source.shutdownID);
      return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement,
        publication: { ...movement.publication, sourceModelShutdown: { ...source, phase: 'observed', receipt } } } } }).step.movement.publication.sourceModelShutdown;
    } catch { throw uncertain(); }
  });
}

export async function observeCodexSourceFixture(args) {
  const check = owner(args);
  if (typeof args.native.observeSourceShutdownFixture !== 'function') throw unavailable();
  return args.journal.exclusive(async () => {
    check(); const record = args.journal.entries().find(value => value.transitionID === args.mcpTransitionID), movement = record?.step?.movement,
      source = movement?.publication?.sourceShutdown;
    if (!source || !['dispatching', 'uncertain'].includes(source.phase)) throw unavailable();
    try {
      const receipt = shutdownReceipt(await args.native.observeSourceShutdownFixture(movement.grant, record.plan.reservation,
        record.step.receipt, movement.publication.operationID, source.shutdownID, args.publicationGuard), record, source.shutdownID);
      check(); return args.journal.put({ ...record, step: { ...record.step, movement: { ...movement,
        publication: { ...movement.publication, sourceShutdown: { ...source, phase: 'observed', receipt } } } } }).step.movement.publication.sourceShutdown;
    } catch { throw uncertain(); }
  });
}

// A successor can correlate the native historical marker with the durable
// host intent. It never advances the host phase or infers resource release.
export async function observeRestoredCodexSourceShutdown({ client, native, journal, agentId, mcpTransitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(mcpTransitionID);
  if (!agentId.startsWith('codex:') || journal?.agentId !== agentId || client?.hostId !== journal?.hostId ||
      typeof native?.usesClient !== 'function' || !native.usesClient(client) ||
      typeof native.observeRestoredSourceShutdown !== 'function' || !journal?.exclusive || !journal?.entries ||
      !signal || typeof guard !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId || !native.usesClient(client)) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const record = journal.entries().find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement,
      publication = movement?.publication, shutdown = publication?.sourceShutdown;
    if (movement?.phase !== 'bound' || movement.grant.sourceMcpShutdown !== true || publication?.phase !== 'observed' || !shutdown) throw unavailable();
    const ids = { operationID: publication.operationID, shutdownID: shutdown.shutdownID,
      transitionID: movement.grant.id, stepID: record.step.receipt.stepID };
    const observed = await native.observeRestoredSourceShutdown(agentId.slice(6), ids); check();
    if (Object.entries(ids).some(([key, value]) => observed?.[key] !== value) ||
        !['pending', 'uncertain', 'closed'].includes(observed.historicalStatus) ||
        shutdown.phase === 'observed' && observed.historicalStatus !== 'closed') throw unavailable();
    return observed;
  });
}

// Historical correlation does not advance the journal or prove resource release.
export async function observeRestoredCodexSourceModelShutdown({ client, native, journal, agentId, mcpTransitionID, signal, guard }) {
  AgentID.parse(agentId); UUID.parse(mcpTransitionID);
  if (!agentId.startsWith('codex:') || journal?.agentId !== agentId || client?.hostId !== journal?.hostId ||
      typeof native?.usesClient !== 'function' || !native.usesClient(client) ||
      typeof native.observeRestoredSourceModelShutdown !== 'function' || !journal?.exclusive || !journal?.entries ||
      !signal || typeof guard !== 'function') throw unavailable();
  const check = () => { if (signal.aborted || client.hostId !== journal.hostId || !native.usesClient(client)) throw unavailable(); guard(); };
  return journal.exclusive(async () => {
    check(); const record = journal.entries().find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement,
      publication = movement?.publication, shutdown = publication?.sourceModelShutdown;
    if (movement?.phase !== 'bound' || movement.grant.sourceModelShutdown !== true || publication?.phase !== 'observed' || !shutdown) throw unavailable();
    const ids = { operationID: publication.operationID, shutdownID: shutdown.shutdownID,
      transitionID: movement.grant.id, stepID: record.step.receipt.stepID };
    const observed = await native.observeRestoredSourceModelShutdown(agentId.slice(6), ids); check();
    if (Object.entries(ids).some(([key, value]) => observed?.[key] !== value) ||
        !['pending', 'uncertain', 'closed', 'absent'].includes(observed.historicalStatus) ||
        shutdown.phase === 'observed' && observed.historicalStatus !== (shutdown.receipt.status === 'closed_local' ? 'closed' : 'absent')) throw unavailable();
    return observed;
  });
}
