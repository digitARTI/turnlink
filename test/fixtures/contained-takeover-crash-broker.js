import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createBroker } from '../../src/broker.js';
import { atomicWrite } from '../../src/storage.js';
import { codexVerifierLease } from '../../src/codex-verifier-lease.js';

// Test-only verifier isolates broker persistence at the exact write boundary.
process.once('message', async config => {
  const verifier = async input => {
    const proof = { version: 1, hostId: input.hostId, agentId: input.grant.agentId, channel: input.grant.channel,
      transitionID: input.grant.id, oldReceiverHash: input.oldReceiverHash, targetReceiverHash: input.targetReceiverHash,
      previous: input.previous, successor: { ...input.previous, generation: randomUUID(),
        containerID: config.successor.containerID, operationID: config.successor.operationID }, previousLease: randomUUID(), currentLease: randomUUID() };
    Object.defineProperty(proof, codexVerifierLease, { value: { check: () => true, release: () => {} } });
    return proof;
  };
  Object.defineProperty(verifier, 'requiresLease', { value: true });
  const write = (path, data) => {
    let rotation = false;
    if (path.endsWith('/store.json')) try {
      rotation = Object.values(JSON.parse(data).bindings).some(binding => binding.ownerDrain?.phase === 'rotated');
    } catch {}
    if (rotation && config.phase === 'before') { writeFileSync(config.marker, 'before'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
    atomicWrite(path, data);
    if (rotation && config.phase === 'after') { writeFileSync(config.marker, 'after'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
  };
  const broker = createBroker({ directory: config.directory, port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), write,
    controlPlane: true, worktreeGrants: true, receiverHandoff: true, taskDispatch: true, worktreeTaskDispatch: true,
    ownerLeaseRequired: true, ownerEndpointDirectory: config.endpointDirectory, completionVerifier: async () => { throw new Error('fixture'); },
    ownerContainmentVerifier: async () => { throw new Error('fixture'); }, ownerTakeoverVerifier: verifier });
  await once(broker.server, 'listening'); process.send({ port: broker.server.address().port });
});
