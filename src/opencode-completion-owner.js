#!/usr/bin/env node
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { HostID } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { digest, validateCredential } from './config.js';
import { assertPrivateFile, privateDirectory, readPrivate } from './storage.js';
import { launchOpenCodeNativeRecovery } from './opencode-native-recovery-launcher.js';
import { OpenCodeContainedOwner } from './opencode-contained-owner.js';
import { isSupervisedContainedNative } from './opencode-container-native-recovery.js';
import { OpenCodeDestinationReceiver, openCodeMovementRpc } from './opencode-destination-receiver.js';
import { OpenCodeLiveMovementJournal } from './opencode-live-movement.js';
import { OpenCodeRecoveredDestinationJournal } from './opencode-recovered-destination-journal.js';
import { OpenCodeCompletedRecovery } from './opencode-completed-recovery.js';
import { createOpenCodeCompletionVerifierServer } from './opencode-completion-verifier-transport.js';
import { createOpenCodeEndpointGate } from './opencode-endpoint-gate.js';
import { OpenCodeAuthorizedDestinationStage, OpenCodeAuthorizedLiveDetachment, OpenCodeAuthorizedLiveMovement } from './opencode-live-movement.js';
import { OpenCodeAuthorizedLivePromotion, OpenCodeLivePromotionJournal, OpenCodeOwnerDrainJournal, openCodePromotionAuthority } from './opencode-live-promotion.js';
import { OpenCodePromotedPlacement } from './opencode-promoted-placement.js';
import { samePlacementGrant } from './opencode-placement-settlement.js';

const unavailable = () => Object.assign(new Error('OPENCODE_COMPLETION_OWNER_UNAVAILABLE'), { code: 'OPENCODE_COMPLETION_OWNER_UNAVAILABLE' });
const path = z.string().min(1).refine(value => isAbsolute(value) && !value.includes('\0'));
const configSchema = z.strictObject({ version: z.literal(1), hostId: HostID, grant: WorktreeTransition,
  runtime: path, entrypoint: path, database: path, source: z.strictObject({ directory: path, workspaceID: z.string().optional() }),
  credentialDirectory: path, liveJournalDirectory: path, destinationJournalDirectory: path.optional(),
  hostTokenFile: path, adapterTokenFile: path, movementTokenFile: path, verifierTokenFile: path, verifierSocket: path.optional(), verifierDirectory: path.optional(),
  endpointFile: path.optional(), endpointDirectory: path.optional(), ownerLease: z.boolean().optional(),
  nextMovement: z.boolean().optional(), promotionJournalDirectory: path.optional(),
  nativeEnvironmentAllowlist: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)).max(64).optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional() }).superRefine((value, context) => {
  if (!value.grant.agentId.startsWith('opencode:ses_') || value.grant.status !== 'moved' || value.grant.purpose ||
      !value.grant.receiptID || value.grant.actualLocation !== value.grant.to || value.source.directory !== value.grant.from)
    context.addIssue({ code: 'custom', message: 'Invalid completed movement grant' });
  if (!!value.endpointFile === !!value.endpointDirectory) context.addIssue({ code: 'custom', message: 'Exactly one endpoint destination is required' });
  if (value.ownerLease && !value.endpointDirectory) context.addIssue({ code: 'custom', message: 'Owner lease requires generation-specific endpoints' });
  if (value.nextMovement ? !value.ownerLease || !value.promotionJournalDirectory : !!value.promotionJournalDirectory)
    context.addIssue({ code: 'custom', message: 'Next movement requires owner lease and a private promotion journal' });
  if (value.ownerLease ? !value.verifierDirectory || !!value.verifierSocket : !value.verifierSocket || !!value.verifierDirectory)
    context.addIssue({ code: 'custom', message: 'Invalid verifier destination' });
});

