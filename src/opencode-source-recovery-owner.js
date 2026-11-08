#!/usr/bin/env node
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { HostID } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { receiverHandoffKey, validateCredential } from './config.js';
import { assertPrivateFile, readPrivate } from './storage.js';
import { activatePreparedOwner, assertEndpointAvailable, nativeEnvironment, prepareLeasedOwner, publishEndpoint } from './opencode-completion-owner.js';
import { launchOpenCodeNativeRecovery } from './opencode-native-recovery-launcher.js';
import { OpenCodeDestinationReceiver, openCodeMovementRpc } from './opencode-destination-receiver.js';
import { OpenCodeLiveMovementJournal } from './opencode-live-movement.js';
import { OpenCodeRecoveryJournal } from './opencode-recovery-journal.js';
import { OpenCodeDetachmentJournal } from './opencode-detachment-journal.js';
import { OpenCodeRecoveredDestinationJournal } from './opencode-recovered-destination-journal.js';
import { OpenCodeLiveRecovery } from './opencode-live-recovery.js';
import { createOpenCodeSourceRecoveryVerifierServer } from './opencode-source-recovery-verifier-transport.js';
import { createOpenCodeCompletionVerifierServer } from './opencode-completion-verifier-transport.js';
import { OpenCodeCompletedRecovery } from './opencode-completed-recovery.js';
import { ChannelClient } from './client.js';
import { samePlacementGrant } from './opencode-placement-settlement.js';
import { createOpenCodeEndpointGate } from './opencode-endpoint-gate.js';

const unavailable = () => Object.assign(new Error('OPENCODE_SOURCE_OWNER_UNAVAILABLE'), { code: 'OPENCODE_SOURCE_OWNER_UNAVAILABLE' });
const path = z.string().min(1).refine(value => isAbsolute(value) && !value.includes('\0'));
const schema = z.strictObject({ version: z.literal(1), hostId: HostID, grant: WorktreeTransition,
  mode: z.enum(['live', 'successor']), runtime: path, entrypoint: path, database: path,
  source: z.strictObject({ directory: path, workspaceID: z.string().optional() }), credentialDirectory: path,
  liveJournalDirectory: path, recoveryJournalDirectory: path, detachmentJournalDirectory: path, destinationJournalDirectory: path,
  hostTokenFile: path, adapterTokenFile: path, movementTokenFile: path, verifierTokenFile: path, verifierSocket: path,
  finish: z.boolean().optional(), refreshRecoveryIdle: z.boolean().optional(), completionVerifierTokenFile: path.optional(), completionVerifierSocket: path.optional(), completionVerifierDirectory: path.optional(), endpointFile: path.optional(), endpointDirectory: path.optional(), ownerLease: z.boolean().optional(),
  brokerUrl: z.string().url().max(2048).optional(),
  nativeEnvironmentAllowlist: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)).max(64).optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional() }).superRefine((value, context) => {
  if (!value.grant.agentId.startsWith('opencode:ses_') || !['prepared', 'uncertain', ...(value.finish ? ['moved'] : [])].includes(value.grant.status) ||
      (value.grant.status === 'moved' && (!value.grant.receiptID || value.grant.actualLocation !== value.grant.to)) ||
      value.grant.purpose || value.source.directory !== value.grant.from)
    context.addIssue({ code: 'custom', message: 'Invalid source recovery grant' });
  if (value.finish ? !(value.completionVerifierTokenFile && (!!value.completionVerifierSocket !== !!value.completionVerifierDirectory) && (!!value.endpointFile !== !!value.endpointDirectory)) :
      !!(value.completionVerifierTokenFile || value.completionVerifierSocket || value.completionVerifierDirectory || value.endpointFile || value.endpointDirectory))
    context.addIssue({ code: 'custom', message: 'Incomplete completion configuration' });
  if (value.brokerUrl && !value.finish) context.addIssue({ code: 'custom', message: 'Grant discovery requires finish mode' });
  if (value.ownerLease ? (!value.finish || !value.endpointDirectory || !value.completionVerifierDirectory) : !!value.completionVerifierDirectory)
    context.addIssue({ code: 'custom', message: 'Owner lease requires generation-specific finish mode' });
  if (value.refreshRecoveryIdle && (!value.finish || value.mode !== 'successor'))
    context.addIssue({ code: 'custom', message: 'Recovery idle observation requires successor finish mode' });
});

