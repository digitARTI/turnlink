import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync, lstatSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createOpenCodeCompletionVerifierServer } from '../../src/opencode-completion-verifier-transport.js';

void (async () => {
  const { generation, secret, grant, receiverKey, proof, endpointFixture } = JSON.parse(process.argv[2]);
  mkdirSync('/tmp/verifiers', { mode: 0o700 });
  let readiness;
  if (endpointFixture) {
    mkdirSync('/tmp/endpoints', { mode: 0o700 });
    const password = 'g'.repeat(43), authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    const server = createServer((request, response) => {
      if (request.headers.authorization !== authorization) { response.writeHead(401).end(); return; }
      response.writeHead(200, { 'content-type': 'text/plain' });
      if (request.url === '/stream') { response.write('open'); return; }
      response.end('guest-gate');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const file = join('/tmp/endpoints', `turnlink-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({ version: 1, url: `http://127.0.0.1:${server.address().port}`, password }), { mode: 0o600 });
    readiness = async () => { const stat = lstatSync(file), bytes = readFileSync(file); return {
      name: file.slice(file.lastIndexOf('/') + 1), device: String(stat.dev), inode: String(stat.ino), digest: createHash('sha256').update(bytes).digest('hex') }; };
  }
  const service = await createOpenCodeCompletionVerifierServer({ path: join('/tmp/verifiers', `${generation}.sock`), secret });
  const client = Object.assign(new EventEmitter(), { hostId: 'local', receiverKeys: new Map([[grant.agentId, receiverKey]]) });
  service.register({ client, grant, ownerGeneration: generation, signal: new AbortController().signal, health: async () => true, ...(readiness ? { readiness } : {}),
    recovery: { observe: async () => proof, onClose: () => () => {} } });
  console.log('READY');
})();