// Only explicit runtime configuration is inherited. Broker, adapter and verifier
// credentials are never passed to the native child as environment variables.
export function nativeEnvironment(env, extra, secrets) {
  const allowed = new Set(['HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
    'OPENCODE_CONFIG_CONTENT', 'OPENCODE_TEST_HOME', 'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_FFF',
    'OPENCODE_CONFIG_PROJECT_DISABLE', 'OPENCODE_FILEWATCHER_DISABLE']);
  const forbidden = new Set(['OPENCODE_DB', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_PASSWORD', 'NODE_OPTIONS', 'NODE_PATH', 'BUN_OPTIONS']);
  for (const name of extra || []) {
    const upper = name.toUpperCase();
    if (upper.startsWith('AGENT_CHANNEL_') || upper.startsWith('TURNLINK_') || upper.startsWith('DYLD_') || upper.startsWith('LD_') ||
        forbidden.has(upper) || typeof env[name] !== 'string' || secrets.includes(env[name])) throw unavailable();
    allowed.add(name);
  }
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => allowed.has(name) && typeof value === 'string'));
}

// Publish the loopback endpoint and password only to a newly created private
// file. Never overwrite an existing path or remove a replacement on shutdown.
// This preflight catches an existing destination before irreversible release;
// publication still uses O_EXCL because the path can change afterward.
export function assertEndpointAvailable(file) {
  privateDirectory(dirname(file));
  try { lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw unavailable();
}

export function publishEndpoint(file, endpoint) {
  privateDirectory(dirname(file));
  const contents = JSON.stringify({ version: 1, url: endpoint.url, password: endpoint.password });
  let fd, identity;
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
    identity = fstatSync(fd);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    // O_EXCL only protects creation. If the pathname was removed or replaced
    // while writing, the still-open descriptor is not a published endpoint.
    const current = lstatSync(file), opened = fstatSync(fd);
    if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
        opened.dev !== identity.dev || opened.ino !== identity.ino || opened.nlink !== 1) throw unavailable();
    closeSync(fd); fd = undefined;
    const remove = () => {
      try { const current = lstatSync(file); if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) unlinkSync(file); }
      catch { /* Leave a missing or replaced path alone. */ }
    };
    remove.check = () => {
      try {
        const current = lstatSync(file);
        if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino || current.nlink !== 1 || readPrivate(file, 4096) !== contents) return false;
        const after = lstatSync(file);
        return after.isFile() && after.dev === identity.dev && after.ino === identity.ino && after.nlink === 1;
      }
      catch { return false; }
    };
    remove.attestation = () => remove.check() ? { name: basename(file), device: String(identity.dev), inode: String(identity.ino),
      digest: createHash('sha256').update(contents).digest('hex') } : false;
    return remove;
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* Already closed. */ } }
    if (identity) {
      try { const current = lstatSync(file); if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) unlinkSync(file); }
      catch { /* Leave a missing or replaced path alone. */ }
    }
    throw error;
  }
}