// Only adopt the same grant. A new moved state must match the exact placement
// and settlement intent already persisted by this owner.
export function selectCurrentRecoveryGrant(original, candidate, records) {
  const old = WorktreeTransition.parse(original), current = WorktreeTransition.parse(candidate);
  if (!samePlacementGrant(old, current) || old.purpose || current.purpose) throw unavailable();
  if (JSON.stringify(old) === JSON.stringify(current)) return current;
  if (!['prepared', 'uncertain'].includes(old.status) || current.status !== 'moved' || current.actualLocation !== old.to) throw unavailable();
  const matches = records.filter(record => record?.grant?.id === old.id && record.commit?.phase === 'committed' &&
    record.settlement && record.settlement.receiptID === current.receiptID &&
    JSON.stringify(record.commit.placement) === JSON.stringify(record.settlement.placement));
  if (matches.length !== 1) throw unavailable();
  return current;
}

async function discoverGrant(config, original, hostToken, records, signal) {
  const client = new ChannelClient({ url: config.brokerUrl, token: hostToken, credentialDirectory: config.credentialDirectory });
  const abort = () => client.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw unavailable();
    await client.connect();
    if (signal.aborted || client.hostId !== config.hostId) throw unavailable();
    client.receiverKeys.set(original.agentId, receiverHandoffKey(config.hostId, original.agentId, original.id, config.credentialDirectory));
    const page = await client.request('control_query', { agentId: original.agentId, channel: original.channel,
      view: 'transitions', entityID: original.id, offset: 0, limit: 1 });
    if (signal.aborted || !Array.isArray(page?.entries) || page.entries.length !== 1) throw unavailable();
    return selectCurrentRecoveryGrant(original, page.entries[0], records);
  } finally { signal.removeEventListener('abort', abort); client.close(); }
}

