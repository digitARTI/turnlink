import { createConnection } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { validateCredential } from './config.js';
import { HostID } from './protocol.js';
import { UUID, WorktreeTransition } from './control/contracts.js';
import { completionSchema } from './opencode-native-recovery.js';
import { makeOpenCodeCompletionVerifier } from './opencode-completed-recovery.js';
import { localVerifierTransport as transport } from './codex-cancellation-verifier-transport.js';
import { codexVerifierLease } from './codex-verifier-lease.js';
import { privateDirectory } from './storage.js';

const unavailable = () => new Error('NATIVE_COMPLETION_VERIFICATION_UNAVAILABLE');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.strictObject({ version: z.literal(1), id: UUID, hostId: HostID, grant: WorktreeTransition, receiverHash: hash, retainOwner: z.boolean().optional() });
const envelope = z.strictObject({ payload: z.unknown(), mac: hash });
const answer = z.strictObject({ id: UUID, proof: completionSchema, ownerGeneration: UUID.optional() });
const challenge = z.strictObject({ challenge: hash });
const heartbeat = z.strictObject({ sequence: z.number().int().positive().safe(), challenge: hash, confirm: hash.optional() });
const endpointReference = z.strictObject({ name: z.string().regex(/^turnlink-[0-9a-f-]{36}\.json$/), device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/), digest: hash });
const heartbeatAnswer = heartbeat.extend({ ready: z.boolean(), endpoint: endpointReference.optional(), confirmed: z.boolean().optional() });
const DEADLINE = 3500;
function heartbeatLines(socket, accept) {
  let buffer = Buffer.alloc(0);
  socket.on('data', data => {
    try {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 4096) throw unavailable();
      let end;
      while ((end = buffer.indexOf(10)) !== -1) {
        const value = JSON.parse(buffer.subarray(0, end).toString('utf8'));
        buffer = buffer.subarray(end + 1); accept(value);
      }
    } catch { socket.destroy(); }
  });
}
async function checkedValue(health) {
  let deadline;
  try {
    return await Promise.race([Promise.resolve().then(health), new Promise(resolve => { deadline = setTimeout(() => resolve(false), 3000); })]);
  } finally { clearTimeout(deadline); }
}
async function checkHealth(health) { return await checkedValue(health) === true; }

