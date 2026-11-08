import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acknowledgeOpenCodeVMHashProbe } from '../src/opencode-vm-hash-ack.js';

test('VM hash acknowledgement carries the exact terminal ticket and fails on lost ACK', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'turnlink-hash-ack-')), socket = join(directory, 'daemon.sock'), id = 'a'.repeat(64);
  let lose = false, seen = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/turnlink-fixture/exec-ticket') { res.end(JSON.stringify({ id })); return; }
    if (req.method !== 'POST' || req.url !== '/turnlink-fixture/exec-ack') { res.writeHead(403).end(); return; }
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.once('end', () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { id }); seen++;
      if (lose) req.socket.destroy(); else res.writeHead(204).end();
    });
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  await acknowledgeOpenCodeVMHashProbe({ endpoint: `unix://${socket}` }); assert.equal(seen, 1);
  lose = true; await assert.rejects(acknowledgeOpenCodeVMHashProbe({ endpoint: `unix://${socket}` }), /VM_HASH_ACK_UNAVAILABLE/);
  assert.equal(seen, 2);
});
