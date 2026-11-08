import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../src/config.js';
import { placementReceiptID } from '../src/opencode-native-recovery.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';
import { localVerifierTransport } from '../src/codex-cancellation-verifier-transport.js';
import { createOpenCodeCompletionVerifierServer, makeRemoteOpenCodeCompletionVerifier } from '../src/opencode-completion-verifier-transport.js';

test('Linux abstract verifier authenticates and preserves a replacement pathname',
  { skip: process.platform !== 'linux' || process.env.TURNLINK_LINUX_ABSTRACT_VERIFIERS !== '1', timeout: 15000 }, async t => {
    const root = mkdtempSync('/private/tmp/tlabs-'), path = join(root, 'verifier.sock'), secret = '7'.repeat(64);
    const service = await createOpenCodeCompletionVerifierServer({ path, secret });
    t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
    await assert.rejects(createOpenCodeCompletionVerifierServer({ path, secret }));
    const transitionID = randomUUID(), receiverKey = '8'.repeat(64), receiverHash = digest(receiverKey);
    const placement = { version: 1, sessionID: 'ses_fixture', transitionID, source: { directory: '/source' }, destination: { directory: '/destination' },
      projectID: 'fixture', eventID: 'evt_fixture', eventSeq: 1, archiveNonce: randomUUID(), stageNonce: randomUUID(), receiverHash, leaseIncarnation: randomUUID() };
    const grant = { id: transitionID, channel: 'dev', taskID: randomUUID(), agentId: 'opencode:ses_fixture', previewID: randomUUID(), claimGeneration: 1,
      from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64), status: 'moved', preparedAt: 1,
      settledAt: 2, actualLocation: '/destination', receiptID: placementReceiptID(placement) };
    const client = Object.assign(new EventEmitter(), { hostId: 'local', receiverKeys: new Map([[grant.agentId, receiverKey]]) });
    const proof = { version: 1, placement, leaseIncarnation: randomUUID() }, owner = new AbortController();
    service.register({ client, grant, recovery: { observe: async () => proof, onClose: () => () => {} }, signal: owner.signal });
    const input = { grant, hostId: 'local', receiverHash, signal: new AbortController().signal };
    await assert.rejects(makeRemoteOpenCodeCompletionVerifier({ path, secret: '9'.repeat(64) })(input));
    const result = await makeRemoteOpenCodeCompletionVerifier({ path, secret })(input); assert.deepEqual(result, proof);
    const lease = result[codexVerifierLease]; assert.equal(lease.check(), true);
    writeFileSync(path, 'unrelated replacement');
    owner.abort(); let revoked = false;
    for (let i = 0; i < 100 && !revoked; i++) { try { lease.check(); await new Promise(resolve => setTimeout(resolve, 10)); } catch { revoked = true; } }
    assert.equal(revoked, true, 'the retained connection must be revoked after the owner closes');
    await service.close(); assert.equal(readFileSync(path, 'utf8'), 'unrelated replacement');
    const attacker = createServer(socket => { socket.write('{"challenge":"' + 'a'.repeat(64) + '"}\n'); setTimeout(() => socket.destroy(), 50); });
    await new Promise((resolve, reject) => { attacker.once('error', reject); attacker.listen(localVerifierTransport.socketPath(path), resolve); });
    try { await assert.rejects(makeRemoteOpenCodeCompletionVerifier({ path, secret })(input)); }
    finally { await new Promise(resolve => attacker.close(resolve)); }
  });
