import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AgentID } from './protocol.js';
import { UUID, Stamp, WorktreeTransition } from './control/contracts.js';
import { sameMcpPlan } from './control/mcp-establishment-contracts.js';
import { sameProviderPlan } from './control/provider-establishment-contracts.js';
import { abortCodexUnstartedProvider, cleanupCodexProvider, dispatchCodexResource, observeCodexMcpQuiescence, observeCodexProviderCleanup, quiesceCodexMcp, reconcileCodexResourceSettlement } from './codex-resource-dispatch.js';
import { dispatchCodexDestinationStep, observeCodexDestinationStep, disposeCodexDestinationStep, observeCodexDestinationStepDisposal } from './codex-step-dispatch.js';
import { cancelCodexDestinationMovement, observeCodexDestinationMovementCancellation, settleCodexDestinationCancellation } from './codex-movement-coordinator.js';

const unavailable = () => Object.assign(new Error('NATIVE_PREPARATION_UNAVAILABLE'), { code: 'NATIVE_PREPARATION_UNAVAILABLE' });
const uncertain = cause => Object.assign(new Error('NATIVE_PREPARATION_UNCERTAIN', { cause }), { code: 'NATIVE_PREPARATION_UNCERTAIN' });

// Coordinates a disposable, data-only native preparation with the stdio fence.
// It does not authorize resource creation, movement, or receiver release.
export async function withCodexNativePreparation({ fence, native, threadId }, operation) {
  AgentID.parse(`codex:${threadId}`);
  if (typeof fence?.exclusive !== 'function' || typeof native?.acquire !== 'function' ||
      typeof native?.abandonPreparation !== 'function' || typeof operation !== 'function' ||
      (typeof native.onClose === 'function' && typeof fence.invalidate !== 'function')) throw unavailable();
  let unsubscribe = () => {};
  try {
    return await fence.exclusive(threadId, async ({ signal, guard, markExternalPending, markExternalReleased, reserveExternalRecovery }) => {
      unsubscribe = typeof native.onClose === 'function' ? native.onClose(() => fence.invalidate('NATIVE_OWNER_CLOSED')) : () => {};
      markExternalPending();
      let reservation;
      try { reservation = await native.acquire(threadId); }
      catch (error) {
        // This native response specifically proves that no reservation was made.
        if (error?.code === 'NATIVE_CONTINUITY_NOT_ACQUIRED') markExternalReleased();
        throw error;
      }
      guard();
      let result, failure, failed = false;
      try { result = await operation({ reservation, signal, guard }); }
      catch (error) { failed = true; failure = error; }
      try {
        // Allow one timed-out abandonment and one bounded observation, even if
        // preparation consumed most of the original fence window.
        if (Number.isSafeInteger(native.timeoutMs) && native.timeoutMs >= 10 && native.timeoutMs <= 300000)
          reserveExternalRecovery(2 * native.timeoutMs + 1000);
        try { await native.abandonPreparation(threadId, reservation); }
        catch (error) {
          if (error?.code !== 'NATIVE_CONTINUITY_UNCERTAIN' || typeof native.observeAbandonedPreparation !== 'function') throw error;
          await native.observeAbandonedPreparation(threadId, reservation);
        }
        guard();
        markExternalReleased();
      } catch { throw uncertain(); }
      if (failed) throw failure;
      return result;
    });
  } finally { unsubscribe(); }
}

