import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOpenCodeHostMux, createOpenCodeContainerMux } from '../src/opencode-container-mux.js';

const docker = process.env.OPENCODE_TEST_DOCKER || '/opt/homebrew/bin/docker';
const image = 'turnlink-opencode-runtime-test:node24-bun142';
const run = (...args) => execFileSync(docker, args, { encoding: 'utf8', timeout: 15000 }).trim();

test('host closes transport on a malformed frame without connecting', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let closed = false;
  createOpenCodeHostMux({ input, output, port: 1234, onClose: () => { closed = true; } });
  const frame = Buffer.alloc(9); frame.writeUInt8(99, 0); frame.writeUInt32BE(1, 1); input.write(frame);
  assert.equal(closed, true); input.destroy(); output.destroy();
});

test('host rejects invalid IDs, oversized frames, and data without an open', () => {
  for (const [type, id, length] of [[1, 0, 0], [2, 1, 16385], [2, 1, 1], [1, 1, 1]]) {
    const input = new PassThrough(), output = new PassThrough(); let closed = false;
    createOpenCodeHostMux({ input, output, port: 1234, onClose: () => { closed = true; } });
    const frame = Buffer.alloc(9 + (length === 1 ? 1 : 0)); frame.writeUInt8(type, 0); frame.writeUInt32BE(id, 1); frame.writeUInt32BE(length, 5);
    input.write(frame); assert.equal(closed, true); input.destroy(); output.destroy();
  }
});

test('a late FIN for a retired connection does not tear down the mux', async () => {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const input = new PassThrough(), output = new PassThrough(); let closed = false;
  const host = createOpenCodeHostMux({ input, output, port: server.address().port, onClose: () => { closed = true; } });
  const frame = (type, id) => { const value = Buffer.alloc(9); value.writeUInt8(type, 0); value.writeUInt32BE(id, 1); return value; };
  try {
    const connected = new Promise(resolve => server.once('connection', resolve)); input.write(frame(1, 1));
    const socket = await connected; socket.destroy(); await new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 20)); input.write(frame(3, 1)); assert.equal(closed, false);
    input.write(frame(3, 3)); assert.equal(closed, true, 'an unowned ID must still fail closed');
  } finally { host.close(); input.destroy(); output.destroy(); await new Promise(resolve => server.close(resolve)); }
});

test('one abruptly closed connection does not disable later connections', async () => {
  const server = net.createServer(socket => { socket.on('data', data => socket.write(data)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const hostToGuest = new PassThrough(), guestToHost = new PassThrough(); let closed = false;
  const host = createOpenCodeHostMux({ input: guestToHost, output: hostToGuest, port: server.address().port, onClose: () => { closed = true; } });
  const guest = createOpenCodeContainerMux({ input: hostToGuest, output: guestToHost, port });
  await new Promise(resolve => guest.listener.once('listening', resolve));
  try {
    for (let i = 0; i < 20; i++) {
      const socket = net.createConnection({ host: '127.0.0.1', port }); await new Promise(resolve => socket.once('connect', resolve));
      socket.write('x'); await new Promise(resolve => socket.once('data', resolve)); socket.destroy();
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(closed, false, `mux closed after connection ${i}`);
    }
    const final = net.createConnection({ host: '127.0.0.1', port }); await new Promise(resolve => final.once('connect', resolve));
    final.write('ok'); assert.equal(String(await new Promise(resolve => final.once('data', resolve))), 'ok'); final.destroy();
  } finally { host.close(); guest.close(); hostToGuest.destroy(); guestToHost.destroy(); await new Promise(resolve => server.close(resolve)); }
});

test('networkless container multiplexes concurrent loopback connections to the fixed broker', { skip: process.env.OPENCODE_DOCKER_TEST !== '1', timeout: 30000 }, async () => {
  const broker = net.createServer({ allowHalfOpen: true }, socket => { socket.on('data', data => socket.write(data.toString().toUpperCase())); socket.on('end', () => socket.end()); });
  await new Promise((resolve, reject) => { broker.once('error', reject); broker.listen(0, '127.0.0.1', resolve); });
  const name = `turnlink-mux-${randomUUID()}`, path = fileURLToPath(new URL('../src/opencode-container-mux.js', import.meta.url));
  const script = `import { createOpenCodeContainerMux } from '/mux.mjs'; const mux=createOpenCodeContainerMux({input:process.stdin,output:process.stdout,port:32173}); mux.listener.once('listening',()=>console.error('READY'));`;
  const child = spawn(docker, ['run', '--rm', '-i', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--name', name, '--mount', `type=bind,src=${path},dst=/mux.mjs,readonly`, image, '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const host = createOpenCodeHostMux({ input: child.stdout, output: child.stdin, port: broker.address().port });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`container not ready: ${stderr}`)), 10000);
      child.stderr.on('data', function ready() { if (stderr.includes('READY')) { clearTimeout(timer); child.stderr.off('data', ready); resolve(); } });
      void exit.then(() => { clearTimeout(timer); reject(new Error(`container exited: ${stderr}`)); });
    });
    const client = `const n=require('node:net'); let count=0; for(const word of ['alpha','beta','z'.repeat(150000)]) { const s=n.connect({host:'127.0.0.1',port:32173},()=>s.end(word)); let data=''; s.on('data',b=>data+=b); s.on('end',()=>{if(data!==word.toUpperCase()) process.exit(4); console.log(word.length>100?'BULK_OK':data); if(++count===3) process.exit(0)}); s.on('error',()=>process.exit(3)); }`;
    const { stdout } = await promisify(execFile)(docker, ['exec', name, '/usr/local/bin/turnlink-bun', '-e', client], { encoding: 'utf8', timeout: 15000 });
    const result = stdout.trim().split('\n').sort();
    assert.deepEqual(result, ['ALPHA', 'BETA', 'BULK_OK']);
  } finally {
    host.close(); child.stdin.destroy(); child.kill('SIGKILL');
    try { run('rm', '-f', name); } catch {}
    await exit; await new Promise(resolve => broker.close(resolve));
  }
});
