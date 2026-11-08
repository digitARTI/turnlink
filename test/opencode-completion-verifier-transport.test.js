import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { digest } from '../src/config.js';
import { placementReceiptID } from '../src/opencode-native-recovery.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { createOpenCodeCompletionVerifierServer, makeRemoteOpenCodeCompletionVerifier } from '../src/opencode-completion-verifier-transport.js';
import { createOpenCodeEndpointGate } from '../src/opencode-endpoint-gate.js';
import { publishEndpoint } from '../src/opencode-completion-owner.js';

const secret = '7'.repeat(64), unavailable = /NATIVE_COMPLETION_VERIFICATION_UNAVAILABLE/;
function sample() {
  const transitionID = randomUUID(), receiverKey = '8'.repeat(64), receiverHash = digest(receiverKey);
  const placement = { version: 1, sessionID: 'ses_fixture', transitionID, source: { directory: '/source' }, destination: { directory: '/destination' },
    projectID: 'fixture', eventID: 'evt_fixture', eventSeq: 1, archiveNonce: randomUUID(), stageNonce: randomUUID(), receiverHash, leaseIncarnation: randomUUID() };
  const grant = { id: transitionID, channel: 'dev', taskID: randomUUID(), agentId: 'opencode:ses_fixture', previewID: randomUUID(), claimGeneration: 1,
    from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64), status: 'moved', preparedAt: 1,
    settledAt: 2, actualLocation: '/destination', receiptID: placementReceiptID(placement) };
  const client = Object.assign(new EventEmitter(), { hostId: 'local', receiverKeys: new Map([[grant.agentId, receiverKey]]) });
  return { grant, client, receiverHash, proof: { version: 1, placement, leaseIncarnation: randomUUID() } };
}

for (const reason of ['abort', 'disconnected', 'membership_removed', 'native_closed']) {
  test(`OpenCode completion owner ${reason} revokes the outstanding lease`, { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock');
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
    const { grant, client, receiverHash, proof } = sample(), owner = new AbortController(), call = new AbortController();
    const native = new EventEmitter();
    native.observe = async () => proof;
    native.onClose = listener => { native.on('close', listener); return () => native.off('close', listener); };
    const unregister = service.register({ client, grant, recovery: native, signal: owner.signal });
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal });
    assert.deepEqual(result, proof); const lease = result[codexVerifierLease]; assert.equal(lease.check(), true);
    if (reason === 'abort') owner.abort(); else if (reason === 'native_closed') native.emit('close'); else client.emit(reason, { agentId: grant.agentId });
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    assert.throws(() => lease.check(), unavailable);
    unregister(); assert.equal(client.listenerCount('disconnected'), 0); assert.equal(client.listenerCount('membership_removed'), 0); assert.equal(native.listenerCount('close'), 0);
  });
}

test('OpenCode completion transport refuses absent owners, incorrect credentials and mismatched native proof',
  { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock');
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const { grant, client, receiverHash, proof } = sample(), owner = new AbortController(), signal = new AbortController().signal;
    const input = { grant, hostId: 'local', receiverHash, signal };
    const remote = makeRemoteOpenCodeCompletionVerifier({ path, secret });
    await assert.rejects(remote(input), unavailable);
    assert.throws(() => service.register({ client, grant, recovery: { observe: async () => proof, onClose: () => { throw new Error('closed'); } }, signal: owner.signal }), unavailable);
    assert.equal(client.listenerCount('disconnected'), 0);
    let value = { ...proof, placement: { ...proof.placement, receiverHash: 'f'.repeat(64) } };
    service.register({ client, grant, recovery: { observe: async () => value, onClose: () => () => {} }, signal: owner.signal });
    await assert.rejects(makeRemoteOpenCodeCompletionVerifier({ path, secret: '9'.repeat(64) })(input), unavailable);
    await assert.rejects(remote(input), unavailable);
    value = proof;
    await assert.rejects(remote({ ...input, receiverHash: 'c'.repeat(64) }), unavailable);
    const good = await remote(input); good[codexVerifierLease].release();
    owner.abort(); await assert.rejects(remote(input), unavailable);
  });

test('historical verifier uses the explicit released observation path',
  { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock');
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
    const { grant, client, receiverHash, proof } = sample(), owner = new AbortController(), call = new AbortController();
    let observed = 0;
    service.register({ client, grant, historical: true, signal: owner.signal,
      recovery: { observe: async () => { throw new Error('wrong path'); }, observeReleased: async () => { observed++; return proof; }, onClose: () => () => {} } });
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal });
    assert.equal(observed, 1); assert.deepEqual(result, proof); result[codexVerifierLease].release();
  });

