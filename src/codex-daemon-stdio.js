// Adapt the local Codex daemon's Unix WebSocket to the stdio protocol used by
// the Turnlink proxy. The daemon remains the sole owner of its native threads.
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const directory = process.env.CODEX_HOME || join(homedir(), '.codex');
const socketPath = realpathSync(join(directory, 'app-server-control', 'app-server-control.sock'));
const socket = new WebSocket(`ws+unix:${socketPath}:/`, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = [], pendingBytes = 0;
input.on('line', line => {
  if (socket.readyState === WebSocket.OPEN) socket.send(line);
  else {
    pendingBytes += Buffer.byteLength(line);
    if (pendingBytes > 16 * 1024 * 1024) { socket.terminate(); process.exitCode = 1; return; }
    pending.push(line);
  }
});
input.on('close', () => { if (socket.readyState === WebSocket.OPEN) socket.close(); else socket.terminate(); });
socket.on('open', () => { for (const line of pending) socket.send(line); pending = []; pendingBytes = 0; });
socket.on('message', (data, binary) => {
  if (binary) { socket.terminate(); process.exitCode = 1; return; }
  process.stdout.write(`${data.toString()}\n`);
});
socket.on('error', () => { console.error('Turnlink: cannot connect to the shared Codex daemon.'); process.exitCode = 1; });
socket.on('close', () => { input.close(); });
