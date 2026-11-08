import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createBroker } from '../../src/broker.js';
import { makeRemoteCodexCancellationVerifier } from '../../src/codex-cancellation-verifier-transport.js';

process.once('message', async ({ directory, path, secret }) => {
  try {
    const remote = makeRemoteCodexCancellationVerifier({ path, secret });
    const wrongSecret = makeRemoteCodexCancellationVerifier({ path, secret: '5'.repeat(64) });
    let entered;
    const verificationEntered = new Promise(resolve => { entered = resolve; });
    let completed;
    const verificationCompleted = new Promise(resolve => { completed = resolve; });
    let broker;
    process.on('message', async message => {
      if (message.verifierEntered) entered();
      if (message.verifierCompleted) completed();
      if (message.close) { await broker.close(); process.disconnect(); }
    });
    broker = createBroker({ directory, port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
      controlPlane: true, worktreeGrants: true, destinationCancellationVerifier: async input => {
        await assert.rejects(wrongSecret(input), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        await assert.rejects(remote({ ...input, hostId: 'other-host' }), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        await assert.rejects(remote({ ...input, receipt: { ...input.receipt, cancellationID: randomUUID() } }), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        const abandoned = new AbortController();
        const first = remote({ ...input, signal: AbortSignal.any([input.signal, abandoned.signal]) });
        await verificationEntered;
        await assert.rejects(remote(input), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        abandoned.abort();
        await assert.rejects(first, /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        // The native observation is still paused even though the socket closed.
        await assert.rejects(remote(input), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        process.send({ releaseVerifier: true });
        await verificationCompleted;
        let proof;
        for (let attempt = 0; attempt < 20 && !proof; attempt++) {
          try { proof = await remote(input); }
          catch (error) {
            if (attempt === 19 || input.signal.aborted) throw error;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
        }
        // The owner registration stays exclusively held after proof delivery,
        // until the gateway commits or refuses the settlement.
        await assert.rejects(remote(input), /DESTINATION_CANCELLATION_VERIFICATION_UNAVAILABLE/);
        return proof;
      } });
    await once(broker.server, 'listening');
    process.send({ port: broker.server.address().port });
  } catch (error) {
    console.error(error.stack); process.exitCode = 1; process.disconnect();
  }
});
