import { createConnection } from 'node:net';
import { lstatSync, unlinkSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { validateCredential } from './config.js';
import { codexVerifierLease, releaseCodexVerifierLease } from './codex-verifier-lease.js';
import { localVerifierTransport } from './codex-cancellation-verifier-transport.js';

const unavailable = () => new Error('CODEX_EFFECT_VERIFIER_UNAVAILABLE');
const secretHex = z.string().regex(/^[a-f0-9]{64}$/);
const LIMIT = 65536;
const signature = (secret, nonce, label, value) => createHmac('sha256', Buffer.from(secret, 'hex')).update('turnlink-codex-effect-v1\0').update(nonce).update('\0').update(label).update('\0').update(JSON.stringify(value)).digest('hex');
const equal = (left, right) => typeof left === 'string' && /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
const envelope = z.strictObject({ payload: z.unknown(), mac: secretHex });
const challenge = z.strictObject({ nonce: secretHex });
const request = z.strictObject({ phase: z.enum(['begin', 'finish']), fence: z.unknown(), ownerProof: secretHex });
const proofSchema = z.strictObject({ phase: z.enum(['begin', 'finish']), effectID: z.string().uuid(), status: z.enum(['armed', 'completed']), grantDigest: secretHex, receiverHash: secretHex });

function reader(socket) {
  let buffer = Buffer.alloc(0), waiting, ended = false;
  const fail = () => { ended = true; if (waiting) { const reject = waiting.reject; waiting = undefined; reject(unavailable()); } };
  socket.on('error', fail); socket.on('close', fail);
  socket.on('data', data => {
    if (ended || buffer.length + data.length > LIMIT) { socket.destroy(); return; }
    buffer = Buffer.concat([buffer, data]);
    const at = buffer.indexOf(10);
    if (at < 0) return;
    if (!waiting || at !== buffer.length - 1) { socket.destroy(); return; }
    let value;
    try { value = JSON.parse(buffer.subarray(0, at).toString('utf8')); } catch { socket.destroy(); return; }
    buffer = Buffer.alloc(0); const resolve = waiting.resolve; waiting = undefined; resolve(value);
  });
  return () => new Promise((resolve, reject) => { if (ended || waiting || buffer.length) reject(unavailable()); else waiting = { resolve, reject }; });
}
function send(socket, value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (socket.destroyed || bytes.length > LIMIT) throw unavailable();
  socket.write(bytes);
}
function signed(secret, nonce, label, payload) { return { payload, mac: signature(secret, nonce, label, payload) }; }
function verify(secret, nonce, label, frame) {
  const parsed = envelope.parse(frame);
  if (!equal(parsed.mac, signature(secret, nonce, label, parsed.payload))) throw unavailable();
  return parsed.payload;
}

// One supervisor is bound to one exact effect. It never accepts a claimed
// result from the requester; both phases are authenticated over a fresh nonce.
export async function createCodexEffectVerifierServer({ path, secret, supervisor }) {
  path = localVerifierTransport.socketPath(path); secret = validateCredential(secret);
  if (typeof supervisor?.verify !== 'function') throw unavailable();
  const sockets = new Set(); let closed = false, fault = false, busy = false;
  const listener = await localVerifierTransport.listenWithoutPathCleanup(path, socket => {
    if (closed || fault || busy) return socket.destroy();
    busy = true; sockets.add(socket); socket.setTimeout(8000, () => socket.destroy());
    const controller = new AbortController(), read = reader(socket); let proof;
    socket.once('close', () => { controller.abort(); releaseCodexVerifierLease(proof); sockets.delete(socket); busy = false; });
    void (async () => {
      const nonce = randomBytes(32).toString('hex'); send(socket, { nonce });
      const incoming = request.parse(verify(secret, nonce, 'request', await read()));
      proof = await supervisor.verify({ ...incoming, signal: controller.signal });
      const lease = proof?.[codexVerifierLease];
      if (!lease?.check?.()) throw unavailable();
      send(socket, signed(secret, nonce, 'proof', proofSchema.parse(proof)));
      if (incoming.phase === 'begin') {
        const command = z.strictObject({ action: z.literal('commit'), effectID: z.string().uuid() }).parse(verify(secret, nonce, 'commit', await read()));
        if (command.effectID !== proof.effectID || typeof lease.commit !== 'function' || lease.check() !== true) throw unavailable();
        lease.commit(); send(socket, signed(secret, nonce, 'committed', { effectID: proof.effectID }));
      }
    })().catch(() => socket.destroy());
  }, () => { fault = true; for (const socket of sockets) socket.destroy(); });
  return Object.freeze({ async close() { if (closed) return; closed = true; for (const socket of sockets) socket.destroy();
    await new Promise(resolve => listener.server.close(resolve));
    try { const current = lstatSync(path); if (current.dev === listener.identity.dev && current.ino === listener.identity.ino) unlinkSync(path); } catch { /* preserve replacements */ }
  } });
}

// The broker receives only an authenticated proof and a retained socket lease.
// Disconnect before completion never clears the broker's durable effect fence.
export function makeRemoteCodexEffectVerifier({ path, secret }) {
  path = localVerifierTransport.socketPath(path); secret = validateCredential(secret);
  return async ({ phase, fence, ownerProof, signal }) => {
    if (!signal || signal.aborted) throw unavailable();
    const before = localVerifierTransport.inspectSocket(path), socket = createConnection(path), read = reader(socket);
    let closed = false, released = false;
    const abort = () => socket.destroy(); signal.addEventListener('abort', abort, { once: true });
    socket.setTimeout(8000, abort);
    socket.once('close', () => { closed = true; signal.removeEventListener('abort', abort); });
    try {
      const { nonce } = challenge.parse(await read());
      const after = localVerifierTransport.inspectSocket(path);
      if (after.dev !== before.dev || after.ino !== before.ino || signal.aborted) throw unavailable();
      const payload = request.parse({ phase, fence, ownerProof }); send(socket, signed(secret, nonce, 'request', payload));
      const result = proofSchema.parse(verify(secret, nonce, 'proof', await read()));
      const lease = {
        check() { return !released && !closed && !socket.destroyed && !signal.aborted; },
        release() { if (released) return; released = true; socket.end(); },
      };
      if (phase === 'begin') lease.commit = async () => {
        if (!lease.check()) throw unavailable();
        send(socket, signed(secret, nonce, 'commit', { action: 'commit', effectID: result.effectID }));
        const accepted = z.strictObject({ effectID: z.string().uuid() }).parse(verify(secret, nonce, 'committed', await read()));
        if (accepted.effectID !== result.effectID || !lease.check()) throw unavailable();
      };
      Object.defineProperty(result, codexVerifierLease, { value: lease }); return result;
    } catch (error) { socket.destroy(); throw Object.assign(unavailable(), { cause: error }); }
  };
}
