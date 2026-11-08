import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { isAbsolute, join, normalize } from 'node:path';
import { z } from 'zod';
import { OpenCodeContainedOwner } from './opencode-contained-owner.js';
import { observeContainedOwner } from './opencode-contained-observations.js';
import { createContainedOpenCodeHttpTunnel } from './opencode-container-http-tunnel.js';
import { createOpenCodeEndpointGate } from './opencode-endpoint-gate.js';
import { publishEndpoint } from './opencode-completion-owner.js';

const run = promisify(execFile);
const unavailable = () => Object.assign(new Error('CONTAINED_HOST_ENDPOINT_UNAVAILABLE'), { code: 'CONTAINED_HOST_ENDPOINT_UNAVAILABLE' });
const reference = z.strictObject({ name: z.string().regex(/^turnlink-[0-9a-f-]{36}\.json$/), device: z.string().regex(/^\d+$/),
  inode: z.string().regex(/^\d+$/), digest: z.string().regex(/^[a-f0-9]{64}$/) });
const endpointSchema = z.strictObject({ version: z.literal(1), url: z.string().url(), password: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) });

// Read only the exact private file named by the authenticated verifier. The
// JSON is never logged, passed on the command line or published on the host.
const readScript = `const fs=require('node:fs'),crypto=require('node:crypto');
const p=process.argv[1],expected=JSON.parse(process.argv[2]);
const check=s=>s.isFile()&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s.nlink===1&&String(s.dev)===expected.device&&String(s.ino)===expected.inode;
try {const before=fs.lstatSync(p);if(!check(before)||before.size>4096)throw 0;const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data;try {if(!check(fs.fstatSync(fd)))throw 0;data=fs.readFileSync(fd);}finally{fs.closeSync(fd)}const after=fs.lstatSync(p);if(!check(after)||data.length>4096||crypto.createHash('sha256').update(data).digest('hex')!==expected.digest)throw 0;process.stdout.write(data);}catch{process.exit(1)}`;

// A host endpoint has a fresh credential, separate from both the guest gate
// and native server. It remains only an observation of the retained lease:
// loss of that lease destroys established streams and the endpoint file.
export async function createContainedHostEndpoint({ owner, docker, containerID, daemonID, operationID, lease,
  guestEndpointDirectory, hostEndpointDirectory, signal, proxyPath }) {
  if (!(owner instanceof OpenCodeContainedOwner) || !isAbsolute(docker) || !/^[a-f0-9]{64}$/.test(containerID || '') ||
      typeof daemonID !== 'string' || !daemonID || typeof operationID !== 'string' || !lease ||
      typeof lease.check !== 'function' || typeof lease.ready !== 'function' || typeof lease.endpoint !== 'function' ||
      typeof lease.onClose !== 'function' || !isAbsolute(guestEndpointDirectory) || normalize(guestEndpointDirectory) !== guestEndpointDirectory ||
      !isAbsolute(hostEndpointDirectory) || signal?.aborted) throw unavailable();
  let tunnel, gate, remove, detach = () => {}, closed = false, closing;
  // Both the gate and tunnel inspect the same owner. Share an in-flight
  // observation so concurrent HTTP requests do not race its exclusive lock.
  let observing;
  const observedOwner = { observe: () => observing ??= observeContainedOwner(owner).finally(() => { observing = undefined; }) };
  const close = () => closing ??= (async () => {
    closed = true; signal?.removeEventListener('abort', abort); detach(); gate?.revoke(); remove?.();
    await gate?.close(); await tunnel?.close();
  })();
  const abort = () => { void close(); };
  try {
    lease.check(); if (!lease.ready()) throw unavailable();
    const guest = reference.parse(lease.endpoint()), observed = await observedOwner.observe();
    if (!observed.running || observed.containerID !== containerID || observed.daemonID !== daemonID || observed.operationID !== operationID) throw unavailable();
    const { stdout } = await run(docker, ['exec', containerID, '/usr/local/bin/turnlink-node', '-e', readScript,
      join(guestEndpointDirectory, guest.name), JSON.stringify(guest)], { encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
    const target = endpointSchema.parse(JSON.parse(stdout)), url = new URL(target.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw unavailable();
    const current = () => {
      if (closed || signal?.aborted || !lease.check() || !lease.ready() || JSON.stringify(lease.endpoint()) !== JSON.stringify(guest)) throw unavailable();
      return true;
    };
    current();
    tunnel = await createContainedOpenCodeHttpTunnel({ owner: observedOwner, docker, containerID, daemonID, operationID,
      nativePort: Number(url.port), password: target.password, signal, ...(proxyPath ? { proxyPath } : {}) });
    current();
    gate = await createOpenCodeEndpointGate({ upstream: tunnel.endpoint, authorize: async () => {
      try { current(); if (!remove?.check()) return false; const state = await observedOwner.observe(); current();
        return state.running && state.containerID === containerID && state.daemonID === daemonID && state.operationID === operationID;
      } catch { return false; }
    }, onRevoked: abort });
    current();
    remove = publishEndpoint(join(hostEndpointDirectory, `turnlink-${randomUUID()}.json`), gate.endpoint);
    gate.activate();
    detach = lease.onClose(abort); signal?.addEventListener('abort', abort, { once: true });
    current(); if (!remove.check()) throw unavailable();
    return Object.freeze({ endpoint() { try { current(); return remove.attestation() || undefined; } catch { abort(); return undefined; } }, close });
  } catch { await close(); throw unavailable(); }
}
