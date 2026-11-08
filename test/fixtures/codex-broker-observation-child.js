import { createServer } from 'node:net';
import { chmodSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createBroker } from '../../src/broker.js';
import { createCodexContainedOwner } from '../../src/codex-contained-owner.js';
import { attachCodexBrokerGrantBridge } from '../../src/codex-broker-grant-bridge.js';

// Fixture only: IPC inherits its descriptor from the test parent. It does not
// authenticate a production peer or allow dispatch.
let broker, owner, bridge, nativeBridge, savedOptions; const observations = new Map();
process.on('message', async message => {
  try {
    if (message.type === 'start') {
      const { options, directory, port, bridgePath } = message;
      savedOptions = options; owner = createCodexContainedOwner(options);
      broker = createBroker({ directory, port, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
        controlPlane: true, worktreeGrants: true, receiverHandoff: true, codexEffectArbiter: owner });
      broker.server.once('listening', () => {
        if (!bridgePath) { process.send?.({ type: 'ready' }); return; }
        bridge = createServer(socket => {
          try { attachCodexBrokerGrantBridge({ stream: socket, owner, grant: options.grant,
            effectID: options.effectID, resourceID: options.resourceID, kind: options.kind }); }
          catch { socket.destroy(); }
        });
        bridge.listen(bridgePath, () => { chmodSync(bridgePath, 0o600); process.send?.({ type: 'ready' }); });
      });
    } else if (message.type === 'launch-inherited') {
      const logFD = openSync(message.logPath, 'wx', 0o600);
      try {
        const digest = createHash('sha256').update(JSON.stringify(savedOptions.grant)).digest('hex');
        nativeBridge = spawn(message.executable, [digest, savedOptions.grant.id, savedOptions.effectID, savedOptions.resourceID, savedOptions.kind],
          { stdio: ['ignore', logFD, logFD, 'pipe'] });
      } finally { closeSync(logFD); }
      nativeBridge.on('error', () => process.send?.({ type: 'bridge-unavailable' }));
      attachCodexBrokerGrantBridge({ stream: nativeBridge.stdio[3], owner, grant: savedOptions.grant,
        effectID: savedOptions.effectID, resourceID: savedOptions.resourceID, kind: savedOptions.kind });
      process.send?.({ type: 'bridge-started', pid: nativeBridge.pid });
    } else if (message.type === 'acquire') {
      const observation = owner.acquireBrokerObservation(message.scope);
      observation.onInvalidate(() => process.send?.({ type: 'invalidated', id: message.id }));
      observations.set(message.id, observation); process.send?.({ type: 'acquired', id: message.id, dispatchAvailable: observation.dispatchAvailable });
    } else if (message.type === 'check') {
      const observation = observations.get(message.id); process.send?.({ type: 'checked', id: message.id, valid: observation?.check() === true });
    } else if (message.type === 'close') {
      await broker.close(); await owner.revoke(); process.exit(0);
    }
  } catch { process.send?.({ type: 'unavailable', id: message.id }); }
});
