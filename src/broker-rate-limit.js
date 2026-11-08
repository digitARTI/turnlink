import { setTimeout as delay } from 'node:timers/promises';

// Only the broker's explicitly pre-dispatch rejection may be retried here.
// Ambiguous transport errors and errors from dispatched effects are returned.
export async function retryBrokerPreDispatch(operation, { check, signal }) {
  if (typeof operation !== 'function' || typeof check !== 'function' || !signal) throw new Error('Broker retry unavailable');
  const backoff = [50, 100, 200, 400, 800];
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted(); check();
    let result;
    try {
      result = await operation();
    } catch (error) {
      if (error?.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH' || attempt >= backoff.length) throw error;
      signal.throwIfAborted(); check();
      await delay(backoff[attempt], undefined, { signal });
      continue;
    }
    signal.throwIfAborted(); check();
    return result;
  }
}
