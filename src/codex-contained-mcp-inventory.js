import { CodexContainedMcp } from './codex-contained-mcp.js';
import { makeContainedSourceRetirement } from './control/contained-source-retirement-contracts.js';

const unavailable = () => Object.assign(new Error('CONTAINED_MCP_INVENTORY_UNAVAILABLE'), { code: 'CONTAINED_MCP_INVENTORY_UNAVAILABLE' });
const bindings = new WeakMap();

// Only a live observation created by this module can be captured, and only
// for the exact native owner, thread and reservation that produced it.
export async function captureContainedSourceInventory(observation, { native, threadId, reservation }) {
  const binding = bindings.get(observation);
  if (!binding || binding.native !== native || binding.threadId !== threadId || binding.reservation !== JSON.stringify(reservation)) throw unavailable();
  await observation.revalidate(); observation.check();
  return structuredClone(observation.entries);
}

// Obtain the exact reviewable stop/remove proposal from live peer-correlated
// owners before requesting the broker preview. This does not authorize it.
export async function captureContainedSourceRetirementProposal(observation, { native, threadId, reservation, permitAdmittedEffectAfterNativeLoss = false }) {
  const binding = bindings.get(observation);
  if (!binding || binding.native !== native || binding.threadId !== threadId || binding.reservation !== JSON.stringify(reservation)) throw unavailable();
  await observation.revalidate(); observation.check();
  try { return makeContainedSourceRetirement(binding.retirementOwners, { permitAdmittedEffectAfterNativeLoss }); } catch { throw unavailable(); }
}

// Correlates the currently materialized native connection map with explicitly
// supplied local owners. It is a revocable observation, never a broker lease,
// resource census, proof of process liveness or permission to move.
export async function acquireContainedSourceInventory({ native, threadId, reservation, owners, signal }) {
  if (typeof native?.observeSourceMcpInventory !== 'function' || typeof native?.verifySourceMcpPeer !== 'function' || typeof native?.onClose !== 'function' ||
      !signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || signal.aborted ||
      !Array.isArray(owners) || owners.length < 1 || owners.length > 64) throw unavailable();
  const names = new Set(), instances = new Set(), expected = [];
  for (const entry of owners) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'names,owner' || !(entry.owner instanceof CodexContainedMcp) ||
        instances.has(entry.owner) || !Array.isArray(entry.names) || entry.names.length < 1 || entry.names.length > 64) throw unavailable();
    instances.add(entry.owner);
    for (const name of entry.names) {
      if (typeof name !== 'string' || !name || name.length > 128 || names.has(name)) throw unavailable();
      names.add(name);
    }
    expected.push({ owner: entry.owner, names: [...entry.names] });
  }
  const controller = new AbortController(), observations = []; let closed = false, detach = () => {}, snapshot;
  const release = () => {
    if (closed) return;
    closed = true; signal.removeEventListener('abort', release); detach(); controller.abort();
  };
  const check = () => {
    try {
      if (closed || signal.aborted || controller.signal.aborted) throw unavailable();
      for (const entry of observations) entry.observation.check();
      return true;
    } catch { release(); throw unavailable(); }
  };
  const revalidate = async () => {
    try {
      check();
      for (const entry of observations) {
        await entry.observation.revalidate(); check();
        const pid = await native.verifySourceMcpPeer(threadId, reservation, { name: entry.name,
          path: entry.observation.peer.path, nonce: entry.observation.peer.nonce }); check();
        if (pid !== entry.observation.wrapperPID) throw unavailable();
      }
      const current = await native.observeSourceMcpInventory(threadId, reservation); check();
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw unavailable();
      return true;
    } catch { release(); throw unavailable(); }
  };
  try {
    signal.addEventListener('abort', release, { once: true });
    detach = native.onClose(release);
    if (closed || signal.aborted) throw unavailable();
    snapshot = await native.observeSourceMcpInventory(threadId, reservation); check();
    if (snapshot.eventStreamPresent || snapshot.entries.length !== names.size) throw unavailable();
    const groups = new Set(), pids = new Set();
    for (const entry of expected) {
      const matched = snapshot.entries.filter(value => entry.names.includes(value.name));
      if (matched.length !== entry.names.length || matched.some(value => value.transport !== 'stdio' || !value.processId ||
          value.owner !== matched[0].owner || value.processId !== matched[0].processId) || groups.has(matched[0].owner) || pids.has(matched[0].processId)) throw unavailable();
      groups.add(matched[0].owner); pids.add(matched[0].processId);
      const observation = await entry.owner.acquireRunningObservation({ signal: controller.signal });
      observations.push({ observation, name: matched[0].name, names: [...entry.names].sort() }); check();
      if (observation.wrapperPID !== matched[0].processId || !observation.peer) throw unavailable();
    }
    await revalidate();
    const result = Object.freeze({ entries: Object.freeze(observations.map(({ observation, names: ownerNames }) => Object.freeze({
      names: Object.freeze(ownerNames), resourceID: observation.resourceID, operationID: observation.operationID,
      containerID: observation.containerID, wrapperPID: observation.wrapperPID }))), check, revalidate, release });
    bindings.set(result, { native, threadId, reservation: JSON.stringify(reservation), retirementOwners: observations.map(({ observation, names: ownerNames }) => ({
      names: [...ownerNames], resourceID: observation.resourceID, operationID: observation.operationID,
      containerID: observation.containerID, wrapperPID: observation.wrapperPID, daemonID: observation.daemonID })) });
    return result;
  } catch { release(); throw unavailable(); }
}
