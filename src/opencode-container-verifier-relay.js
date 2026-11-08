import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute, join, normalize } from 'node:path';
import { unlinkSync } from 'node:fs';
import { localVerifierTransport } from './codex-cancellation-verifier-transport.js';
import { UUID } from './control/contracts.js';
import { validateCredential } from './config.js';
import { OpenCodeContainedOwner } from './opencode-contained-owner.js';
import { createContainedHostEndpoint } from './opencode-container-host-endpoint.js';
import { observeContainedOwner } from './opencode-contained-observations.js';

const unavailable = () => Object.assign(new Error('CONTAINED_VERIFIER_RELAY_UNAVAILABLE'), { code: 'CONTAINED_VERIFIER_RELAY_UNAVAILABLE' });
// Acceptance includes two Docker identity observations, not merely a local
// socket round-trip. Both peers still fail closed on expiry or disconnection.
const ANNOUNCEMENT_DEADLINE = 10000;

function readAnnouncementFrame(stream, signal) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0), done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); stream.off('data', data); stream.off('close', fail); signal?.removeEventListener('abort', fail); error ? reject(error) : resolve(value); };
    const fail = () => finish(unavailable());
    const data = chunk => {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 4096) return fail();
      const end = buffer.indexOf(10); if (end < 0) return;
      if (end !== buffer.length - 1) return fail();
      try { finish(undefined, JSON.parse(buffer.subarray(0, end).toString('utf8'))); } catch { fail(); }
    };
    const timer = setTimeout(fail, ANNOUNCEMENT_DEADLINE);
    stream.on('data', data); stream.once('close', fail); signal?.addEventListener('abort', fail, { once: true });
    if (stream.destroyed || signal?.aborted) fail();
  });
}

// The announcement is provisional until the host's authenticated reply; the
// broker independently authenticates the real verifier over the relay.
export async function announceContainedVerifier({ stream, secret, generation, signal }) {
  secret = validateCredential(secret); generation = UUID.parse(generation);
  if (!stream || typeof stream.write !== 'function' || typeof stream.destroy !== 'function' || signal?.aborted) throw unavailable();
  stream.on('error', () => stream.destroy());
  try {
    const challenge = await readAnnouncementFrame(stream, signal);
    if (!challenge || Object.keys(challenge).join(',') !== 'challenge' || !/^[a-f0-9]{64}$/.test(challenge.challenge || '')) throw unavailable();
    const payload = { version: 1, generation }, response = readAnnouncementFrame(stream, signal);
    stream.write(`${JSON.stringify({ payload, mac: localVerifierTransport.mac(secret, 'opencode-contained-verifier-announcement', challenge.challenge, payload) })}\n`);
    const accepted = await response;
    if (!accepted || Object.keys(accepted).sort().join(',') !== 'mac,payload' || JSON.stringify(accepted.payload) !== JSON.stringify(payload) ||
        !localVerifierTransport.equal(accepted.mac, localVerifierTransport.mac(secret, 'opencode-contained-verifier-accepted', challenge.challenge, payload))) throw unavailable();
    const close = () => { signal?.removeEventListener('abort', close); stream.destroy(); };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) { close(); throw unavailable(); }
    return Object.freeze({ generation, close });
  } catch { stream.destroy(); throw unavailable(); }
}

