import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

// Each interactive client receives its own stdio proxy. The capability exists
// only in the launching process and the child TUI's environment.
export async function createCodexTuiBridge({ env = process.env, proxyArgs = ['app-server'] } = {}) {
  const secret = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${secret}`);
  const server = createServer((request, response) => { response.writeHead(404); response.end(); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  let peer, child, closed = false, connectionUsed = false;
  const done = new Promise(resolve => { server.once('close', resolve); });
  server.on('upgrade', (request, socket, head) => {
    const supplied = Buffer.from(request.headers.authorization || '');
    if (connectionUsed || request.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    connectionUsed = true;
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => {
    peer = ws;
    child = spawn(process.execPath, [fileURLToPath(new URL('./codex-proxy.js', import.meta.url)), ...proxyArgs], {
      env, stdio: ['pipe', 'pipe', 'inherit'],
    });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (Buffer.byteLength(line) > 8 * 1024 * 1024 || ws.bufferedAmount > 16 * 1024 * 1024) { ws.terminate(); return; }
      if (ws.readyState === WebSocket.OPEN) ws.send(line, error => { if (error) ws.terminate(); });
    });
    child.on('error', () => ws.terminate());
    child.once('exit', () => { if (ws.readyState === WebSocket.OPEN) ws.close(); });
    child.stdin.on('error', () => ws.terminate());
    ws.on('error', () => {});
    ws.on('message', (data, binary) => {
      if (binary || child.stdin.writableLength > 16 * 1024 * 1024) { ws.terminate(); return; }
      const text = data.toString();
      try { JSON.parse(text); } catch { ws.terminate(); return; }
      if (text.includes('\n') || text.includes('\r')) { ws.terminate(); return; }
      child.stdin.write(`${text}\n`);
    });
    ws.once('close', () => { child.stdin.end(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `ws://127.0.0.1:${server.address().port}`, secret,
    async close() {
      if (closed) return done;
      closed = true;
      if (peer) peer.terminate();
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit').catch(() => {}); child.kill(); await exited;
      }
      sockets.close(); server.close(); await done;
    },
  };
}
