import { join } from 'node:path';
import { z } from 'zod';
import { AgentID, HostID } from './protocol.js';
import { Command, UUID, WorktreeTransition } from './control/contracts.js';
import { ProviderEstablishmentPlan, ProviderEstablishmentReceipt, ProviderCleanupReceipt, cleanupMatchesOwner, receiptMatchesPlan } from './control/provider-establishment-contracts.js';
import { McpEstablishmentPlan, McpEstablishmentReceipt, McpQuiescence, mcpReceiptMatchesPlan } from './control/mcp-establishment-contracts.js';
import { compatibleResourceHold } from './control/worktree-holds.js';
import { digest, stateDir } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';

const unavailable = () => Object.assign(new Error('CODEX_RESOURCE_JOURNAL_UNAVAILABLE'), { code: 'CODEX_RESOURCE_JOURNAL_UNAVAILABLE' });
const plan = z.union([ProviderEstablishmentPlan, McpEstablishmentPlan]);
const receipt = z.union([ProviderEstablishmentReceipt, McpEstablishmentReceipt]);
const settlement = Command.options.find(schema => schema.shape.op.value === 'worktree.settle');
const cleanupSchema = z.strictObject({ cleanupID: UUID, receiptID: UUID,
  phase: z.enum(['dispatching', 'uncertain', 'observed', 'settled']), grant: WorktreeTransition,
  receipt: ProviderCleanupReceipt.optional(), settlement: settlement.optional() });
const quiescenceSchema = z.strictObject({ shutdownID: UUID, phase: z.enum(['dispatching', 'uncertain', 'observed']),
  grant: WorktreeTransition, receipt: McpQuiescence.optional() });
// The receipt identifies one retained native result. It is not movement,
// publication, physical cleanup or permission to invoke a tool.
export const CodexStepPreparationReceipt = z.strictObject({ operationID: UUID, candidateID: UUID, stepID: UUID,
  mcpResourceID: UUID, providerResourceID: UUID, status: z.literal('retained') });
// A native disposal receipt concerns only this retained step. It does not
// establish physical MCP shutdown or release either broker resource hold.
export const CodexStepDisposalReceipt = z.strictObject({ disposalID: UUID, operationID: UUID, candidateID: UUID, stepID: UUID,
  mcpResourceID: UUID, providerResourceID: UUID, status: z.literal('disposed') });
export const CodexMovementCancellationReceipt = z.strictObject({ transitionID: UUID, stepID: UUID, cancellationID: UUID });
// These receipts record local native observations only; neither settles the
// broker transition nor proves remote resource release.
export const CodexPublicationReceipt = z.strictObject({ operationID: UUID, transitionID: UUID, stepID: UUID, status: z.literal('staged') });
export const CodexSourceMcpShutdownReceipt = z.strictObject({ shutdownID: UUID, operationID: UUID, transitionID: UUID,
  stepID: UUID, status: z.literal('closed_local') });
export const CodexSourceModelShutdownReceipt = z.strictObject({ shutdownID: UUID, operationID: UUID, transitionID: UUID,
  stepID: UUID, status: z.enum(['closed_local', 'absent_local']) });
const containedSourceSchema = z.array(z.strictObject({ names: z.array(z.string().min(1).max(128)).min(1).max(64),
  resourceID: UUID, operationID: UUID, containerID: z.string().regex(/^[a-f0-9]{64}$/), wrapperPID: z.number().int().min(1).max(0xffffffff) })).min(1).max(64)
  .superRefine((entries, context) => {
    const names = new Set(), resources = new Set(), operations = new Set(), containers = new Set(), pids = new Set();
    for (const entry of entries) {
      if (resources.has(entry.resourceID) || operations.has(entry.operationID) || containers.has(entry.containerID) || pids.has(entry.wrapperPID))
        context.addIssue({ code: 'custom', message: 'Duplicate contained source owner' });
      resources.add(entry.resourceID); operations.add(entry.operationID); containers.add(entry.containerID); pids.add(entry.wrapperPID);
      for (const name of entry.names) { if (names.has(name)) context.addIssue({ code: 'custom', message: 'Duplicate contained source name' }); names.add(name); }
    }
    if (names.size > 64) context.addIssue({ code: 'custom', message: 'Too many contained source names' });
  });
