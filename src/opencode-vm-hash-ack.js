import { request } from 'node:http';
import { z } from 'zod';

// Explicit fixture protocol: called only after the fixed hash command returned
// and both hashes matched. A lost acknowledgement fails the held lease.
export async function acknowledgeOpenCodeVMHashProbe({ endpoint, signal }) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('VM_HASH_ACK_UNAVAILABLE'); }
  if (url.protocol !== 'unix:' || url.hostname || !url.pathname.startsWith('/') || signal?.aborted) throw new Error('VM_HASH_ACK_UNAVAILABLE');
  const socketPath = decodeURIComponent(url.pathname);
  const call = (method, path, body) => new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({ socketPath, method, path, signal, timeout: 10000,
      headers: data ? { 'content-type': 'application/json', 'content-length': String(data.length) } : {} }, response => {
      response.on('data', chunk => { size += chunk.length; if (size > 1024) req.destroy(); else chunks.push(chunk); });
      response.once('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      response.once('error', () => reject(new Error('VM_HASH_ACK_UNAVAILABLE')));
    });
    req.once('timeout', () => req.destroy()); req.once('error', () => reject(new Error('VM_HASH_ACK_UNAVAILABLE')));
    req.end(data);
  });
  try {
    const ticket = await call('GET', '/turnlink-fixture/exec-ticket');
    if (ticket.status !== 200) throw new Error('Unavailable');
    const { id } = z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/) }).parse(JSON.parse(ticket.body));
    const acknowledged = await call('POST', '/turnlink-fixture/exec-ack', { id });
    if (acknowledged.status !== 204 || acknowledged.body) throw new Error('Unavailable');
  } catch { throw new Error('VM_HASH_ACK_UNAVAILABLE'); }
}