// Assemble the native data-only candidate and both unstarted resource plans
// under one live reservation. The callback runs while that exact owner and
// admission fence are held; the plans are not executable after this returns.
export async function withCodexDestinationPreparation({ fence, native, threadId, destination, modelContext = false, refreshCatalog = false }, operation) {
  if (typeof destination !== 'string' || !destination || typeof operation !== 'function' ||
      typeof modelContext !== 'boolean' || typeof refreshCatalog !== 'boolean' || (refreshCatalog && !modelContext) ||
      typeof native?.retainDestination !== 'function' || typeof native?.validateDestination !== 'function' ||
      typeof native?.planMcp !== 'function' || typeof native?.planProvider !== 'function') throw unavailable();
  return withCodexNativePreparation({ fence, native, threadId }, async ({ reservation, signal, guard }) => {
    const { candidateId } = await native.retainDestination(threadId, reservation, destination);
    guard(); await native.validateDestination(threadId, reservation, candidateId); guard();
    const mcpPlan = await native.planMcp(threadId, reservation, destination);
    guard();
    const providerPlan = await native.planProvider(threadId, reservation, destination, { modelContext, refreshCatalog });
    guard(); await native.validateDestination(threadId, reservation, candidateId); guard();
    const result = await operation({ reservation, candidateId, mcpPlan, providerPlan, signal, guard });
    guard(); await native.validateDestination(threadId, reservation, candidateId); guard();
    return result;
  });
}

