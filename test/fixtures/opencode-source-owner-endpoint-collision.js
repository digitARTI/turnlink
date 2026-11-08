import { readFileSync, writeFileSync } from 'node:fs';
import { OpenCodeDestinationReceiver } from '../../src/opencode-destination-receiver.js';
import { startOpenCodeSourceRecoveryOwner } from '../../src/opencode-source-recovery-owner.js';

const [configFile] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configFile, 'utf8'));
let injected = false;
const request = OpenCodeDestinationReceiver.prototype.request;
OpenCodeDestinationReceiver.prototype.request = async function (method, ...args) {
  const result = await request.call(this, method, ...args);
  if (method === 'control_receiver_release_verified') {
    writeFileSync(config.endpointFile, 'external collision', { mode: 0o600, flag: 'wx' });
    injected = true;
  }
  return result;
};
try {
  const owner = await startOpenCodeSourceRecoveryOwner(config);
  await owner.close();
  throw new Error('Collision did not refuse endpoint publication');
} catch (error) {
  if (!injected || error?.code !== 'OPENCODE_SOURCE_OWNER_UNAVAILABLE') throw error;
}
