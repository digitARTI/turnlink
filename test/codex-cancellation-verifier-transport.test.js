import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { EventEmitter, once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodexCancellationVerifierServer, makeRemoteCodexCancellationVerifier } from '../src/codex-cancellation-verifier-transport.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { CodexNativeControl } from '../src/codex-native-control.js';
import { CodexResourceJournal } from '../src/codex-resource-journal.js';

const secret = '4'.repeat(64);
const unavailable = /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/;
const tempRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();

for (const reason of ['abort', 'disconnected', 'membership_removed']) {
  test(`owner ${reason} revokes an outstanding verifier registration`,
    { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
      const directory = mkdtempSync(join(tempRoot, 'tlcv-owner-')), path = join(directory, 'v.sock');
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const server = await createCodexCancellationVerifierServer({ path, secret });
      t.after(() => server.close());
      const request = input(), owner = new AbortController(), { grant, receipt } = request;
      grant.destinationOwners = { mcpTransitionID: randomUUID(), providerTransitionID: randomUUID(),
        mcpResourceID: randomUUID(), providerResourceID: randomUUID(), stepID: receipt.stepID };
      const client = Object.assign(new EventEmitter(), { hostId: request.hostId, closed: false,
        subscriptions: new Set([grant.agentId]), activeSubscriptions: new Set([grant.agentId]) });
      const native = Object.create(CodexNativeControl.prototype);
      native.usesClient = value => value === client;
      native.observeDestinationGrantCancellation = async () => receipt;
      const journal = Object.create(CodexResourceJournal.prototype);
      Object.defineProperties(journal, { hostId: { value: request.hostId }, agentId: { value: grant.agentId } });
      journal.entries = () => [{ transitionID: grant.destinationOwners.mcpTransitionID, plan: { reservation: {} },
        step: { receipt: { stepID: receipt.stepID }, movement: { phase: 'settling', grant,
          cancellationReceipt: receipt, settlementID: randomUUID() } } }];
      const settlementID = randomUUID();
      const entries = journal.entries;
      journal.entries = () => { const rows = entries(); rows[0].step.movement.settlementID = settlementID; return rows; };
      const unregister = server.register({ native, journal, client, guard() {}, signal: owner.signal, grant });
      const proof = await makeRemoteCodexCancellationVerifier({ path, secret })(request);
      const lease = proof[codexVerifierLease]; lease.check();
      if (reason === 'abort') owner.abort(); else client.emit(reason, { agentId: grant.agentId });
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      assert.throws(() => lease.check(), unavailable);
      unregister();
      assert.equal(client.listenerCount('disconnected'), 0);
      assert.equal(client.listenerCount('membership_removed'), 0);
    });
}
function input() {
  const id = randomUUID(), stepID = randomUUID();
  return { hostId: 'local', signal: new AbortController().signal,
    grant: { id, channel: 'dev', taskID: randomUUID(), agentId: `codex:${randomUUID()}`, previewID: randomUUID(),
      claimGeneration: 1, from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64),
      authorityDigest: 'b'.repeat(64), status: 'prepared', preparedAt: 1 },
    receipt: { transitionID: id, stepID, cancellationID: randomUUID() } };
}

test('protected verifier rejects missing owners, wrong keys, aborted calls and duplicate listeners', { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = await createCodexCancellationVerifierServer({ path, secret });
  t.after(() => server.close());
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  await assert.rejects(createCodexCancellationVerifierServer({ path, secret }), /EADDRINUSE/);
  const remote = makeRemoteCodexCancellationVerifier({ path, secret });
  const wrong = makeRemoteCodexCancellationVerifier({ path, secret: '5'.repeat(64) });
  await assert.rejects(remote(input()), unavailable);
  await assert.rejects(wrong(input()), unavailable);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(remote({ ...input(), signal: stopped.signal }), unavailable);
  await server.close();
  assert.equal(existsSync(path), false);
  await assert.rejects(remote(input()), unavailable);
});

