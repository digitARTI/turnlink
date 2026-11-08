import { readFileSync, writeFileSync } from 'node:fs';
import { launchOpenCodeNativeRecovery } from '../../src/opencode-native-recovery-launcher.js';
import { OpenCodeDestinationReceiver, openCodeMovementRpc } from '../../src/opencode-destination-receiver.js';
import { OpenCodeLiveMovementJournal } from '../../src/opencode-live-movement.js';
import { OpenCodeRecoveryJournal } from '../../src/opencode-recovery-journal.js';
import { OpenCodeLiveRecovery } from '../../src/opencode-live-recovery.js';
import { OpenCodeRecoveredDestinationJournal } from '../../src/opencode-recovered-destination-journal.js';

// Isolated acceptance fixture: die either before dispatch or after the broker
// accepts settlement but before the caller can update its write-ahead journal.
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const host = launchOpenCodeNativeRecovery({ runtime: config.runtime, entrypoint: config.entrypoint, database: config.database,
  sessionID: config.sessionID, source: { directory: config.source }, pluginID: 'turnlink', env: { ...process.env }, timeoutMs: 15000, serveCandidate: true });
try {
  const endpoint = await host.ready;
  writeFileSync(config.pidFile, String(host.pid), { mode: 0o600 });
  const rpc = openCodeMovementRpc({ ...endpoint, directory: config.destination, timeoutMs: 15000 });
  const receiver = new OpenCodeDestinationReceiver({ rpc: async (method, input) => {
    if (config.crashBefore && method === 'request' && input.method === 'settlePlacement') process.kill(process.pid, 'SIGKILL');
    const result = await rpc(method, input);
    if (method === 'request' && input.method === 'settlePlacement') process.kill(process.pid, 'SIGKILL');
    return result;
  }, token: async () => readFileSync(config.movementTokenFile, 'utf8').trim(),
  credential: async () => readFileSync(config.adapterTokenFile, 'utf8').trim(), grant: config.grant, credentialDirectory: config.credentialDirectory });
  await receiver.resume();
  const liveJournal = new OpenCodeLiveMovementJournal('local', config.grant.agentId, config.liveJournalDirectory);
  const journal = new OpenCodeRecoveryJournal('local', config.grant.agentId, config.recoveryJournalDirectory);
  const destinationJournal = config.destinationJournalDirectory ?
    new OpenCodeRecoveredDestinationJournal('local', config.grant.agentId, config.destinationJournalDirectory) : undefined;
  const recovery = new OpenCodeLiveRecovery({ client: receiver, credential: async () => readFileSync(config.adapterTokenFile, 'utf8').trim(),
    recovery: host.recovery, journal, liveJournal, destinationJournal, sessionID: config.sessionID, channel: config.grant.channel });
  if ((await recovery.reconcile(config.grant)).status !== 'observed') throw new Error('Fixture recovery not observed');
  await recovery.takeover(config.grant);
  await recovery.settlePlacement(config.grant);
  throw new Error('Fixture did not terminate at settlement boundary');
} catch (error) {
  await host.close();
  console.error(error?.stack || 'Fixture failed');
  process.exitCode = 1;
}
