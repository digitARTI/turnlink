import { createConnection, createServer } from 'node:net';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, linkSync, lstatSync, openSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { validateCredential } from './config.js';
import { HostID } from './protocol.js';
import { UUID, WorktreeTransition } from './control/contracts.js';
import { CodexMovementCancellationReceipt } from './codex-resource-journal.js';
import { makeCodexDestinationCancellationVerifier } from './codex-destination-cancellation-verifier.js';
import { codexVerifierLease, releaseCodexVerifierLease } from './codex-verifier-lease.js';

const LIMIT = 128 * 1024;
const DEADLINE = 3500;
const unavailable = () => new Error('DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.strictObject({ version: z.literal(1), id: UUID, hostId: HostID, grant: WorktreeTransition,
  receipt: CodexMovementCancellationReceipt });
const challenge = z.strictObject({ challenge: hex });
const envelope = z.strictObject({ payload: z.unknown(), mac: hex });
const answer = z.strictObject({ id: UUID, proof: CodexMovementCancellationReceipt });

function socketPath(path) {
  if (process.platform === 'win32' || typeof path !== 'string' || !isAbsolute(path) ||
      Buffer.byteLength(path) > 100 || path.includes('\0')) throw unavailable();
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || (parent.mode & 0o077)) throw unavailable();
  // Experimental Linux mode uses a kernel abstract address: there is no
  // pathname to replace or unlink. The name is not a credential; every peer
  // must still authenticate the challenge on the retained connection.
  if (process.platform === 'linux' && process.env.TURNLINK_LINUX_ABSTRACT_VERIFIERS === '1')
    return `\0turnlink-v1-${createHash('sha256').update(path).digest('hex')}`;
  return path;
}

function inspectSocket(path) {
  // An abstract address has no filesystem inode. This stable identity is only
  // an address correlation; it does not prove a listener exists or is the
  // same peer. The authenticated, retained socket provides those guarantees.
  if (process.platform === 'linux' && process.env.TURNLINK_LINUX_ABSTRACT_VERIFIERS === '1' && /^\0turnlink-v1-[a-f0-9]{64}$/.test(path))
    return { dev: 'linux-abstract', ino: path };
  const stat = lstatSync(path);
  if (!stat.isSocket() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw unavailable();
  return stat;
}

function mac(secret, label, nonce, value) {
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(label).update('\0').update(nonce)
    .update('\0').update(JSON.stringify(value)).digest('hex');
}
function equal(left, right) {
  return typeof left === 'string' && /^[a-f0-9]{64}$/.test(left) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

// Exactly one bounded JSON line per phase; malformed or extra frames fail closed.
function lines(socket, onLine) {
  let buffer = Buffer.alloc(0), busy = false;
  socket.on('data', data => {
    if (busy || buffer.length + data.length > LIMIT) return socket.destroy();
    buffer = Buffer.concat([buffer, data]);
    const newline = buffer.indexOf(10);
    if (newline < 0) return;
    if (newline !== buffer.length - 1) return socket.destroy();
    busy = true;
    try { onLine(JSON.parse(buffer.subarray(0, newline).toString('utf8'))); }
    catch { socket.destroy(); }
  });
}
function write(socket, value) {
  const data = Buffer.from(`${JSON.stringify(value)}\n`);
  if (data.length > LIMIT || socket.destroyed) throw unavailable();
  socket.write(data);
}

// Shared local framing and private-listener primitives for independently
// authenticated native verifier transports. Protocol schemas and MAC labels
// remain specific to each verifier.
export const localVerifierTransport = Object.freeze({ socketPath, inspectSocket, mac, equal, lines, write,
  listenWithoutPathCleanup: (...args) => listenWithoutPathCleanup(...args) });

// A pathname-bound libuv listener unlinks its pathname on close, even if the
// pathname was replaced. On macOS, duplicate the bound descriptor, retain the
// socket inode through a private hard link, and serve from an fd-based listener
// whose close does not unlink that pathname. Fail closed where fd duplication
// is unavailable. The parent directory remains a trusted local boundary.
async function listenWithoutPathCleanup(path, onConnection, onError) {
  if (process.platform === 'linux' && process.env.TURNLINK_LINUX_ABSTRACT_VERIFIERS === '1' && /^\0turnlink-v1-[a-f0-9]{64}$/.test(path)) {
    const server = createServer(onConnection); server.on('error', onError);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => { server.off('error', reject); resolve(); }); });
    return { server, identity: inspectSocket(path) };
  }
  if (process.platform !== 'darwin') throw unavailable();
  const bound = createServer();
  bound.on('error', () => {});
  await new Promise((resolve, reject) => {
    bound.once('error', reject);
    bound.listen(path, () => { bound.off('error', reject); resolve(); });
  });
  let server, fd, alias, identity;
  try {
    const initial = lstatSync(path);
    if (!initial.isSocket() || initial.isSymbolicLink() || initial.uid !== process.getuid()) throw unavailable();
    chmodSync(path, 0o600); identity = inspectSocket(path);
    if (identity.dev !== initial.dev || identity.ino !== initial.ino) throw unavailable();
    const boundFd = bound._handle?.fd;
    if (!Number.isInteger(boundFd) || boundFd < 0) throw unavailable();
    fd = openSync(`/dev/fd/${boundFd}`, 'r');
    alias = join(dirname(path), `.turnlink-verifier-${randomUUID()}`);
    linkSync(path, alias);
    const linked = inspectSocket(alias);
    if (linked.dev !== identity.dev || linked.ino !== identity.ino) throw unavailable();
    server = createServer(onConnection); server.on('error', onError);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ fd }, () => { server.off('error', reject); resolve(); });
    });
    fd = undefined; // The fd-based listener owns it now.
    await new Promise(resolve => bound.close(resolve));
    // Link creation refuses an unexpected replacement instead of overwriting it.
    linkSync(alias, path);
    unlinkSync(alias); alias = undefined;
    const published = inspectSocket(path);
    if (published.dev !== identity.dev || published.ino !== identity.ino) throw unavailable();
    return { server, identity };
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (bound.listening) await new Promise(resolve => bound.close(resolve));
    if (alias && identity) {
      try { const stat = inspectSocket(alias); if (stat.dev === identity.dev && stat.ino === identity.ino) unlinkSync(alias); } catch { /* retain unexpected paths */ }
    }
    throw error;
  }
}