const sourceShutdownSchema = z.strictObject({ shutdownID: UUID, phase: z.enum(['dispatching', 'uncertain', 'observed']),
  receipt: CodexSourceMcpShutdownReceipt.optional() });
const sourceModelShutdownSchema = z.strictObject({ shutdownID: UUID, phase: z.enum(['dispatching', 'uncertain', 'observed']),
  receipt: CodexSourceModelShutdownReceipt.optional() });
const publicationSchema = z.strictObject({ operationID: UUID, phase: z.enum(['dispatching', 'uncertain', 'observed']),
  receipt: CodexPublicationReceipt.optional(), contained: containedSourceSchema.optional(), sourceShutdown: sourceShutdownSchema.optional(), sourceModelShutdown: sourceModelShutdownSchema.optional() });
const movementSchema = z.strictObject({ grant: WorktreeTransition,
  phase: z.enum(['binding', 'binding_uncertain', 'bound', 'cancelling', 'cancel_uncertain', 'cancelled', 'settling', 'settlement_uncertain', 'settled']),
  cancellationID: UUID.optional(), cancellationReceipt: CodexMovementCancellationReceipt.optional(), settlementID: UUID.optional(),
  publication: publicationSchema.optional() });
const stepDisposalSchema = z.strictObject({ disposalID: UUID, phase: z.enum(['dispatching', 'uncertain', 'observed']),
  receipt: CodexStepDisposalReceipt.optional() });
const stepSchema = z.strictObject({ operationID: UUID, candidateID: UUID, checkedAt: z.number().int().nonnegative().safe(),
  mcpGrant: WorktreeTransition, providerGrant: WorktreeTransition,
  phase: z.enum(['dispatching', 'uncertain', 'observed']), receipt: CodexStepPreparationReceipt.optional(),
  disposal: stepDisposalSchema.optional(), movement: movementSchema.optional() });
const recordSchema = z.strictObject({ taskID: UUID, claimGeneration: z.number().int().nonnegative().safe(), previewID: UUID,
  transitionID: UUID, receiptID: UUID, channel: z.string().min(1).max(200), plan,
  phase: z.enum(['previewing', 'previewed', 'abandoned', 'authorizing', 'prepared', 'aborting', 'aborted', 'dispatching', 'uncertain', 'observed', 'settled']),
  grant: WorktreeTransition.optional(), receipt: receipt.optional(), settlement: settlement.optional(), cleanup: cleanupSchema.optional(), quiescence: quiescenceSchema.optional(), step: stepSchema.optional() });
const transitions = { previewing: ['previewed', 'abandoned'], previewed: ['authorizing', 'abandoned'], abandoned: [], authorizing: ['prepared'], prepared: ['dispatching', 'aborting'], aborting: ['aborted'], aborted: [],
  dispatching: ['uncertain', 'observed'], uncertain: ['uncertain', 'observed'], observed: ['settled'], settled: [] };
const fixed = value => JSON.stringify({ taskID: value.taskID, claimGeneration: value.claimGeneration, previewID: value.previewID,
  transitionID: value.transitionID, receiptID: value.receiptID, channel: value.channel, plan: value.plan });
