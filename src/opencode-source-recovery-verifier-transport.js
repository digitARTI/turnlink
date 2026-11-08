import { createConnection } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { z } from 'zod';
import { validateCredential } from './config.js';
import { HostID } from './protocol.js';
import { UUID, WorktreeTransition } from './control/contracts.js';
import { NativeSourceRecoveryProof, makeOpenCodeSourceRecoveryVerifier } from './opencode-source-recovery-verifier.js';
import { localVerifierTransport as transport } from './codex-cancellation-verifier-transport.js';
import { codexVerifierLease } from './codex-verifier-lease.js';

const unavailable = () => new Error('NATIVE_SOURCE_RECOVERY_VERIFICATION_UNAVAILABLE');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.strictObject({ version: z.literal(1), id: UUID, hostId: HostID, grant: WorktreeTransition, receiverHash: hash });
const envelope = z.strictObject({ payload: z.unknown(), mac: hash });
const answer = z.strictObject({ id: UUID, proof: NativeSourceRecoveryProof });
const challenge = z.strictObject({ challenge: hash });
const DEADLINE = 3500;

// Registrations are installed by the owner of the native recovery capability,
// never by a broker or adapter request. The connection remains open until the
// broker has finished its synchronous acknowledgement or the registration is revoked.
export async function createOpenCodeSourceRecoveryVerifierServer({ path, secret }) {
  path = transport.socketPath(path); secret = validateCredential(secret);
  const registrations = new Map(), sockets = new Set(), busy = new Set();
  let closed = false, fault = false, closing;
  const connected = socket => {
    if (closed || fault || sockets.size >= 32) return socket.destroy();
    sockets.add(socket);
    const abort = new AbortController(), nonce = randomBytes(32).toString('hex');
    let current, pending = false, gone = false;
    const free = () => {
      if (current && gone && !pending) {
        current.sockets.delete(socket); busy.delete(current.grantId); current = undefined;
      }
    };
    socket.setTimeout(DEADLINE, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { abort.abort(); sockets.delete(socket); gone = true; free(); });
    transport.lines(socket, raw => {
      void (async () => {
        const frame = envelope.parse(raw);
        if (!transport.equal(frame.mac, transport.mac(secret, 'opencode-source-recovery-request', nonce, frame.payload))) throw unavailable();
        const input = request.parse(frame.payload), candidate = registrations.get(input.grant.id);
        if (!candidate || busy.has(input.grant.id) || candidate.hostId !== input.hostId || candidate.agentId !== input.grant.agentId) throw unavailable();
        current = candidate; busy.add(candidate.grantId); candidate.sockets.add(socket); pending = true;
        let proof;
        try { proof = await candidate.verify({ grant: input.grant, hostId: input.hostId, receiverHash: input.receiverHash, signal: abort.signal }); }
        finally { pending = false; free(); }
        if (abort.signal.aborted || registrations.get(input.grant.id) !== current) throw unavailable();
        const output = { id: input.id, proof: NativeSourceRecoveryProof.parse(proof) };
        transport.write(socket, { payload: output, mac: transport.mac(secret, 'opencode-source-recovery-response', nonce, output) });
      })().catch(() => socket.destroy());
    });
    try { transport.write(socket, { challenge: nonce }); } catch { socket.destroy(); }
  };
  const { server, identity } = await transport.listenWithoutPathCleanup(path, connected, () => {
    fault = true; for (const socket of sockets) socket.destroy();
  });
  return {
    register({ client, recovery, native, mode, grant: value, signal }) {
      if (closed || fault || !signal || signal.aborted || typeof signal.addEventListener !== 'function' ||
          typeof client?.on !== 'function' || typeof client?.off !== 'function' || typeof native?.onClose !== 'function') throw unavailable();
      const grant = WorktreeTransition.parse(value), hostId = HostID.parse(client.hostId);
      if (!grant.agentId.startsWith('opencode:') || !['prepared', 'uncertain'].includes(grant.status) || grant.purpose || registrations.has(grant.id) || busy.has(grant.id)) throw unavailable();
      const entry = { grantId: grant.id, agentId: grant.agentId, hostId, sockets: new Set(), verify: makeOpenCodeSourceRecoveryVerifier({ recovery, client, mode }) };
      registrations.set(grant.id, entry);
      let removed = false;
      const unregister = () => {
        if (removed) return;
        removed = true;
        if (registrations.get(grant.id) === entry) registrations.delete(grant.id);
        signal.removeEventListener('abort', unregister); client.off('disconnected', unregister); client.off('membership_removed', membershipRemoved); entry.stopNative?.();
        for (const socket of entry.sockets) socket.destroy();
      };
      const membershipRemoved = event => { if (event?.agentId === grant.agentId) unregister(); };
      entry.unregister = unregister;
      signal.addEventListener('abort', unregister, { once: true }); client.on('disconnected', unregister); client.on('membership_removed', membershipRemoved);
      try { entry.stopNative = native.onClose(unregister); }
      catch { unregister(); throw unavailable(); }
      if (typeof entry.stopNative !== 'function') { unregister(); throw unavailable(); }
      if (removed) entry.stopNative?.();
      if (signal.aborted || removed) { unregister(); throw unavailable(); }
      return unregister;
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const entry of registrations.values()) entry.unregister();
      registrations.clear(); for (const socket of sockets) socket.destroy();
      closing = new Promise(resolve => server.close(resolve)).then(() => {
        try { const stat = transport.inspectSocket(path); if (stat.dev === identity.dev && stat.ino === identity.ino) unlinkSync(path); }
        catch { /* Do not remove an unexpected replacement. */ }
      });
      return closing;
    },
  };
}

