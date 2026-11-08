import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { lstatSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { privateTemp } from '../src/storage.js';
import { createOpenCodeDaemonUnixProxy } from '../src/opencode-daemon-unix-proxy.js';

test('daemon proxy pins its private socket and tears down streams on revocation', async t => {
  const root = privateTemp('/private/tmp/tldp-'), path = join(root, 'd.sock');
  const upstreamServer = createServer(socket => socket.pipe(socket)); upstreamServer.listen(0, '127.0.0.1'); await once(upstreamServer, 'listening');
  t.after(() => { upstreamServer.close(); rmSync(root, { recursive: true, force: true }); });
  const controller = new AbortController();
  const proxy = await createOpenCodeDaemonUnixProxy({ path, signal: controller.signal,
    openStream: () => createConnection(upstreamServer.address().port, '127.0.0.1') });
  assert.equal(proxy.check(), true); assert.equal(lstatSync(path).mode & 0o777, 0o600);
  await assert.rejects(createOpenCodeDaemonUnixProxy({ path, openStream: () => null }), /DAEMON_PROXY_UNAVAILABLE/);
  const client = createConnection(path); await once(client, 'connect');
  const response = once(client, 'data'); client.write('synthetic'); assert.equal((await response)[0].toString(), 'synthetic');
  const closed = once(client, 'close'); controller.abort(); await closed;
  assert.equal(proxy.check(), false); assert.throws(() => lstatSync(path), /ENOENT/);
});

test('Docker client reaches its pinned daemon through the proxy', { skip: process.env.TURNLINK_DOCKER_PROXY_INTEGRATION !== '1' }, async t => {
  const root = privateTemp('/private/tmp/tldp-'), docker = '/opt/homebrew/bin/docker', path = join(root, 'd.sock');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const endpoint = execFileSync(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8', timeout: 30000 }).trim();
  const url = new URL(endpoint); assert.equal(url.protocol, 'unix:');
  const proxy = await createOpenCodeDaemonUnixProxy({ path, openStream: () => createConnection(decodeURIComponent(url.pathname)) });
  t.after(() => proxy.close());
  const run = promisify(execFile);
  const id = async host => (await run(docker, ['--host', host, 'info', '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 30000 })).stdout.trim();
  assert.equal(await id(proxy.endpoint), await id(endpoint)); assert.equal(proxy.check(), true);
});

test('daemon proxy closes active streams when its pathname is replaced', async t => {
  const root = privateTemp('/private/tmp/tldp-'), path = join(root, 'd.sock');
  const upstreamServer = createServer(socket => socket.pipe(socket)); upstreamServer.listen(0, '127.0.0.1'); await once(upstreamServer, 'listening');
  t.after(() => { upstreamServer.close(); rmSync(root, { recursive: true, force: true }); });
  const proxy = await createOpenCodeDaemonUnixProxy({ path, openStream: () => createConnection(upstreamServer.address().port, '127.0.0.1') });
  const client = createConnection(path); await once(client, 'connect');
  const closed = once(client, 'close'); renameSync(path, join(root, 'old.sock')); writeFileSync(path, 'replacement');
  let timer; try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('proxy did not revoke')), 3000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(proxy.check(), false); assert.equal(readFileSync(path, 'utf8'), 'replacement');
});

test('daemon proxy drains a large final response before closing', async t => {
  const root = privateTemp('/private/tmp/tldp-'), path = join(root, 'd.sock'), payload = Buffer.alloc(2 * 1024 * 1024, 65);
  const upstreamServer = createServer(socket => socket.once('data', () => socket.end(payload)));
  upstreamServer.listen(0, '127.0.0.1'); await once(upstreamServer, 'listening');
  t.after(() => { upstreamServer.close(); rmSync(root, { recursive: true, force: true }); });
  const proxy = await createOpenCodeDaemonUnixProxy({ path, openStream: () => createConnection(upstreamServer.address().port, '127.0.0.1') });
  t.after(() => proxy.close());
  const client = createConnection(path); await once(client, 'connect'); const chunks = [];
  client.on('data', chunk => chunks.push(chunk)); const ended = once(client, 'end'); client.write('request'); await ended;
  assert.deepEqual(Buffer.concat(chunks), payload); client.destroy();
});
