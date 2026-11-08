import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.string().regex(/^[A-Za-z0-9:._/-]{1,256}$/);
const challengeSchema = z.strictObject({ version: z.literal(1), type: z.literal('challenge'), scope: scopeSchema, challenge: hex });
const readySchema = z.strictObject({ version: z.literal(1), type: z.literal('ready'), scope: scopeSchema, tag: hex });
const unavailable = () => new Error('VM_DAEMON_HANDSHAKE_UNAVAILABLE');
const mac = (secret, domain, scope, challenge, nonce) => createHmac('sha256', secret)
  .update(`${domain}\0${scope}\0${challenge}\0${nonce}`).digest('hex');

export function openCodeVMDaemonScope({ grantScope, image, name, sessionID, directory }) {
  if (!hex.safeParse(grantScope).success || !/^sha256:[a-f0-9]{64}$/.test(image || '') ||
      !/^turnlink-plugin-test-[0-9a-f-]{36}$/.test(name || '') || !/^ses_[A-Za-z0-9_-]{1,1000}$/.test(sessionID || '') ||
      typeof directory !== 'string' || !directory.startsWith('/') || directory.includes('\0')) throw unavailable();
  return createHash('sha256').update(`turnlink-vm-docker-scope-v1\0${grantScope}\0${image}\0${name}\0${sessionID}\0${directory}`).digest('hex');
}

async function readLine(stream, signal, deadline) {
  const bytes = [];
  while (true) {
    if (signal?.aborted || stream.destroyed || stream.readableEnded || Date.now() >= deadline) throw unavailable();
    const byte = stream.read(1);
    if (byte !== null) {
      if (!Buffer.isBuffer(byte)) throw unavailable();
      if (byte[0] === 10) return Buffer.from(bytes).toString('utf8');
      if (bytes.length >= 511) throw unavailable();
      bytes.push(byte[0]); continue;
    }
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); stream.off('readable', ready); stream.off('error', fail); stream.off('end', fail); stream.off('close', fail); signal?.removeEventListener('abort', fail); };
      const ready = () => { cleanup(); resolve(); }, fail = () => { cleanup(); reject(unavailable()); };
      const timer = setTimeout(fail, Math.max(1, deadline - Date.now()));
      stream.once('readable', ready); stream.once('error', fail); stream.once('end', fail); stream.once('close', fail); signal?.addEventListener('abort', fail, { once: true });
      if (signal?.aborted || stream.destroyed) fail();
    });
  }
}

// The caller obtains the stream, expected scope and secret from its retained
// supervisor capability, never from a guest or an ordinary plugin request.
// The returned stream is authenticated but does not attest VM custody.
async function authenticate({ stream, secret, scope, signal, timeoutMs = 10000, domain, readyDomain }) {
  if (!stream?.read || !stream?.write || !stream?.destroy || !Buffer.isBuffer(secret) || secret.length !== 32 ||
      !scopeSchema.safeParse(scope).success || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000 || signal?.aborted)
    { stream?.destroy?.(); throw unavailable(); }
  const deadline = Date.now() + timeoutMs;
  try {
    const challenge = challengeSchema.parse(JSON.parse(await readLine(stream, signal, deadline)));
    if (challenge.scope !== scope) throw unavailable();
    const nonce = randomBytes(32).toString('hex');
    const frame = { version: 1, type: 'authenticate', scope, nonce,
      tag: mac(secret, domain, scope, challenge.challenge, nonce) };
    const encoded = JSON.stringify(frame) + '\n';
    if (Buffer.byteLength(encoded) > 512) throw unavailable();
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); stream.off('error', fail); stream.off('close', fail); signal?.removeEventListener('abort', fail); };
      const fail = () => { cleanup(); reject(unavailable()); }, timer = setTimeout(fail, Math.max(1, deadline - Date.now()));
      stream.once('error', fail); stream.once('close', fail); signal?.addEventListener('abort', fail, { once: true });
      stream.write(encoded, error => { if (error) return fail(); cleanup(); resolve(); });
      if (signal?.aborted || stream.destroyed) fail();
    });
    const ready = readySchema.parse(JSON.parse(await readLine(stream, signal, deadline)));
    const expected = Buffer.from(mac(secret, readyDomain, scope, challenge.challenge, nonce), 'hex');
    if (ready.scope !== scope || !timingSafeEqual(expected, Buffer.from(ready.tag, 'hex')) || signal?.aborted || stream.destroyed) throw unavailable();
    if (signal) {
      const revoke = () => stream.destroy();
      signal.addEventListener('abort', revoke, { once: true });
      stream.once('close', () => signal.removeEventListener('abort', revoke));
      if (signal.aborted) { revoke(); throw unavailable(); }
    }
    return stream;
  } catch { stream.destroy(); throw unavailable(); }
}

