import { readFileSync, writeFileSync } from 'node:fs';
import { OpenCodeLiveRecovery } from '../../src/opencode-live-recovery.js';
import { OpenCodeDestinationReceiver } from '../../src/opencode-destination-receiver.js';
import { OpenCodeNativeRecovery } from '../../src/opencode-native-recovery.js';
import { startOpenCodeSourceRecoveryOwner } from '../../src/opencode-source-recovery-owner.js';

const [configFile, marker, phase = 'settlement'] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, 'utf8'));
let moved;
const stop = () => {
  const nativePid = process._getActiveHandles().find(handle => Number.isSafeInteger(handle.pid) && handle.pid > 0)?.pid;
  writeFileSync(marker, JSON.stringify({ transitionID: moved?.id ?? config.grant.id, nativePid, ...(moved ? { receiptID: moved.receiptID } : {}) }), { mode: 0o600 });
  process.kill(process.pid, 'SIGKILL');
};
const commit = OpenCodeNativeRecovery.prototype.commitPreparedPlacement;
OpenCodeNativeRecovery.prototype.commitPreparedPlacement = async function (...args) {
  if (phase === 'commit-before') stop();
  return commit.apply(this, args);
};
const settle = OpenCodeLiveRecovery.prototype.settlePlacement;
OpenCodeLiveRecovery.prototype.settlePlacement = async function (...args) {
  moved = await settle.apply(this, args);
  if (phase === 'settlement') stop();
  return moved;
};
const complete = OpenCodeLiveRecovery.prototype.completePlacement;
OpenCodeLiveRecovery.prototype.completePlacement = async function (...args) {
  const result = await complete.apply(this, args);
  if (phase === 'completion') stop();
  return result;
};
const request = OpenCodeDestinationReceiver.prototype.request;
OpenCodeDestinationReceiver.prototype.request = async function (method, ...args) {
  const result = await request.call(this, method, ...args);
  if (phase === 'release' && method === 'control_receiver_release_verified') stop();
  return result;
};
await startOpenCodeSourceRecoveryOwner(config);
throw new Error('Fixture did not stop at requested phase');
