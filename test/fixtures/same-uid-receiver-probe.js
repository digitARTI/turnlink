import { readFileSync } from 'node:fs';
import { ChannelClient } from '../../src/client.js';

// Test-only: all credentials belong to the disposable fixture. Never print them.
const fixture = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const client = new ChannelClient({ url: fixture.url, token: fixture.hostToken, credentialDirectory: fixture.credentialDirectory });
try {
  if (process.geteuid() !== fixture.uid) throw new Error('different uid');
  await client.resumeReceiverHandoff(fixture.agentId, fixture.transitionID);
  const held = await client.observeReceiverHandoff(fixture.agentId, fixture.adapterToken, fixture.transitionID, 'dev');
  if (held.status !== 'held' || held.transitionID !== fixture.transitionID) throw new Error('not held');
  process.stdout.write('same-uid receiver resumed with exact held grant\n');
} catch { process.stderr.write('same-uid probe failed\n'); process.exitCode = 1; }
finally { client.close(); }
