import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDeepSeekTestGateway } from '../src/opencode-deepseek-gateway.js';

test('DeepSeek gateway keeps the provider key on the host and fixes the upstream destination', async t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-gateway-')), authFile = join(root, 'auth.json'), token = 'a'.repeat(64);
  writeFileSync(authFile, JSON.stringify({ deepseek: { type: 'api', key: 'private-test-key' } }), { mode: 0o600 });
  const requests = [];
  const gateway = await startDeepSeekTestGateway({ accessToken: token, authFile, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return new Response('data: fixture\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  t.after(async () => { await gateway.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${gateway.port}`, request = (path, bearer, body) => fetch(base + path, { method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { model: 'attacker-model', max_tokens: 9999, stream: true, messages: [{ role: 'user', content: 'synthetic' }] };
  assert.equal((await request('/v1/chat/completions', 'b'.repeat(64), body)).status, 403);
  assert.equal((await request('/other', token, body)).status, 403);
  assert.equal((await request('/v1/chat/completions', token, { messages: [{ content: [{ type: 'image_url', image_url: { url: 'https://example.invalid' } }] }] })).status, 502);
  const result = await request('/v1/chat/completions', token, body);
  assert.equal(await result.text(), 'data: fixture\n\n');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.authorization, 'Bearer private-test-key');
  const forwarded = JSON.parse(requests[0].options.body);
  assert.equal(forwarded.model, 'deepseek-chat'); assert.equal(forwarded.max_tokens, 256);
  assert.ok(!JSON.stringify(forwarded).includes('private-test-key'));
});

test('default network gateway rejects unapproved tool schemas before upstream dispatch', async t => {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-gateway-policy-')), authFile = join(root, 'auth.json'), token = 'a'.repeat(64);
  writeFileSync(authFile, JSON.stringify({ deepseek: { type: 'api', key: 'private-test-key' } }), { mode: 0o600 });
  const originalFetch = globalThis.fetch; let upstream = 0;
  globalThis.fetch = async () => { upstream++; return new Response('data: fixture\n\n', { headers: { 'content-type': 'text/event-stream' } }); };
  let gateway;
  try {
    gateway = await startDeepSeekTestGateway({ accessToken: token, authFile });
    const request = body => originalFetch(`http://127.0.0.1:${gateway.port}/v1/chat/completions`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const body = { messages: [{ role: 'user', content: 'synthetic' }] };
    const blocked = await request({ ...body, tools: [{ type: 'function', function: { name: 'channel_control' } }] });
    assert.equal(blocked.status, 502); assert.equal(upstream, 0);
    const allowed = await request(body); assert.equal(allowed.status, 200); assert.equal(await allowed.text(), 'data: fixture\n\n');
    assert.equal(upstream, 1);
  } finally { await gateway?.close(); globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); }
});