/// Local verifier owned by the proxy. Each registration holds the actual
/// fenced native control and journal, and exists only during one settlement.
export async function createCodexCancellationVerifierServer({ path, secret }) {
  path = socketPath(path); secret = validateCredential(secret);
  const handlers = new Map(), sockets = new Set(), busyGrants = new Set();
  let closed = false, fault = false, closePromise;
  const onConnection = socket => {
    if (closed || fault || sockets.size >= 32) return socket.destroy();
    sockets.add(socket);
    const abort = new AbortController(), nonce = randomBytes(32).toString('hex');
    let current, heldProof, verificationPending = false, socketClosed = false;
    const releaseRegistration = () => {
      if (current && socketClosed && !verificationPending) {
        releaseCodexVerifierLease(heldProof); heldProof = undefined;
        current.inFlight = false; current.sockets.delete(socket); busyGrants.delete(current.grantId); current = undefined;
      }
    };
    socket.setTimeout(DEADLINE, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      abort.abort(); sockets.delete(socket);
      socketClosed = true; releaseRegistration();
    });
    lines(socket, raw => {
      void (async () => {
        const frame = envelope.parse(raw);
        if (!equal(frame.mac, mac(secret, 'request', nonce, frame.payload))) throw unavailable();
        const payload = request.parse(frame.payload);
        const candidate = handlers.get(payload.grant.id);
        if (!candidate || candidate.inFlight || busyGrants.has(payload.grant.id) || candidate.hostId !== payload.hostId || candidate.agentId !== payload.grant.agentId) throw unavailable();
        current = candidate;
        current.inFlight = true; current.sockets.add(socket); busyGrants.add(payload.grant.id);
        let proof;
        verificationPending = true;
        try {
          proof = await current.verify({ grant: payload.grant, receipt: payload.receipt,
            hostId: payload.hostId, signal: abort.signal });
          heldProof = proof;
        } finally { verificationPending = false; releaseRegistration(); }
        if (abort.signal.aborted || handlers.get(payload.grant.id) !== current) throw unavailable();
        heldProof?.[codexVerifierLease]?.check();
        const result = { id: payload.id, proof: CodexMovementCancellationReceipt.parse(proof) };
        write(socket, { payload: result, mac: mac(secret, 'response', nonce, result) });
        // Hold the exact registration and connection until the broker has
        // finished its synchronous settlement or the deadline expires.
      })().catch(() => socket.destroy());
    });
    try { write(socket, { challenge: nonce }); } catch { socket.destroy(); }
  };
  const { server, identity } = await listenWithoutPathCleanup(path, onConnection, () => {
    fault = true; for (const socket of sockets) socket.destroy();
  });
  return {
    register({ native, journal, client, guard, signal, grant: input, restored = false }) {
      if (closed || fault) throw unavailable();
      const grant = WorktreeTransition.parse(input), hostId = HostID.parse(client?.hostId);
      if (handlers.has(grant.id) || busyGrants.has(grant.id) || journal?.agentId !== grant.agentId || journal?.hostId !== hostId ||
          !signal || signal.aborted || typeof signal.addEventListener !== 'function' ||
          typeof client.on !== 'function' || typeof client.off !== 'function') throw unavailable();
      const entry = { grantId: grant.id, hostId, agentId: grant.agentId, inFlight: false, sockets: new Set(),
        verify: makeCodexDestinationCancellationVerifier({ native, journal, client, guard, restored }) };
      handlers.set(grant.id, entry);
      let unregistered = false;
      const unregister = () => {
        if (unregistered) return;
        unregistered = true;
        if (handlers.get(grant.id) === entry) handlers.delete(grant.id);
        signal.removeEventListener('abort', unregister);
        client.off('disconnected', unregister); client.off('membership_removed', removed);
        for (const socket of entry.sockets) socket.destroy();
      };
      const removed = event => { if (event?.agentId === grant.agentId) unregister(); };
      entry.unregister = unregister;
      signal.addEventListener('abort', unregister, { once: true });
      client.on('disconnected', unregister); client.on('membership_removed', removed);
      if (signal.aborted) { unregister(); throw unavailable(); }
      return unregister;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      for (const entry of handlers.values()) entry.unregister();
      handlers.clear();
      for (const socket of sockets) socket.destroy();
      closePromise = new Promise(resolve => server.close(resolve)).then(() => {
        try { const stat = inspectSocket(path); if (stat.dev === identity.dev && stat.ino === identity.ino) unlinkSync(path); }
        catch { /* retain a missing or replaced path */ }
      });
      return closePromise;
    },
  };
}