export const authenticateOpenCodeVMDaemonStream = options => authenticate({ ...options,
  domain: 'turnlink-vm-docker-v1', readyDomain: 'turnlink-vm-docker-ready-v1' });

// The caller retains the supervisor's VM and control descriptor. Control loss
// or unexpected bytes revoke every authenticated API stream immediately.
export async function createOpenCodeVMDaemonLease({ controlStream, connectAPI, secret, scope, signal }) {
  if (typeof connectAPI !== 'function' || !/^[a-f0-9]{64}$/.test(scope || '') || signal?.aborted) {
    controlStream?.destroy?.(); throw unavailable();
  }
  const controller = new AbortController(), streams = new Set(); let active = false, connecting = 0;
  const close = () => { if (controller.signal.aborted) return; active = false; controller.abort(); signal?.removeEventListener('abort', close);
    for (const stream of streams) stream.destroy(); streams.clear(); controlStream.destroy(); };
  signal?.addEventListener('abort', close, { once: true });
  try {
    await authenticate({ stream: controlStream, secret, scope, signal: controller.signal,
      domain: 'turnlink-vm-docker-lease-v1', readyDomain: 'turnlink-vm-docker-lease-ready-v1' });
    if (signal?.aborted || controller.signal.aborted || controlStream.destroyed) throw unavailable();
    active = true;
    controlStream.on('readable', close); controlStream.once('end', close); controlStream.once('close', close); controlStream.once('error', close);
    if (controlStream.readableLength || controlStream.readableEnded || signal?.aborted) { close(); throw unavailable(); }
    const openStream = async () => {
      if (!active || controller.signal.aborted || streams.size + connecting >= 64) throw unavailable();
      connecting++;
      let stream, reserved = true;
      try {
        stream = await new Promise((resolve, reject) => {
          let done = false;
          const aborted = () => { if (!done) { done = true; reject(unavailable()); } };
          controller.signal.addEventListener('abort', aborted, { once: true });
          Promise.resolve().then(() => {
            if (controller.signal.aborted) throw unavailable();
            return connectAPI(controller.signal);
          }).then(value => {
            controller.signal.removeEventListener('abort', aborted);
            if (done || controller.signal.aborted) { value?.destroy?.(); if (!done) reject(unavailable()); return; }
            done = true; resolve(value);
          }, () => { controller.signal.removeEventListener('abort', aborted); if (!done) { done = true; reject(unavailable()); } });
          if (controller.signal.aborted) aborted();
        });
        if (!active || controller.signal.aborted) { stream?.destroy?.(); throw unavailable(); }
        connecting--; reserved = false;
        streams.add(stream); stream.once('close', () => streams.delete(stream));
        await authenticateOpenCodeVMDaemonStream({ stream, secret, scope, signal: controller.signal });
        if (!active || controller.signal.aborted) throw unavailable();
        return stream;
      } catch { stream?.destroy?.(); throw unavailable(); }
      finally { if (reserved) connecting--; }
    };
    return Object.freeze({ openStream, close, check: () => active && !controller.signal.aborted && !controlStream.destroyed });
  } catch { close(); throw unavailable(); }
}