// Explicitly owns one quarantined recovery; the operator supplies a broker grant
// and chooses which native lease originally detached membership.
export async function startOpenCodeSourceRecoveryOwner(value, { env = process.env, signal, onVerifierRegistered, onStage } = {}) {
  if (signal?.aborted) throw unavailable();
  if (onVerifierRegistered !== undefined && typeof onVerifierRegistered !== 'function') throw unavailable();
  if (onStage !== undefined && typeof onStage !== 'function') throw unavailable();
  const stage = value => { try { onStage?.(value); } catch {} };
  const config = schema.parse(value), agentId = config.grant.agentId, sessionID = agentId.slice('opencode:'.length);
  const endpointFile = config.endpointFile || (config.endpointDirectory ? join(config.endpointDirectory, `turnlink-${randomUUID()}.json`) : undefined);
  const readCredential = file => validateCredential(readPrivate(file, 128).trim());
  const secrets = [config.hostTokenFile, config.adapterTokenFile, config.movementTokenFile, config.verifierTokenFile,
    ...(config.finish ? [config.completionVerifierTokenFile] : [])].map(readCredential);
  if (new Set(secrets).size !== secrets.length) throw unavailable();
  const environment = nativeEnvironment(env, config.nativeEnvironmentAllowlist, secrets);
  assertPrivateFile(config.database);
  if (config.finish) { try { assertEndpointAvailable(endpointFile); } catch { throw unavailable(); } }
  const abort = new AbortController();
  let native, receiver, recovery, completion, service, gate, unregister, announcement, removeEndpoint, closing, started = false, gateArmed = false, ownerGeneration, committed = false, leasePrepared = false;
  const check = () => { if (abort.signal.aborted) throw unavailable(); };
  const interrupted = () => { abort.abort(); void close(); };
  const close = () => closing ??= (async () => {
    abort.abort(); gate?.revoke(); signal?.removeEventListener('abort', interrupted); announcement?.close(); unregister?.(); removeEndpoint?.(); completion?.close(); recovery?.close(); receiver?.close();
    await gate?.close(); await service?.close(); if (native) await native.close();
  })();
  try {
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw unavailable();
    signal?.addEventListener('abort', interrupted, { once: true }); if (signal?.aborted) interrupted(); check();
    const liveJournal = new OpenCodeLiveMovementJournal(config.hostId, agentId, config.liveJournalDirectory);
    const journal = new OpenCodeRecoveryJournal(config.hostId, agentId, config.recoveryJournalDirectory);
    const detachmentJournal = new OpenCodeDetachmentJournal(config.hostId, agentId, config.detachmentJournalDirectory);
    const destinationJournal = new OpenCodeRecoveredDestinationJournal(config.hostId, agentId, config.destinationJournalDirectory);
    stage('discover-grant');
    const grant = config.brokerUrl ? await discoverGrant(config, config.grant, secrets[0], [
      await liveJournal.exclusive(() => liveJournal.get(config.grant.id)),
      await destinationJournal.exclusive(() => destinationJournal.get(config.grant.id)),
    ], abort.signal) : config.grant;
    check();
    stage('native-launch');
    native = launchOpenCodeNativeRecovery({ runtime: config.runtime, entrypoint: config.entrypoint, database: config.database,
      sessionID, pluginID: 'turnlink', source: config.source, env: environment, timeoutMs: config.timeoutMs ?? 15000, serveCandidate: true });
    void native.exit.then(interrupted);
    const endpoint = await native.ready; check();
    if (config.finish) {
      const endpointGate = await createOpenCodeEndpointGate({ upstream: endpoint, authorize: async () => {
        if (abort.signal.aborted || !receiver) return false;
        if (config.ownerLease) {
          if (!ownerGeneration) return false;
          const state = await receiver.request('control_receiver_owner_status', { agentId, channel: grant.channel,
            credential: readCredential(config.adapterTokenFile), transitionID: grant.id, ownerGeneration });
          if (state?.ownerGeneration !== ownerGeneration || abort.signal.aborted) return false;
          if (state.active === true) return true;
          return committed ? false : 'pending';
        }
        return (await receiver.status()).state === 'released' && !abort.signal.aborted;
      }, onRevoked: interrupted });
      if (abort.signal.aborted) { await endpointGate.close(); throw unavailable(); }
      gate = endpointGate;
    }
    receiver = new OpenCodeDestinationReceiver({ rpc: openCodeMovementRpc({ ...endpoint, directory: grant.to, timeoutMs: config.timeoutMs ?? 15000 }),
      token: async () => readCredential(config.movementTokenFile), credential: async () => readCredential(config.adapterTokenFile),
      grant, credentialDirectory: config.credentialDirectory });
    stage('receiver-resume'); const status = await receiver.resume(); check();
    if (receiver.hostId !== config.hostId || !['held', ...(config.finish && grant.status === 'moved' ? ['released', ...(config.ownerLease ? ['prepared'] : [])] : [])].includes(status.state)) throw unavailable();
    if (grant.status === 'moved' && !status.sourceDetached) throw unavailable();
    const releasedOwner = async () => {
      check(); gate.activate(); removeEndpoint = publishEndpoint(endpointFile, gate.endpoint); gateArmed = true;
      if (config.ownerLease) await activatePreparedOwner(receiver, () => readCredential(config.adapterTokenFile), grant, ownerGeneration, abort.signal, config.timeoutMs ?? 15000);
      committed = true;
      check(); started = true;
      return Object.freeze({ state: 'released', transitionID: grant.id, ...(config.endpointDirectory ? { endpointFile } : {}), recovery, receiver, native, exit: native.exit, close });
    };
    const releaseCompletion = async (moved, historical = false) => {
      completion ??= new OpenCodeCompletedRecovery({ client: receiver, credential: async () => readCredential(config.adapterTokenFile),
        recovery: native.recovery, liveJournal, destinationJournal, sessionID, channel: grant.channel });
      const proof = await (historical ? completion.observeReleased(moved) : completion.observe(moved)); check();
      if (!proof || proof.placement.transitionID !== grant.id) throw unavailable();
      if (config.ownerLease) ownerGeneration = randomUUID();
      service = await createOpenCodeCompletionVerifierServer({ path: config.ownerLease ? join(config.completionVerifierDirectory, `${ownerGeneration}.sock`) : config.completionVerifierSocket, secret: secrets[4] });
      if (abort.signal.aborted) { await service.close(); throw unavailable(); }
      unregister = service.register({ client: receiver, recovery: completion, grant: moved, signal: abort.signal, historical, ...(ownerGeneration ? { ownerGeneration } : {}),
        health: async () => {
          if (config.ownerLease && leasePrepared) {
            const observed = await receiver.request('control_receiver_owner_status', { agentId, channel: grant.channel,
              credential: readCredential(config.adapterTokenFile), transitionID: grant.id, ownerGeneration });
            return !abort.signal.aborted && observed?.ownerGeneration === ownerGeneration;
          }
          const observed = await receiver.status(); return !abort.signal.aborted && ['held', 'prepared', 'released'].includes(observed.state);
        },
        readiness: async nonce => gateArmed && !abort.signal.aborted && !!removeEndpoint?.check() && await gate.prove(nonce) && removeEndpoint?.attestation() });
      if (config.ownerLease && onVerifierRegistered) {
        announcement = await onVerifierRegistered({ generation: unregister.ownerGeneration, signal: abort.signal });
        if (typeof announcement?.close !== 'function' || abort.signal.aborted) throw unavailable();
      }
      assertEndpointAvailable(endpointFile); check();
      if (config.ownerLease) ownerGeneration = unregister.ownerGeneration;
      const released = config.ownerLease ? await prepareLeasedOwner(receiver, () => readCredential(config.adapterTokenFile), moved,
        unregister, abort.signal, config.timeoutMs ?? 15000) : await receiver.request('control_receiver_release_verified', { agentId, channel: grant.channel,
        credential: readCredential(config.adapterTokenFile), transitionID: grant.id });
      if (config.ownerLease) {
        check(); if (released?.status !== 'prepared' || released.transitionID !== grant.id || released.ownerGeneration !== ownerGeneration) throw unavailable();
        leasePrepared = true;
        return;
      }
      check(); if (released?.status !== 'released' || released.transitionID !== grant.id || (await receiver.status()).state !== 'released') throw unavailable();
      unregister(); unregister = undefined; await service.close(); service = undefined;
    };
    if (status.state === 'released' || status.state === 'prepared') {
      if (config.ownerLease) await releaseCompletion(grant, true);
      return await releasedOwner();
    }
    if (config.finish && grant.status === 'moved') {
      completion = new OpenCodeCompletedRecovery({ client: receiver, credential: async () => readCredential(config.adapterTokenFile),
        recovery: native.recovery, liveJournal, destinationJournal, sessionID, channel: grant.channel });
      const observed = await completion.observe(grant); check();
      if (observed) { await releaseCompletion(grant); return await releasedOwner(); }
    }
    recovery = new OpenCodeLiveRecovery({ client: receiver, credential: async () => readCredential(config.adapterTokenFile), recovery: native.recovery,
      journal, detachmentJournal, destinationJournal, liveJournal, sessionID, channel: grant.channel });
    stage('recovery-claim'); const saved = await journal.exclusive(() => journal.get(grant.id)); check();
    if (!saved) await recovery.claim(grant);
    else { const observed = await recovery.reconcile(grant); if (observed.status !== 'observed') throw unavailable(); await recovery.takeover(grant); }
    check();
    if (!status.sourceDetached) {
      stage('source-detach');
      if (config.mode === 'successor') {
        const detached = await detachmentJournal.exclusive(() => detachmentJournal.get(grant.id));
        if (!detached) await recovery.detachMembership(grant);
        else if ((await recovery.observeDetachedMembership(grant)).status !== 'detached') throw unavailable();
        check();
      }
      service = await createOpenCodeSourceRecoveryVerifierServer({ path: config.verifierSocket, secret: secrets[3] });
      if (abort.signal.aborted) { await service.close(); throw unavailable(); }
      unregister = service.register({ recovery, native: native.recovery, client: receiver, grant, mode: config.mode, signal: abort.signal });
      const result = await receiver.request('control_receiver_recover_source', { agentId, channel: grant.channel,
        credential: readCredential(config.adapterTokenFile), transitionID: grant.id });
      check(); if (result?.detached !== true || !(await receiver.status()).sourceDetached) throw unavailable();
      unregister(); unregister = undefined; await service.close(); service = undefined;
    }
    check();
    stage('destination-stage'); const liveRecord = await liveJournal.exclusive(() => liveJournal.get(grant.id));
    if (liveRecord?.phase === 'staged') {
      if (!liveRecord.commit && (await recovery.observeLiveDestination(grant)).status !== 'staged') throw unavailable();
    } else {
      const destination = await destinationJournal.exclusive(() => destinationJournal.get(grant.id));
      if (!destination) await recovery.stageRecoveredDestination(grant);
      else if (!destination.commit && (await recovery.observeRecoveredDestination(grant)).status !== 'staged') throw unavailable();
    }
    check();
    if (config.finish) {
      stage('placement-commit');
      assertEndpointAvailable(endpointFile); check();
      if (config.refreshRecoveryIdle && grant.status === 'prepared') { await receiver.refreshRecoveryIdle(); check(); }
      if (grant.status !== 'moved') { await recovery.commitPreparedPlacement(grant); check(); }
      const moved = await recovery.settlePlacement(grant); check();
      await recovery.completePlacement(moved); check();
      stage('completion-release'); await releaseCompletion(moved);
      return await releasedOwner();
    }
    started = true;
    return Object.freeze({ state: 'staged', transitionID: grant.id, recovery, receiver, native, exit: native.exit, close });
  } catch { await close(); throw unavailable(); }
  finally { if (!started) abort.abort(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let owner, stopping = false; const controller = new AbortController();
  const stop = () => { if (!stopping) { stopping = true; controller.abort(); void owner?.close(); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config' || !isAbsolute(process.argv[3])) throw unavailable();
    owner = await startOpenCodeSourceRecoveryOwner(JSON.parse(readPrivate(process.argv[3], 65536)), { signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ state: owner.state, transitionID: owner.transitionID, ...(owner.endpointFile ? { endpointFile: owner.endpointFile } : {}) })}\n`);
    const result = await owner.exit; await owner.close();
    if (!stopping || result.error || result.code !== 0 || result.signal !== null) process.exitCode = 1;
  } catch { await owner?.close(); console.error('Turnlink: OpenCode source recovery owner unavailable'); process.exitCode = 1; }
}