// Fixed-generation byte relay only. Authentication remains the verifier's
// end-to-end HMAC and retained lease; neither a socket path nor Docker ID is a
// credential. The caller supplies the trusted container and private roots.
export async function createContainedVerifierRelay({ owner, docker, containerID, daemonID, operationID, hostDirectory, containerDirectory, generation }) {
  generation = UUID.parse(generation);
  if (process.platform !== 'darwin' || !(owner instanceof OpenCodeContainedOwner) || !isAbsolute(docker) || !/^[a-f0-9]{64}$/.test(containerID || '') ||
      typeof daemonID !== 'string' || !daemonID || typeof operationID !== 'string' ||
      !isAbsolute(hostDirectory) || !isAbsolute(containerDirectory) || normalize(containerDirectory) !== containerDirectory) throw unavailable();
  const path = join(hostDirectory, `${generation}.sock`), target = join(containerDirectory, `${generation}.sock`);
  const hostPath = localVerifierTransport.socketPath(path), addressHash = createHash('sha256').update(target).digest('hex');
  let closed = false, listener, closing; const sockets = new Set(), children = new Set();
  const onConnection = socket => {
    if (closed || sockets.size >= 16) return socket.destroy();
    sockets.add(socket); socket.pause(); socket.on('error', () => socket.destroy()); socket.once('close', () => sockets.delete(socket));
    void (async () => {
      const state = await observeContainedOwner(owner);
      if (closed || socket.destroyed || !state.running || state.status !== 'running' || state.containerID !== containerID ||
          state.daemonID !== daemonID || state.operationID !== operationID) throw unavailable();
      const script = "const net=require('net');const s=net.createConnection('\\0turnlink-v1-'+process.argv[1]);s.on('error',()=>process.exit(1));process.stdin.on('error',()=>process.exit(1));process.stdout.on('error',()=>process.exit(1));process.stdin.pipe(s);s.pipe(process.stdout);s.on('close',()=>process.exit());";
      const child = spawn(docker, ['exec', '-i', containerID, '/usr/local/bin/turnlink-node', '-e', script, addressHash], { stdio: ['pipe', 'pipe', 'ignore'] });
      children.add(child); child.once('close', () => { children.delete(child); socket.destroy(); }); child.once('error', () => socket.destroy());
      child.stdin.on('error', () => socket.destroy()); child.stdout.on('error', () => socket.destroy());
      socket.once('close', () => { child.stdin.destroy(); child.stdout.destroy(); child.kill(); });
      socket.pipe(child.stdin); child.stdout.pipe(socket); socket.resume();
    })().catch(() => socket.destroy());
  };
  const close = () => closing ??= (async () => {
    closed = true; for (const socket of sockets) socket.destroy();
    for (const child of children) { child.stdin.destroy(); child.stdout.destroy(); child.kill(); }
    if (listener?.server.listening) await new Promise(resolve => listener.server.close(resolve));
    if (listener?.identity) try {
      const current = localVerifierTransport.inspectSocket(hostPath);
      if (current.dev === listener.identity.dev && current.ino === listener.identity.ino) unlinkSync(hostPath);
    } catch { /* Never remove a replacement. */ }
  })();
  try {
    listener = await localVerifierTransport.listenWithoutPathCleanup(hostPath, onConnection, () => { void close(); });
    const attest = async lease => {
      if (closed || typeof lease?.socketIdentity !== 'function' || lease.ownerGeneration !== generation ||
          typeof owner.observeIsolatedDatabaseVolume !== 'function') throw unavailable();
      const identity = lease.socketIdentity();
      if (identity.dev !== String(listener.identity.dev) || identity.ino !== String(listener.identity.ino)) throw unavailable();
      const { observed, volume } = await observeContainedOwner(owner, () => owner.observeIsolatedDatabaseVolume('/var/lib/turnlink/opencode.sqlite'));
      const after = lease.socketIdentity();
      if (closed || JSON.stringify(after) !== JSON.stringify(identity) || !observed.running || observed.status !== 'running' ||
          observed.containerID !== containerID || observed.daemonID !== daemonID || observed.operationID !== operationID ||
          volume.containerID !== containerID || volume.daemonID !== daemonID) throw unavailable();
      return Object.freeze({ version: 1, generation, containerID, daemonID, operationID, volume: {
        name: volume.volume.name, createdAt: volume.volume.createdAt, destination: volume.volume.destination } });
    };
    return Object.freeze({ path, generation, attest, close });
  } catch { await close(); throw unavailable(); }
}

// The stream must already belong to the host supervisor's private channel.
// The challenge authenticates the announcement, not the Docker identity;
// identity is independently observed before and after creating the relay.
export async function acceptContainedVerifierAnnouncement({ stream, secret, signal, ...options }) {
  secret = validateCredential(secret);
  if (!stream || typeof stream.write !== 'function' || typeof stream.destroy !== 'function' || signal?.aborted) throw unavailable();
  stream.on('error', () => stream.destroy());
  const nonce = randomBytes(32).toString('hex');
  const frame = await new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0), done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); stream.off('data', onData); stream.off('close', onClose); signal?.removeEventListener('abort', onClose); error ? reject(error) : resolve(value); };
    const onClose = () => finish(unavailable());
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 4096) return finish(unavailable());
      const end = buffer.indexOf(10); if (end < 0) return;
      if (end !== buffer.length - 1) return finish(unavailable());
      try { finish(undefined, JSON.parse(buffer.subarray(0, end).toString('utf8'))); } catch { finish(unavailable()); }
    };
    const timer = setTimeout(onClose, ANNOUNCEMENT_DEADLINE);
    stream.on('data', onData); stream.once('close', onClose); signal?.addEventListener('abort', onClose, { once: true });
    if (signal?.aborted) onClose(); else stream.write(`${JSON.stringify({ challenge: nonce })}\n`);
  }).catch(error => { stream.destroy(); throw error; });
  let relay;
  try {
    if (!frame || Object.keys(frame).sort().join(',') !== 'mac,payload' || !frame.payload ||
        Object.keys(frame.payload).sort().join(',') !== 'generation,version' || frame.payload.version !== 1 ||
        !localVerifierTransport.equal(frame.mac, localVerifierTransport.mac(secret, 'opencode-contained-verifier-announcement', nonce, frame.payload))) throw unavailable();
    const generation = UUID.parse(frame.payload.generation), before = await observeContainedOwner(options.owner);
    if (!before.running || before.status !== 'running' || before.containerID !== options.containerID || before.daemonID !== options.daemonID ||
        before.operationID !== options.operationID || stream.destroyed || signal?.aborted) throw unavailable();
    relay = await createContainedVerifierRelay({ ...options, generation });
    const after = await observeContainedOwner(options.owner);
    if (!after.running || after.status !== 'running' || after.containerID !== options.containerID || after.daemonID !== options.daemonID ||
        after.operationID !== options.operationID || stream.destroyed || signal?.aborted) throw unavailable();
    const close = () => { signal?.removeEventListener('abort', close); stream.destroy(); void relay.close(); };
    stream.once('close', close); stream.once('data', close); signal?.addEventListener('abort', close, { once: true });
    stream.write(`${JSON.stringify({ payload: frame.payload, mac: localVerifierTransport.mac(secret, 'opencode-contained-verifier-accepted', nonce, frame.payload) })}\n`);
    return Object.freeze({ generation, relay, close });
  } catch { stream.destroy(); await relay?.close(); throw unavailable(); }
}

