#!/usr/bin/env node
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { startOpenCodeCompletionOwner } from './opencode-completion-owner.js';
import { startOpenCodeSourceRecoveryOwner } from './opencode-source-recovery-owner.js';
import { announceContainedVerifier } from './opencode-container-verifier-relay.js';
import { createOpenCodeTakeoverVerifierServer } from './opencode-takeover-verifier-transport.js';
import { launchOpenCodeNativeRecovery } from './opencode-native-recovery-launcher.js';
import { OpenCodeRecoveryJournal } from './opencode-recovery-journal.js';
import { nativeEnvironment } from './opencode-completion-owner.js';
import { ChannelClient } from './client.js';
import { OpenCodeContainment } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';

const unavailable = () => new Error('OPENCODE_CONTAINED_GUEST_UNAVAILABLE');
const secret = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.strictObject({ version: z.literal(1), mode: z.enum(['completion', 'source-recovery', 'takeover']), owner: z.record(z.string(), z.unknown()),
  environment: z.record(z.string(), z.string()), announcementPort: z.number().int().min(1).max(65535), brokerPort: z.number().int().min(1).max(65535),
  previousTransitionID: z.string().uuid().optional(), successor: z.unknown().optional(),
  secrets: z.strictObject({ host: secret, adapter: secret, movement: secret, completion: secret, announcement: secret, source: secret.optional(), takeover: secret.optional() }) });

