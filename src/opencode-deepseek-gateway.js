import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readPrivate } from './storage.js';
import { validateCredential } from './config.js';
import { assertAuthorizedToolCatalogue } from './deepseek-tool-authorization.js';

// Explicit test gateway: a private container token is distinct from the
// provider credential, and neither the URL nor the model comes from the guest.
export async function startDeepSeekTestGateway({ accessToken, authFile, fetchImpl = fetch }) {
  validateCredential(accessToken);
  const active = new Set(); let closed = false;
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${accessToken}`);
    if (closed || req.method !== 'POST' || req.url !== '/v1/chat/completions' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(403).end(); return;
    }
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), 120000);
    res.once('close', () => controller.abort());
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('request too large'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages) || body.messages.length > 128 ||
          body.messages.some(m => !m || typeof m !== 'object' || !(typeof m.content === 'string' || m.content === null ||
            (Array.isArray(m.content) && m.content.every(c => c?.type === 'text' && typeof c.text === 'string'))))) throw new Error('invalid body');
      // The default network path may only forward schemas explicitly approved
      // for this synthetic test. A custom transport is responsible for its own
      // equally strict filter, or can be a local deterministic fixture.
      if (fetchImpl === fetch && body.tools !== undefined) {
        if (!Array.isArray(body.tools)) throw new Error('invalid tool catalogue');
        if (body.tools.length) assertAuthorizedToolCatalogue(body.tools);
      }
      const auth = JSON.parse(readPrivate(authFile, 1024 * 1024));
      if (auth.deepseek?.type !== 'api' || typeof auth.deepseek.key !== 'string' || !auth.deepseek.key) throw new Error('credential unavailable');
      const upstream = await fetchImpl('https://api.deepseek.com/chat/completions', { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.deepseek.key}` },
        body: JSON.stringify({ ...body, model: 'deepseek-chat', max_tokens: Math.min(Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 ? body.max_tokens : 256, 256) }) });
      if (!upstream.ok || !upstream.body) { res.writeHead(502).end(); return; }
      res.writeHead(200, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
    } catch { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); }
    finally { clearTimeout(timer); active.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return Object.freeze({ port: server.address().port, close: async () => { if (closed) return; closed = true; for (const c of active) c.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
}
