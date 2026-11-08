import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tools, controlTools } from './tools.js';
import { digest } from './config.js';
import { fingerprint } from './admissions.js';

// Experimental host-side port. It is not a sandbox and does not enable
// movement: only the listed session-scoped read operations are implemented.
// The owner must authenticate and isolate the process holding the other port.
const sessionIDSchema = z.string().startsWith('ses_').max(1024);
const messageID = z.string().uuid();
const membershipValue = z.strictObject({ sessionID: sessionIDSchema, directory: z.string().min(1).max(4096), channel: z.string().min(1).max(128).optional(),
  forms: z.array(z.string().max(512)).max(512), taskWatch: z.boolean(),
  receiverHandoff: z.strictObject({ transitionID: z.string().uuid(), receiverHash: z.string().regex(/^[a-f0-9]{64}$/) }).optional() });
const ledgerRecord = z.strictObject({ id: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['inflight', 'uncertain', 'accepted']), rpcId: z.string().min(1).max(512), method: z.literal('session.prompt'), updatedAt: z.number().finite() });
const request = z.discriminatedUnion('method', [
  ...['session.get', 'session.wait', 'session.context', 'permission.list'].map(method => z.strictObject({ id: messageID, method: z.literal(method), sessionID: sessionIDSchema })),
  z.strictObject({ id: messageID, method: z.literal('storage.get'), sessionID: sessionIDSchema }),
  z.strictObject({ id: messageID, method: z.literal('storage.scan'), sessionID: sessionIDSchema }),
  z.strictObject({ id: messageID, method: z.literal('storage.set'), sessionID: sessionIDSchema, value: membershipValue }),
  z.strictObject({ id: messageID, method: z.literal('storage.remove'), sessionID: sessionIDSchema }),
  z.strictObject({ id: messageID, method: z.literal('tools.register'), sessionID: sessionIDSchema, names: z.array(z.string().min(1).max(128)).max(64) }),
  z.strictObject({ id: messageID, method: z.literal('ledger.get'), sessionID: sessionIDSchema, messageID }),
  z.strictObject({ id: messageID, method: z.literal('ledger.set'), sessionID: sessionIDSchema, record: ledgerRecord }),
  z.strictObject({ id: messageID, method: z.literal('broker.call'), sessionID: sessionIDSchema,
    operation: z.enum(['connect', 'subscribe', 'unsubscribe', 'join', 'members', 'history', 'send', 'ack', 'leave', 'resume', 'control_command', 'control_query']),
    params: z.record(z.string(), z.unknown()) }),
  z.strictObject({ id: messageID, method: z.literal('session.prompt'), sessionID: sessionIDSchema,
    input: z.strictObject({ sessionID: sessionIDSchema, id: z.string().min(1).max(512), text: z.string().max(256 * 1024),
      delivery: z.enum(['queue', 'steer']), resume: z.boolean(), metadata: z.record(z.string(), z.unknown()) }) }),
]);
const ack = z.strictObject({ method: z.literal('event.ack'), sequence: z.number().int().positive().safe() });
const toolResult = z.discriminatedUnion('ok', [
  z.strictObject({ invocationID: messageID, ok: z.literal(true), value: z.strictObject({ content: z.string().max(1024 * 1024) }) }),
  z.strictObject({ invocationID: messageID, ok: z.literal(false) }),
]);
const eventTypes = new Set(['session.moved', 'session.deleted', 'permission.asked', 'permission.replied', 'form.created', 'form.replied', 'form.cancelled']);

