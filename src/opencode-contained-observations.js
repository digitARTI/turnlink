// A contained owner intentionally refuses overlapping journal operations.
// Relay, endpoint and broker attestation share this queue so their own reads
// do not spuriously invalidate a live lease. Other writers remain independent
// and any unexpected owner lock conflict still fails closed.
const tails = new WeakMap();
export function observeContainedOwner(owner, operation = () => owner.observe()) {
  if (!owner || typeof operation !== 'function') return Promise.reject(new Error('CONTAINED_OWNER_UNAVAILABLE'));
  const previous = tails.get(owner) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  tails.set(owner, tail);
  void tail.then(() => { if (tails.get(owner) === tail) tails.delete(owner); });
  return current;
}
