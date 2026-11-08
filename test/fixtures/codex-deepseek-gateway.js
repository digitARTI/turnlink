import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readPrivate } from '../../src/storage.js';
import { validateCredential } from '../../src/config.js';
import { filterCodexResponsesTools, readApprovedCodexControl } from '../../src/deepseek-tool-authorization.js';

// Synthetic test gateway: the child sees only a disposable local token. An
// provider receives only the four approved MCP tools; no shell tool is sent.
export async function startCodexDeepSeekGateway({ accessToken, authFile, approvedControlFile, approvedControlSha256, fetchImpl = fetch }) {
  validateCredential(accessToken);
  const approvedControl = approvedControlFile || approvedControlSha256 ? readApprovedCodexControl(approvedControlFile, approvedControlSha256) : undefined;
  const active = new Set(); let closed = false;
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${accessToken}`);
    if (closed || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(403).end(); return; }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'deepseek-flash', object: 'model' }] })); return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), 90000); res.once('close', () => controller.abort());
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('request too large'); chunks.push(chunk); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid request');
      payload.tools = filterCodexResponsesTools(payload.tools, approvedControl);
      payload.model = 'deepseek-flash';
      payload.max_output_tokens = Math.min(Number.isSafeInteger(payload.max_output_tokens) && payload.max_output_tokens > 0 ? payload.max_output_tokens : 4096, 4096);
      const auth = JSON.parse(readPrivate(authFile, 1024 * 1024));
      if (auth.deepseek?.type !== 'api' || typeof auth.deepseek.key !== 'string' || !auth.deepseek.key) throw new Error('credential unavailable');
      const upstream = await fetchImpl('https://api.deepseek.com/responses', { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.deepseek.key}` }, body: JSON.stringify(payload) });
      if (!upstream.ok || !upstream.body) { res.writeHead(502).end(); return; }
      res.writeHead(200, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
    } catch { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); }
    finally { clearTimeout(timer); active.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return Object.freeze({ port: server.address().port, close: async () => { if (closed) return; closed = true; for (const c of active) c.abort();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
}