// Broker-side verifier. A live authenticated socket is held until the broker
// settles or refuses the source acknowledgement; adapter requests cannot set the path.
export function makeRemoteOpenCodeSourceRecoveryVerifier({ path, secret }) {
  path = transport.socketPath(path); secret = validateCredential(secret);
  const verify = ({ grant, hostId, receiverHash, signal }) => new Promise((resolve, reject) => {
    let socket, done = false, released = false, before;
    const release = () => { if (released) return; released = true; signal?.removeEventListener('abort', abort); socket?.destroy(); };
    const finish = (error, value) => {
      if (done) { if (error) release(); return; }
      done = true; if (error) { release(); reject(unavailable()); } else resolve(value);
    };
    const abort = () => finish(unavailable());
    try {
      if (!signal || signal.aborted) throw unavailable();
      before = transport.inspectSocket(path);
      const input = request.parse({ version: 1, id: randomUUID(), hostId, grant, receiverHash });
      socket = createConnection(path);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      socket.setTimeout(DEADLINE, abort); socket.on('error', abort);
      socket.on('close', () => { if (!done) abort(); else release(); });
      socket.on('connect', () => {
        try { const after = transport.inspectSocket(path); if (before.dev !== after.dev || before.ino !== after.ino) throw unavailable(); }
        catch { abort(); }
      });
      transport.lines(socket, raw => {
        const nonce = challenge.parse(raw).challenge;
        transport.write(socket, { payload: input, mac: transport.mac(secret, 'opencode-source-recovery-request', nonce, input) });
        socket.removeAllListeners('data');
        transport.lines(socket, rawAnswer => {
          const frame = envelope.parse(rawAnswer);
          if (!transport.equal(frame.mac, transport.mac(secret, 'opencode-source-recovery-response', nonce, frame.payload))) throw unavailable();
          const result = answer.parse(frame.payload);
          if (result.id !== input.id) throw unavailable();
          Object.defineProperty(result.proof, codexVerifierLease, { value: {
            check() {
              if (released || signal.aborted || socket.destroyed) throw unavailable();
              const current = transport.inspectSocket(path);
              if (before.dev !== current.dev || before.ino !== current.ino) throw unavailable();
              return true;
            }, release,
          } });
          finish(null, result.proof);
        });
      });
    } catch { finish(unavailable()); }
  });
  Object.defineProperty(verify, 'requiresLease', { value: true });
  return verify;
}
