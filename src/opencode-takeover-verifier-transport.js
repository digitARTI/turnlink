import { createConnection } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { z } from 'zod';
import { validateCredential } from './config.js';
import { OpenCodeContainment } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { localVerifierTransport as transport } from './codex-cancellation-verifier-transport.js';
import { codexVerifierLease } from './codex-verifier-lease.js';

const unavailable = () => new Error('NATIVE_TAKEOVER_VERIFICATION_UNAVAILABLE');
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid();
const request = z.strictObject({ version: z.literal(1), id: uuid, hostId: z.string(), grant: WorktreeTransition,
  previous: OpenCodeContainment, oldReceiverHash: hash, targetReceiverHash: hash });
const envelope = z.strictObject({ payload: z.unknown(), mac: hash });
const evidence = z.strictObject({ version: z.literal(1), hostId: z.string(), agentId: z.string(), channel: z.string(), transitionID: uuid,
  oldReceiverHash: hash, targetReceiverHash: hash, previous: OpenCodeContainment, successor: OpenCodeContainment,
  previousLease: uuid, currentLease: uuid });

// One already-claimed native recovery instance serves one authenticated broker
// connection. Destroying that instance or aborting its owner revokes the proof.
export async function createOpenCodeTakeoverVerifierServer({ path, secret, native, grant: value, hostId, successor, signal }) {
  path = transport.socketPath(path); secret = validateCredential(secret);
  const grant = WorktreeTransition.parse(value), target = OpenCodeContainment.parse(successor);
  if (!signal || signal.aborted || !native?.inspect || !native?.inspectRecovery || !native?.observeRecoveryTransport || !native?.onClose ||
      typeof hostId !== 'string' || !hostId || !grant.agentId.startsWith('opencode:') || grant.status !== 'prepared' || grant.purpose) throw unavailable();
  let closed = false, busy = false, listener; const sockets = new Set();
  const closeSockets = () => { closed = true; for (const socket of sockets) socket.destroy(); };
  const stopNative = native.onClose(closeSockets);
  if (typeof stopNative !== 'function') throw unavailable();
  signal.addEventListener('abort', closeSockets, { once: true });
  try {
    listener = await transport.listenWithoutPathCleanup(path, socket => {
      if (closed || signal.aborted || busy) return socket.destroy();
      busy = true; sockets.add(socket); const nonce = randomBytes(32).toString('hex'); let pending = false, gone = false;
      const free = () => { if (gone && !pending) { sockets.delete(socket); busy = false; } };
      socket.setTimeout(15000, () => socket.destroy()); socket.on('error', () => socket.destroy());
      socket.once('close', () => { gone = true; free(); });
      transport.lines(socket, raw => {
        void (async () => {
          pending = true;
          try {
          const frame = envelope.parse(raw);
          if (!transport.equal(frame.mac, transport.mac(secret, 'opencode-takeover-request', nonce, frame.payload))) throw unavailable();
          const input = request.parse(frame.payload);
          if (input.hostId !== hostId || JSON.stringify(input.grant) !== JSON.stringify(grant) || closed || socket.destroyed) throw unavailable();
          const before = await native.inspect(), inspected = await native.inspectRecovery(), released = await native.observeRecoveryTransport(), after = await native.inspect();
          if (closed || signal.aborted || socket.destroyed || JSON.stringify(before) !== JSON.stringify(after) ||
              before.sessionID !== grant.agentId.slice('opencode:'.length) || before.transitionID !== grant.id ||
              before.source.directory !== grant.from || before.directory !== grant.to || !released ||
              JSON.stringify(released.intent) !== JSON.stringify(before) || JSON.stringify(released.recovery) !== JSON.stringify(inspected.recovery) ||
              inspected.recovery.previousLeaseIncarnation !== before.leaseIncarnation ||
              inspected.recovery.leaseIncarnation === before.leaseIncarnation || released.release.family !== 'session-model-websocket') throw unavailable();
          const proof = evidence.parse({ version: 1, hostId, agentId: grant.agentId, channel: grant.channel, transitionID: grant.id,
            oldReceiverHash: input.oldReceiverHash, targetReceiverHash: input.targetReceiverHash, previous: input.previous,
            successor: target, previousLease: before.leaseIncarnation, currentLease: inspected.recovery.leaseIncarnation });
          const response = { id: input.id, proof };
          transport.write(socket, { payload: response, mac: transport.mac(secret, 'opencode-takeover-response', nonce, response) });
          } finally { pending = false; free(); }
        })().catch(() => socket.destroy());
      });
      try { transport.write(socket, { challenge: nonce }); } catch { socket.destroy(); }
    }, closeSockets);
    if (closed || signal.aborted) throw unavailable();
    return Object.freeze({ close: async () => {
      closeSockets(); signal.removeEventListener('abort', closeSockets); stopNative();
      await new Promise(resolve => listener.server.close(resolve));
      try { const current = transport.inspectSocket(path); if (current.dev === listener.identity.dev && current.ino === listener.identity.ino) unlinkSync(path); } catch {}
    } });
  } catch { closeSockets(); signal.removeEventListener('abort', closeSockets); stopNative(); if (listener) await new Promise(resolve => listener.server.close(resolve)); throw unavailable(); }
}

// The broker uses a host-provisioned path and secret. The socket stays open
// until the broker has committed or refused the receiver rotation.
export function makeRemoteOpenCodeTakeoverVerifier({ path, secret }) {
  path = transport.socketPath(path); secret = validateCredential(secret);
  const verify = input => new Promise((resolve, reject) => {
    let socket, done = false, released = false, identity;
    const release = () => { if (released) return; released = true; input.signal?.removeEventListener('abort', abort); socket?.destroy(); };
    const fail = () => { if (!done) { done = true; release(); reject(unavailable()); } else release(); };
    const abort = () => fail();
    try {
      if (!input.signal || input.signal.aborted) throw unavailable();
      identity = transport.inspectSocket(path);
      const payload = request.parse({ version: 1, id: randomUUID(), hostId: input.hostId, grant: input.grant, previous: input.previous,
        oldReceiverHash: input.oldReceiverHash, targetReceiverHash: input.targetReceiverHash });
      socket = createConnection(path); input.signal.addEventListener('abort', abort, { once: true });
      socket.setTimeout(15000, fail); socket.on('error', fail); socket.on('close', fail);
      socket.on('connect', () => { try { const current = transport.inspectSocket(path); if (current.dev !== identity.dev || current.ino !== identity.ino) fail(); } catch { fail(); } });
      transport.lines(socket, raw => {
        const nonce = z.strictObject({ challenge: hash }).parse(raw).challenge;
        transport.write(socket, { payload, mac: transport.mac(secret, 'opencode-takeover-request', nonce, payload) });
        socket.removeAllListeners('data');
        transport.lines(socket, response => {
          const frame = envelope.parse(response);
          if (!transport.equal(frame.mac, transport.mac(secret, 'opencode-takeover-response', nonce, frame.payload))) throw unavailable();
          const result = z.strictObject({ id: uuid, proof: evidence }).parse(frame.payload);
          if (result.id !== payload.id || released || input.signal.aborted) throw unavailable();
          Object.defineProperty(result.proof, codexVerifierLease, { value: { check() {
            if (released || input.signal.aborted || socket.destroyed) throw unavailable();
            const current = transport.inspectSocket(path); if (current.dev !== identity.dev || current.ino !== identity.ino) throw unavailable(); return true;
          }, release } });
          done = true; resolve(result.proof);
        });
      });
    } catch { fail(); }
  });
  Object.defineProperty(verify, 'requiresLease', { value: true }); return verify;
}