// Owns the fence before native acquisition. A provider-only abort can drain it
// after exact native cleanup and broker settlement; MCP and movement remain held.
export async function withCodexResourceOwnership({ fence, native, threadId, client, credential, journal, abandonUnstarted = false }, operation) {
  AgentID.parse(`codex:${threadId}`);
  if (typeof fence?.exclusive !== 'function' || typeof fence?.invalidate !== 'function' || typeof native?.acquire !== 'function' ||
      typeof native?.onClose !== 'function' || typeof operation !== 'function' || typeof abandonUnstarted !== 'boolean' ||
      (abandonUnstarted && (typeof native?.abandonPreparation !== 'function' || typeof journal?.exclusive !== 'function' ||
        typeof journal?.entries !== 'function' || typeof journal?.put !== 'function' || journal.agentId !== `codex:${threadId}` || client?.hostId !== journal.hostId)) ||
      native.supportsPublicationFixture === true && (typeof native.usesPublicationFence !== 'function' || !native.usesPublicationFence(fence))) throw unavailable();
  let unsubscribe = () => {};
  try {
    return await fence.exclusive(threadId, async ({ signal, guard, publicationGuard, beginPublication, endPublication, markExternalPending, markExternalReleased, reserveExternalRecovery }) => {
      unsubscribe = native.onClose(() => fence.invalidate('NATIVE_OWNER_CLOSED'));
      markExternalPending();
      let reservation;
      try { reservation = await native.acquire(threadId); }
      catch (error) {
        if (error?.code === 'NATIVE_CONTINUITY_NOT_ACQUIRED') markExternalReleased();
        throw error;
      }
      let releaseTransition;
      let result;
      try {
        guard(); result = await operation({ reservation, signal, guard, publicationGuard, beginPublication, endPublication, reserveExternalRecovery, requestProviderRelease: transitionID => {
          guard(); if (releaseTransition) throw unavailable(); releaseTransition = UUID.parse(transitionID);
        } }); guard();
      } catch (error) {
        if (!abandonUnstarted || releaseTransition) throw error;
        try {
          await journal.exclusive(async () => {
            const check = () => { guard(); if (signal.aborted || client.hostId !== journal.hostId) throw uncertain(); };
            check();
            const records = journal.entries(), active = records.filter(record => !['abandoned', 'aborted'].includes(record.phase));
            // The dispatching marker is durable before every native effect.
            // An authorizing or prepared record may own a broker hold, but its
            // native dispatch marker has not been written. Recover only an
            // exactly observed grant; absence does not prove the begin failed.
            if (active.length > 1 || active.some(record => !['previewing', 'previewed', 'authorizing', 'prepared'].includes(record.phase) ||
                JSON.stringify(record.plan.reservation) !== JSON.stringify(reservation))) return;
            let record = active[0];
            if (record && ['authorizing', 'prepared'].includes(record.phase)) {
              if (!client?.request || typeof credential !== 'function') return;
              const page = await client.request('control_query', { agentId: journal.agentId, channel: record.channel,
                view: 'transitions', entityID: record.transitionID, offset: 0, limit: 1 });
              check();
              if (!Array.isArray(page?.entries) || page.entries.length !== 1) return;
              const grant = WorktreeTransition.parse(page.entries[0]);
              if (grant.status !== 'prepared') return;
              if (record.phase === 'authorizing') record = journal.put({ ...record, phase: 'prepared', grant });
              else if (JSON.stringify(record.grant) !== JSON.stringify(grant)) return;
              check();
            }
            if (Number.isSafeInteger(native.timeoutMs) && native.timeoutMs >= 10 && native.timeoutMs <= 300000)
              reserveExternalRecovery(2 * native.timeoutMs + 1000);
            try { await native.abandonPreparation(threadId, reservation); }
            catch (abandonError) {
              if (abandonError?.code !== 'NATIVE_CONTINUITY_UNCERTAIN' || typeof native.observeAbandonedPreparation !== 'function') throw abandonError;
              await native.observeAbandonedPreparation(threadId, reservation);
            }
            check();
            if (record?.phase === 'prepared') {
              const settlement = { id: record.receiptID, op: 'worktree.settle', channel: record.channel,
                transitionID: record.transitionID, purpose: record.grant.purpose, outcome: 'failed', actualLocation: record.plan.from,
                configurationDigest: record.plan.digest, receiptID: record.receiptID };
              record = journal.put({ ...record, phase: 'aborting', settlement }); check();
              const send = async () => {
                const key = await credential(); check();
                const reply = await client.request('control_adapter', { agentId: journal.agentId, credential: key, command: settlement });
                check(); if (reply?.commandID !== settlement.id) throw uncertain();
              };
              try { await send(); } catch { check(); await send(); }
              const page = await client.request('control_query', { agentId: journal.agentId, channel: record.channel,
                view: 'transitions', entityID: record.transitionID, offset: 0, limit: 1 });
              check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw uncertain();
              const current = WorktreeTransition.parse(page.entries[0]);
              const expected = WorktreeTransition.parse({ ...record.grant, status: 'failed', actualLocation: record.plan.from,
                receiptID: record.receiptID, settledAt: current.settledAt });
              if (JSON.stringify(current) !== JSON.stringify(expected)) throw uncertain();
              journal.put({ ...record, phase: 'aborted' }); check();
            } else if (record) { journal.put({ ...record, phase: 'abandoned' }); check(); }
            markExternalReleased();
          });
        } catch { throw uncertain(error); }
        throw error;
      }
      if (releaseTransition) {
        const agentId = `codex:${threadId}`;
        if (!client?.request || typeof credential !== 'function' || !journal?.exclusive || journal.agentId !== agentId || client.hostId !== journal.hostId ||
            typeof native.takeReleasedProviderOwner !== 'function') throw uncertain();
        await journal.exclusive(async () => {
          guard(); if (signal.aborted || client.hostId !== journal.hostId) throw uncertain();
          const record = journal.entries().find(value => value.transitionID === releaseTransition);
          if (!record || record.plan.kind === 'mcp_runtime' || record.phase !== 'settled' || record.cleanup?.phase !== 'settled' ||
              JSON.stringify(record.plan.reservation) !== JSON.stringify(reservation)) throw uncertain();
          const page = await client.request('control_query', { agentId, channel: record.channel, view: 'transitions', entityID: releaseTransition, offset: 0, limit: 1 });
          guard(); if (signal.aborted || client.hostId !== journal.hostId || !Array.isArray(page?.entries) || page.entries.length !== 1) throw uncertain();
          const current = WorktreeTransition.parse(page.entries[0]);
          if (current.id !== releaseTransition || current.agentId !== agentId || current.status !== 'failed' || current.purpose !== 'establish-provider' ||
              current.channel !== record.channel || current.taskID !== record.taskID || current.previewID !== record.previewID ||
              current.claimGeneration !== record.claimGeneration || current.from !== record.plan.from || current.to !== record.plan.to ||
              current.configurationDigest !== record.plan.digest || current.preparedAt !== record.grant.preparedAt ||
              current.settledAt === undefined || current.settledAt < record.cleanup.grant.settledAt ||
              current.receiptID !== record.cleanup.receiptID || current.actualLocation !== record.plan.from ||
              JSON.stringify(current.providerPlan) !== JSON.stringify(record.plan) || JSON.stringify(current.resourceReceipt) !== JSON.stringify(record.receipt) ||
              JSON.stringify(current.cleanupReceipt) !== JSON.stringify(record.cleanup.receipt)) throw uncertain();
          const key = await credential(); guard(); if (signal.aborted || client.hostId !== journal.hostId) throw uncertain();
          const authorized = await client.request('control_worktree_authorize', { agentId, channel: record.channel, credential: key,
            action: 'release-provider', grant: current });
          guard(); if (signal.aborted || client.hostId !== journal.hostId || !Stamp.safeParse(authorized?.checkedAt).success ||
              authorized.checkedAt < current.settledAt || JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(current)) throw uncertain();
          native.takeReleasedProviderOwner(threadId, reservation, record.cleanup.receipt, client);
          guard(); markExternalReleased();
        });
        return result;
      }
      throw Object.assign(new Error('NATIVE_RESOURCE_OWNERSHIP_HELD'), { code: 'NATIVE_RESOURCE_OWNERSHIP_HELD' });
    });
  } finally { unsubscribe(); }
}