test('protected verifier refuses insecure directories and oversized frames', { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  chmodSync(directory, 0o755);
  await assert.rejects(createCodexCancellationVerifierServer({ path, secret }), unavailable);
  chmodSync(directory, 0o700);
  writeFileSync(path, 'existing file', { mode: 0o600 });
  await assert.rejects(createCodexCancellationVerifierServer({ path, secret }));
  assert.equal(readFileSync(path, 'utf8'), 'existing file');
  rmSync(path);
  const server = await createCodexCancellationVerifierServer({ path, secret });
  t.after(() => server.close());
  const socket = createConnection(path);
  socket.on('error', () => {});
  socket.resume();
  await once(socket, 'connect');
  const closed = once(socket, 'close');
  socket.write(Buffer.alloc(128 * 1024 + 1, 0x61));
  await closed;
});

test('closing the verifier aborts live connections and repeated close waits for teardown', { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = await createCodexCancellationVerifierServer({ path, secret });
  const socket = createConnection(path); socket.on('error', () => {}); socket.resume();
  await once(socket, 'connect');
  const closed = once(socket, 'close');
  await Promise.all([server.close(), server.close(), closed]);
  assert.equal(existsSync(path), false);
});

test('verifier shutdown preserves a replacement file at the socket path', { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = await createCodexCancellationVerifierServer({ path, secret });
  rmSync(path); writeFileSync(path, 'replacement', { mode: 0o600 });
  await server.close();
  assert.equal(readFileSync(path, 'utf8'), 'replacement');
});

test('broker-side abort closes a pending verifier connection', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let received;
  const requestReceived = new Promise(resolve => { received = resolve; });
  const server = createServer(socket => {
    socket.on('error', () => {}); socket.write(`${JSON.stringify({ challenge: 'a'.repeat(64) })}\n`);
    socket.once('data', () => received(socket));
  });
  server.listen(path); await once(server, 'listening'); chmodSync(path, 0o600);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const controller = new AbortController(), remote = makeRemoteCodexCancellationVerifier({ path, secret });
  const result = remote({ ...input(), signal: controller.signal });
  const socket = await requestReceived, closed = once(socket, 'close');
  controller.abort();
  await assert.rejects(result, unavailable); await closed;
});

test('verified proof holds the connection until release and abort revokes it', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sockets = [];
  const server = createServer(socket => {
    sockets.push(socket); socket.on('error', () => {});
    const nonce = 'a'.repeat(64);
    socket.write(`${JSON.stringify({ challenge: nonce })}\n`);
    socket.once('data', data => {
      const request = JSON.parse(data.toString());
      const payload = { id: request.payload.id, proof: request.payload.receipt };
      const mac = createHmac('sha256', Buffer.from(secret, 'hex')).update('response').update('\0').update(nonce)
        .update('\0').update(JSON.stringify(payload)).digest('hex');
      socket.write(`${JSON.stringify({ payload, mac })}\n`);
    });
  });
  server.listen(path); await once(server, 'listening'); chmodSync(path, 0o600);
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => server.close(resolve)); });
  const remote = makeRemoteCodexCancellationVerifier({ path, secret });
  const firstInput = input(), proof = await remote(firstInput), lease = proof[codexVerifierLease];
  assert.deepEqual(proof, firstInput.receipt); assert.equal(sockets[0].destroyed, false);
  lease.check(); const firstClosed = once(sockets[0], 'close'); lease.release(); await firstClosed;
  assert.throws(() => lease.check(), unavailable);
  const controller = new AbortController(), second = await remote({ ...input(), signal: controller.signal });
  const secondClosed = once(sockets[1], 'close'); controller.abort(); await secondClosed;
  assert.throws(() => second[codexVerifierLease].check(), unavailable);
});

test('broker rejects a forged verifier response', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tempRoot, 'tlcvtest-')), path = join(directory, 'v.sock');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const server = createServer(socket => {
    socket.on('error', () => {}); socket.write(`${JSON.stringify({ challenge: 'a'.repeat(64) })}\n`);
    let buffer = '';
    socket.on('data', data => {
      buffer += data.toString();
      if (!buffer.includes('\n')) return;
      const frame = JSON.parse(buffer);
      socket.end(`${JSON.stringify({ payload: { id: frame.payload.id, proof: frame.payload.receipt }, mac: '0'.repeat(64) })}\n`);
    });
  });
  server.listen(path); await once(server, 'listening'); chmodSync(path, 0o600);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(makeRemoteCodexCancellationVerifier({ path, secret })(input()), unavailable);
});