const establishment = ({ cleanup, quiescence, step, ...value }) => JSON.stringify(value);
const cleanupTransitions = { dispatching: ['uncertain', 'observed'], uncertain: ['observed'], observed: ['settled'], settled: [] };
function validCleanupChange(previous, next) {
  if (!previous) return !next || next.phase === 'dispatching';
  if (!next) return false;
  if (JSON.stringify(previous) === JSON.stringify(next)) return true;
  return cleanupTransitions[previous.phase].includes(next.phase) && previous.cleanupID === next.cleanupID &&
    previous.receiptID === next.receiptID && JSON.stringify(previous.grant) === JSON.stringify(next.grant) &&
    (!previous.receipt || JSON.stringify(previous.receipt) === JSON.stringify(next.receipt)) &&
    (!previous.settlement || JSON.stringify(previous.settlement) === JSON.stringify(next.settlement));
}
function uniqueIdentifiers(records) {
  const ids = records.flatMap(record => [record.previewID, record.transitionID, record.receiptID,
    ...(record.cleanup ? [record.cleanup.cleanupID, record.cleanup.receiptID] : []), ...(record.quiescence ? [record.quiescence.shutdownID] : []),
    ...(record.step ? [record.step.operationID, ...(record.step.receipt ? [record.step.receipt.stepID] : []),
      ...(record.step.disposal ? [record.step.disposal.disposalID] : []),
      ...(record.step.movement ? [record.step.movement.grant.id, record.step.movement.grant.previewID,
        ...(record.step.movement.publication ? [record.step.movement.publication.operationID,
          ...(record.step.movement.publication.sourceShutdown ? [record.step.movement.publication.sourceShutdown.shutdownID] : []),
          ...(record.step.movement.publication.sourceModelShutdown ? [record.step.movement.publication.sourceModelShutdown.shutdownID] : [])] : []),
        ...(record.step.movement.cancellationID ? [record.step.movement.cancellationID] : []),
        ...(record.step.movement.settlementID ? [record.step.movement.settlementID] : [])] : [])] : [])]);
  return new Set(ids).size === ids.length;
}

function validShutdownChange(before, after, allowed) {
  if (!before) return !after || allowed && after.phase === 'dispatching';
  if (!after || before.shutdownID !== after.shutdownID) return false;
  if (JSON.stringify(before) === JSON.stringify(after)) return before.phase !== 'dispatching';
  return (before.phase === 'dispatching' ? ['uncertain', 'observed'] : before.phase === 'uncertain' ? ['observed'] : []).includes(after.phase) &&
    (!before.receipt || JSON.stringify(before.receipt) === JSON.stringify(after.receipt));
}
function validPublicationChange(previous, next) {
  if (!previous) return !next || next.phase === 'dispatching' && !next.sourceShutdown && !next.sourceModelShutdown;
  if (!next || previous.operationID !== next.operationID || JSON.stringify(previous.contained) !== JSON.stringify(next.contained)) return false;
  const phase = previous.phase === next.phase ? previous.phase === 'observed' || previous.phase === 'uncertain' :
    (previous.phase === 'dispatching' ? ['uncertain', 'observed'] : previous.phase === 'uncertain' ? ['observed'] : []).includes(next.phase);
  if (!phase || (previous.receipt && JSON.stringify(previous.receipt) !== JSON.stringify(next.receipt))) return false;
  return validShutdownChange(previous.sourceShutdown, next.sourceShutdown, previous.phase === 'observed' && next.phase === 'observed') &&
    validShutdownChange(previous.sourceModelShutdown, next.sourceModelShutdown,
      previous.phase === 'observed' && next.phase === 'observed' && previous.sourceShutdown?.phase === 'observed');
}

