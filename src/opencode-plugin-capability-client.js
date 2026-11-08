import { randomUUID } from 'node:crypto';

// This partial client does not make a plugin runnable by itself. The owner
// decides which operations to expose and must supply an isolated transport.
export function createOpenCodePluginCapabilityClient({ port, sessionID, signal }) {
  if (!port?.postMessage || !port?.on || !sessionID?.startsWith('ses_') || signal?.aborted) throw new Error('PLUGIN_CAPABILITY_UNAVAILABLE');
  const waiting = new Map(), events = [], consumers = [], toolHandlers = new Map(), controller = new AbortController(), closeListeners = new Set(), brokerListeners = new Set();
  let closed = false, sequence = 0, subscribed = false, registered = false, maintenance;
  const unavailable = () => new Error('PLUGIN_CAPABILITY_UNAVAILABLE');
  const close = () => {
    if (closed) return; closed = true; controller.abort(); signal?.removeEventListener('abort', close); port.off('message', receive); port.off('close', close); port.close();
    for (const pending of waiting.values()) pending.reject(unavailable()); waiting.clear();
    for (const consumer of consumers.splice(0)) consumer.reject(unavailable()); events.length = 0;
    for (const listener of closeListeners) listener(); closeListeners.clear();
  };
  const receive = message => {
    if (!message || typeof message !== 'object' || closed) return close();
    if (Object.hasOwn(message, 'maintenanceID')) {
      if (Object.keys(message).sort().join(',') !== 'action,maintenanceID' || typeof message.maintenanceID !== 'string' ||
          !['pause', 'resume'].includes(message.action) || typeof maintenance?.[message.action] !== 'function') return close();
      try { maintenance[message.action](); port.postMessage({ maintenanceID: message.maintenanceID, ok: true }); } catch { close(); }
      return;
    }
    if (Object.hasOwn(message, 'invocationID')) {
      const handler = toolHandlers.get(message.tool);
      if (typeof message.invocationID !== 'string' || message.sessionID !== sessionID || !handler) return close();
      void Promise.resolve().then(() => handler(message.args, { sessionID, signal: controller.signal })).then(value => {
        if (!closed) port.postMessage({ invocationID: message.invocationID, ok: true, value });
      }, () => { if (!closed) port.postMessage({ invocationID: message.invocationID, ok: false }); }).catch(close);
      return;
    }
    if (Object.hasOwn(message, 'sequence')) {
      if (!Number.isSafeInteger(message.sequence) || message.sequence !== sequence + 1) return close();
      if (Object.hasOwn(message, 'brokerEvent')) {
        if (!['message', 'membership_removed'].includes(message.brokerEvent) || !brokerListeners.size) return close();
        sequence = message.sequence;
        try { for (const listener of brokerListeners) listener(message.brokerEvent, message.data); port.postMessage({ method: 'event.ack', sequence }); }
        catch { close(); } return;
      }
      if (!message.event || events.length >= 128) return close();
      sequence = message.sequence; const event = { sequence, event: message.event }, consumer = consumers.shift();
      if (consumer) consumer.resolve(event); else events.push(event); return;
    }
    const pending = waiting.get(message.id);
    if (!pending || typeof message.ok !== 'boolean') return close();
    waiting.delete(message.id); if (message.ok) pending.resolve(message.value); else pending.reject(unavailable());
  };
  port.on('message', receive); port.on('close', close); signal?.addEventListener('abort', close, { once: true }); port.start?.();
  const call = (method, extra = {}) => {
    if (closed || waiting.size >= 128) return Promise.reject(unavailable());
    const id = randomUUID(); return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try { port.postMessage({ id, method, sessionID, ...extra }); } catch { waiting.delete(id); close(); reject(unavailable()); }
    });
  };
  const requireSession = input => { if (input?.sessionID !== sessionID) throw unavailable(); };
  const membershipKey = key => { if (key !== `memberships/${sessionID}`) throw unavailable(); };
  return Object.freeze({
    session: Object.freeze({ get: input => { requireSession(input); return call('session.get'); },
      wait: input => { requireSession(input); return call('session.wait'); }, context: input => { requireSession(input); return call('session.context'); },
      prompt: input => { requireSession(input); return call('session.prompt', { input }); } }),
    permission: Object.freeze({ list: input => { requireSession(input); return call('permission.list'); } }),
    broker: Object.freeze({ call: (operation, params = {}) => call('broker.call', { operation, params }) }),
    createAdmissionLedger: () => Object.freeze({ get: messageID => call('ledger.get', { messageID }).then(value => value === null ? undefined : value),
      set: record => call('ledger.set', { record }) }),
    storage: Object.freeze({ get: key => { membershipKey(key); return call('storage.get').then(value => value === null ? undefined : value); },
      set: (key, value) => { membershipKey(key); return call('storage.set', { value }); }, remove: key => { membershipKey(key); return call('storage.remove'); },
      scan: input => { if (input?.prefix !== 'memberships/' || input.after) throw unavailable(); return call('storage.scan'); } }),
    tool: Object.freeze({ transform: async callback => {
      if (registered || closed || typeof callback !== 'function') throw unavailable();
      registered = true;
      callback({ add: definition => {
        if (!definition || typeof definition.name !== 'string' || typeof definition.execute !== 'function' || toolHandlers.has(definition.name)) throw unavailable();
        toolHandlers.set(definition.name, definition.execute);
      } });
      await call('tools.register', { names: [...toolHandlers.keys()] });
    } }),
    event: Object.freeze({ subscribe: async function* (options = {}) {
      if (subscribed || closed || options.signal?.aborted) throw unavailable();
      subscribed = true; options.signal?.addEventListener('abort', close, { once: true });
      try {
        while (!closed) {
          const next = events.shift() ?? await new Promise((resolve, reject) => consumers.push({ resolve, reject }));
          if (closed) throw unavailable();
          yield next.event;
          if (closed) throw unavailable();
          port.postMessage({ method: 'event.ack', sequence: next.sequence });
        }
      } finally { options.signal?.removeEventListener('abort', close); close(); }
    } }), maintenance: Object.freeze({ register: handlers => {
      if (maintenance || typeof handlers?.pause !== 'function' || typeof handlers?.resume !== 'function') throw unavailable();
      maintenance = handlers;
    } }), onBrokerEvent: listener => { if (closed || typeof listener !== 'function') throw unavailable(); brokerListeners.add(listener); },
    onClose: listener => { if (closed) listener(); else closeListeners.add(listener); }, close,
  });
}
