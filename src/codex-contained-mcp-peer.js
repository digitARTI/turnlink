import { createServer } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { privateTemp } from './storage.js';

export function cleanupContainedMcpPeer(peer) {
  try {
    const directory = dirname(peer.path), root = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
    if (dirname(directory) !== root || !/^tl-peer-[a-zA-Z0-9]+$/.test(basename(directory)) || basename(peer.path) !== 'socket') return;
    const parent = lstatSync(directory, { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== BigInt(process.getuid()) || (parent.mode & 0o077n)) return;
    try {
      const current = lstatSync(peer.path, { bigint: true });
      if (current.isSocket() && String(current.dev) === peer.device && String(current.ino) === peer.inode) unlinkSync(peer.path);
    } catch {}
    rmdirSync(directory);
  } catch { /* Leave an unexpected path untouched for later inspection. */ }
}

// The peer endpoint belongs to the wrapper process, not the MCP container.
// Its token is stored only in the private owner journal and never on stdout.
export async function createContainedMcpPeer(onFailure) {
  if (!['darwin', 'linux'].includes(process.platform) || typeof onFailure !== 'function') throw new Error('CONTAINED_MCP_PEER_UNAVAILABLE');
  const directory = privateTemp(process.platform === 'darwin' ? '/private/tmp/tl-peer-' : '/tmp/tl-peer-');
  const path = join(directory, 'socket'), nonce = randomBytes(32).toString('hex'), clients = new Set();
  const server = createServer(socket => {
    clients.add(socket); socket.setTimeout(2000, () => socket.destroy());
    socket.on('close', () => clients.delete(socket)); socket.on('error', () => {});
    let input = '';
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      if (input.length > 65) return socket.destroy();
      if (!input.endsWith('\n')) return;
      const value = input.slice(0, -1);
      if (!/^[a-f0-9]{64}$/.test(value) || !timingSafeEqual(Buffer.from(value), Buffer.from(nonce))) return socket.destroy();
      socket.end('ok\n');
    });
  });
  server.maxConnections = 8;
  let original;
  const close = () => {
    for (const client of clients) client.destroy();
    if (server.listening) server.close();
    if (original) cleanupContainedMcpPeer({ path, ...original });
    else { try { rmdirSync(directory); } catch {} }
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    server.removeAllListeners('error'); server.on('error', onFailure);
    const stat = lstatSync(path, { bigint: true }); if (!stat.isSocket()) throw new Error('CONTAINED_MCP_PEER_UNAVAILABLE');
    original = { device: String(stat.dev), inode: String(stat.ino) };
    return Object.freeze({ path, nonce, ...original, close });
  } catch (error) { close(); throw error; }
}
