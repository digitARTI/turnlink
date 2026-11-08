import { OpenCodeContainedOwner } from '../../src/opencode-contained-owner.js';
import { createContainedOpenCodeBrokerTunnel } from '../../src/opencode-container-broker-tunnel.js';

// Test-only host process. The broker and the recovery observer remain in the
// parent; killing this process severs the original owner's transport.
process.once('message', async config => {
  try {
    const owner = new OpenCodeContainedOwner(config.owner);
    const tunnels = [];
    for (const [brokerPort, containerPort] of config.ports) {
      tunnels.push(await createContainedOpenCodeBrokerTunnel({ owner, docker: config.owner.docker, ...config.identity,
        brokerPort, containerPort, muxPath: '/code/src/opencode-container-mux.js' }));
    }
    process.send({ ready: true });
    process.on('disconnect', () => { for (const tunnel of tunnels) tunnel.close(); owner.close(); });
  } catch { process.send?.({ error: 'SUPERVISOR_UNAVAILABLE' }); process.exitCode = 1; }
});
