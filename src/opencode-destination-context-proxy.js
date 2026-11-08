import { createOpenCodeDestinationContextRpc } from './opencode-destination-context-rpc.js';
import { createOpenCodeDestinationStorageJournal } from './opencode-destination-storage-journal.js';

// Supervisor-side facsimile of the native plugin context. It is intentionally
// limited to the APIs used by the sealed plugin owner; no movement API exists.
export function createOpenCodeDestinationContextProxy({ port, sessionID, directory, signal, storageJournalDirectory }) {
  if (!directory?.startsWith('/') || !sessionID?.startsWith('ses_')) throw new Error('DESTINATION_CONTEXT_UNAVAILABLE');
  let closed = false, registered = false, subscribed = false, sequence = 0; const definitions = new Map(), events = [], consumers = [];
  const unavailable = () => new Error('DESTINATION_CONTEXT_UNAVAILABLE');
  const journal = storageJournalDirectory ? createOpenCodeDestinationStorageJournal({ directory: storageJournalDirectory, sessionID }) : undefined;
  const rpc = createOpenCodeDestinationContextRpc({ port, sessionID, signal, handlers: {
    'tool.invoke': async ({ name, input }, abort) => {
      const definition = definitions.get(name); if (!definition || abort.aborted || closed) throw unavailable();
      const value = await definition.execute(input, { sessionID, signal: abort });
      if (abort.aborted || closed) throw unavailable(); return value;
    },
    'event.deliver': async value => {
      if (closed || value.sequence !== sequence + 1 || events.length >= 128) throw unavailable();
      sequence = value.sequence;
      return new Promise((resolve, reject) => {
        const item = { event: value.event, resolve: () => resolve({ acknowledged: value.sequence }), reject }, consumer = consumers.shift();
        if (consumer) consumer.resolve(item); else events.push(item);
      });
    },
  } });
  const close = () => {
    if (closed) return; closed = true; rpc.close();
    for (const consumer of consumers.splice(0)) consumer.reject(unavailable());
    for (const event of events.splice(0)) event.reject(unavailable());
  };
  rpc.onClose(close);
  const session = method => input => {
    if (input?.sessionID !== sessionID || closed) return Promise.reject(unavailable());
    return rpc.call(method);
  };
  const key = value => { if (value !== `memberships/${sessionID}` || closed) throw unavailable(); };
  const context = Object.freeze({ location: Object.freeze({ directory }),
    // Prompt admission is deliberately unavailable in the observation phase.
    session: Object.freeze({ get: session('session.get'), wait: session('session.wait'), context: session('session.context'),
      prompt: async () => { throw unavailable(); } }),
    permission: Object.freeze({ list: session('permission.list') }),
    storage: Object.freeze({ get: async value => { key(value); const result = await rpc.call('storage.get'); return result === null ? undefined : result; },
      set: (name, value) => { key(name); if (!journal) throw unavailable(); return journal.run('set', value, () => rpc.call('storage.set', { value })); },
      remove: name => { key(name); if (!journal) throw unavailable(); return journal.run('remove', null, () => rpc.call('storage.remove')); } }),
    tool: Object.freeze({ transform: async callback => {
      if (registered || closed || typeof callback !== 'function') throw unavailable(); registered = true;
      callback({ add: definition => {
        if (!definition || typeof definition.name !== 'string' || typeof definition.execute !== 'function' || definitions.has(definition.name)) throw unavailable();
        definitions.set(definition.name, definition);
      } });
      const tools = [...definitions.values()].map(({ name, description, input, options }) => ({ name, description, input, ...(options ? { options } : {}) }));
      try { await rpc.call('tool.register', { tools }); } catch { close(); throw unavailable(); }
    } }),
    event: Object.freeze({ subscribe: async function* ({ signal: eventSignal } = {}) {
      if (subscribed || closed || eventSignal?.aborted) throw unavailable(); subscribed = true;
      const abort = () => close(); eventSignal?.addEventListener('abort', abort, { once: true });
      let current;
      try { while (!closed) {
        current = events.shift() ?? await new Promise((resolve, reject) => consumers.push({ resolve, reject }));
        yield current.event; if (closed) throw unavailable(); current.resolve(); current = undefined;
      } }
      finally { current?.reject(unavailable()); eventSignal?.removeEventListener('abort', abort); close(); }
    } }),
  });
  return Object.freeze({ context, close });
}