// Establish the actual target owners while one retained candidate, native
// reservation and admission fence remain live. The callback is still fenced;
// these resource receipts do not authorize placement or receiver release.
export async function withCodexEstablishedDestination({ fence, native, threadId, destination, client, credential, journal,
  channel, taskID, claimGeneration, modelContext = true, refreshCatalog = false, stepPreparation = false, pollMs = 500, verifierService, validateProject,
  requireDeclaredCredentialPreflight = false }, operation) {
  const agentId = AgentID.parse(`codex:${threadId}`); UUID.parse(taskID);
  if (typeof destination !== 'string' || !destination || typeof operation !== 'function' || typeof credential !== 'function' ||
      !client?.request || !journal?.exclusive || journal.agentId !== agentId || client.hostId !== journal.hostId || typeof channel !== 'string' || !channel ||
      (verifierService !== undefined && typeof verifierService?.register !== 'function') ||
      (validateProject !== undefined && typeof validateProject !== 'function') ||
      typeof requireDeclaredCredentialPreflight !== 'boolean' ||
      (requireDeclaredCredentialPreflight && typeof native?.preflightProviderCredential !== 'function') ||
      !Number.isSafeInteger(claimGeneration) || claimGeneration <= 0 || typeof modelContext !== 'boolean' ||
      typeof refreshCatalog !== 'boolean' || typeof stepPreparation !== 'boolean' || ((refreshCatalog || stepPreparation) && !modelContext) ||
      (stepPreparation && (native?.supportsMcpStepPreparation !== true || native?.supportsMcpStepDisposal !== true ||
        typeof native?.assertRetainedDestinationOwners !== 'function' || typeof native?.preflightDestinationStep !== 'function' || typeof native?.prepareDestinationStep !== 'function' ||
        typeof native?.markCompletedStepUncertain !== 'function' || typeof native?.validateRetainedDestinationStep !== 'function' ||
        typeof native?.assertRetainedStepDisposal !== 'function' || typeof native?.disposeDestinationStep !== 'function' ||
        typeof native?.markCompletedStepDisposalUncertain !== 'function' || typeof native?.acknowledgeRecordedStepDisposal !== 'function' ||
        typeof native?.observeDestinationStep !== 'function' || typeof native?.observeDestinationStepDisposal !== 'function')) ||
      !Number.isSafeInteger(pollMs) || pollMs < 10 || pollMs > 30000 ||
      typeof native?.retainDestination !== 'function' || typeof native?.validateDestination !== 'function' ||
      typeof native?.planMcp !== 'function' || typeof native?.planProvider !== 'function' || typeof native?.assertRetainedResourcePlan !== 'function' ||
      typeof native?.constructMcp !== 'function' || typeof native?.constructProvider !== 'function') throw unavailable();
  return withCodexResourceOwnership({ fence, native, threadId, client, credential, journal, abandonUnstarted: true }, async ({ reservation, signal, guard, publicationGuard, beginPublication, endPublication, reserveExternalRecovery, requestProviderRelease }) => {
    const checkDeclaredCredential = async () => {
      if (!requireDeclaredCredentialPreflight) return;
      guard(); const status = await native.preflightProviderCredential(threadId, reservation, destination); guard();
      if (status === 'missing') throw Object.assign(new Error('NATIVE_DECLARED_CREDENTIAL_MISSING'), { code: 'NATIVE_DECLARED_CREDENTIAL_MISSING' });
      if (status === 'changed') throw Object.assign(new Error('NATIVE_PROVIDER_PREPARATION_CHANGED'), { code: 'NATIVE_PROVIDER_PREPARATION_CHANGED' });
      if (!['present', 'not_declared'].includes(status)) throw unavailable();
    };
    await checkDeclaredCredential();
    const { candidateId } = await native.retainDestination(threadId, reservation, destination); guard();
    await native.validateDestination(threadId, reservation, candidateId); guard();
    await checkDeclaredCredential();
    const mcpPlan = await native.planMcp(threadId, reservation, destination, { bindingCapture: true, pluginCapture: true, skillCapture: true,
      ...(stepPreparation ? { stepPreparation: true } : {}) }); guard();
    const providerPlan = await native.planProvider(threadId, reservation, destination, { modelContext, refreshCatalog }); guard();
    await native.validateDestination(threadId, reservation, candidateId); guard();
    const validateDispatch = validateProject || requireDeclaredCredentialPreflight ? async () => {
      if (validateProject) await validateProject(); guard(); await checkDeclaredCredential(); guard();
    } : undefined;
    const common = { client, credential, native, journal, agentId, channel, taskID, claimGeneration, reservation, signal, guard, pollMs,
      ...(validateDispatch ? { validateProject: validateDispatch } : {}) };
    const validateBeforeOperation = async (mcp, provider, checkOwners = async () => {}) => {
      try { await native.validateDestination(threadId, reservation, candidateId); guard(); await checkOwners(); guard(); }
      catch (error) {
        // Only settled, exact resources returned by this attempt are eligible.
        // MCP quiescence retains its broker hold and does not release the fence.
        const recoveryWindow = () => {
          guard();
          if (Number.isSafeInteger(native.timeoutMs) && native.timeoutMs >= 10 && native.timeoutMs <= 300000)
            reserveExternalRecovery(2 * native.timeoutMs + 1000);
        };
        const stopState = (transitionID, field) => {
          guard(); const record = journal.snapshot().find(value => value.transitionID === transitionID);
          guard(); return record?.[field]?.phase;
        };
        const observeWithoutReplay = async (observe, args) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            recoveryWindow();
            try { return await observe(args); }
            catch (error) {
              if (attempt === 2 || !['NATIVE_CONTINUITY_UNCERTAIN', 'CODEX_RESOURCE_DISPATCH_UNCERTAIN',
                'CODEX_STEP_PREPARATION_UNCERTAIN', 'CODEX_STEP_DISPOSAL_UNCERTAIN'].includes(error?.code)) throw error;
              await delay(Math.min(pollMs, 250), undefined, { signal });
              guard();
            }
          }
        };
        try {
          if (mcp) {
            const stepArgs = { ...common, mcpTransitionID: mcp.transitionID, providerTransitionID: provider?.transitionID, candidateId };
            let recorded = journal.snapshot().find(value => value.transitionID === mcp.transitionID)?.step;
            if (recorded && ['dispatching', 'uncertain'].includes(recorded.phase)) {
              recoveryWindow(); await observeWithoutReplay(observeCodexDestinationStep, stepArgs);
              recorded = journal.snapshot().find(value => value.transitionID === mcp.transitionID)?.step;
            }
            if (recorded?.phase === 'observed' && !recorded.disposal) {
              recoveryWindow();
              try { await disposeCodexDestinationStep(stepArgs); }
              catch {
                const phase = journal.snapshot().find(value => value.transitionID === mcp.transitionID)?.step?.disposal?.phase;
                if (!['dispatching', 'uncertain'].includes(phase)) throw uncertain();
                await observeWithoutReplay(observeCodexDestinationStepDisposal, stepArgs);
              }
            } else if (recorded?.disposal && ['dispatching', 'uncertain'].includes(recorded.disposal.phase)) {
              recoveryWindow(); await observeWithoutReplay(observeCodexDestinationStepDisposal, stepArgs);
            } else if (recorded && recorded.disposal?.phase !== 'observed') throw uncertain();
          }
          if (provider) {
            const args = { ...common, transitionID: provider.transitionID };
            recoveryWindow();
            try { await cleanupCodexProvider(args); }
            catch {
              const phase = stopState(provider.transitionID, 'cleanup');
              if (phase === 'dispatching' || phase === 'uncertain') {
                await observeWithoutReplay(observeCodexProviderCleanup, args);
              } else if (phase !== 'observed') throw uncertain();
              // An observed cleanup permits only its exact journaled broker
              // settlement to be retried; native disposal is never repeated.
              recoveryWindow(); await cleanupCodexProvider(args);
            }
          }
          if (mcp) {
            const args = { ...common, transitionID: mcp.transitionID };
            recoveryWindow();
            try { await quiesceCodexMcp(args); }
            catch {
              const phase = stopState(mcp.transitionID, 'quiescence');
              if (phase !== 'dispatching' && phase !== 'uncertain') throw uncertain();
              // A lost stop is observed on the same owner; do not send a
              // second shutdown or infer physical release.
              await observeWithoutReplay(observeCodexMcpQuiescence, args);
            }
          }
        } catch { throw uncertain(); }
        throw error;
      }
    };
    const establish = async plan => {
      try { return await dispatchCodexResource({ ...common, plan }); }
      catch (error) {
        // Only a durable native receipt permits retrying the broker settlement.
        // Never repeat construction or promote an uncertain native effect.
        guard();
        const record = journal.snapshot().find(value => value.plan.id === plan.id);
        const samePlan = plan.kind === 'mcp_runtime' ? sameMcpPlan : sameProviderPlan;
        if (!record || !['observed', 'settled'].includes(record.phase) || !record.receipt || !record.settlement ||
            !samePlan(record.plan, plan)) throw error;
        const settled = await reconcileCodexResourceSettlement({ ...common, transitionID: record.transitionID });
        guard();
        if (settled.phase !== 'settled') throw uncertain();
        return { grant: settled.grant, receipt: settled.receipt, transitionID: settled.transitionID };
      }
    };
    const mcp = await establish(mcpPlan); guard();
    await validateBeforeOperation(mcp);
    let provider;
    try { provider = await establish(providerPlan); }
    catch (error) {
      guard();
      const record = journal.snapshot().find(value => value.plan.id === providerPlan.id);
      // Before dispatching is journaled, no native provider construction has
      // been invoked by this attempt. Stop the already established MCP owner
      // under its own authorization; an ambiguous provider effect stays held.
      if (!record || ['previewing', 'previewed', 'authorizing', 'prepared', 'aborting'].includes(record.phase)) {
        let abortFailed = false;
        try { await abortCodexUnstartedProvider({ ...common, mcpTransitionID: mcp.transitionID, plan: providerPlan }); }
        catch { abortFailed = true; }
        try { await validateBeforeOperation(mcp, undefined, async () => { throw error; }); }
        catch (cleanupError) { if (abortFailed) throw uncertain(); throw cleanupError; }
      }
      throw error;
    }
    guard();
    let step;
    await validateBeforeOperation(mcp, provider, async () => {
      const check = () => { if (signal.aborted || client.hostId !== journal.hostId) throw unavailable(); guard(); };
      if (validateProject) { check(); await validateProject(); check(); }
      const current = async (owned, purpose, plan) => {
        check();
        const samePlan = purpose === 'establish-mcp' ? sameMcpPlan : sameProviderPlan;
        const record = journal.snapshot().find(value => value.transitionID === owned.transitionID);
        if (!record || record.phase !== 'settled' || record.cleanup || record.quiescence ||
            !samePlan(record.plan, plan) || JSON.stringify(record.receipt) !== JSON.stringify(owned.receipt)) throw unavailable();
        const page = await client.request('control_query', { agentId, channel, view: 'transitions', entityID: owned.transitionID, offset: 0, limit: 1 });
        check(); if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
        const grant = WorktreeTransition.parse(page.entries[0]);
        if (grant.id !== owned.transitionID || grant.purpose !== purpose || grant.status !== 'established' || !Stamp.safeParse(grant.settledAt).success ||
            JSON.stringify(grant.resourceReceipt) !== JSON.stringify(owned.receipt) ||
            !samePlan(purpose === 'establish-mcp' ? grant.mcpPlan : grant.providerPlan, plan)) throw unavailable();
        return grant;
      };
      const mcpGrant = await current(mcp, 'establish-mcp', mcpPlan);
      const providerGrant = await current(provider, 'establish-provider', providerPlan);
      const key = await credential(); check();
      const observed = await client.request('control_worktree_authorize', { agentId, channel, credential: key,
        action: 'observe-destination-owners', grant: mcpGrant, peerGrant: providerGrant });
      check();
      if (!Stamp.safeParse(observed?.checkedAt).success || observed.checkedAt < Math.max(mcpGrant.settledAt, providerGrant.settledAt) ||
          JSON.stringify(WorktreeTransition.parse(observed.mcpGrant)) !== JSON.stringify(mcpGrant) ||
          JSON.stringify(WorktreeTransition.parse(observed.providerGrant)) !== JSON.stringify(providerGrant)) throw unavailable();
      if (stepPreparation) {
        // The two resource dispatches advertise separate capabilities. Publish
        // the combined observation only after both exact owners were checked.
        for (const evidence of [{ kind: 'capability', nativeMcpRuntime: true, nativeProviderFactory: true }, { kind: 'idle' }]) {
          check(); const key = await credential(); check();
          const command = { id: randomUUID(), op: 'evidence.record', channel, entityID: taskID, ...evidence };
          const reply = await client.request('control_adapter', { agentId, credential: key, command });
          check(); if (reply?.commandID !== command.id) throw unavailable();
        }
        const stepArgs = { ...common, mcpTransitionID: mcp.transitionID, providerTransitionID: provider.transitionID, candidateId };
        try { step = await dispatchCodexDestinationStep(stepArgs); }
        catch (error) {
          const phase = journal.snapshot().find(value => value.transitionID === mcp.transitionID)?.step?.phase;
          if (!['dispatching', 'uncertain'].includes(phase)) throw error;
          for (let attempt = 0; attempt < 3; attempt++) {
            guard(); if (Number.isSafeInteger(native.timeoutMs) && native.timeoutMs >= 10 && native.timeoutMs <= 300000)
              reserveExternalRecovery(2 * native.timeoutMs + 1000);
            try { step = await observeCodexDestinationStep(stepArgs); break; }
            catch (observeError) {
              if (attempt === 2 || observeError?.code !== 'CODEX_STEP_PREPARATION_UNCERTAIN') throw observeError;
              await delay(Math.min(pollMs, 250), undefined, { signal }); guard();
            }
          }
        }
        guard(); await native.validateRetainedDestinationStep({ threadId, reservation, step }); guard();
      }
    });
    const stopPreparedDestination = async () => {
      guard();
      let current = journal.snapshot().find(value => value.transitionID === mcp.transitionID);
      if (!current || current.quiescence ||
          journal.snapshot().find(value => value.transitionID === provider.transitionID)?.cleanup) throw unavailable();
      if (current.step?.movement && current.step.movement.phase !== 'settled') {
        if (!verifierService) throw unavailable();
        const args = { ...common, mcpTransitionID: mcp.transitionID, verifierService };
        const recoveryWindow = () => {
          guard(); if (Number.isSafeInteger(native.timeoutMs) && native.timeoutMs >= 10 && native.timeoutMs <= 300000)
            reserveExternalRecovery(2 * native.timeoutMs + 1000);
        };
        if (current.step.movement.phase === 'bound') {
          recoveryWindow();
          try { await cancelCodexDestinationMovement(args); }
          catch (error) {
            current = journal.snapshot().find(value => value.transitionID === mcp.transitionID);
            if (!['cancelling', 'cancel_uncertain'].includes(current?.step?.movement?.phase)) throw error;
          }
        }
        current = journal.snapshot().find(value => value.transitionID === mcp.transitionID);
        if (['cancelling', 'cancel_uncertain'].includes(current?.step?.movement?.phase)) {
          for (let attempt = 0; attempt < 3; attempt++) {
            recoveryWindow();
            try { await observeCodexDestinationMovementCancellation(args); break; }
            catch (error) { if (attempt === 2 || error?.code !== 'CODEX_MOVEMENT_COORDINATION_UNCERTAIN') throw error; await delay(Math.min(pollMs, 250), undefined, { signal }); }
          }
        }
        current = journal.snapshot().find(value => value.transitionID === mcp.transitionID);
        if (!['cancelled', 'settling', 'settlement_uncertain', 'settled'].includes(current?.step?.movement?.phase)) throw unavailable();
        if (current.step.movement.phase !== 'settled') {
          for (let attempt = 0; attempt < 3; attempt++) {
            recoveryWindow();
            try { await settleCodexDestinationCancellation(args); break; }
            catch (error) { if (attempt === 2 || error?.code !== 'CODEX_MOVEMENT_COORDINATION_UNCERTAIN') throw error; await delay(Math.min(pollMs, 250), undefined, { signal }); }
          }
        }
        current = journal.snapshot().find(value => value.transitionID === mcp.transitionID);
        if (current?.step?.movement?.phase !== 'settled') throw uncertain();
      }
      // The ordinary validation failure path already performs separately
      // authorized, journaled step disposal and owner shutdown. The marker
      // distinguishes that exact controlled exit from a validation failure.
      const requested = new Error('NATIVE_UNBOUND_ABANDON_REQUESTED');
      try { await validateBeforeOperation(mcp, provider, async () => { throw requested; }); }
      catch (error) { if (error !== requested) throw error; }
      guard();
    };
    const result = await operation({ reservation, candidateId, mcpPlan, providerPlan, mcp, provider, ...(stepPreparation ? { step } : {}), stopPreparedDestination,
      ...(verifierService ? { verifierService } : {}), signal, guard, publicationGuard, beginPublication, endPublication, requestProviderRelease });
    guard(); await native.validateDestination(threadId, reservation, candidateId); guard();
    if (stepPreparation) { await native.validateRetainedDestinationStep({ threadId, reservation, step }); guard(); }
    return result;
  });
}
