import { createServer, request as httpRequest } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const unavailable = () => Object.assign(new Error('OPENCODE_ENDPOINT_GATE_UNAVAILABLE'), { code: 'OPENCODE_ENDPOINT_GATE_UNAVAILABLE' });

// The published credential is independent of the native server password. The
// gate is owned by the same controller as the native child; it starts closed
// and terminates established streams when revoked. This is not a broker lease.
export async function createOpenCodeEndpointGate({ upstream, authorize, onRevoked = () => {} }) {
  let url;
  try { url = new URL(upstream?.url); } catch { throw unavailable(); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || typeof upstream?.password !== 'string' || !upstream.password ||
      typeof authorize !== 'function' || typeof onRevoked !== 'function') throw unavailable();
  const password = randomBytes(32).toString('base64url');
  const challengeKey = randomBytes(32), challengeToken = randomBytes(32).toString('hex');
  const challengeMac = nonce => createHmac('sha256', challengeKey).update(nonce).digest('hex');
  const expected = Buffer.from(`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`);
  const nativeAuthorization = `Basic ${Buffer.from(`opencode:${upstream.password}`).toString('base64')}`;
  const sockets = new Set(), requests = new Set();
  let active = false, retired = false, closed = false, closing, timer, verification, lastVerified = 0, generation = 0;
  const authenticated = value => {
    const actual = Buffer.from(typeof value === 'string' ? value : '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const revoke = () => {
    active = false; retired = true; generation++; lastVerified = 0;
    if (timer) clearInterval(timer); timer = undefined;
    for (const request of requests) request.destroy();
    for (const socket of sockets) socket.destroy();
  };
  const fail = () => {
    if (!active) return;
    revoke();
    try { onRevoked(); } catch { /* Revocation must remain effective. */ }
  };
  // Coalesce concurrent HTTP/upgrade checks and briefly reuse a successful
  // observation. This bounds broker traffic, not the revocation window.
  const verify = async (force = false) => {
    if (!active || closed) return false;
    if (!force && lastVerified && performance.now() - lastVerified < 750) return true;
    if (!verification) {
      const observedGeneration = generation;
      verification = (async () => {
        let timerId;
        try {
          const result = await Promise.race([Promise.resolve().then(authorize),
            new Promise(resolve => { timerId = setTimeout(() => resolve(false), 3000); })]);
          if (result === 'pending' && !closed && active && observedGeneration === generation) return 'pending';
          if (result !== true || closed || !active || observedGeneration !== generation) return false;
          lastVerified = performance.now(); return true;
        } finally { clearTimeout(timerId); }
      })().finally(() => { verification = undefined; });
    }
    return verification;
  };
  const permitted = async request => {
    if (!authenticated(request.headers.authorization)) return 401;
    if (closed || !active) return 503;
    try { const result = await verify(); if (result === 'pending' && !closed && active) return 503;
      if (result !== true || closed || !active) { fail(); return 503; } }
    catch { fail(); return 503; }
    return 0;
  };
  const headers = request => ({ ...request.headers, host: url.host, authorization: nativeAuthorization });
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      if (incoming.url?.startsWith('/__turnlink_gate_challenge/')) {
        const nonce = incoming.url.slice('/__turnlink_gate_challenge/'.length);
        if (closed || retired || incoming.method !== 'GET' || !/^[a-f0-9]{64}$/.test(nonce) || incoming.headers['x-turnlink-gate-challenge'] !== challengeToken) {
          outgoing.writeHead(404, { 'content-length': '0' }); outgoing.end(); return;
        }
        outgoing.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); outgoing.end(challengeMac(nonce)); return;
      }
      const denied = await permitted(incoming);
      if (denied) { outgoing.writeHead(denied, { 'content-length': '0' }); outgoing.end(); return; }
      if (incoming.destroyed || outgoing.destroyed) return;
      const target = httpRequest({ hostname: '127.0.0.1', port: Number(url.port), method: incoming.method,
        path: incoming.url, headers: headers(incoming) }, response => {
        outgoing.writeHead(response.statusCode || 502, response.headers); response.pipe(outgoing);
        response.on('error', () => outgoing.destroy());
      });
      requests.add(target); target.once('close', () => requests.delete(target));
      target.on('error', () => { if (outgoing.destroyed) return; if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
      incoming.on('error', () => target.destroy()); outgoing.on('error', () => target.destroy()); outgoing.on('close', () => target.destroy());
      incoming.pipe(target);
    })().catch(() => { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); });
  });
  server.on('error', fail);
  server.on('connection', socket => {
    if (sockets.size >= 128) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (incoming, socket, head) => {
    socket.on('error', () => socket.destroy());
    void (async () => {
      const denied = await permitted(incoming);
      if (denied) { socket.end(`HTTP/1.1 ${denied} ${denied === 401 ? 'Unauthorized' : 'Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
      if (socket.destroyed || closed || !active) return;
      const target = httpRequest({ hostname: '127.0.0.1', port: Number(url.port), method: incoming.method,
        path: incoming.url, headers: headers(incoming) });
      requests.add(target); target.once('close', () => requests.delete(target));
      target.on('upgrade', (response, remote, remoteHead) => {
        if (closed || !active || socket.destroyed) { remote.destroy(); socket.destroy(); return; }
        remote.on('error', () => socket.destroy()); remote.on('close', () => socket.destroy()); socket.on('close', () => remote.destroy());
        socket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n` +
          response.rawHeaders.reduce((all, value, index) => all + (index % 2 ? `${value}\r\n` : `${value}: `), '') + '\r\n');
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        socket.pipe(remote); remote.pipe(socket);
      });
      target.on('response', response => { response.resume(); socket.destroy(); });
      target.on('error', () => socket.destroy()); target.end();
    })().catch(() => socket.destroy());
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw unavailable();
    return Object.freeze({ endpoint: Object.freeze({ url: `http://127.0.0.1:${address.port}`, password }),
      async prove(nonce) {
        if (closed || retired || !/^[a-f0-9]{64}$/.test(nonce)) throw unavailable();
        try {
          const response = await fetch(`http://127.0.0.1:${address.port}/__turnlink_gate_challenge/${nonce}`, {
            headers: { 'x-turnlink-gate-challenge': challengeToken }, redirect: 'error', signal: AbortSignal.timeout(3000) });
          const body = await response.text();
          if (!response.ok || body !== challengeMac(nonce) || closed || retired) throw unavailable();
          return true;
        } catch { throw unavailable(); }
      },
      activate() {
        if (closed || retired || active) throw unavailable();
        active = true;
        timer = setInterval(() => {
          if (!active) return;
          void verify(true).then(ok => { if (ok !== true && ok !== 'pending') fail(); }, fail);
        }, 1000);
        timer.unref();
      }, revoke,
      close() { if (closing) return closing; closed = true; revoke(); closing = new Promise(resolve => server.close(resolve)); return closing; } });
  } catch { revoke(); server.close(); throw unavailable(); }
}
