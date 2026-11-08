import assert from 'node:assert/strict';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { launchOpenCodeNativeRecovery } from '../../src/opencode-native-recovery-launcher.js';
import { createOpenCodeTakeoverVerifierServer } from '../../src/opencode-takeover-verifier-transport.js';
import { OpenCodeRecoveryJournal } from '../../src/opencode-recovery-journal.js';

// Run inside the successor against the same VM volume; no SQLite bytes leave it.
const base = '/var/lib/turnlink/tmp';
const roots = readdirSync(base).filter(name => name.startsWith('turnlink-native-live-handoff-'));
assert.equal(roots.length, 1);
const root = join(base, roots[0]);
const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
  XDG_CACHE_HOME: join(root, 'cache'), OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FFF: '1',
  OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_FILEWATCHER_DISABLE: '1' };
const native = launchOpenCodeNativeRecovery({ runtime: '/usr/local/bin/turnlink-bun',
  entrypoint: resolve('.native-runtimes/opencode/packages/cli/src/native-recovery-host.ts'), database: join(root, 'movement.sqlite'),
  sessionID: 'ses_movement', pluginID: 'turnlink', source: { directory: join(root, 'destination') }, env, timeoutMs: 15000 });
let service; const controller = new AbortController();
try {
  let config, journal;
  if (process.argv.includes('--serve')) {
    const reader = createInterface({ input: process.stdin, terminal: false });
    const [line] = await once(reader, 'line'); config = JSON.parse(line); reader.close();
    journal = new OpenCodeRecoveryJournal('local', 'opencode:ses_movement', join(root, 'recovery-journal'));
  }
  const intent = await native.recovery.inspect();
  const observed = await native.recovery.observeRecoveryRecord();
  let claim, reconciled = false;
  if (journal) {
    const saved = await journal.exclusive(() => journal.get(intent.transitionID));
    if (!saved) {
      if (observed.recovery) throw new Error('Recovery claim requires journal reconciliation');
      await journal.exclusive(() => journal.put({ grant: config.grant, pluginID: 'turnlink', phase: 'claiming' }));
      try {
        claim = await native.recovery.claimRecovery(intent.transitionID);
        if (config.dropClaimReply) throw new Error('Fixture dropped native claim reply');
        await journal.exclusive(() => journal.put({ grant: config.grant, pluginID: 'turnlink', phase: 'claimed', claim }));
      } catch (error) {
        await journal.exclusive(() => journal.put({ grant: config.grant, pluginID: 'turnlink', phase: 'uncertain' }));
        throw error;
      }
    } else {
      if (saved.phase !== 'uncertain' || JSON.stringify(saved.grant) !== JSON.stringify(config.grant) || !observed.recovery)
        throw new Error('Recovery claim remains unresolved');
      const pending = { grant: config.grant, pluginID: 'turnlink', phase: 'observed', claim: observed.recovery, observedByLease: observed.currentLease };
      reconciled = true;
      await journal.exclusive(() => { journal.put(pending); journal.put({ ...pending, phase: 'taking' }); });
      try {
        claim = await native.recovery.takeoverRecovery(observed.recovery, observed.currentLease);
        await journal.exclusive(() => journal.put({ grant: config.grant, pluginID: 'turnlink', phase: 'claimed', claim }));
      } catch (error) {
        await journal.exclusive(() => journal.put({ ...pending, phase: 'takeover-uncertain' }));
        throw error;
      }
    }
  } else claim = observed.recovery ? await native.recovery.takeoverRecovery(observed.recovery, observed.currentLease) :
    await native.recovery.claimRecovery(intent.transitionID);
  assert.notEqual(claim.leaseIncarnation, intent.leaseIncarnation);
  const inspection = await native.recovery.inspectRecovery();
  const transport = await native.recovery.observeRecoveryTransport();
  assert.equal(transport.intent.transitionID, intent.transitionID);
  assert.equal(transport.recovery.leaseIncarnation, claim.leaseIncarnation);
  assert.ok(inspection.unresolved.length > 0);
  if (process.argv.includes('--serve')) {
    mkdirSync('/tmp/turnlink-takeover', { recursive: true, mode: 0o700 });
    service = await createOpenCodeTakeoverVerifierServer({ path: `/tmp/turnlink-takeover/${config.successor.generation}.sock`,
      secret: config.secret, native: native.recovery, grant: config.grant, hostId: 'local', successor: config.successor, signal: controller.signal });
    process.stdout.write(`${JSON.stringify({ ready: true, reconciled })}\n`);
    await Promise.race([new Promise(resolve => { process.stdin.resume(); process.stdin.once('end', resolve); process.stdin.once('close', resolve); }),
      native.exit.then(() => { throw new Error('NATIVE_RECOVERY_LEASE_CLOSED'); })]);
  } else process.stdout.write(`${JSON.stringify({ transitionID: intent.transitionID, newLease: true, previousLease: intent.leaseIncarnation,
    currentLease: claim.leaseIncarnation, unresolved: inspection.unresolved.length, transport: transport.release.family })}\n`);
  if (process.argv.includes('--hold')) {
    const inputClosed = new Promise(resolve => { process.stdin.resume(); process.stdin.once('end', resolve); process.stdin.once('close', resolve); });
    const exited = native.exit.then(() => { throw new Error('NATIVE_RECOVERY_LEASE_CLOSED'); });
    await Promise.race([inputClosed, exited]);
  }
} finally { controller.abort(); await service?.close(); await native.close(); }