test('readiness challenge proves a closed gate and rejects a replaced endpoint file',
  { skip: process.platform !== 'darwin', timeout: 10000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock'), file = join(root, 'endpoint.json');
    const upstream = createServer((_request, response) => response.end('native'));
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const gate = await createOpenCodeEndpointGate({ upstream: { url: `http://127.0.0.1:${upstream.address().port}`, password: 'native' }, authorize: async () => false });
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { await service.close(); await gate.close(); await new Promise(resolve => upstream.close(resolve)); rmSync(root, { recursive: true, force: true }); });
    const { grant, client, receiverHash, proof } = sample(), owner = new AbortController(), call = new AbortController();
    let removeEndpoint;
    service.register({ client, grant, signal: owner.signal, recovery: { observe: async () => proof, onClose: () => () => {} },
      health: async () => true, readiness: async nonce => !!removeEndpoint?.check() && await gate.prove(nonce) && removeEndpoint?.check() === true });
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal, retainOwner: true });
    const lease = result[codexVerifierLease]; assert.equal(lease.ready(), false);
    removeEndpoint = publishEndpoint(file, gate.endpoint);
    await new Promise(resolve => setTimeout(resolve, 1300)); assert.equal(lease.ready(), true);
    const auth = `Basic ${Buffer.from(`opencode:${gate.endpoint.password}`).toString('base64')}`;
    assert.equal((await fetch(gate.endpoint.url, { headers: { authorization: auth } })).status, 503);
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, 'modified in place'); await new Promise(resolve => setTimeout(resolve, 1300)); assert.equal(lease.ready(), false);
    writeFileSync(file, original); await new Promise(resolve => setTimeout(resolve, 1300)); assert.equal(lease.ready(), true);
    rmSync(file); writeFileSync(file, 'replacement');
    await new Promise(resolve => setTimeout(resolve, 1300)); assert.equal(lease.ready(), false);
    lease.release(); owner.abort();
  });

test('retained completion lease identifies the registration and reports owner loss',
  { skip: process.platform !== 'darwin', timeout: 12000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock');
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
    const { grant, client, receiverHash, proof } = sample(), owner = new AbortController(), call = new AbortController();
    const recovery = { observe: async () => proof, onClose: () => () => {} }; let ready = false, challenge, leaseClosed = 0;
    const unregister = service.register({ client, grant, recovery, signal: owner.signal, health: async () => true,
      readiness: async nonce => { challenge = nonce; return ready; }, onRetainedLeaseClose: () => { leaseClosed++; } });
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal, retainOwner: true });
    const lease = result[codexVerifierLease];
    assert.match(lease.ownerGeneration, /^[0-9a-f-]{36}$/);
    await new Promise(resolve => setTimeout(resolve, 3700));
    assert.equal(lease.check(), true, 'retention must outlive the one-shot verification deadline');
    assert.equal(lease.ready(), false);
    ready = true; await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(lease.ready(), true); assert.match(challenge, /^[a-f0-9]{64}$/);
    ready = false; await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(lease.ready(), false);
    unregister.authorizeRetry('b'.repeat(64));
    assert.equal(await lease.confirm('a'.repeat(64)), false);
    assert.equal(await lease.confirm('b'.repeat(64)), true);
    assert.equal(await lease.confirm('b'.repeat(64)), false, 'retry confirmation is one-use');
    const disconnected = new Promise(resolve => lease.onClose(resolve));
    unregister(); await disconnected;
    await new Promise(resolve => setImmediate(resolve)); assert.equal(leaseClosed, 1);
    assert.throws(() => lease.check(), unavailable);
    await new Promise(resolve => setImmediate(resolve));
    service.register({ client, grant, recovery, signal: owner.signal, health: async () => true });
    const next = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal, retainOwner: true });
    assert.notEqual(next[codexVerifierLease].ownerGeneration, lease.ownerGeneration);
    next[codexVerifierLease].release();
  });

test('retained completion lease expires when its owner stops responding',
  { skip: process.platform !== 'darwin', timeout: 15000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock');
    const { grant, receiverHash, proof } = sample(), call = new AbortController();
    const source = `import { EventEmitter } from 'node:events';
      import { createOpenCodeCompletionVerifierServer } from './src/opencode-completion-verifier-transport.js';
      const [path, secret, data] = process.argv.slice(1), { grant, proof } = JSON.parse(data);
      const client = Object.assign(new EventEmitter(), { hostId: 'local', receiverKeys: new Map([[grant.agentId, '8'.repeat(64)]]) });
      const service = await createOpenCodeCompletionVerifierServer({ path, secret });
      service.register({ client, grant, recovery: { observe: async () => proof, onClose: () => () => {} }, signal: new AbortController().signal, health: async () => true });
      process.stdout.write('ready\\n');`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, path, secret, JSON.stringify({ grant, proof })], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { child.kill('SIGCONT'); child.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); });
    const [ready] = await once(child.stdout, 'data'); assert.match(String(ready), /ready/);
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal, retainOwner: true });
    const lease = result[codexVerifierLease], closed = new Promise(resolve => lease.onClose(resolve));
    assert.equal(child.kill('SIGSTOP'), true);
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('owner heartbeat did not expire')), 7000))]);
    assert.throws(() => lease.check(), unavailable);
  });

test('retained completion lease expires when the separately checked native process hangs',
  { skip: process.platform !== 'darwin', timeout: 15000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlocv-'), path = join(root, 'v.sock');
    const native = spawn(process.execPath, ['-e', "require('node:http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',function(){process.stdout.write(String(this.address().port)+'\\n')})"], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { native.kill('SIGCONT'); native.kill('SIGKILL'); rmSync(root, { recursive: true, force: true }); });
    const [port] = await once(native.stdout, 'data');
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { native.kill('SIGCONT'); await service.close(); });
    const { grant, client, receiverHash, proof } = sample(), owner = new AbortController(), call = new AbortController();
    service.register({ client, grant, recovery: { observe: async () => proof, onClose: () => () => {} }, signal: owner.signal,
      health: async () => (await fetch(`http://127.0.0.1:${String(port).trim()}`, { signal: AbortSignal.timeout(6000) })).ok });
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })({ grant, hostId: 'local', receiverHash, signal: call.signal, retainOwner: true });
    const lease = result[codexVerifierLease], closed = new Promise(resolve => lease.onClose(resolve));
    assert.equal(native.kill('SIGSTOP'), true);
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('native heartbeat did not expire')), 7000))]);
    assert.throws(() => lease.check(), unavailable);
  });
