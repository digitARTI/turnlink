// Retain both observational owners as one revocable capability. This does
// not establish destination authority or enable execution.
export function linkOpenCodeObservationOwners(source, destination) {
  if (typeof source?.onClose !== 'function' || typeof source?.close !== 'function' ||
      typeof destination?.onClose !== 'function' || typeof destination?.close !== 'function')
    throw new Error('OPENCODE_OBSERVATION_LINK_UNAVAILABLE');
  let active = true, removeSource, removeDestination;
  const close = () => {
    if (!active) return; active = false;
    removeSource?.(); removeDestination?.();
    try { source.close(); } catch {}
    try { destination.close(); } catch {}
  };
  removeSource = source.onClose(close);
  if (active) removeDestination = destination.onClose(close);
  if (!active) { removeSource?.(); removeDestination?.(); throw new Error('OPENCODE_OBSERVATION_LINK_UNAVAILABLE'); }
  return Object.freeze({ close, check: () => active });
}
