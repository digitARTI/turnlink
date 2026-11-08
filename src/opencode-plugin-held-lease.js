import { pluginProvenanceObservation } from './opencode-plugin-provenance.js';
import { isOpenCodeNativeIdleHold } from './opencode-native-movement.js';
import { OpenCodeSourceReceiver } from './opencode-source-receiver.js';
import { WorktreeTransition } from './control/contracts.js';

// Experimental coordination only. The observed provenance is explicitly
// non-executable; this object never submits a broker grant or native move.
export async function holdOpenCodePluginProvenance({ native, capabilityHost, observeSeal, watchAuthority, daemonID, port, signal }) {
  if (!native?.holdIdle || !native?.checkIdle || !native?.releaseIdle || !native?.close || !capabilityHost?.holdActivity ||
      !capabilityHost?.pauseMaintenance || !capabilityHost?.resumeMaintenance || !capabilityHost?.drainAndHoldActivity ||
      typeof observeSeal !== 'function' || typeof watchAuthority !== 'function' || !port?.on || signal?.aborted) throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE');
  let active = true, nativeHold, activity, removeNativeClose; const listeners = new Set();
  const notifyClosed = () => { for (const listener of listeners) { try { listener(); } catch {} } listeners.clear(); };
  const onClose = listener => {
    if (typeof listener !== 'function') throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE');
    if (!active) listener(); else listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const close = () => {
    if (!active) return; active = false; signal?.removeEventListener('abort', close); port.off('close', close); removeNativeClose?.();
    try { native.close(); } catch {}
    try { capabilityHost.close(); } catch {}
    notifyClosed();
  };
  port.on('close', close); signal?.addEventListener('abort', close, { once: true });
  if (typeof native.onClose !== 'function') { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE'); }
  removeNativeClose = native.onClose(close);
  try {
    const watch = await watchAuthority();
    if (!active || watch?.watching !== true) throw new Error('Unavailable');
    await capabilityHost.pauseMaintenance();
    activity = await capabilityHost.drainAndHoldActivity();
    nativeHold = await native.holdIdle();
    if (!active || !activity.check()) throw new Error('Unavailable');
    const provenance = await pluginProvenanceObservation({ native, hold: nativeHold, observeSeal, daemonID });
    if (!active || !activity.check()) throw new Error('Unavailable');
    const check = async () => {
      if (!active || !activity.check()) { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE'); }
      try {
        const current = await pluginProvenanceObservation({ native, hold: nativeHold, observeSeal, daemonID });
        if (!active || !activity.check() || JSON.stringify(current) !== JSON.stringify(provenance)) throw new Error('Unavailable');
        return provenance;
      } catch { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE'); }
    };
    const release = async () => {
      if (!active) throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE');
      try {
        await native.releaseIdle(nativeHold.holdID);
        if (!active) throw new Error('Unavailable');
        activity.release(); await capabilityHost.resumeMaintenance();
        if (!active) throw new Error('Unavailable');
        active = false; signal?.removeEventListener('abort', close); port.off('close', close); removeNativeClose?.();
        notifyClosed();
      } catch { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE'); }
    };
    // This binds a broker-observed grant to the live hold for inspection. The
    // provenance is still explicitly non-executable; no native effect occurs.
    const observeGrant = async (value, source) => {
      const grant = WorktreeTransition.parse(value);
      if (!(source instanceof OpenCodeSourceReceiver) || grant.status !== 'prepared' || grant.purpose ||
          grant.nativeAuthorityObservationDigest ||
          grant.agentId !== `opencode:${nativeHold.sessionID}` || grant.pluginProvenanceDigest !== provenance.digest ||
          !isOpenCodeNativeIdleHold(nativeHold, native, grant.from)) throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE');
      await check();
      try {
        await source.observeGrant(grant);
        await source.watchGrant(grant);
        await check();
        // A broker revocation during the potentially slow seal inspection
        // must not be hidden by an earlier successful observation.
        await source.observeGrant(grant);
        await native.checkIdle(nativeHold.holdID);
        if (!active || !activity.check()) throw new Error('Unavailable');
        return Object.freeze({ transitionID: grant.id, provenanceDigest: provenance.digest, executionEligible: false });
      } catch { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE'); }
    };
    const observeNativeAuthority = async () => {
      if (typeof native.observeHeldAuthority !== 'function') throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE');
      await check();
      try { const authority = await native.observeHeldAuthority(nativeHold.holdID); await check();
        return Object.freeze({ ...authority, pluginProvenanceDigest: provenance.digest }); }
      catch { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE'); }
    };
    return Object.freeze({ provenance, check, observeGrant, observeNativeAuthority, release, close, onClose });
  } catch (cause) { close(); throw new Error('PLUGIN_HELD_LEASE_UNAVAILABLE', { cause }); }
}