/// Broker-side callback. The path and secret are trusted configuration, never
/// supplied by an adapter command. Each connection uses a fresh challenge.
export function makeRemoteCodexCancellationVerifier({ path, secret }) {
  path = socketPath(path); secret = validateCredential(secret);
  return ({ grant, receipt, hostId, signal }) => new Promise((resolve, reject) => {
    let socket, done = false, released = false, before;
    const release = () => {
      if (released) return;
      released = true;
      signal?.removeEventListener('abort', aborted);
      socket?.destroy();
    };
    const finish = (error, value) => {
      if (done) { if (error) release(); return; }
      done = true;
      if (error) { release(); reject(unavailable()); } else resolve(value);
    };
    const aborted = () => finish(unavailable());
    try {
      if (!signal || signal.aborted) throw unavailable();
      before = inspectSocket(path);
      const payload = request.parse({ version: 1, id: randomUUID(), hostId, grant, receipt });
      socket = createConnection(path);
      let phase = 'challenge', nonce;
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) return aborted();
      socket.setTimeout(DEADLINE, aborted);
      socket.on('error', aborted);
      socket.on('close', () => { if (!done) aborted(); else release(); });
      socket.on('connect', () => {
        try { const after = inspectSocket(path); if (before.dev !== after.dev || before.ino !== after.ino) throw unavailable(); }
        catch { aborted(); }
      });
      lines(socket, raw => {
        if (phase === 'challenge') {
          nonce = challenge.parse(raw).challenge;
          phase = 'answer';
          write(socket, { payload, mac: mac(secret, 'request', nonce, payload) });
          // Install the response reader after the challenge frame.
          socket.removeAllListeners('data');
          lines(socket, response => {
            const frame = envelope.parse(response);
            if (!equal(frame.mac, mac(secret, 'response', nonce, frame.payload))) throw unavailable();
            const result = answer.parse(frame.payload);
            if (result.id !== payload.id || JSON.stringify(result.proof) !== JSON.stringify(payload.receipt)) throw unavailable();
            Object.defineProperty(result.proof, codexVerifierLease, { value: {
              check() {
                if (released || signal.aborted || socket.destroyed) throw unavailable();
                const current = inspectSocket(path);
                if (before.dev !== current.dev || before.ino !== current.ino) throw unavailable();
              },
              release,
            } });
            finish(null, result.proof);
          });
        }
      });
    } catch { finish(unavailable()); }
  });
}
