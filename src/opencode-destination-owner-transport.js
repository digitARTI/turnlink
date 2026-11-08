import { z } from 'zod';

// Supervisor-owned inherited descriptor, dedicated to observation. A guest or
// request cannot nominate a process, socket, digest, or destination lease.
export function serveOpenCodeDestinationOwnerTransport({ stream, supervisor }) {
  if (!stream?.write || !stream?.destroy || !supervisor?.check || !supervisor?.onClose || !supervisor?.close)
    throw new Error('DESTINATION_OWNER_TRANSPORT_UNAVAILABLE');
  const requestSchema = z.strictObject({ id: z.number().int().positive().safe(), method: z.literal('check') });
  let closed = false, pending = false, buffer = Buffer.alloc(0), lastID = 0, remove;
  const close = () => { if (closed) return; closed = true; remove?.(); stream.destroy(); supervisor.close(); };
  remove = supervisor.onClose(close);
  stream.on('data', chunk => {
    if (closed) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > 16384) return close();
    const end = buffer.indexOf(10); if (end < 0) return;
    if (pending || end !== buffer.length - 1) return close();
    let request;
    try { request = requestSchema.parse(JSON.parse(buffer.subarray(0, end).toString('utf8'))); buffer = Buffer.alloc(0);
      if (request.id <= lastID) throw new Error('Invalid'); lastID = request.id; }
    catch { close(); return; }
    pending = true;
    void Promise.resolve().then(() => supervisor.check()).then(result => {
      if (!closed) stream.write(`${JSON.stringify({ id: request.id, result })}\n`, error => { if (error) close(); });
    }, close).finally(() => { pending = false; });
  });
  stream.on('end', close); stream.on('close', close); stream.on('error', close);
  return Object.freeze({ close });
}
