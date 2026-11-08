import { close, read, write } from 'node:fs';
import { z } from 'zod';

// This descriptor is inherited from the source supervisor, not selected by
// a plugin, broker request, or destination guest.
export function connectOpenCodeDestinationOwner({ fd, timeoutMs = 30000 }) {
  if (fd !== 6 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
    throw new Error('DESTINATION_OWNER_UNAVAILABLE');
  const schema = z.strictObject({ id: z.number().int().positive().safe(), result: z.strictObject({ directory: z.string().startsWith('/'),
    holdID: z.string().uuid(), revision: z.number().int().nonnegative().safe(), authorityDigest: z.string().regex(/^[a-f0-9]{64}$/), observerID: z.string().uuid(),
    componentDigests: z.strictObject(Object.fromEntries(['agent', 'model', 'permissions', 'permissionRules', 'hooks', 'tools', 'toolDefinitions', 'instructions']
      .map(name => [name, z.string().regex(/^[a-f0-9]{64}$/)]))).optional(), modelResolution: z.enum(['current', 'unavailable']).optional(),
    projectInstructionFilesDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    hostedActivations: z.array(z.strictObject({ definition: z.string().uuid(), bundleDigest: z.string().regex(/^[a-f0-9]{64}$/) })).max(64).optional(),
    hostedHookActivations: z.array(z.strictObject({ definition: z.string().uuid(), bundleDigest: z.string().regex(/^[a-f0-9]{64}$/) })).max(64).optional() }) });
  let active = true, sequence = 0, pending, buffer = Buffer.alloc(0);
  const listeners = new Set();
  const stop = () => {
    if (!active) return; active = false; close(fd, () => {});
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('DESTINATION_OWNER_UNAVAILABLE')); pending = undefined; }
    for (const listener of listeners) { try { listener(); } catch {} } listeners.clear();
  };
  const readNext = () => {
    if (!active) return;
    const chunk = Buffer.alloc(16384);
    read(fd, chunk, 0, chunk.length, null, (error, count) => {
      if (error || !count) return stop();
      buffer = Buffer.concat([buffer, chunk.subarray(0, count)]);
      if (buffer.length > 16384) return stop();
      const end = buffer.indexOf(10);
      if (end >= 0) {
        if (!pending || end !== buffer.length - 1) return stop();
        try {
          const value = schema.parse(JSON.parse(buffer.subarray(0, end).toString('utf8')));
          if (value.id !== pending.id) return stop();
          const current = pending; pending = undefined; clearTimeout(current.timer); buffer = Buffer.alloc(0); current.resolve(Object.freeze(value.result));
        } catch { return stop(); }
      }
      readNext();
    });
  };
  readNext();
  const check = () => new Promise((resolve, reject) => {
    if (!active || pending) { stop(); return reject(new Error('DESTINATION_OWNER_UNAVAILABLE')); }
    const id = ++sequence, bytes = Buffer.from(`${JSON.stringify({ id, method: 'check' })}\n`);
    pending = { id, resolve, reject, timer: setTimeout(stop, timeoutMs) };
    let offset = 0;
    const send = () => write(fd, bytes, offset, bytes.length - offset, null, (error, count) => {
      if (error || !count) return stop(); offset += count; if (offset < bytes.length) send();
    });
    send();
  });
  const onClose = listener => { if (typeof listener !== 'function') throw new Error('DESTINATION_OWNER_UNAVAILABLE');
    if (!active) listener(); else listeners.add(listener); return () => listeners.delete(listener); };
  return Object.freeze({ check, onClose, close: stop });
}