function validStepChange(previous, next) {
  if (!previous) return !next || next.phase === 'dispatching';
  if (!next) return false;
  if (JSON.stringify(previous) === JSON.stringify(next)) return previous.phase !== 'dispatching' && previous.disposal?.phase !== 'dispatching' &&
    previous.movement?.publication?.phase !== 'dispatching' && previous.movement?.publication?.sourceShutdown?.phase !== 'dispatching' &&
    previous.movement?.publication?.sourceModelShutdown?.phase !== 'dispatching' &&
    !['binding', 'cancelling', 'settling'].includes(previous.movement?.phase);
  const allowed = previous.phase === 'dispatching' ? ['uncertain', 'observed'] : previous.phase === 'uncertain' ? ['observed'] : ['observed'];
  const beforeDisposal = previous.disposal, afterDisposal = next.disposal;
  const beforeMovement = previous.movement, afterMovement = next.movement;
  const movementTransitions = { binding: ['binding_uncertain', 'bound'], binding_uncertain: ['bound'], bound: ['cancelling'],
    cancelling: ['cancel_uncertain', 'cancelled'], cancel_uncertain: ['cancelled'], cancelled: ['settling'],
    settling: ['settlement_uncertain', 'settled'], settlement_uncertain: ['settled'], settled: [] };
  const movementValid = !beforeMovement ? !afterMovement || previous.phase === 'observed' && !previous.disposal && afterMovement.phase === 'binding' :
    !!afterMovement && JSON.stringify(beforeMovement.grant) === JSON.stringify(afterMovement.grant) &&
    (JSON.stringify(beforeMovement) === JSON.stringify(afterMovement) ? !['binding', 'cancelling', 'settling'].includes(beforeMovement.phase) :
      movementTransitions[beforeMovement.phase].includes(afterMovement.phase) || beforeMovement.phase === 'bound' && afterMovement.phase === 'bound') &&
    validPublicationChange(beforeMovement.publication, afterMovement.publication) &&
    (!beforeMovement.publication || afterMovement.phase === 'bound') &&
    (!beforeMovement.cancellationID || beforeMovement.cancellationID === afterMovement.cancellationID) &&
    (!beforeMovement.settlementID || beforeMovement.settlementID === afterMovement.settlementID) &&
    (!beforeMovement.cancellationReceipt || JSON.stringify(beforeMovement.cancellationReceipt) === JSON.stringify(afterMovement.cancellationReceipt));
  const disposalValid = !beforeDisposal ? !afterDisposal || previous.phase === 'observed' && afterDisposal.phase === 'dispatching' :
    !!afterDisposal && beforeDisposal.disposalID === afterDisposal.disposalID &&
    (JSON.stringify(beforeDisposal) === JSON.stringify(afterDisposal) ? beforeDisposal.phase !== 'dispatching' :
      (beforeDisposal.phase === 'dispatching' ? ['uncertain', 'observed'] : beforeDisposal.phase === 'uncertain' ? ['observed'] : []).includes(afterDisposal.phase)) &&
    (!beforeDisposal.receipt || JSON.stringify(beforeDisposal.receipt) === JSON.stringify(afterDisposal.receipt));
  return movementValid && disposalValid && allowed.includes(next.phase) && previous.operationID === next.operationID && previous.candidateID === next.candidateID &&
    previous.checkedAt === next.checkedAt && JSON.stringify(previous.mcpGrant) === JSON.stringify(next.mcpGrant) &&
    JSON.stringify(previous.providerGrant) === JSON.stringify(next.providerGrant) &&
    (!previous.receipt || JSON.stringify(previous.receipt) === JSON.stringify(next.receipt));
}

function matchesEstablishedRecord(record, grant) {
  const initial = record.grant;
  return record.phase === 'settled' && !!record.receipt && !!initial && grant.status === 'established' && !grant.cleanupReceipt &&
    grant.id === record.transitionID && grant.previewID === record.previewID && grant.taskID === record.taskID &&
    grant.agentId === record.plan.agentId && grant.channel === record.channel && grant.claimGeneration === record.claimGeneration &&
    grant.from === record.plan.from && grant.to === record.plan.to && grant.preparedAt === initial.preparedAt &&
    grant.actualLocation === record.plan.from && grant.receiptID === record.receiptID && grant.settledAt !== undefined &&
    grant.settledAt >= grant.preparedAt && grant.purpose === initial.purpose && grant.configurationDigest === record.plan.digest &&
    JSON.stringify(grant.resourceReceipt) === JSON.stringify(record.receipt) &&
    JSON.stringify(grant.mcpPlan ?? grant.providerPlan) === JSON.stringify(record.plan);
}