// Hosted alongside the broker by a trusted supervisor. Only relay objects
// created through authenticated announcements can supply an attestation.
export function createContainedVerifierRegistry() {
  const entries = new Map(); let closed = false;
  const accept = async options => {
    if (closed || entries.size >= 64) throw unavailable();
    const announcement = await acceptContainedVerifierAnnouncement(options);
    if (closed || entries.has(announcement.generation) || options.stream.destroyed) { announcement.close(); throw unavailable(); }
    const entry = { announcement, stream: options.stream, options, lease: undefined, endpoint: undefined, preparing: false, timer: undefined };
    entries.set(announcement.generation, entry);
    const remove = () => {
      clearInterval(entry.timer); void entry.endpoint?.close();
      if (entries.get(announcement.generation) === entry) entries.delete(announcement.generation);
    };
    options.stream.once('close', remove);
    return announcement;
  };
  const verify = async ({ generation, lease, signal }) => {
    if (closed || signal?.aborted) throw unavailable();
    const entry = entries.get(UUID.parse(generation));
    if (!entry || entry.stream.destroyed) throw unavailable();
    const attestation = await entry.announcement.relay.attest(lease);
    if (closed || signal?.aborted || entries.get(generation) !== entry || entry.stream.destroyed) throw unavailable();
    if (entry.options.hostEndpointDirectory !== undefined) {
      if (entry.lease && entry.lease !== lease) throw unavailable();
      entry.lease = lease;
      if (!entry.timer && !entry.endpoint) {
        const attempt = async () => {
          if (entry.preparing || entry.endpoint || closed || entries.get(generation) !== entry || entry.stream.destroyed) return;
          try { if (!lease.check() || !lease.ready() || !lease.endpoint()) return; } catch { entry.announcement.close(); return; }
          entry.preparing = true;
          try {
            const endpoint = await createContainedHostEndpoint({ owner: entry.options.owner, docker: entry.options.docker,
              containerID: entry.options.containerID, daemonID: entry.options.daemonID, operationID: entry.options.operationID,
              guestEndpointDirectory: entry.options.guestEndpointDirectory, hostEndpointDirectory: entry.options.hostEndpointDirectory,
              proxyPath: entry.options.proxyPath, lease });
            if (closed || entries.get(generation) !== entry || entry.stream.destroyed) { await endpoint.close(); return; }
            entry.endpoint = endpoint; clearInterval(entry.timer); entry.timer = undefined;
          } catch { entry.announcement.close(); }
          finally { entry.preparing = false; }
        };
        entry.timer = setInterval(() => { void attempt(); }, 200); entry.timer.unref(); void attempt();
      }
    }
    return attestation;
  };
  // Synchronous for the broker's delivery fence. Only the exact retained lease
  // whose HMAC socket was attested may name the host-owned endpoint.
  const endpoint = ({ generation, lease }) => {
    const entry = entries.get(generation);
    if (closed || !entry || entry.stream.destroyed || entry.lease !== lease || !entry.endpoint) return undefined;
    return entry.endpoint.endpoint();
  };
  const close = () => { if (closed) return; closed = true; for (const entry of entries.values()) { clearInterval(entry.timer); void entry.endpoint?.close(); entry.announcement.close(); } entries.clear(); };
  return Object.freeze({ accept, verify, endpoint, close });
}
