import { isOpenCodePluginSealObservation } from './opencode-plugin-seal-observer.js';
import { isOpenCodeDestinationRuntimeObservation } from './opencode-destination-runtime-observer.js';

// Couple the observational destination reservation and sealed-plugin port.
// Neither side establishes daemon custody or grants authority to execute.
export function bindOpenCodeDestinationPluginLease({ supervisor, bridge, signal }) {
  if (!supervisor?.onClose || !supervisor?.close || !bridge?.capabilityHost?.close || !bridge?.close || !bridge?.port?.on || signal?.aborted)
    throw new Error('DESTINATION_PLUGIN_LEASE_UNAVAILABLE');
  let active = true, removeSupervisor;
  const close = () => {
    if (!active) return; active = false; signal?.removeEventListener('abort', close); bridge.port.off('close', close); removeSupervisor?.();
    // Each side must be revoked even if another close operation fails.
    try { supervisor.close(); } catch {}
    try { bridge.capabilityHost.close(); } catch {}
    try { Promise.resolve(bridge.close()).catch(() => {}); } catch {}
  };
  bridge.port.on('close', close); signal?.addEventListener('abort', close, { once: true });
  removeSupervisor = supervisor.onClose(close);
  if (!active) throw new Error('DESTINATION_PLUGIN_LEASE_UNAVAILABLE');
  const verify = async ({ activity, observeSeal, observeRuntime }) => {
    if (!active || typeof activity?.check !== 'function' || typeof observeSeal !== 'function') throw new Error('DESTINATION_PLUGIN_LEASE_UNAVAILABLE');
    try {
      if (!activity.check()) throw new Error('Unavailable');
      const native = await supervisor.check(), runtime = observeRuntime ? await observeRuntime() : undefined, first = await observeSeal();
      if (!active || !activity.check() || !isOpenCodePluginSealObservation(first) || first.executionEligible !== false) throw new Error('Unavailable');
      if (observeRuntime && (!isOpenCodeDestinationRuntimeObservation(runtime) || runtime.executionEligible !== false)) throw new Error('Unavailable');
      if (runtime && (!Array.isArray(native.hostedActivations) || native.hostedActivations.length === 0 ||
          native.hostedActivations.some(item => item.bundleDigest !== runtime.bundleDigest) || !Array.isArray(native.hostedHookActivations) ||
          native.hostedHookActivations.some(item => item.bundleDigest !== runtime.bundleDigest))) throw new Error('Unavailable');
      const again = await supervisor.check(), second = await observeSeal(), runtimeAgain = observeRuntime ? await observeRuntime() : undefined;
      if (!active || !activity.check() || !isOpenCodePluginSealObservation(second) || JSON.stringify(native) !== JSON.stringify(again) ||
          JSON.stringify(first) !== JSON.stringify(second) || JSON.stringify(runtime) !== JSON.stringify(runtimeAgain) ||
          (runtimeAgain && !isOpenCodeDestinationRuntimeObservation(runtimeAgain))) throw new Error('Unavailable');
      return Object.freeze({ native, seal: first, ...(runtime ? { runtime } : {}), executionEligible: false });
    } catch { close(); throw new Error('DESTINATION_PLUGIN_LEASE_UNAVAILABLE'); }
  };
  return Object.freeze({ close, verify });
}