function validStepReferences(records) {
  const usedProviders = new Set();
  for (const mcp of records.filter(value => value.step)) {
    const step = mcp.step, provider = records.find(value => value.transitionID === step.providerGrant.id);
    const disposed = step.disposal?.phase === 'observed';
    if (!provider || provider.plan.kind === 'mcp_runtime' || (!disposed && (provider.cleanup || mcp.quiescence)) ||
        usedProviders.has(provider.transitionID) || !matchesEstablishedRecord(mcp, step.mcpGrant) ||
        !matchesEstablishedRecord(provider, step.providerGrant) || !compatibleResourceHold(step.mcpGrant, step.providerGrant) ||
        !compatibleResourceHold(step.providerGrant, step.mcpGrant) ||
        records.some(value => !['abandoned', 'aborted'].includes(value.phase) && value.transitionID !== mcp.transitionID && value.transitionID !== provider.transitionID &&
          (value.phase !== 'settled' || value.plan.kind === 'mcp_runtime' || value.cleanup?.phase !== 'settled')) ||
        step.checkedAt < Math.max(step.mcpGrant.settledAt, step.providerGrant.settledAt) ||
        (step.receipt && (step.receipt.operationID !== step.operationID || step.receipt.candidateID !== step.candidateID ||
          step.receipt.mcpResourceID !== mcp.receipt.resourceID || step.receipt.providerResourceID !== provider.receipt.resourceID))) return false;
    usedProviders.add(provider.transitionID);
  }
  return true;
}
function validQuiescenceChange(previous, next) {
  if (!previous) return !next || next.phase === 'dispatching';
  if (!next) return false;
  if (JSON.stringify(previous) === JSON.stringify(next)) return true;
  const allowed = previous.phase === 'dispatching' ? ['uncertain', 'observed'] : previous.phase === 'uncertain' ? ['observed'] : [];
  return allowed.includes(next.phase) && previous.shutdownID === next.shutdownID &&
    JSON.stringify(previous.grant) === JSON.stringify(next.grant) &&
    (!previous.receipt || JSON.stringify(previous.receipt) === JSON.stringify(next.receipt));
}

