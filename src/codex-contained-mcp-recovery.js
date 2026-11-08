import { CodexContainedMcp } from './codex-contained-mcp.js';
import { requireCodexPublicationBarrier } from './codex-admission-fence.js';
import { observeCodexPublicationRecovery } from './codex-publication-recovery.js';
import { receiverHandoffKey } from './config.js';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { readPrivate } from './storage.js';
import { Stamp, WorktreeTransition } from './control/contracts.js';
import { setTimeout as delay } from 'node:timers/promises';

const unavailable = () => Object.assign(new Error('CONTAINED_MCP_RECOVERY_UNAVAILABLE'), { code: 'CONTAINED_MCP_RECOVERY_UNAVAILABLE' });

// Effectful recovery is opt-in by the caller and requires a separately
// approved exact inventory in the broker grant. The resource journals record
// stop/remove intent before effects; an uncertain intent is only observed.
// A successful result still holds the receiver and cannot authorize movement.
export async function retireRestoredCapturedSource(args) {
  const { client, native, journal, agentId, mcpTransitionID, owners, signal, guard, credential } = args;
  if (!agentId?.startsWith('codex:') || journal?.agentId !== agentId || journal?.hostId !== client?.hostId ||
      typeof client?.on !== 'function' || typeof client?.off !== 'function' || typeof client?.request !== 'function' ||
      typeof journal?.snapshot !== 'function' || typeof credential !== 'function' || typeof guard !== 'function' ||
      !native?.usesClient?.(client) || !signal || signal.aborted || !Array.isArray(owners)) throw unavailable();
  let invalidated = false;
  const disconnected = () => { invalidated = true; };
  const removed = event => { if (event?.agentId === agentId) invalidated = true; };
  client.on('disconnected', disconnected); client.on('membership_removed', removed);
  try {
    const before = journal.snapshot(), record = before.find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement;
    const grant = WorktreeTransition.parse(movement?.grant), publication = movement?.publication;
    const plan = grant.sourceRetirement, captured = publication?.contained;
    // This legacy coordinator performs effects after a point-in-time broker
    // observation. It cannot uphold v2's immediate-revocation guarantee;
    // v2 must go through its own verified dispatch protocol once available.
    if (movement?.phase !== 'bound' || !plan || plan.version !== 1 || publication?.phase !== 'observed' ||
        publication.sourceShutdown?.phase !== 'observed' || publication.sourceModelShutdown?.phase !== 'observed' ||
        !Array.isArray(captured) || captured.length !== plan.owners.length || owners.length !== plan.owners.length) throw unavailable();
    const receiverKey = client.receiverKeys?.get(agentId);
    if (!/^[a-f0-9]{64}$/.test(receiverKey || '')) throw unavailable();
    const provided = new Map();
    for (const value of owners) {
      if (!value || Object.keys(value).sort().join(',') !== 'owner,resourceID' || !(value.owner instanceof CodexContainedMcp) || provided.has(value.resourceID)) throw unavailable();
      provided.set(value.resourceID, value.owner);
    }
    for (const expected of plan.owners) {
      const saved = captured.find(value => value.resourceID === expected.resourceID), { daemonID: _daemon, ...identity } = expected;
      if (!saved || JSON.stringify({ ...saved, names: [...saved.names].sort() }) !== JSON.stringify(identity) || !provided.has(expected.resourceID)) throw unavailable();
    }
    const socket = client.socket, generation = client.subscriptionGenerations?.get(agentId);
    const check = () => {
      if (client.socket !== socket || client.subscriptionGenerations?.get(agentId) !== generation || invalidated || signal.aborted || journal.hostId !== client.hostId || !native.usesClient(client) ||
          (!client.subscriptions?.has(agentId) || !client.activeSubscriptions?.has(agentId)) || client.receiverKeys?.get(agentId) !== receiverKey ||
          receiverHandoffKey(client.hostId, agentId, grant.id, args.credentialDirectory) !== receiverKey ||
          JSON.stringify(journal.snapshot()) !== JSON.stringify(before)) throw unavailable();
      guard();
    };
    const authorize = async () => {
      check(); const secret = await credential(); check();
      // Only the broker's explicit pre-dispatch rate-limit response may be
      // retried. These operations are observations; stop/remove are never in
      // this retry loop and retain their own durable intent semantics.
      const read = async operation => {
        for (let attempt = 0; ; attempt++) {
          try { return await operation(); }
          catch (error) {
            if (error?.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' || attempt >= 30) throw error;
            await delay(100, undefined, { signal }); check();
          }
        }
      };
      const result = await read(() => client.request('control_worktree_authorize', { agentId, channel: grant.channel, credential: secret, grant, action: 'retire-source-contained' }));
      check();
      if (!Stamp.safeParse(result?.checkedAt).success || result.checkedAt < grant.preparedAt ||
          JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw unavailable();
      const evidence = await observeCodexPublicationRecovery({ ...args, retryRateLimited: true }); check();
      if (!evidence.sourceDetached || evidence.publication.historicalStatus !== 'installed' || !evidence.publication.snapshotObserved ||
          evidence.mcp?.historicalStatus !== 'closed' || !['closed', 'absent'].includes(evidence.model?.historicalStatus)) throw unavailable();
    };
    for (const item of plan.owners) {
      const owner = provided.get(item.resourceID), { names: _names, ...identity } = item;
      await authorize();
      const stopped = await owner.stopExact(identity); check();
      if (!['stopped_local', 'removed_local'].includes(stopped.status)) throw unavailable();
      await authorize();
      if (stopped.status !== 'removed_local') { await owner.retireExact(identity); check(); }
      await authorize();
    }
    return await acquireRestoredCapturedRetiredSource(args);
  } catch (error) { throw Object.assign(unavailable(), { cause: error }); }
  finally { client.off('disconnected', disconnected); client.off('membership_removed', removed); }
}

// Trusted operator configuration: no peer or operation identity is accepted
// here; both resource and operation identities come from the durable capture.
export function loadContainedRecoveryOwners(path) {
  try {
    if (typeof path !== 'string' || !isAbsolute(path)) throw unavailable();
    const config = z.strictObject({ version: z.literal(1), directory: z.string().refine(isAbsolute), docker: z.string().refine(isAbsolute),
      owners: z.array(z.strictObject({ resourceID: z.string().uuid(), image: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        command: z.array(z.string().min(1).max(4096).refine(value => !value.includes('\0'))).min(1).max(64) })).min(1).max(64) }).parse(JSON.parse(readPrivate(path, 65536)));
    const seen = new Set();
    return config.owners.map(spec => {
      if (seen.has(spec.resourceID)) throw unavailable();
      seen.add(spec.resourceID);
      return { resourceID: spec.resourceID, owner: new CodexContainedMcp({ directory: config.directory, docker: config.docker, spec }) };
    });
  } catch { throw unavailable(); }
}

// A successor can correlate the historical native shutdown with exact retired
// container identities while the broker still holds this receiver. The result
// is a revocable local observation, not a release receipt or proof of remote work.
export async function acquireRestoredCapturedRetiredSource(args) {
  const { native, journal, client, agentId, mcpTransitionID, owners, signal, guard, credentialDirectory } = args;
  if (!agentId?.startsWith('codex:') || journal?.agentId !== agentId || journal?.hostId !== client?.hostId ||
      typeof journal?.snapshot !== 'function' || typeof native?.onClose !== 'function' ||
      typeof client?.on !== 'function' || typeof client?.off !== 'function' || typeof guard !== 'function' ||
      !signal || signal.aborted || typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function' || !Array.isArray(owners)) throw unavailable();
  const socket = client.socket, generation = client.subscriptionGenerations?.get(agentId);
  const controller = new AbortController(), observations = []; let closed = false, detach = () => {}, baseline, receiverKey, transitionID;
  const disconnected = () => release();
  const removed = event => { if (event?.agentId === agentId) release(); };
  const release = () => {
    if (closed) return;
    closed = true; signal.removeEventListener('abort', release); client.off('disconnected', disconnected);
    client.off('membership_removed', removed); detach(); controller.abort();
  };
  const check = () => {
    try {
      if (closed || signal.aborted || client.hostId !== journal.hostId || client.socket !== socket ||
          client.subscriptionGenerations?.get(agentId) !== generation || !native.usesClient(client)) throw unavailable();
      if (receiverKey && ((!client.subscriptions?.has(agentId) || !client.activeSubscriptions?.has(agentId)) || client.receiverKeys?.get(agentId) !== receiverKey ||
          receiverHandoffKey(client.hostId, agentId, transitionID, credentialDirectory) !== receiverKey)) throw unavailable();
      guard();
      if (baseline && JSON.stringify(journal.snapshot()) !== baseline) throw unavailable();
      for (const observation of observations) observation.check();
      return true;
    } catch { release(); throw unavailable(); }
  };
  try {
    signal.addEventListener('abort', release, { once: true });
    client.on('disconnected', disconnected); client.on('membership_removed', removed);
    detach = native.onClose(release); check();
    const records = journal.snapshot(); baseline = JSON.stringify(records);
    const record = records.find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement;
    const publication = movement?.publication, shutdown = publication?.sourceShutdown, captured = publication?.contained;
    if (movement?.phase !== 'bound' || publication?.phase !== 'observed' || shutdown?.phase !== 'observed' || !shutdown.receipt ||
        !Array.isArray(captured) || captured.length === 0 || captured.length !== owners.length) throw unavailable();
    transitionID = movement.grant.id; receiverKey = client.receiverKeys?.get(agentId);
    if (!/^[a-f0-9]{64}$/.test(receiverKey || '')) throw unavailable();
    check();
    const provided = new Map(), seen = new Set();
    for (const value of owners) {
      if (!value || Object.keys(value).sort().join(',') !== 'owner,resourceID' || !(value.owner instanceof CodexContainedMcp) || provided.has(value.resourceID)) throw unavailable();
      provided.set(value.resourceID, value.owner);
    }
    for (const item of captured) {
      const owner = provided.get(item.resourceID);
      if (!owner || seen.has(item.resourceID)) throw unavailable();
      seen.add(item.resourceID);
      const { names: _names, ...expected } = item;
      const observation = await owner.acquireRetiredObservation({ signal: controller.signal, expected }); observations.push(observation); check();
    }
    const revalidate = async () => {
      try {
        check();
        for (const observation of observations) { await observation.revalidate(); check(); }
        const evidence = await observeCodexPublicationRecovery({ ...args, signal: controller.signal, retryRateLimited: true }); check();
        if (evidence.publication.historicalStatus !== 'installed' || !evidence.publication.snapshotObserved ||
            evidence.mcp?.historicalStatus !== 'closed' || evidence.transitionID !== movement.grant.id) throw unavailable();
        for (const observation of observations) { await observation.revalidate(); check(); }
        return true;
      } catch { release(); throw unavailable(); }
    };
    await revalidate();
    return Object.freeze({ entries: Object.freeze(captured.map(item => Object.freeze({ ...item, names: Object.freeze([...item.names]) }))),
      check, revalidate, release });
  } catch { release(); throw unavailable(); }
}

// Experimental same-owner observation only. It neither retires a container
// nor mints a broker lease; persisted launch identities are historical data.
export async function acquireCapturedRetiredSource({ native, journal, client, agentId, mcpTransitionID, owners, signal, guard, publicationGuard }) {
  if (!agentId?.startsWith('codex:') || journal?.agentId !== agentId || journal?.hostId !== client?.hostId ||
      typeof journal?.snapshot !== 'function' || typeof native?.observeSourceShutdownFixture !== 'function' ||
      typeof native?.assertPublicationBarrier !== 'function' || typeof native?.onClose !== 'function' || native.supportsPublicationFixture !== true ||
      typeof guard !== 'function' || !signal || signal.aborted || typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function' || !Array.isArray(owners)) throw unavailable();
  const controller = new AbortController(), observations = []; let closed = false, detach = () => {}, baseline;
  const release = () => { if (closed) return; closed = true; signal.removeEventListener('abort', release); detach(); controller.abort(); };
  const check = () => {
    try {
      if (closed || signal.aborted || client.hostId !== journal.hostId) throw unavailable();
      guard(); requireCodexPublicationBarrier(publicationGuard, agentId.slice(6)); native.assertPublicationBarrier(publicationGuard, agentId.slice(6));
      if (baseline && JSON.stringify(journal.snapshot()) !== baseline) throw unavailable();
      for (const observation of observations) observation.check();
      return true;
    } catch { release(); throw unavailable(); }
  };
  try {
    signal.addEventListener('abort', release, { once: true }); detach = native.onClose(release); check();
    const records = journal.snapshot(); baseline = JSON.stringify(records);
    const record = records.find(value => value.transitionID === mcpTransitionID), movement = record?.step?.movement;
    const publication = movement?.publication, shutdown = publication?.sourceShutdown, captured = publication?.contained;
    if (movement?.phase !== 'bound' || publication?.phase !== 'observed' || shutdown?.phase !== 'observed' || !shutdown.receipt ||
        !Array.isArray(captured) || captured.length !== owners.length || captured.length === 0) throw unavailable();
    const provided = new Map();
    for (const value of owners) {
      if (!value || Object.keys(value).sort().join(',') !== 'owner,resourceID' || !(value.owner instanceof CodexContainedMcp) || provided.has(value.resourceID)) throw unavailable();
      provided.set(value.resourceID, value.owner);
    }
    for (const item of captured) {
      const owner = provided.get(item.resourceID); if (!owner) throw unavailable();
      const { names: _names, ...expected } = item;
      const observation = await owner.acquireRetiredObservation({ signal: controller.signal, expected }); observations.push(observation); check();
    }
    const revalidate = async () => {
      try {
        check();
        for (const observation of observations) { await observation.revalidate(); check(); }
        const receipt = await native.observeSourceShutdownFixture(movement.grant, record.plan.reservation, record.step.receipt,
          publication.operationID, shutdown.shutdownID, publicationGuard); check();
        if (JSON.stringify(receipt) !== JSON.stringify(shutdown.receipt)) throw unavailable();
        return true;
      } catch { release(); throw unavailable(); }
    };
    await revalidate();
    return Object.freeze({ entries: Object.freeze(captured.map(item => Object.freeze({ ...item, names: Object.freeze([...item.names]) }))),
      check, revalidate, release });
  } catch { release(); throw unavailable(); }
}