export async function activatePreparedOwner(receiver, credential, grant, ownerGeneration, signal, timeoutMs = 15000) {
  const until = performance.now() + timeoutMs;
  while (!signal.aborted && performance.now() < until) {
    try {
      const result = await receiver.request('control_receiver_owner_activate', { agentId: grant.agentId, channel: grant.channel,
        credential: credential(), transitionID: grant.id, ownerGeneration });
      if (result?.active === true && result.transitionID === grant.id && result.ownerGeneration === ownerGeneration) return;
    } catch { /* Remain closed until the broker observes readiness. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw unavailable();
}

export async function prepareLeasedOwner(receiver, credential, grant, unregister, signal, timeoutMs = 15000) {
  const until = performance.now() + timeoutMs, ownerGeneration = unregister.ownerGeneration;
  while (!signal.aborted && performance.now() < until) {
    const ownerProof = randomBytes(32).toString('hex'); unregister.authorizeRetry(ownerProof);
    try {
      const result = await receiver.request('control_receiver_release_verified', { agentId: grant.agentId, channel: grant.channel,
        credential: credential(), transitionID: grant.id, ownerGeneration, ownerProof });
      if (result?.status === 'prepared' && result.transitionID === grant.id && result.ownerGeneration === ownerGeneration) return result;
    } catch { /* Retry only with fresh authorization from this owner. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw unavailable();
}

// Owns a new native process and the exact held receiver. The file is a trusted
// operator configuration, never an adapter or model-supplied command.
export async function verifyContainedNativeOwner(owner, database, native) {
  if (!(owner instanceof OpenCodeContainedOwner) || !native?.containerID || !native?.daemonID || !native?.operationID ||
      !isSupervisedContainedNative(native, owner)) throw unavailable();
  const before = await owner.assertIsolatedDatabaseVolume(database), observed = await owner.observe();
  const after = await owner.assertIsolatedDatabaseVolume(database);
  if (JSON.stringify(before) !== JSON.stringify(after) || before.containerID !== native.containerID || before.daemonID !== native.daemonID ||
      observed.containerID !== native.containerID || observed.daemonID !== native.daemonID || observed.operationID !== native.operationID ||
      !observed.running || observed.status !== 'running') throw unavailable();
  return before;
}

export async function startOpenCodeCompletionOwner(value, { env = process.env, signal, onNextStage, onNativeStart, nativeLauncher = launchOpenCodeNativeRecovery, containedOwner, onVerifierRegistered } = {}) {
  if (signal?.aborted) throw unavailable();
  const config = configSchema.parse(value), agentId = config.grant.agentId, sessionID = agentId.slice('opencode:'.length);
  const endpointFile = config.endpointFile || join(config.endpointDirectory, `turnlink-${randomUUID()}.json`);
  const readCredential = file => validateCredential(readPrivate(file, 128).trim());
  const secrets = [config.hostTokenFile, config.adapterTokenFile, config.movementTokenFile, config.verifierTokenFile].map(readCredential);
  if (new Set(secrets).size !== secrets.length) throw unavailable();
  const environment = nativeEnvironment(env, config.nativeEnvironmentAllowlist, secrets);
  if (!containedOwner) assertPrivateFile(config.database);
  else if (!(containedOwner instanceof OpenCodeContainedOwner) || nativeLauncher === launchOpenCodeNativeRecovery) throw unavailable();
  assertEndpointAvailable(endpointFile);
  const abort = new AbortController();
  let native, receiver, completion, service, gate, unregister, removeEndpoint, closing, started = false, gateArmed = false, ownerGeneration, committed = false,
    leasePrepared = false, liveJournal, nextBridge, nextNative, nextGrant, nextPromotion, nextCandidate, drainJournal, draining = false,
    nextGate, nextService, nextCompletion, nextRemoveEndpoint, nextUnregister, nextPlacement, verifierAnnouncement, nextVerifierAnnouncement;
  const check = () => { if (abort.signal.aborted) throw unavailable(); };
  const interrupted = () => { abort.abort(); void close(); };
  const close = () => closing ??= (async () => {
    abort.abort(); gate?.revoke(); nextGate?.revoke(); signal?.removeEventListener('abort', interrupted); unregister?.(); nextUnregister?.(); verifierAnnouncement?.close(); nextVerifierAnnouncement?.close(); removeEndpoint?.(); nextRemoveEndpoint?.();
    nextPlacement?.close(); nextCandidate?.close(); nextCompletion?.close(); nextBridge?.close(); completion?.close(); receiver?.close();
    await gate?.close(); await nextGate?.close(); await service?.close(); await nextService?.close(); if (native) await native.close();
  })();
  try {
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw unavailable();
    if (onVerifierRegistered !== undefined && (typeof onVerifierRegistered !== 'function' || !config.ownerLease)) throw unavailable();
    signal?.addEventListener('abort', interrupted, { once: true });
    if (signal?.aborted) interrupted();
    check();
    native = await nativeLauncher({ runtime: config.runtime, entrypoint: config.entrypoint, database: config.database,
      sessionID, pluginID: 'turnlink', source: config.source, env: environment, timeoutMs: config.timeoutMs ?? 15000, serveCandidate: true });
    if (containedOwner) await verifyContainedNativeOwner(containedOwner, config.database, native);
    onNativeStart?.(native.pid);
    void native.exit.then(interrupted);
    onNextStage?.('native-ready'); const endpoint = await native.ready; check();
    const endpointGate = await createOpenCodeEndpointGate({ upstream: endpoint, authorize: async () => {
      if (abort.signal.aborted || !receiver) return false;
      if (config.ownerLease) {
        if (!ownerGeneration) return false;
        const state = await receiver.request('control_receiver_owner_status', { agentId, channel: config.grant.channel,
          credential: readCredential(config.adapterTokenFile), transitionID: config.grant.id, ownerGeneration });
        if (state?.ownerGeneration !== ownerGeneration || abort.signal.aborted) return false;
        if (state.active === true) return true;
        return committed ? false : 'pending';
      }
      return (await receiver.status()).state === 'released' && !abort.signal.aborted;
    }, onRevoked: () => { gateArmed = false; if (!draining) interrupted(); } });
    if (abort.signal.aborted) { await endpointGate.close(); throw unavailable(); }
    gate = endpointGate;
    receiver = new OpenCodeDestinationReceiver({ rpc: openCodeMovementRpc({ ...endpoint, directory: config.grant.to, timeoutMs: config.timeoutMs ?? 15000 }),
      token: async () => readCredential(config.movementTokenFile), credential: async () => readCredential(config.adapterTokenFile),
      grant: config.grant, credentialDirectory: config.credentialDirectory });
    onNextStage?.('receiver-resume'); const status = await receiver.resume(); check();
    if (receiver.hostId !== config.hostId || status.sourceDetached !== true) throw unavailable();
    if (status.state === 'held' || (config.ownerLease && ['prepared', 'released'].includes(status.state))) {
      liveJournal = new OpenCodeLiveMovementJournal(config.hostId, agentId, config.liveJournalDirectory);
      const destinationJournal = config.destinationJournalDirectory ?
        new OpenCodeRecoveredDestinationJournal(config.hostId, agentId, config.destinationJournalDirectory) : undefined;
      completion = new OpenCodeCompletedRecovery({ client: receiver, credential: async () => readCredential(config.adapterTokenFile),
        recovery: native.recovery, liveJournal, destinationJournal, sessionID, channel: config.grant.channel, onDiagnostic: onNextStage });
      const historical = status.state !== 'held';
      onNextStage?.('completion-observe'); const proof = await (historical ? completion.observeReleased(config.grant) : completion.observe(config.grant)); check();
      if (!proof || proof.placement.transitionID !== config.grant.id) throw unavailable();
      if (config.ownerLease) ownerGeneration = randomUUID();
      onNextStage?.('verifier-listen'); service = await createOpenCodeCompletionVerifierServer({ path: config.ownerLease ? join(config.verifierDirectory, `${ownerGeneration}.sock`) : config.verifierSocket, secret: secrets[3] });
      if (abort.signal.aborted) { await service.close(); throw unavailable(); }
      onNextStage?.('verifier-register'); unregister = service.register({ client: receiver, recovery: completion, grant: config.grant, signal: abort.signal, historical, ...(ownerGeneration ? { ownerGeneration } : {}),
        ...(onVerifierRegistered ? { onRetainedLeaseClose: () => { verifierAnnouncement?.close(); if (!draining) interrupted(); } } : {}),
        health: async () => {
          if (config.ownerLease && leasePrepared) {
            const observed = await receiver.request('control_receiver_owner_status', { agentId, channel: config.grant.channel,
              credential: readCredential(config.adapterTokenFile), transitionID: config.grant.id, ownerGeneration });
            return !abort.signal.aborted && observed?.ownerGeneration === ownerGeneration;
          }
          const observed = await receiver.status(); return !abort.signal.aborted && ['held', 'prepared', 'released'].includes(observed.state);
        },
        readiness: async nonce => {
          if (!gateArmed || abort.signal.aborted || !removeEndpoint?.check()) return false;
          try { return await gate.prove(nonce) && gateArmed && removeEndpoint?.attestation(); }
          catch (error) { if (draining && !gateArmed) return false; throw error; }
        } });
      check();
      if (config.ownerLease) ownerGeneration = unregister.ownerGeneration;
      if (onVerifierRegistered) {
        verifierAnnouncement = await onVerifierRegistered({ generation: ownerGeneration, signal: abort.signal });
        if (!verifierAnnouncement || typeof verifierAnnouncement.close !== 'function') throw unavailable();
        if (abort.signal.aborted) { verifierAnnouncement.close(); throw unavailable(); }
      }
      onNextStage?.('endpoint-preflight'); assertEndpointAvailable(endpointFile); check();
      onNextStage?.('prepare-lease'); const released = config.ownerLease ? await prepareLeasedOwner(receiver, () => readCredential(config.adapterTokenFile), config.grant,
        unregister, abort.signal, config.timeoutMs ?? 15000) : await receiver.request('control_receiver_release_verified', { agentId, channel: config.grant.channel,
        credential: readCredential(config.adapterTokenFile), transitionID: config.grant.id });
      check();
      if (config.ownerLease) {
        if (released?.status !== 'prepared' || released.transitionID !== config.grant.id || released.ownerGeneration !== ownerGeneration) throw unavailable();
        leasePrepared = true;
        gate.activate(); removeEndpoint = publishEndpoint(endpointFile, gate.endpoint); gateArmed = true;
        onNextStage?.('activate-lease'); await activatePreparedOwner(receiver, () => readCredential(config.adapterTokenFile), config.grant, ownerGeneration, abort.signal, config.timeoutMs ?? 15000);
        committed = true; check(); started = true;
        const promoteNext = config.nextMovement ? async value => {
          check(); if (nextBridge) throw unavailable();
          nextGrant = WorktreeTransition.parse(value); const journal = new OpenCodeLivePromotionJournal(config.hostId, agentId, config.promotionJournalDirectory);
          const authority = openCodePromotionAuthority({ receiver, credential: async () => readCredential(config.adapterTokenFile), ownerGeneration });
          const history = async (oldGrant, _nextGrant, proof) => {
            const records = liveJournal.snapshot();
            return records.length === 1 && samePlacementGrant(records[0].grant, oldGrant) && records[0].phase === 'staged' &&
              records[0].commit?.phase === 'committed' && records[0].settlement?.phase === 'settled' &&
              JSON.stringify(records[0].commit.placement) === JSON.stringify(proof.placement) &&
              JSON.stringify(records[0].settlement.placement) === JSON.stringify(proof.placement);
          };
          const controller = new OpenCodeAuthorizedLivePromotion({ journal, native: native.recovery, completion, authority, history });
          const result = await controller.promote(config.grant, nextGrant, { receiverHash: digest(receiver.receiverKeys.get(agentId) || ''), ownerGeneration });
          check(); nextPromotion = result; nextNative = native.recovery.promotedLive(result.promotionID);
          const source = { get hostId() { return receiver.hostId; }, connect: async () => { if (!receiver.hostId) throw unavailable(); },
            on: (...args) => receiver.on(...args), off: (...args) => receiver.off(...args),
            request: (method, params) => { if (method !== 'control_worktree_authorize') throw unavailable();
              return receiver.request('control_worktree_authorize_next', { ...params, ownerGeneration }); } };
          nextBridge = new OpenCodeAuthorizedLiveMovement({ client: source, credential: async () => readCredential(config.adapterTokenFile), native: nextNative,
            journal: liveJournal, sessionID, channel: config.grant.channel, promotion: { journal, authority } });
          return Object.freeze({ bridge: nextBridge, native: nextNative });
        } : undefined;
        const drainNext = config.nextMovement ? async value => {
          check(); const grant = WorktreeTransition.parse(value);
          if (draining || !nextNative || !nextPromotion || JSON.stringify(grant) !== JSON.stringify(nextGrant) ||
              nextNative.transportReleased(grant.id) !== true) throw unavailable();
          const authority = openCodePromotionAuthority({ receiver, credential: async () => readCredential(config.adapterTokenFile), ownerGeneration });
          const binding = await authority(config.grant, grant);
          drainJournal = new OpenCodeOwnerDrainJournal(config.hostId, agentId, config.promotionJournalDirectory);
          return drainJournal.exclusive(async () => {
            if (drainJournal.get()) throw unavailable();
            const saved = drainJournal.put({ version: 1, hostId: config.hostId, agentId, oldTransitionID: config.grant.id, nextGrant: grant,
              ownerGeneration, receiverHash: binding.receiverHash, promotionID: nextPromotion.promotionID, drainID: randomUUID(), phase: 'dispatching' });
            const ownerProof = randomBytes(32).toString('hex'); unregister.authorizeRetry(ownerProof); draining = true;
            try {
              const result = await receiver.request('control_receiver_owner_drain', { agentId, channel: grant.channel,
                credential: readCredential(config.adapterTokenFile), transitionID: config.grant.id, ownerGeneration, nextGrant: grant, drainID: saved.drainID, ownerProof });
              gateArmed = false; gate.revoke();
              if (result?.draining !== true || result.drainID !== saved.drainID || result.transitionID !== grant.id || result.ownerGeneration !== ownerGeneration) throw unavailable();
              return drainJournal.put({ ...saved, phase: 'draining' });
            } catch {
              gateArmed = false; gate.revoke();
              let uncertain;
              try { uncertain = drainJournal.put({ ...saved, phase: 'uncertain' }); } catch { /* Preserve the dispatched intent. */ }
              if (uncertain && !abort.signal.aborted) try {
                const observationProof = randomBytes(32).toString('hex'); unregister.authorizeRetry(observationProof);
                const observed = await receiver.request('control_receiver_owner_drain_observe', { agentId, channel: grant.channel,
                  credential: readCredential(config.adapterTokenFile), transitionID: config.grant.id, ownerGeneration,
                  nextGrant: grant, drainID: saved.drainID, ownerProof: observationProof });
                if (observed?.draining === true && observed.drainID === saved.drainID && observed.transitionID === grant.id &&
                    observed.ownerGeneration === ownerGeneration && !abort.signal.aborted)
                  return drainJournal.put({ ...uncertain, phase: 'draining' });
              } catch { /* Preserve the fenced uncertain record. */ }
              throw Object.assign(new Error('OPENCODE_OWNER_DRAIN_UNCERTAIN'), { code: 'OPENCODE_OWNER_DRAIN_UNCERTAIN' });
            }
          });
        } : undefined;
        const detachNext = config.nextMovement ? async value => {
          check(); const grant = WorktreeTransition.parse(value);
          if (!draining || !drainJournal || nextCandidate || JSON.stringify(grant) !== JSON.stringify(nextGrant)) throw unavailable();
          const saved = await drainJournal.exclusive(() => drainJournal.get());
          if (saved?.phase !== 'draining') throw unavailable();
          nextCandidate = new OpenCodeDestinationReceiver({ rpc: openCodeMovementRpc({ ...endpoint, directory: grant.to, timeoutMs: config.timeoutMs ?? 15000 }),
            token: async () => readCredential(config.movementTokenFile), credential: async () => readCredential(config.adapterTokenFile),
            grant, credentialDirectory: config.credentialDirectory });
          onNextStage?.('offer'); const offer = await nextCandidate.offer({ previousTransitionID: config.grant.id });
          const until = performance.now() + (config.timeoutMs ?? 15000); let status;
          while (!abort.signal.aborted && performance.now() < until) { status = await nextCandidate.status(); if (status.state === 'held') break; await new Promise(resolve => setTimeout(resolve, 100)); }
          if (status?.state !== 'held' || status.sourceDetached !== false) throw unavailable();
          onNextStage?.('detach'); const detacher = new OpenCodeAuthorizedLiveDetachment({ client: nextCandidate, credential: async () => readCredential(config.adapterTokenFile),
            native: nextNative, journal: liveJournal, sessionID, channel: grant.channel });
          await detacher.detach(grant);
          onNextStage?.('source-check'); await nextCandidate.request('control_receiver_check_source', { agentId, channel: grant.channel,
            credential: readCredential(config.adapterTokenFile), offerID: offer.offerID });
          while (!abort.signal.aborted && performance.now() < until) { status = await nextCandidate.status(); if (status.state === 'held' && status.sourceDetached === true) break; await new Promise(resolve => setTimeout(resolve, 100)); }
          if (status?.state !== 'held' || status.sourceDetached !== true) throw unavailable();
          await drainJournal.exclusive(() => drainJournal.put({ ...saved, phase: 'detached' }));
          onNextStage?.('stage'); const stager = new OpenCodeAuthorizedDestinationStage({ client: nextCandidate, credential: async () => readCredential(config.adapterTokenFile),
            native: nextNative, journal: liveJournal, sessionID, channel: grant.channel });
          return stager.stage(grant);
        } : undefined;
        const completeNext = config.nextMovement ? async value => {
          check(); const grant = WorktreeTransition.parse(value);
          if (!draining || !nextCandidate || !nextNative || !nextPromotion || nextPlacement || JSON.stringify(grant) !== JSON.stringify(nextGrant)) throw unavailable();
          const savedDrain = await drainJournal.exclusive(() => drainJournal.get()); if (savedDrain?.phase !== 'detached') throw unavailable();
          nextPlacement = new OpenCodePromotedPlacement({ client: nextCandidate, credential: async () => readCredential(config.adapterTokenFile),
            native: nextNative, journal: liveJournal, promotion: nextPromotion });
          onNextStage?.('commit'); await nextPlacement.commit(grant);
          onNextStage?.('settle'); const moved = await nextPlacement.settle(grant);
          onNextStage?.('complete'); const proof = await nextPlacement.complete(moved);
          check(); if (proof.placement.transitionID !== moved.id) throw unavailable();
          // Retire only the old verifier registration; the old native
          // descriptor remains the owner of the newly promoted activation.
          unregister?.(); unregister = undefined; await service?.close(); service = undefined;
          nextCompletion = new OpenCodeCompletedRecovery({ client: nextCandidate, credential: async () => readCredential(config.adapterTokenFile),
            recovery: nextNative, liveJournal, sessionID, channel: moved.channel });
          const confirmed = await nextCompletion.observe(moved); if (!confirmed || JSON.stringify(confirmed) !== JSON.stringify(proof)) throw unavailable();
          const generation = randomUUID(), nextVerifierPath = join(config.verifierDirectory, `${generation}.sock`);
          const newEndpointFile = join(config.endpointDirectory, `turnlink-${randomUUID()}.json`);
          let nextArmed = false, nextPrepared = false, nextCommitted = false;
          nextGate = await createOpenCodeEndpointGate({ upstream: endpoint, authorize: async () => {
            const observed = await nextCandidate.request('control_receiver_owner_status', { agentId, channel: moved.channel,
              credential: readCredential(config.adapterTokenFile), transitionID: moved.id, ownerGeneration: generation });
            if (observed?.ownerGeneration !== generation || abort.signal.aborted) return false;
            return observed.active === true ? true : nextCommitted ? false : 'pending';
          }, onRevoked: interrupted });
          nextService = await createOpenCodeCompletionVerifierServer({ path: nextVerifierPath, secret: secrets[3] });
          nextUnregister = nextService.register({ client: nextCandidate, recovery: nextCompletion, grant: moved, signal: abort.signal, ownerGeneration: generation,
            ...(onVerifierRegistered ? { onRetainedLeaseClose: interrupted } : {}),
            health: async () => {
              if (nextPrepared) { const observed = await nextCandidate.request('control_receiver_owner_status', { agentId, channel: moved.channel,
                credential: readCredential(config.adapterTokenFile), transitionID: moved.id, ownerGeneration: generation }); return !abort.signal.aborted && observed?.ownerGeneration === generation; }
              const observed = await nextCandidate.status(); return !abort.signal.aborted && ['held', 'prepared', 'released'].includes(observed.state);
            },
            readiness: async nonce => nextArmed && !abort.signal.aborted && !!nextRemoveEndpoint?.check() && await nextGate.prove(nonce) && nextRemoveEndpoint?.attestation() });
          if (onVerifierRegistered) {
            nextVerifierAnnouncement = await onVerifierRegistered({ generation, signal: abort.signal });
            if (!nextVerifierAnnouncement || typeof nextVerifierAnnouncement.close !== 'function') throw unavailable();
            if (abort.signal.aborted) { nextVerifierAnnouncement.close(); throw unavailable(); }
          }
          onNextStage?.('next-prepare');
          await prepareLeasedOwner(nextCandidate, () => readCredential(config.adapterTokenFile), moved, nextUnregister, abort.signal, config.timeoutMs ?? 15000);
          nextPrepared = true; nextGate.activate(); nextRemoveEndpoint = publishEndpoint(newEndpointFile, nextGate.endpoint); nextArmed = true;
          onNextStage?.('next-activate');
          await activatePreparedOwner(nextCandidate, () => readCredential(config.adapterTokenFile), moved, generation, abort.signal, config.timeoutMs ?? 15000);
          nextCommitted = true; check();
          return { transitionID: moved.id, endpointFile: newEndpointFile, ownerGeneration: generation };
        } : undefined;
        return Object.freeze({ state: 'released', transitionID: config.grant.id, endpointFile, exit: native.exit, close,
          ...(promoteNext ? { promoteNext, drainNext, detachNext, completeNext } : {}) });
      }
      if (released?.status !== 'released' || released.transitionID !== config.grant.id || (await receiver.status()).state !== 'released') throw unavailable();
      unregister(); unregister = undefined;
    } else if (status.state !== 'released') throw unavailable();
    check(); gate.activate(); removeEndpoint = publishEndpoint(endpointFile, gate.endpoint); gateArmed = true;
    started = true;
    return Object.freeze({ state: 'released', transitionID: config.grant.id, ...(config.endpointDirectory ? { endpointFile } : {}), exit: native.exit, close });
  } catch {
    await close(); throw unavailable();
  } finally {
    if (!started) abort.abort();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let owner, stopping = false;
  const controller = new AbortController();
  const stop = () => { if (!stopping) { stopping = true; controller.abort(); void owner?.close(); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config' || !isAbsolute(process.argv[3])) throw unavailable();
    owner = await startOpenCodeCompletionOwner(JSON.parse(readPrivate(process.argv[3], 65536)), { signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ state: owner.state, transitionID: owner.transitionID, ...(owner.endpointFile ? { endpointFile: owner.endpointFile } : {}) })}\n`);
    const result = await owner.exit;
    await owner.close();
    if (!stopping || result.error || result.code !== 0 || result.signal !== null) process.exitCode = 1;
  } catch {
    await owner?.close();
    console.error('Turnlink: OpenCode completion owner unavailable');
    process.exitCode = 1;
  }
}
