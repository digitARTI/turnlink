import { EventEmitter } from 'node:events';
import { on } from 'node:events';
import plugin from '../../adapters/opencode.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function openCodeFixture(t, options, overrides = {}) {
  if (!options.tokenFile && options.token) {
    const tokenFile = join(options.credentialDirectory, '..', 'fixture-host.token');
    writeFileSync(tokenFile, options.token, { mode: 0o600 });
    options = { ...options, tokenFile };
  }
  const tools = {}, calls = [], storage = overrides.storage || new Map();
  const permissions = new Map(), forms = new Map(), events = new EventEmitter();
  let subscriptions = 0;
  const ctx = {
    app: { version: '2.0.28' }, location: { directory: '/projects/b' }, options,
    tool: { transform: async callback => callback({ add: tool => { tools[tool.name] = tool; } }) },
    storage: {
      get: async key => storage.get(key), set: async (key, value) => storage.set(key, value),
      remove: async key => storage.delete(key),
      scan: async ({ prefix }) => ({ entries: [...storage].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })) }),
    },
    permission: { list: async ({ sessionID }) => [...(permissions.get(sessionID) || [])] },
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: '/projects/b' }, agent: 'plan', model: { providerID: 'fixture', id: 'test' } }),
      context: async ({ sessionID }) => [{ type: 'assistant', content: (forms.get(sessionID) || []).map(f => ({
        type: 'tool', name: 'question', id: f.id, state: { status: 'running' },
      })) }],
      prompt: async input => { calls.push(input); return { id: input.id, sessionID: input.sessionID }; },
      ...overrides.session,
    },
    event: { subscribe: async function* ({ signal }) { subscriptions++; for await (const [event] of on(events, 'event', { signal })) yield event; } },
  };
  const cleanup = await plugin.setup(ctx);
  t.after(cleanup);
  const emit = (type, data) => {
    const sessionID = data.sessionID || data.form?.sessionID;
    if (type === 'permission.asked') permissions.set(sessionID, [...(permissions.get(sessionID) || []), data]);
    if (type === 'permission.replied') permissions.set(sessionID, (permissions.get(sessionID) || []).filter(p => p.id !== data.requestID));
    if (type === 'form.created') forms.set(sessionID, [...(forms.get(sessionID) || []), data.form]);
    if (['form.replied', 'form.cancelled'].includes(type)) forms.set(sessionID, (forms.get(sessionID) || []).filter(f => f.id !== data.id));
    events.emit('event', { type, data });
  };
  return { tools, calls, emit, cleanup, ctx, storage, permissions, forms,
    disconnectEvents: () => events.emit('error', new Error('Fixture event stream disconnected')),
    subscriptionCount: () => subscriptions };
}
