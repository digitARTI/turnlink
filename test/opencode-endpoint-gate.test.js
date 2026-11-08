import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { createOpenCodeEndpointGate } from '../src/opencode-endpoint-gate.js';

test('endpoint gate uses a separate credential, blocks before activation and revokes streams and websockets', async t => {
  const nativePassword = 'native-fixture-password';
  const nativeAuth = `Basic ${Buffer.from(`opencode:${nativePassword}`).toString('base64')}`;
  const upstream = createServer((request, response) => {
    if (request.headers.authorization !== nativeAuth) { response.writeHead(401).end(); return; }
    if (request.url === '/stream') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('data: ready\n\n'); return; }
    response.writeHead(200, { 'content-type': 'text/plain' }); response.end('native fixture');
  });
  const wss = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (request, socket, head) => {
    if (request.headers.authorization !== nativeAuth) return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => ws.on('message', value => ws.send(value)));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let allowed = true, revocations = 0;
  const gate = await createOpenCodeEndpointGate({ upstream: { url: `http://127.0.0.1:${upstream.address().port}`, password: nativePassword },
    authorize: async () => allowed, onRevoked: () => { revocations++; } });
  t.after(async () => { await gate.close(); wss.close(); await new Promise(resolve => upstream.close(resolve)); });
  assert.notEqual(gate.endpoint.password, nativePassword);
  const authorization = `Basic ${Buffer.from(`opencode:${gate.endpoint.password}`).toString('base64')}`;
  const options = { headers: { authorization } };
  assert.equal((await fetch(gate.endpoint.url)).status, 401);
  assert.equal((await fetch(gate.endpoint.url, options)).status, 503);
  const early = new WebSocket(gate.endpoint.url.replace('http:', 'ws:'), { headers: { authorization } });
  early.on('error', () => {});
  const [, refused] = await once(early, 'unexpected-response');
  assert.equal(refused.statusCode, 503); refused.resume(); early.terminate();
  const nonce = 'a'.repeat(64);
  assert.equal(await gate.prove(nonce), true);
  assert.equal((await fetch(`${gate.endpoint.url}/__turnlink_gate_challenge/${nonce}`)).status, 404);
  allowed = 'pending'; gate.activate();
  assert.equal((await fetch(gate.endpoint.url, options)).status, 503);
  assert.equal(revocations, 0, 'a request during preparation must not retire the gate');
  allowed = true;
  assert.equal(await (await fetch(gate.endpoint.url, options)).text(), 'native fixture');
  const response = await fetch(`${gate.endpoint.url}/stream`, options), reader = response.body.getReader();
  assert.match(Buffer.from((await reader.read()).value).toString(), /ready/);
  const ws = new WebSocket(gate.endpoint.url.replace('http:', 'ws:'), { headers: { authorization } });
  await once(ws, 'open');
  const message = once(ws, 'message'); ws.send('hello'); assert.equal(String((await message)[0]), 'hello');
  const closed = once(ws, 'close');
  allowed = false;
  await Promise.race([closed, delay(4000).then(() => { throw new Error('gate did not revoke websocket'); })]);
  assert.equal(revocations, 1);
  await assert.rejects(gate.prove(nonce), /OPENCODE_ENDPOINT_GATE_UNAVAILABLE/);
  assert.throws(() => gate.activate(), /OPENCODE_ENDPOINT_GATE_UNAVAILABLE/);
  await assert.rejects(reader.read());
  assert.equal((await fetch(gate.endpoint.url, options)).status, 503);
  await gate.close();
  assert.throws(() => gate.activate(), /OPENCODE_ENDPOINT_GATE_UNAVAILABLE/);
});

test('revocation during an in-flight authorization prevents forwarding', async t => {
  let forwarded = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const upstream = createServer((_request, response) => { forwarded++; response.end('unsafe'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gate = await createOpenCodeEndpointGate({ upstream: { url: `http://127.0.0.1:${upstream.address().port}`, password: 'native' },
    authorize: async () => { await waiting; return true; } });
  t.after(async () => { release(); await gate.close(); await new Promise(resolve => upstream.close(resolve)); });
  gate.activate();
  const authorization = `Basic ${Buffer.from(`opencode:${gate.endpoint.password}`).toString('base64')}`;
  const request = fetch(gate.endpoint.url, { headers: { authorization } }).then(response => response.status, () => 'closed');
  await delay(50); gate.revoke(); release();
  assert.throws(() => gate.activate(), /OPENCODE_ENDPOINT_GATE_UNAVAILABLE/);
  assert.ok([503, 'closed'].includes(await request));
  assert.equal(forwarded, 0);
});

test('gate refuses invalid upstream addresses and credentials', async () => {
  await assert.rejects(createOpenCodeEndpointGate({ upstream: { url: 'http://example.com:1234', password: 'x' }, authorize: async () => true }), /OPENCODE_ENDPOINT_GATE_UNAVAILABLE/);
  await assert.rejects(createOpenCodeEndpointGate({ upstream: { url: 'http://127.0.0.1:1234', password: '' }, authorize: async () => true }), /OPENCODE_ENDPOINT_GATE_UNAVAILABLE/);
});

test('concurrent requests share a bounded authorization observation', async t => {
  const upstream = createServer((_request, response) => response.end('ok'));
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let checks = 0;
  const gate = await createOpenCodeEndpointGate({ upstream: { url: `http://127.0.0.1:${upstream.address().port}`, password: 'native' },
    authorize: async () => { checks++; await delay(50); return true; } });
  t.after(async () => { await gate.close(); await new Promise(resolve => upstream.close(resolve)); });
  gate.activate();
  const authorization = `Basic ${Buffer.from(`opencode:${gate.endpoint.password}`).toString('base64')}`;
  const results = await Promise.all(Array.from({ length: 40 }, () => fetch(gate.endpoint.url, { headers: { authorization } })));
  assert.ok(results.every(response => response.status === 200));
  assert.equal(checks, 1, 'one burst must not trigger a broker observation per request');
});
