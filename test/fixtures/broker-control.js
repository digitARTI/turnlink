import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// Test-only, loopback-only observation. This endpoint cannot mutate a broker
// and never exports credentials, receiver hashes, or the full store.
export async function startFixtureBrokerControl({ broker, secret }) {
  if (!/^[a-f0-9]{64}$/.test(secret) || !broker?.store) throw new Error('Invalid fixture control');
  const expected = Buffer.from(secret);
  const server = createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization || '');
    const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (valid && req.method === 'GET' && req.url === '/v1/snapshot') {
      const bindings = Object.fromEntries(Object.entries(broker.store.bindings).map(([id, binding]) => [id, {
        ...(binding.receiverHandoff ? { receiverHandoff: { status: binding.receiverHandoff.status, sourceDetached: binding.receiverHandoff.sourceDetached === true,
          ...(binding.receiverHandoff.nativeCompletion ? { nativeCompletion: { receiptID: binding.receiverHandoff.nativeCompletion.receiptID } } : {}) } } : {}),
        ...(binding.ownerDrain ? { ownerDrain: { phase: binding.ownerDrain.phase, ...(binding.ownerDrain.containment ? { containment: binding.ownerDrain.containment } : {}) } } : {}) } ]));
      const messages = (broker.store.messages || []).map(message => ({ messageId: message.messageId, delivered: message.delivered, offered: message.offered }));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ bindings, messages })); return;
    }
    const match = /^\/v1\/receiver\/([A-Za-z0-9:_-]{1,256})$/.exec(req.url || '');
    if (!valid || req.method !== 'GET' || !match) { res.writeHead(404).end(); return; }
    const binding = broker.store.bindings[match[1]], handoff = binding?.receiverHandoff, drain = binding?.ownerDrain;
    const result = { exists: !!binding, handoff: handoff ? { status: handoff.status, sourceDetached: handoff.sourceDetached === true,
      transitionID: handoff.transitionID } : null, drain: drain ? { phase: drain.phase, nextTransitionID: drain.nextTransitionID } : null };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(result));
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxHeadersCount = 16;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return Object.freeze({ port: server.address().port, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) });
}
