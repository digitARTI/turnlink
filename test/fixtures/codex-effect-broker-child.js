import { existsSync, readFileSync } from 'node:fs';
import { createBroker } from '../../src/broker.js';
import { makeRemoteCodexEffectVerifier } from '../../src/codex-effect-verifier-transport.js';
import { atomicWrite } from '../../src/storage.js';
import { ControlStore } from '../../src/control/store.js';
const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (value.crashAfterAdapter) {
  const revoke = ControlStore.prototype.revokeAdapter;
  ControlStore.prototype.revokeAdapter = function(hostId, ...args) {
    const result = revoke.call(this, hostId, ...args);
    if (hostId === value.crashAfterAdapter) process.kill(process.pid, 'SIGKILL');
    return result;
  };
}
const broker = createBroker({ directory: value.directory, port: value.port, secret: '1'.repeat(64), adminSecret: '2'.repeat(64),
  controlPlane: true, worktreeGrants: true, receiverHandoff: true,
  codexEffectVerifier: makeRemoteCodexEffectVerifier({ path: value.socket, secret: value.secret }),
  write(path, data) {
    const already = existsSync(path) && readFileSync(path, 'utf8').includes('"replayUncertain":true');
    atomicWrite(path, data);
    if (value.crashOnReplay && !already && data.includes('"replayUncertain":true')) process.kill(process.pid, 'SIGKILL');
    if (value.crashAfterRevocation) {
      const state = JSON.parse(data), binding = state.bindings?.[value.crashAfterRevocation];
      if (state.codexEffectFence?.replayUncertain && binding?.revoked && !state.agents?.[value.crashAfterRevocation]) process.kill(process.pid, 'SIGKILL');
    }
    if (value.crashAfterHost && JSON.parse(data).hosts?.[value.crashAfterHost]?.revoked) process.kill(process.pid, 'SIGKILL');
  } });
broker.server.on('listening', () => process.send?.({ type: 'ready' }));
process.on('message', async message => { if (message?.type === 'close') { await broker.close(); process.exit(0); } });
