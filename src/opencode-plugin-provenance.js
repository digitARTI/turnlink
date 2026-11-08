import { createHash } from 'node:crypto';
import { PluginProvenanceObservation } from './control/contracts.js';
import { isOpenCodePluginSealObservation } from './opencode-plugin-seal-observer.js';
import { isOpenCodeNativeIdleHold } from './opencode-native-movement.js';

// Only a host-created observation can be wrapped. This is still non-executable
// and must not be treated as a maintained process lease.
export async function pluginProvenanceObservation({ observeSeal, native, hold, daemonID }) {
  if (!isOpenCodeNativeIdleHold(hold, native) || typeof observeSeal !== 'function') throw new Error('PLUGIN_PROVENANCE_UNAVAILABLE');
  await native.checkIdle(hold.holdID);
  const seal = await observeSeal();
  if (!isOpenCodePluginSealObservation(seal) || seal.executionEligible !== false || seal.issue !== 'COMPLETE_EXECUTION_GRAPH_UNATTESTED')
    throw new Error('PLUGIN_PROVENANCE_UNAVAILABLE');
  if (!isOpenCodeNativeIdleHold(hold, native, seal.directory) || seal.sessionID !== hold.sessionID || seal.daemonID !== daemonID)
    throw new Error('PLUGIN_PROVENANCE_UNAVAILABLE');
  await native.checkIdle(hold.holdID);
  if (!isOpenCodeNativeIdleHold(hold, native)) throw new Error('PLUGIN_PROVENANCE_UNAVAILABLE');
  const fields = { version: 1, image: seal.image, bundleDigest: seal.bundleSha256, guardDigest: seal.guardSha256, containerID: seal.id,
    daemonID, processID: seal.pid, startedAt: seal.startedAt, nativeHoldID: hold.holdID, executionEligible: false };
  return PluginProvenanceObservation.parse({ ...fields, digest: createHash('sha256').update(JSON.stringify(fields)).digest('hex') });
}