export function createOpenCodePluginCapabilityHost({ port, context, sessionID, signal, authorizeMembership, admitPrompt, participantBroker, childLedger, activityEvidence, allowTools = false, allowControlTools = false }) {
  if (!port?.postMessage || !port?.on || !context?.session || !context?.permission || !sessionID?.startsWith('ses_') || signal?.aborted)
    throw new Error('PLUGIN_CAPABILITY_UNAVAILABLE');
  const controller = new AbortController(); let closed = false, sequence = 0, toolsRegistered = false, hold, holdGeneration = 0;
  const pending = new Set(), activeRequests = new Set(), invocations = new Map(), maintenanceRequests = new Map();
  const operations = new Map([
    ['session.get', args => context.session.get(args, { signal: controller.signal })],
    ['session.wait', args => context.session.wait(args, { signal: controller.signal })],
    ['session.context', args => context.session.context(args, { signal: controller.signal })],
    ['permission.list', args => context.permission.list(args, { signal: controller.signal })],
  ]);
  const close = () => {
    if (closed) return;
    closed = true; controller.abort(); signal?.removeEventListener('abort', close); participantBroker?.close();
    for (const invocation of invocations.values()) invocation.reject(new Error('PLUGIN_CAPABILITY_UNAVAILABLE')); invocations.clear();
    for (const request of maintenanceRequests.values()) { clearTimeout(request.timer); request.reject(new Error('PLUGIN_CAPABILITY_UNAVAILABLE')); } maintenanceRequests.clear();
    port.off('message', receive); port.off('close', close); port.close();
  };
  const receive = async raw => {
    if (raw && Object.hasOwn(raw, 'maintenanceID')) {
      const entry = maintenanceRequests.get(raw.maintenanceID);
      if (!entry || Object.keys(raw).sort().join(',') !== 'maintenanceID,ok' || raw.ok !== true) { close(); return; }
      maintenanceRequests.delete(raw.maintenanceID); clearTimeout(entry.timer); entry.resolve(); return;
    }
    const finished = toolResult.safeParse(raw);
    if (finished.success) {
      const pendingInvocation = invocations.get(finished.data.invocationID);
      if (!pendingInvocation) { close(); return; }
      invocations.delete(finished.data.invocationID);
      if (finished.data.ok) pendingInvocation.resolve(finished.data.value); else pendingInvocation.reject(new Error('PLUGIN_CAPABILITY_UNAVAILABLE'));
      return;
    }
    const acknowledged = ack.safeParse(raw);
    if (acknowledged.success) { if (!pending.delete(acknowledged.data.sequence)) close(); return; }
    const parsed = request.safeParse(raw);
    if (!parsed.success || parsed.data.sessionID !== sessionID) { close(); return; }
    const { id, method } = parsed.data;
    if (activeRequests.size >= 128 || activeRequests.has(id)) { close(); return; }
    activeRequests.add(id);
    try {
      if (hold) { hold.dirty = true; throw new Error('Unavailable'); }
      let value;
      if (method === 'storage.get' || method === 'storage.scan') {
        if (typeof context.storage?.get !== 'function') throw new Error('Unavailable');
        value = await context.storage.get(`memberships/${sessionID}`);
        if (method === 'storage.scan') value = { entries: value === undefined ? [] : [{ key: `memberships/${sessionID}`, value }] };
      } else if (method === 'storage.set' || method === 'storage.remove') {
        if (typeof authorizeMembership !== 'function' || typeof context.storage?.[method.slice(8)] !== 'function' ||
            (method === 'storage.set' && parsed.data.value.sessionID !== sessionID) ||
            await authorizeMembership({ method, sessionID, ...(method === 'storage.set' ? { value: parsed.data.value } : {}) }, controller.signal) !== true || closed)
          throw new Error('Unavailable');
        value = method === 'storage.set' ? await context.storage.set(`memberships/${sessionID}`, parsed.data.value) : await context.storage.remove(`memberships/${sessionID}`);
      } else if (method === 'ledger.get' || method === 'ledger.set') {
        if (!childLedger?.get || !childLedger?.set || !participantBroker?.observeMessage) throw new Error('Unavailable');
        const messageID = method === 'ledger.get' ? parsed.data.messageID : parsed.data.record.id;
        const observed = participantBroker.observeMessage(messageID);
        if (!observed) throw new Error('Unavailable');
        if (method === 'ledger.get') value = childLedger.get(messageID);
        else {
          const record = parsed.data.record, prior = childLedger.get(messageID);
          if (record.fingerprint !== fingerprint(observed) || record.rpcId !== `msg_turnlink_${digest(`${sessionID}:${messageID}`)}` ||
              (!prior && record.state !== 'inflight') || (prior && (prior.fingerprint !== record.fingerprint || prior.rpcId !== record.rpcId ||
                (prior.state === 'accepted' && record.state !== 'accepted') || (prior.state === 'uncertain' && record.state === 'inflight'))) ||
              (record.state === 'accepted' && admitPrompt?.mayAck?.(messageID) !== true)) throw new Error('Unavailable');
          value = childLedger.set(record);
        }
      } else if (method === 'broker.call') {
        if (!participantBroker?.call) throw new Error('Unavailable');
        value = await participantBroker.call(parsed.data.operation, parsed.data.params);
      } else if (method === 'tools.register') {
        const allowed = [...tools, ...(allowControlTools ? controlTools : [])].filter(definition => definition.name !== 'channel_ack');
        if (!allowTools || toolsRegistered || typeof context.tool?.transform !== 'function' ||
            new Set(parsed.data.names).size !== allowed.length || parsed.data.names.length !== allowed.length ||
            allowed.some(definition => !parsed.data.names.includes(definition.name))) throw new Error('Unavailable');
        toolsRegistered = true;
        await context.tool.transform(editor => {
          for (const definition of allowed) {
            const input = structuredClone(definition.inputSchema);
            if (definition.name === 'channel_join') {
              delete input.properties.harness; delete input.properties.sessionId;
              input.required = input.required.filter(key => !['harness', 'sessionId'].includes(key)); input.properties.project.required = ['name'];
            }
            editor.add({ name: definition.name, description: definition.name === 'channel_join' ?
              'Join the shared agent channel; declare your role and project. Identity is supplied by the actual OpenCode session.' : definition.description,
              input, options: { codemode: false }, execute: async (args, native) => {
                if (hold) hold.dirty = true;
                if (closed || hold || native?.sessionID !== sessionID || native.signal?.aborted || invocations.size >= 128) throw new Error('PLUGIN_CAPABILITY_UNAVAILABLE');
                const invocationID = randomUUID();
                return new Promise((resolve, reject) => {
                  const abort = () => close(); native.signal?.addEventListener('abort', abort, { once: true });
                  invocations.set(invocationID, { resolve: value => { native.signal?.removeEventListener('abort', abort); resolve(value); },
                    reject: error => { native.signal?.removeEventListener('abort', abort); reject(error); } });
                  if (native.signal?.aborted) { close(); return; }
                  try { port.postMessage({ invocationID, tool: definition.name, args, sessionID }); } catch { close(); }
                });
              } });
          }
        });
        value = null;
      } else if (method === 'session.prompt') {
        if (parsed.data.input.sessionID !== sessionID || typeof admitPrompt !== 'function') throw new Error('Unavailable');
        // The trusted owner must independently authenticate and journal the
        // source of the prompt. A sidecar's requested text is not authority.
        value = await admitPrompt(parsed.data.input, controller.signal);
        if (value?.id !== parsed.data.input.id || value?.sessionID !== sessionID) throw new Error('Unavailable');
      } else value = await operations.get(method)({ sessionID });
      if (!closed) port.postMessage({ id, ok: true, value: value ?? null });
    } catch { if (!closed) port.postMessage({ id, ok: false, error: 'PLUGIN_CAPABILITY_UNAVAILABLE' }); }
    finally { activeRequests.delete(id); }
  };
  port.on('message', receive); port.on('close', close); signal?.addEventListener('abort', close, { once: true });
  port.start?.();
  participantBroker?.onEvent?.((type, data) => {
    if (closed) return;
    if (hold) hold.dirty = true;
    if (type === 'disconnected' || pending.size >= 128 || sequence >= Number.MAX_SAFE_INTEGER) { close(); return; }
    pending.add(++sequence);
    try { port.postMessage({ brokerEvent: type, data, sequence }); } catch { close(); }
  });
  if (typeof context.event?.subscribe === 'function') void (async () => {
    try {
      for await (const event of context.event.subscribe({ signal: controller.signal })) {
        if (closed) break;
        if (!eventTypes.has(event?.type) || (event.data?.sessionID || event.data?.form?.sessionID) !== sessionID) continue;
        if (hold) hold.dirty = true;
        if (pending.size >= 128 || sequence >= Number.MAX_SAFE_INTEGER) { close(); break; }
        pending.add(++sequence); port.postMessage({ event, sequence });
      }
      // A silent stream loss is not proof that events were observed.
      if (!closed) close();
    } catch { if (!closed) close(); }
  })();
  const holdActivity = () => {
    if (closed || hold || activeRequests.size || invocations.size || pending.size || typeof activityEvidence !== 'function' || activityEvidence() !== true)
      throw new Error('PLUGIN_ACTIVITY_UNAVAILABLE');
    const current = { generation: ++holdGeneration, dirty: false }; hold = current;
    return Object.freeze({ check: () => !closed && hold === current && !current.dirty && !activeRequests.size && !invocations.size && !pending.size && activityEvidence() === true,
      release: () => { if (hold !== current) throw new Error('PLUGIN_ACTIVITY_UNAVAILABLE'); hold = undefined; } });
  };
  const drainAndHoldActivity = async () => {
    const deadline = Date.now() + 3000;
    while (!closed && !hold) {
      if (!activeRequests.size && !invocations.size && !pending.size && typeof activityEvidence === 'function' && activityEvidence() === true)
        return holdActivity();
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('PLUGIN_ACTIVITY_UNAVAILABLE');
  };
  const maintenance = action => {
    if (closed || maintenanceRequests.size || (action === 'resume' && hold)) return Promise.reject(new Error('PLUGIN_CAPABILITY_UNAVAILABLE'));
    const maintenanceID = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(close, 5000); maintenanceRequests.set(maintenanceID, { resolve, reject, timer });
      try { port.postMessage({ maintenanceID, action }); } catch { close(); }
    });
  };
  return Object.freeze({ close, holdActivity, drainAndHoldActivity, pauseMaintenance: () => maintenance('pause'), resumeMaintenance: () => maintenance('resume') });
}