// Registrations are installed by the owner of the native recovery capability,
// never by a broker or adapter request. The connection remains open until the
// broker has finished its synchronous release or the registration is revoked.
export async function createOpenCodeCompletionVerifierServer({ path, secret }) {
  path = transport.socketPath(path); secret = validateCredential(secret);
  const registrations = new Map(), sockets = new Set(), busy = new Set();
  let closed = false, fault = false, closing;
  const connected = socket => {
    if (closed || fault || sockets.size >= 32) return socket.destroy();
    sockets.add(socket);
    const abort = new AbortController(), nonce = randomBytes(32).toString('hex');
    let current, pending = false, gone = false, sequence = 0, retained = false;
    const free = () => {
      if (current && gone && !pending) {
        current.sockets.delete(socket); busy.delete(current.grantId); current = undefined;
      }
    };
    socket.setTimeout(DEADLINE, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { abort.abort(); sockets.delete(socket); gone = true;
      if (retained) try { current?.onRetainedLeaseClose?.(); } catch { /* Closing remains fail-closed. */ }
      free(); });
    transport.lines(socket, raw => {
      void (async () => {
        const frame = envelope.parse(raw);
        if (!transport.equal(frame.mac, transport.mac(secret, 'opencode-completion-request', nonce, frame.payload))) throw unavailable();
        const input = request.parse(frame.payload), candidate = registrations.get(input.grant.id);
        if (!candidate || busy.has(input.grant.id) || candidate.hostId !== input.hostId || candidate.agentId !== input.grant.agentId) throw unavailable();
        if (input.retainOwner && typeof candidate.health !== 'function') throw unavailable();
        current = candidate; busy.add(candidate.grantId); candidate.sockets.add(socket); pending = true;
        let proof;
        try { proof = await candidate.verify({ grant: input.grant, hostId: input.hostId, receiverHash: input.receiverHash, signal: abort.signal }); }
        finally { pending = false; free(); }
        if (input.retainOwner && !await checkHealth(candidate.health)) throw unavailable();
        if (abort.signal.aborted || registrations.get(input.grant.id) !== current) throw unavailable();
        const output = { id: input.id, proof: completionSchema.parse(proof), ...(input.retainOwner ? { ownerGeneration: current.ownerGeneration } : {}) };
        retained = input.retainOwner === true;
        transport.write(socket, { payload: output, mac: transport.mac(secret, 'opencode-completion-response', nonce, output) });
        if (input.retainOwner) {
          socket.setTimeout(0); socket.removeAllListeners('data');
          heartbeatLines(socket, rawPing => {
            void (async () => {
              const pingFrame = envelope.parse(rawPing), ping = heartbeat.parse(pingFrame.payload);
              if (pending || ping.sequence !== sequence + 1 || !transport.equal(pingFrame.mac, transport.mac(secret, 'opencode-completion-ping', nonce, ping))) throw unavailable();
              pending = true;
              try { if (!await checkHealth(candidate.health) || abort.signal.aborted || registrations.get(input.grant.id) !== current) throw unavailable(); }
              finally { pending = false; free(); }
              const readiness = typeof candidate.readiness === 'function' ? await checkedValue(() => candidate.readiness(ping.challenge)) : false;
              const endpoint = readiness && typeof readiness === 'object' ? endpointReference.parse(readiness) : undefined;
              const ready = readiness === true || !!endpoint;
              if (abort.signal.aborted || registrations.get(input.grant.id) !== current) throw unavailable();
              sequence = ping.sequence;
              const confirmed = ping.confirm !== undefined && candidate.pendingRetry === ping.confirm;
              if (confirmed) candidate.pendingRetry = undefined;
              const reply = { ...ping, ready, ...(endpoint ? { endpoint } : {}), ...(ping.confirm !== undefined ? { confirmed } : {}) };
              transport.write(socket, { payload: reply, mac: transport.mac(secret, 'opencode-completion-pong', nonce, reply) });
            })().catch(() => socket.destroy());
          });
        }
      })().catch(() => socket.destroy());
    });
    try { transport.write(socket, { challenge: nonce }); } catch { socket.destroy(); }
  };
  const { server, identity } = await transport.listenWithoutPathCleanup(path, connected, () => {
    fault = true; for (const socket of sockets) socket.destroy();
  });
  return {
    register({ client, recovery, grant: value, signal, health, readiness, onRetainedLeaseClose, historical = false, ownerGeneration = randomUUID() }) {
      if (closed || fault || !signal || signal.aborted || typeof signal.addEventListener !== 'function' ||
          typeof client?.on !== 'function' || typeof client?.off !== 'function' || typeof recovery?.onClose !== 'function') throw unavailable();
      const grant = WorktreeTransition.parse(value), hostId = HostID.parse(client.hostId);
      if (!grant.agentId.startsWith('opencode:') || grant.status !== 'moved' || grant.purpose || registrations.has(grant.id) || busy.has(grant.id)) throw unavailable();
      if ((health !== undefined && typeof health !== 'function') || (readiness !== undefined && typeof readiness !== 'function') ||
          (onRetainedLeaseClose !== undefined && typeof onRetainedLeaseClose !== 'function')) throw unavailable();
      if (typeof historical !== 'boolean') throw unavailable();
      ownerGeneration = UUID.parse(ownerGeneration);
      const entry = { grantId: grant.id, agentId: grant.agentId, hostId, ownerGeneration, health, readiness, onRetainedLeaseClose, sockets: new Set(),
        verify: makeOpenCodeCompletionVerifier({ recovery, client, historical }) };
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
      try { entry.stopNative = recovery.onClose(unregister); }
      catch { unregister(); throw unavailable(); }
      if (typeof entry.stopNative !== 'function') { unregister(); throw unavailable(); }
      if (removed) entry.stopNative?.();
      if (signal.aborted || removed) { unregister(); throw unavailable(); }
      Object.defineProperty(unregister, 'ownerGeneration', { value: entry.ownerGeneration });
      Object.defineProperty(unregister, 'authorizeRetry', { value: nonce => { entry.pendingRetry = hash.parse(nonce); } });
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
// settles or refuses the receiver release; adapter requests cannot set the path.
export function makeRemoteOpenCodeCompletionVerifier({ path, secret }) {
  path = transport.socketPath(path); secret = validateCredential(secret);
  const verify = ({ grant, hostId, receiverHash, signal, retainOwner = false }) => new Promise((resolve, reject) => {
    let socket, done = false, released = false, before, timer, lastPong, sequence = 0, acknowledged = 0, challengeValue, ready = false, endpoint, confirmation;
    const release = () => { if (released) return; released = true; clearInterval(timer); confirmation?.finish(false); signal?.removeEventListener('abort', abort); socket?.destroy(); };
    const finish = (error, value) => {
      if (done) { if (error) release(); return; }
      done = true; if (error) { release(); reject(unavailable()); } else resolve(value);
    };
    const abort = () => finish(unavailable());
    try {
      if (!signal || signal.aborted) throw unavailable();
      before = transport.inspectSocket(path);
      const input = request.parse({ version: 1, id: randomUUID(), hostId, grant, receiverHash, ...(retainOwner ? { retainOwner: true } : {}) });
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
        transport.write(socket, { payload: input, mac: transport.mac(secret, 'opencode-completion-request', nonce, input) });
        socket.removeAllListeners('data');
        transport.lines(socket, rawAnswer => {
          const frame = envelope.parse(rawAnswer);
          if (!transport.equal(frame.mac, transport.mac(secret, 'opencode-completion-response', nonce, frame.payload))) throw unavailable();
          const result = answer.parse(frame.payload);
          if (result.id !== input.id || (retainOwner && !result.ownerGeneration)) throw unavailable();
          if (retainOwner) {
            socket.setTimeout(0); lastPong = performance.now();
            socket.removeAllListeners('data');
            heartbeatLines(socket, rawPong => {
              const pongFrame = envelope.parse(rawPong), pong = heartbeatAnswer.parse(pongFrame.payload);
              if (pong.sequence !== acknowledged + 1 || pong.sequence > sequence || pong.challenge !== challengeValue ||
                  !transport.equal(pongFrame.mac, transport.mac(secret, 'opencode-completion-pong', nonce, pong))) throw unavailable();
              acknowledged = pong.sequence; ready = pong.ready; endpoint = pong.endpoint; lastPong = performance.now();
              if (pong.confirm !== undefined) {
                if (!confirmation || pong.confirm !== confirmation.nonce || typeof pong.confirmed !== 'boolean') throw unavailable();
                confirmation.finish(pong.confirmed);
              }
            });
            timer = setInterval(() => {
              if (released) return;
              if (performance.now() - lastPong > DEADLINE) { release(); return; }
              if (sequence !== acknowledged) return;
              try { const ping = { sequence: ++sequence, challenge: challengeValue = randomBytes(32).toString('hex'), ...(confirmation ? { confirm: confirmation.nonce } : {}) }; transport.write(socket, { payload: ping, mac: transport.mac(secret, 'opencode-completion-ping', nonce, ping) }); }
              catch { release(); }
            }, 1000);
            timer.unref();
          }
          Object.defineProperty(result.proof, codexVerifierLease, { value: {
            ...(retainOwner ? { ownerGeneration: result.ownerGeneration } : {}),
            ready() { this.check(); return retainOwner && ready; },
            endpoint() { this.check(); return retainOwner && ready && endpoint ? { ...endpoint } : undefined; },
            socketIdentity() { this.check(); return { dev: String(before.dev), ino: String(before.ino) }; },
            confirm(nonce) {
              this.check(); hash.parse(nonce);
              if (!retainOwner || confirmation) throw unavailable();
              return new Promise(resolve => {
                const deadline = setTimeout(() => confirmation?.finish(false), 3000);
                confirmation = { nonce, finish(value) { clearTimeout(deadline); confirmation = undefined; resolve(value); } };
              });
            },
            onClose(listener) {
              if (typeof listener !== 'function') throw unavailable();
              if (released || socket.destroyed) { queueMicrotask(listener); return () => {}; }
              socket.once('close', listener);
              return () => socket.off('close', listener);
            },
            check() {
              if (released || signal.aborted || socket.destroyed || (retainOwner && performance.now() - lastPong > DEADLINE)) { release(); throw unavailable(); }
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

// The broker fixes the private root and derives the socket name exclusively
// from the requested UUID. The socket handshake still authenticates the owner.
export function makeRemoteOpenCodeGenerationVerifier({ directory, secret }) {
  if (!isAbsolute(directory)) throw unavailable();
  privateDirectory(directory); secret = validateCredential(secret);
  const verify = input => {
    const generation = UUID.parse(input.ownerGeneration);
    privateDirectory(directory);
    return makeRemoteOpenCodeCompletionVerifier({ path: join(directory, `${generation}.sock`), secret })(input);
  };
  Object.defineProperty(verify, 'requiresLease', { value: true });
  return verify;
}
