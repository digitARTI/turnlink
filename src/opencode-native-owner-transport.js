import { z } from 'zod';

// An inherited duplex descriptor is dedicated to one native session. It
// carries only pre-grant observations and the held idle reservation.
// Movement effects remain unavailable over this transport.
export function serveOpenCodeNativeOwnerTransport({ stream, native, sessionID }) {
  if (!stream?.write || !stream?.destroy || !native?.onClose || !sessionID?.startsWith('ses_')) throw new Error('NATIVE_OWNER_TRANSPORT_UNAVAILABLE');
  const schema = z.strictObject({ id: z.number().int().positive().safe(), sessionID: z.literal(sessionID),
    method: z.enum(['observeIdle', 'holdIdle', 'checkIdle', 'observeHeldAuthority', 'releaseIdle']), holdID: z.string().uuid().optional() });
  let closed = false, pending = false, buffer = Buffer.alloc(0), lastID = 0;
  let removeNativeClose;
  const close = () => { if (closed) return; closed = true; removeNativeClose?.(); stream.destroy(); native.close(); };
  removeNativeClose = native.onClose(close);
  const onData = chunk => {
    if (closed) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > 16384) return close();
    const newline = buffer.indexOf(10); if (newline < 0) return;
    if (pending || newline !== buffer.length - 1) return close();
    let request;
    try {
      request = schema.parse(JSON.parse(buffer.subarray(0, newline).toString('utf8'))); buffer = Buffer.alloc(0);
      if (request.id <= lastID || (['checkIdle', 'observeHeldAuthority', 'releaseIdle'].includes(request.method) !== !!request.holdID)) throw new Error('Invalid');
      lastID = request.id;
    } catch { close(); return; }
    pending = true;
    void Promise.resolve().then(() => native[request.method](...(request.holdID ? [request.holdID] : []))).then(value => {
      if (!closed) stream.write(`${JSON.stringify({ id: request.id, result: value })}\n`, error => { if (error) close(); });
    }, () => close()).finally(() => { pending = false; });
  };
  stream.on('data', onData); stream.on('end', close); stream.on('close', close); stream.on('error', close);
  return Object.freeze({ close });
}
