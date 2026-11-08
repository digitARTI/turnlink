import { randomUUID } from 'node:crypto';
import { z } from 'zod';

// Private bidirectional transport primitive. The caller must supply a port
// bound to the native owner and must close it on loss of the parent lease.
// It does not itself authenticate a process or authorize movement.
export function createOpenCodeDestinationContextRpc({ port, sessionID, handlers, signal, timeoutMs = 30000 }) {
  if (!port?.on || !port?.postMessage || !port?.close || !sessionID?.startsWith('ses_') || signal?.aborted ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
    throw new Error('DESTINATION_CONTEXT_UNAVAILABLE');
  const id = z.string().uuid(), args = z.record(z.string(), z.unknown()), empty = z.strictObject({});
  const methods = { 'session.get': empty, 'session.wait': empty, 'session.context': empty, 'permission.list': empty,
    'storage.get': empty, 'storage.remove': empty, 'storage.set': z.strictObject({ value: args }),
    'tool.register': z.strictObject({ tools: z.array(z.strictObject({ name: z.string().min(1).max(128), description: z.string().max(8192),
      input: args, options: args.optional() })).max(64) }),
    'tool.invoke': z.strictObject({ name: z.string().min(1).max(128), input: args }),
    'event.deliver': z.strictObject({ sequence: z.number().int().positive().safe(), event: args }) };
  const request = z.strictObject({ type: z.literal('request'), id, sessionID: z.literal(sessionID),
    method: z.enum(Object.keys(methods)), args });
  const response = z.strictObject({ type: z.literal('response'), id, sessionID: z.literal(sessionID), ok: z.boolean(), value: z.unknown().optional() });
  let closed = false; const controller = new AbortController(), pending = new Map(), active = new Set(), seen = new Set(), listeners = new Set();
  const fail = () => {
    if (closed) return; closed = true; controller.abort(); signal?.removeEventListener('abort', fail); port.off('message', receive); port.off('close', fail); port.close();
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error('DESTINATION_CONTEXT_UNAVAILABLE')); } pending.clear();
    for (const listener of listeners) { try { listener(); } catch {} } listeners.clear();
  };
  const receive = raw => {
    if (closed) return;
    const result = response.safeParse(raw);
    if (result.success) {
      const entry = pending.get(result.data.id); if (!entry) return fail(); pending.delete(result.data.id); clearTimeout(entry.timer);
      if (result.data.ok) entry.resolve(result.data.value); else entry.reject(new Error('DESTINATION_CONTEXT_UNAVAILABLE'));
      return;
    }
    const input = request.safeParse(raw);
    if (!input.success || active.size >= 128 || seen.size >= 4096 || seen.has(input.data.id) || !methods[input.data.method].safeParse(input.data.args).success ||
        typeof handlers?.[input.data.method] !== 'function') return fail();
    const message = input.data; active.add(message.id); seen.add(message.id);
    void Promise.resolve().then(() => { if (controller.signal.aborted) throw new Error('Unavailable'); return handlers[message.method](message.args, controller.signal); }).then(value => {
      if (!closed) port.postMessage({ type: 'response', id: message.id, sessionID, ok: true, ...(value === undefined ? {} : { value }) });
    }, () => { if (!closed) port.postMessage({ type: 'response', id: message.id, sessionID, ok: false }); })
      .catch(fail).finally(() => active.delete(message.id));
  };
  port.on('message', receive); port.on('close', fail); signal?.addEventListener('abort', fail, { once: true }); port.start?.();
  const call = (method, value = {}) => {
    if (closed || !Object.hasOwn(methods, method) || pending.size >= 128 || !methods[method].safeParse(value).success) return Promise.reject(new Error('DESTINATION_CONTEXT_UNAVAILABLE'));
    const requestID = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(requestID, { resolve, reject, timer: setTimeout(fail, timeoutMs) });
      try { port.postMessage({ type: 'request', id: requestID, sessionID, method, args: value }); } catch { fail(); }
    });
  };
  const onClose = listener => { if (typeof listener !== 'function') throw new Error('DESTINATION_CONTEXT_UNAVAILABLE');
    if (closed) listener(); else listeners.add(listener); return () => listeners.delete(listener); };
  return Object.freeze({ call, onClose, close: fail });
}
