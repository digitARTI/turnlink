import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

const unavailable = () => Object.assign(new Error('CONTAINED_HTTP_TUNNEL_UNAVAILABLE'), { code: 'CONTAINED_HTTP_TUNNEL_UNAVAILABLE' });

// Local experimental relay. Each connection is bound to a freshly observed
// exact container and forwarded only to that container's loopback port.
export async function createContainedOpenCodeHttpTunnel({ owner, docker, containerID, daemonID, operationID, nativePort, password, signal, proxyPath = '/http-proxy.cjs' }) {
  if (!owner?.observe || !isAbsolute(docker) || !/^[a-f0-9]{64}$/.test(containerID || '') || typeof daemonID !== 'string' || !daemonID ||
      typeof operationID !== 'string' || !Number.isInteger(nativePort) || nativePort < 1 || nativePort > 65535 ||
      typeof password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(password) || !['/http-proxy.cjs', '/assets/http-proxy.cjs'].includes(proxyPath) || signal?.aborted) throw unavailable();
  let closed = false, closing, observation; const sockets = new Set(), children = new Set();
  const observe = () => observation ??= owner.observe().finally(() => { observation = undefined; });
  const server = createServer(socket => {
    if (closed || sockets.size >= 32) { socket.destroy(); return; }
    sockets.add(socket); socket.pause(); socket.on('error', () => socket.destroy()); socket.once('close', () => sockets.delete(socket));
    void (async () => {
      const observed = await observe();
      if (closed || socket.destroyed || !observed.running || observed.containerID !== containerID || observed.daemonID !== daemonID || observed.operationID !== operationID) throw unavailable();
      const child = spawn(docker, ['exec', '-i', containerID, '/usr/local/bin/turnlink-node', proxyPath, String(nativePort)],
        { stdio: ['pipe', 'pipe', 'ignore'] });
      children.add(child); child.once('close', () => { children.delete(child); socket.destroy(); }); child.once('error', () => socket.destroy());
      child.stdin.on('error', () => socket.destroy()); child.stdout.on('error', () => socket.destroy());
      socket.once('close', () => { child.stdin.destroy(); child.stdout.destroy(); child.kill(); });
      socket.pipe(child.stdin); child.stdout.pipe(socket); socket.resume();
    })().catch(() => socket.destroy());
  });
  const close = () => closing ??= (async () => {
    closed = true; signal?.removeEventListener('abort', abort); for (const socket of sockets) socket.destroy();
    for (const child of children) { child.stdin.destroy(); child.stdout.destroy(); child.kill(); }
    await new Promise(resolve => server.close(resolve));
  })();
  const abort = () => { void close(); };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string' || signal?.aborted) throw unavailable();
    signal?.addEventListener('abort', abort, { once: true });
    return Object.freeze({ endpoint: Object.freeze({ url: `http://127.0.0.1:${address.port}`, password }), close });
  } catch (error) { await close(); throw error; }
}