// This process receives host-selected configuration over an inherited private
// Docker stream. Credentials live only in the container's private tmpfs.
async function main() {
  const reader = createInterface({ input: process.stdin, terminal: false });
  const [line] = await once(reader, 'line'); reader.close();
  if (Buffer.byteLength(line) > 65536) throw unavailable();
  const config = input.parse(JSON.parse(line));
  if (new Set(Object.values(config.secrets)).size !== Object.keys(config.secrets).length ||
      (config.mode !== 'completion') !== !!config.secrets.source || (config.mode === 'takeover') !== !!config.secrets.takeover ||
      (config.mode === 'takeover') !== !!config.previousTransitionID || (config.mode === 'takeover') !== !!config.successor) throw unavailable();
  const root = mkdtempSync('/tmp/turnlink-owner-');
  for (const directory of ['/tmp/turnlink-host-verifiers', '/tmp/turnlink-host-endpoints', '/tmp/turnlink-source'])
    mkdirSync(directory, { mode: 0o700, recursive: true });
  const files = Object.fromEntries(Object.entries(config.secrets).map(([name, value]) => {
    const file = `${root}/${name}.token`; writeFileSync(file, value, { mode: 0o600, flag: 'wx' }); return [name, file];
  }));
  const ownerConfig = { ...config.owner, hostTokenFile: files.host, adapterTokenFile: files.adapter, movementTokenFile: files.movement,
    ...(config.mode === 'completion' ? { verifierTokenFile: files.completion } : { verifierTokenFile: files.source, completionVerifierTokenFile: files.completion }) };
  const environment = { ...config.environment };
  if (environment.OPENCODE_CONFIG_CONTENT) {
    const values = { __TURNLINK_HOST_TOKEN_FILE__: files.host, __TURNLINK_ADAPTER_TOKEN_FILE__: files.adapter,
      __TURNLINK_MOVEMENT_TOKEN_FILE__: files.movement, __TURNLINK_CREDENTIAL_DIRECTORY__: ownerConfig.credentialDirectory,
      __TURNLINK_BROKER_URL__: `ws://127.0.0.1:${config.brokerPort}` };
    const substitute = value => typeof value === 'string' && Object.hasOwn(values, value) ? values[value] :
      Array.isArray(value) ? value.map(substitute) : value && typeof value === 'object' ?
        Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item)])) : value;
    environment.OPENCODE_CONFIG_CONTENT = JSON.stringify(substitute(JSON.parse(environment.OPENCODE_CONFIG_CONTENT)));
  }
  const controller = new AbortController(); let owner, announcement;
  const close = async () => { controller.abort(); announcement?.close(); await owner?.close(); };
  const inputClosed = new Promise(resolve => {
    const ended = () => { void close(); resolve(); };
    process.stdin.once('end', ended); process.stdin.once('close', ended); process.stdin.resume();
  });
  process.once('SIGTERM', () => { void close(); }); process.once('SIGINT', () => { void close(); });
  const onVerifierRegistered = async ({ generation, signal }) => {
    const socket = createConnection({ host: '127.0.0.1', port: config.announcementPort }); socket.on('error', () => socket.destroy());
    await once(socket, 'connect'); announcement = await announceContainedVerifier({ stream: socket, secret: config.secrets.announcement, generation, signal });
    return announcement;
  };
  try {
    const options = { env: environment, signal: controller.signal, onVerifierRegistered };
    if (config.mode === 'takeover') {
      const grant = WorktreeTransition.parse(ownerConfig.grant), successor = OpenCodeContainment.parse(config.successor), agentId = grant.agentId;
      if (!agentId.startsWith('opencode:ses_') || grant.id === config.previousTransitionID || grant.status !== 'prepared' || grant.purpose) throw unavailable();
      const sessionID = agentId.slice('opencode:'.length);
      const env = nativeEnvironment(environment, ownerConfig.nativeEnvironmentAllowlist, Object.values(config.secrets));
      const native = launchOpenCodeNativeRecovery({ runtime: ownerConfig.runtime, entrypoint: ownerConfig.entrypoint, database: ownerConfig.database,
        sessionID, pluginID: 'turnlink', source: ownerConfig.source, env, timeoutMs: ownerConfig.timeoutMs ?? 15000 });
      let verifier, client;
      try {
        const journal = new OpenCodeRecoveryJournal(ownerConfig.hostId, agentId, ownerConfig.recoveryJournalDirectory);
        const intent = await native.recovery.inspect(), observed = await native.recovery.observeRecoveryRecord();
        if (intent.transitionID !== grant.id || intent.source.directory !== grant.from || intent.directory !== grant.to) throw unavailable();
        const saved = await journal.exclusive(() => journal.get(grant.id)); let claim;
        if (!saved) {
          if (observed.recovery) throw unavailable();
          await journal.exclusive(() => journal.put({ grant, pluginID: 'turnlink', phase: 'claiming' }));
          try { claim = await native.recovery.claimRecovery(grant.id);
            await journal.exclusive(() => journal.put({ grant, pluginID: 'turnlink', phase: 'claimed', claim })); }
          catch (error) { await journal.exclusive(() => journal.put({ grant, pluginID: 'turnlink', phase: 'uncertain' })); throw error; }
        } else {
          if (!['claiming', 'claimed', 'uncertain'].includes(saved.phase) || !observed.recovery || JSON.stringify(saved.grant) !== JSON.stringify(grant)) throw unavailable();
          const pending = { grant, pluginID: 'turnlink', phase: 'observed', claim: observed.recovery, observedByLease: observed.currentLease };
          await journal.exclusive(() => { journal.put(pending); journal.put({ ...pending, phase: 'taking' }); });
          try { claim = await native.recovery.takeoverRecovery(observed.recovery, observed.currentLease);
            await journal.exclusive(() => journal.put({ grant, pluginID: 'turnlink', phase: 'claimed', claim })); }
          catch (error) { await journal.exclusive(() => journal.put({ ...pending, phase: 'takeover-uncertain' })); throw error; }
        }
        mkdirSync('/tmp/turnlink-takeover', { mode: 0o700, recursive: true });
        verifier = await createOpenCodeTakeoverVerifierServer({ path: `/tmp/turnlink-takeover/${successor.generation}.sock`,
          secret: config.secrets.takeover, native: native.recovery, grant, hostId: ownerConfig.hostId, successor, signal: controller.signal });
        client = new ChannelClient({ url: `ws://127.0.0.1:${config.brokerPort}`, tokenFile: files.host, credentialDirectory: ownerConfig.credentialDirectory });
        try { await client.recoverContainedOwner(agentId, config.secrets.adapter, config.previousTransitionID, grant); }
        catch {
          // Resolve an ambiguous response with the durable successor key. This
          // is a subscribe observation, never a replay of the rotation.
          client.close(); client = new ChannelClient({ url: `ws://127.0.0.1:${config.brokerPort}`, tokenFile: files.host, credentialDirectory: ownerConfig.credentialDirectory });
          await client.resumeReceiverHandoff(agentId, grant.id);
        }
        const socket = client.socket; client.close(); if (socket?.readyState !== 3) await once(socket, 'close'); client = undefined;
      } finally { client?.close(); await verifier?.close(); await native.close(); }
    }
    owner = config.mode === 'completion' ? await startOpenCodeCompletionOwner(ownerConfig, options) : await startOpenCodeSourceRecoveryOwner(ownerConfig, options);
    process.stdout.write(`${JSON.stringify({ state: owner.state, transitionID: owner.transitionID })}\n`);
    await Promise.race([inputClosed, owner.exit]);
  } finally { await close(); process.stdin.destroy(); rmSync(root, { recursive: true, force: true }); }
}
void main().catch(() => { console.error('Turnlink contained guest unavailable'); process.exitCode = 1; });