// Private write-ahead coordination journal. A dispatching/uncertain record
// requires native observation; it must never cause construction to be replayed.
export class CodexResourceJournal {
  #host; #agent; #path; #lock; #records = []; #locked = false; #fault = false;
  constructor(hostId, agentId, directory = process.env.AGENT_CHANNEL_CREDENTIAL_DIR || join(stateDir, 'session-keys')) {
    this.#host = HostID.parse(hostId); this.#agent = AgentID.parse(agentId);
    if (!agentId.startsWith('codex:')) throw unavailable();
    privateDirectory(directory); const root = join(directory, digest(hostId)); privateDirectory(root);
    this.#path = join(root, `${digest(agentId)}.codex-resources.json`);
    this.#lock = join(root, `${digest(agentId)}.codex-resources-writer`); this.#reload();
  }
  get hostId() { return this.#host; }
  get agentId() { return this.#agent; }
  #validate(value) {
    const r = recordSchema.parse(value), isMcp = r.plan.kind === 'mcp_runtime';
    if (r.plan.agentId !== this.#agent || r.plan.from === r.plan.to) throw unavailable();
    const needsGrant = ['prepared', 'aborting', 'aborted', 'dispatching', 'uncertain', 'observed', 'settled'].includes(r.phase);
    const needsReceipt = ['observed', 'settled'].includes(r.phase);
    const abort = ['aborting', 'aborted'].includes(r.phase);
    if (needsGrant !== !!r.grant || (needsReceipt && (!r.receipt || !r.settlement)) ||
        (!abort && (!!r.receipt !== !!r.settlement)) || (abort && (r.receipt || !r.settlement)) ||
        (r.receipt && !needsReceipt && r.phase !== 'uncertain')) throw unavailable();
    if (r.grant) {
      const grant = r.grant;
      if (grant.id !== r.transitionID || grant.previewID !== r.previewID || grant.taskID !== r.taskID || grant.channel !== r.channel ||
          grant.agentId !== this.#agent || grant.claimGeneration !== r.claimGeneration || grant.status !== 'prepared' ||
          grant.purpose !== (isMcp ? 'establish-mcp' : 'establish-provider') || grant.from !== r.plan.from || grant.to !== r.plan.to ||
          grant.configurationDigest !== r.plan.digest || JSON.stringify(isMcp ? grant.mcpPlan : grant.providerPlan) !== JSON.stringify(r.plan)) throw unavailable();
    }
    if (r.receipt) {
      const matches = isMcp ? mcpReceiptMatchesPlan(r.receipt, r.grant) : receiptMatchesPlan(r.receipt, r.grant);
      if (!matches || (r.phase !== 'uncertain' && r.receipt.phase !== 'constructed') || r.settlement.id !== r.receiptID || r.settlement.receiptID !== r.receiptID ||
          r.settlement.transitionID !== r.transitionID || r.settlement.channel !== r.channel || r.settlement.purpose !== r.grant.purpose ||
          r.settlement.outcome !== (r.phase === 'uncertain' ? 'uncertain' : 'established') || r.settlement.actualLocation !== r.plan.from ||
          r.settlement.configurationDigest !== r.plan.digest || JSON.stringify(r.settlement.resourceReceipt) !== JSON.stringify(r.receipt)) throw unavailable();
    }
    if (abort && (r.settlement.id !== r.receiptID || r.settlement.receiptID !== r.receiptID ||
        r.settlement.transitionID !== r.transitionID || r.settlement.channel !== r.channel || r.settlement.purpose !== r.grant.purpose ||
        r.settlement.outcome !== 'failed' || r.settlement.actualLocation !== r.plan.from || r.settlement.configurationDigest !== r.plan.digest ||
        r.settlement.resourceReceipt || r.settlement.cleanupReceipt)) throw unavailable();
    if (r.cleanup) {
      const c = r.cleanup, g = c.grant;
      if (isMcp || r.phase !== 'settled' || !r.receipt || g.status !== 'established' ||
          g.id !== r.transitionID || g.agentId !== this.#agent || g.channel !== r.channel ||
          g.taskID !== r.taskID || g.previewID !== r.previewID || g.claimGeneration !== r.claimGeneration ||
          g.from !== r.plan.from || g.to !== r.plan.to || g.preparedAt !== r.grant.preparedAt ||
          g.actualLocation !== r.plan.from || g.receiptID !== r.receiptID || g.settledAt === undefined ||
          g.purpose !== 'establish-provider' || g.configurationDigest !== r.plan.digest ||
          JSON.stringify(g.providerPlan) !== JSON.stringify(r.plan) || JSON.stringify(g.resourceReceipt) !== JSON.stringify(r.receipt) ||
          g.cleanupReceipt || (!!c.receipt !== !!c.settlement) ||
          (['observed', 'settled'].includes(c.phase) !== !!c.receipt)) throw unavailable();
      if (c.receipt && (c.receipt.cleanupID !== c.cleanupID || !cleanupMatchesOwner(c.receipt, g) ||
          c.settlement.id !== c.receiptID || c.settlement.receiptID !== c.receiptID ||
          c.settlement.transitionID !== r.transitionID || c.settlement.channel !== r.channel ||
          c.settlement.purpose !== 'establish-provider' || c.settlement.outcome !== 'failed' ||
          c.settlement.actualLocation !== r.plan.from || c.settlement.configurationDigest !== r.plan.digest ||
          JSON.stringify(c.settlement.cleanupReceipt) !== JSON.stringify(c.receipt))) throw unavailable();
    }
    if (r.quiescence) {
      const q = r.quiescence, g = q.grant;
      if (!isMcp || r.phase !== 'settled' || !r.receipt || g.status !== 'established' || g.cleanupReceipt ||
          g.id !== r.transitionID || g.agentId !== this.#agent || g.channel !== r.channel || g.taskID !== r.taskID ||
          g.previewID !== r.previewID || g.claimGeneration !== r.claimGeneration || g.purpose !== 'establish-mcp' ||
          g.from !== r.plan.from || g.to !== r.plan.to || g.preparedAt !== r.grant.preparedAt ||
          g.actualLocation !== r.plan.from || g.receiptID !== r.receiptID || g.settledAt === undefined ||
          g.configurationDigest !== r.plan.digest || JSON.stringify(g.mcpPlan) !== JSON.stringify(r.plan) ||
          JSON.stringify(g.resourceReceipt) !== JSON.stringify(r.receipt) ||
          ((q.phase === 'observed') !== !!q.receipt) || q.receipt &&
          (q.receipt.shutdownID !== q.shutdownID || JSON.stringify(q.receipt.resource) !== JSON.stringify(r.receipt))) throw unavailable();
    }
    if (r.step && (!isMcp || r.phase !== 'settled' || !r.plan.effects.stepPreparation || (r.quiescence && r.step.disposal?.phase !== 'observed') ||
        (r.step.phase === 'observed') !== !!r.step.receipt || r.step.disposal &&
        (r.step.phase !== 'observed' || (r.step.disposal.phase === 'observed') !== !!r.step.disposal.receipt ||
          r.step.disposal.receipt && (r.step.disposal.receipt.disposalID !== r.step.disposal.disposalID ||
            r.step.disposal.receipt.operationID !== r.step.receipt.operationID || r.step.disposal.receipt.candidateID !== r.step.receipt.candidateID ||
            r.step.disposal.receipt.stepID !== r.step.receipt.stepID || r.step.disposal.receipt.mcpResourceID !== r.step.receipt.mcpResourceID ||
            r.step.disposal.receipt.providerResourceID !== r.step.receipt.providerResourceID)))) throw unavailable();
    if (r.step?.movement) {
      const { grant, phase, cancellationID, cancellationReceipt, settlementID, publication } = r.step.movement, refs = grant.destinationOwners;
      if (r.step.phase !== 'observed' || (r.step.disposal && phase !== 'settled') || (r.quiescence && phase !== 'settled') || grant.status !== 'prepared' || !refs ||
          grant.agentId !== this.#agent || grant.taskID !== r.taskID || grant.channel !== r.channel ||
          grant.claimGeneration !== r.claimGeneration || grant.from !== r.plan.from || grant.to !== r.plan.to ||
          refs.mcpTransitionID !== r.transitionID || refs.providerTransitionID !== r.step.providerGrant.id ||
          refs.mcpResourceID !== r.receipt.resourceID || refs.providerResourceID !== r.step.providerGrant.resourceReceipt.resourceID ||
          refs.stepID !== r.step.receipt.stepID ||
          (['cancelling', 'cancel_uncertain', 'cancelled', 'settling', 'settlement_uncertain', 'settled'].includes(phase) !== !!cancellationID) ||
          (['cancelled', 'settling', 'settlement_uncertain', 'settled'].includes(phase) !== !!cancellationReceipt) ||
          (['settling', 'settlement_uncertain', 'settled'].includes(phase) !== !!settlementID) ||
          (cancellationReceipt && (cancellationReceipt.transitionID !== grant.id || cancellationReceipt.stepID !== refs.stepID ||
            cancellationReceipt.cancellationID !== cancellationID)) ||
          (publication && (phase !== 'bound' || (publication.phase === 'observed') !== !!publication.receipt ||
            publication.receipt && (publication.receipt.operationID !== publication.operationID || publication.receipt.transitionID !== grant.id ||
              publication.receipt.stepID !== refs.stepID) ||
            publication.sourceShutdown && (publication.phase !== 'observed' || grant.sourceMcpShutdown !== true ||
              (publication.sourceShutdown.phase === 'observed') !== !!publication.sourceShutdown.receipt ||
              publication.sourceShutdown.receipt && (publication.sourceShutdown.receipt.shutdownID !== publication.sourceShutdown.shutdownID ||
                publication.sourceShutdown.receipt.operationID !== publication.operationID || publication.sourceShutdown.receipt.transitionID !== grant.id ||
                publication.sourceShutdown.receipt.stepID !== refs.stepID)) ||
            publication.sourceModelShutdown && (publication.phase !== 'observed' || grant.sourceModelShutdown !== true ||
              publication.sourceShutdown?.phase !== 'observed' ||
              (publication.sourceModelShutdown.phase === 'observed') !== !!publication.sourceModelShutdown.receipt ||
              publication.sourceModelShutdown.receipt && (publication.sourceModelShutdown.receipt.shutdownID !== publication.sourceModelShutdown.shutdownID ||
                publication.sourceModelShutdown.receipt.operationID !== publication.operationID || publication.sourceModelShutdown.receipt.transitionID !== grant.id ||
                publication.sourceModelShutdown.receipt.stepID !== refs.stepID))))) throw unavailable();
    }
    return r;
  }
  #reload() {
    try {
      const file = z.strictObject({ version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), hostId: HostID, agentId: AgentID, records: z.array(recordSchema).max(256) }).parse(JSON.parse(readPrivate(this.#path)));
      if (file.hostId !== this.#host || file.agentId !== this.#agent || !uniqueIdentifiers(file.records)) throw unavailable();
      if (file.version === 1 && file.records.some(record => record.step?.movement?.publication)) throw unavailable();
      if (file.version < 3 && file.records.some(record => record.step?.movement?.publication?.sourceModelShutdown)) throw unavailable();
      if (file.version < 4 && file.records.some(record => record.step?.movement?.publication?.contained)) throw unavailable();
      this.#records = file.records.map(value => this.#validate(value));
      if (!validStepReferences(this.#records)) throw unavailable();
    } catch (error) { if (error.code !== 'ENOENT') throw error; this.#records = []; }
  }
  snapshot() { if (this.#locked || this.#fault) throw unavailable(); this.#reload(); return structuredClone(this.#records); }
  entries() { if (!this.#locked || this.#fault) throw unavailable(); return structuredClone(this.#records); }
  async exclusive(operation) {
    if (this.#locked || this.#fault) throw unavailable();
    const unlock = acquireStore(this.#lock, () => { this.#fault = true; }); this.#locked = true;
    try { this.#reload(); return await operation(); } finally { this.#locked = false; unlock(); }
  }
  put(value) {
    if (!this.#locked || this.#fault) throw unavailable();
    const r = this.#validate(value), previous = this.#records.find(item => item.transitionID === r.transitionID);
    if ((!previous && r.phase !== 'previewing') || (previous && (fixed(previous) !== fixed(r) ||
        (previous.phase === 'dispatching' && r.phase === 'dispatching') ||
        (establishment(previous) !== establishment(r) && !transitions[previous.phase].includes(r.phase)) ||
        (previous.grant && JSON.stringify(previous.grant) !== JSON.stringify(r.grant)) ||
        (previous.receipt && JSON.stringify(previous.receipt) !== JSON.stringify(r.receipt)) ||
        (previous.settlement && JSON.stringify(previous.settlement) !== JSON.stringify(r.settlement)) ||
        !validCleanupChange(previous.cleanup, r.cleanup) || !validQuiescenceChange(previous.quiescence, r.quiescence) ||
        !validStepChange(previous.step, r.step)))) throw unavailable();
    const next = this.#records.filter(item => item.transitionID !== r.transitionID); next.push(r);
    if (next.length > 256 || !uniqueIdentifiers(next) || !validStepReferences(next)) throw unavailable();
    atomicWrite(this.#path, JSON.stringify({ version: next.some(record => record.step?.movement?.publication?.contained) ? 4 : next.some(record => record.step?.movement?.publication?.sourceModelShutdown) ? 3 : next.some(record => record.step?.movement?.publication) ? 2 : 1,
      hostId: this.#host, agentId: this.#agent, records: next })); this.#records = next;
    return structuredClone(r);
  }
}
