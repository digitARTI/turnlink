#!/usr/bin/env node
import { createServer } from 'node:net';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { isAbsolute, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { acquireStore, readPrivate, privateDirectory } from './storage.js';
import { validateCredential } from './config.js';
import { createBroker } from './broker.js';
import { OpenCodeContainedOwner } from './opencode-contained-owner.js';
import { createContainedOpenCodeBrokerTunnel } from './opencode-container-broker-tunnel.js';
import { createContainedVerifierRegistry, createContainedVerifierRelay } from './opencode-container-verifier-relay.js';
import { makeRemoteOpenCodeGenerationVerifier } from './opencode-completion-verifier-transport.js';
import { makeRemoteOpenCodeSourceRecoveryVerifier } from './opencode-source-recovery-verifier-transport.js';
import { makeRemoteOpenCodeTakeoverVerifier } from './opencode-takeover-verifier-transport.js';
import { makeContainedOwnerTakeoverVerifier } from './opencode-container-takeover-verifier.js';
import { validateState } from './protocol.js';

const unavailable = () => new Error('OPENCODE_CONTAINED_HOST_UNAVAILABLE');
const path = z.string().refine(value => isAbsolute(value) && normalize(value) === value && !value.includes('\0'));
const port = z.number().int().min(1).max(65535), image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const schema = z.strictObject({ version: z.literal(1), docker: path, runtimeManifest: path,
  owner: z.strictObject({ directory: path, spec: z.unknown() }),
  broker: z.strictObject({ directory: path, endpointDirectory: path, verifierDirectory: path, port: z.number().int().min(0).max(65535),
    hostTokenFile: path, adminTokenFile: path, completionTokenFile: path }),
  announcement: z.strictObject({ secretFile: path, brokerPort: port, guestPort: port }),
  modelTunnel: z.strictObject({ hostPort: port, guestPort: port }).optional(),
  guest: z.strictObject({ mode: z.enum(['completion', 'source-recovery', 'takeover']), ownerFile: path, environmentFile: path,
    adapterTokenFile: path, movementTokenFile: path }).optional(),
  recovery: z.strictObject({ takeoverGeneration: z.string().uuid(), takeoverTokenFile: path,
    sourceGeneration: z.string().uuid(), sourceTokenFile: path, prepareSuccessor: z.boolean().optional() }).optional() });
const manifestSchema = z.strictObject({ version: z.literal(1), image, contentDigest: z.string().regex(/^[a-f0-9]{64}$/) });

// Explicitly configured local host bootstrap. Guest paths are fixed by the
// runtime contract; the guest cannot nominate a host path or host credential.
export async function startContainedOpenCodeHost(value, { onGuestDiagnostic } = {}) {
  if (onGuestDiagnostic !== undefined && typeof onGuestDiagnostic !== 'function') throw unavailable();
  if (process.platform !== 'darwin') throw unavailable();
  const config = schema.parse(value), manifest = manifestSchema.parse(JSON.parse(readPrivate(config.runtimeManifest, 65536)));
  const spec = config.owner.spec;
  if (!spec || typeof spec !== 'object' || spec.image !== manifest.image || spec.codeVolume || spec.mounts?.length ||
      spec.volume?.destination !== '/var/lib/turnlink' || spec.volume?.mode !== 'rw' || spec.init !== true ||
      JSON.stringify([...(spec.tmpfs || [])].sort()) !== JSON.stringify(['/run/turnlink-secrets', '/tmp'].sort()) ||
      config.announcement.brokerPort === config.announcement.guestPort ||
      (config.modelTunnel && [config.announcement.brokerPort, config.announcement.guestPort].includes(config.modelTunnel.guestPort)) ||
      (config.recovery && config.recovery.takeoverGeneration === config.recovery.sourceGeneration)) throw unavailable();
  const run = promisify(execFile), inspected = await run(config.docker, ['image', 'inspect', manifest.image], { encoding: 'utf8', timeout: 15000 });
  const values = JSON.parse(inspected.stdout), info = Array.isArray(values) && values.length === 1 && values[0];
  if (!info || info.Id !== manifest.image || info.Config?.Labels?.['org.turnlink.runtime.manifest'] !== manifest.contentDigest ||
      info.Config.User !== '10001' || info.Config.WorkingDir !== '/code') throw unavailable();
  const readToken = file => validateCredential(readPrivate(file, 128).trim());
  const tokens = [config.broker.hostTokenFile, config.broker.adminTokenFile, config.broker.completionTokenFile, config.announcement.secretFile,
    ...(config.recovery ? [config.recovery.takeoverTokenFile, config.recovery.sourceTokenFile] : []),
    ...(config.guest ? [config.guest.adapterTokenFile, config.guest.movementTokenFile] : [])].map(readToken);
  if (new Set(tokens).size !== tokens.length) throw unavailable();
  if (config.guest && config.guest.mode !== 'completion' && !config.recovery) throw unavailable();
  if (config.recovery?.prepareSuccessor && config.guest?.mode !== 'takeover') throw unavailable();
  for (const directory of [config.owner.directory, config.broker.directory, config.broker.endpointDirectory, config.broker.verifierDirectory]) privateDirectory(directory);
  const owner = new OpenCodeContainedOwner({ directory: config.owner.directory, docker: config.docker, spec });
  const registry = createContainedVerifierRegistry(), tunnels = [], relays = [], sockets = new Set();
  let broker, announcementServer, identity, guestProcess, closing;
  const close = () => closing ??= (async () => {
    guestProcess?.stdin.end(); registry.close(); for (const socket of sockets) socket.destroy(); for (const tunnel of tunnels) tunnel.close();
    for (const relay of relays) await relay.close();
    if (announcementServer?.listening) await new Promise(resolve => announcementServer.close(resolve));
    await broker?.close(); owner.close();
  })();
  try {
    let state, created = false;
    if (config.recovery?.prepareSuccessor) {
      const requested = JSON.parse(readPrivate(config.guest.ownerFile, 65536));
      let compromised = false; const unlock = acquireStore(config.broker.directory, () => { compromised = true; });
      try {
        const saved = validateState(JSON.parse(readPrivate(join(config.broker.directory, 'store.json'))));
        const binding = saved.bindings[requested?.grant?.agentId], drain = binding?.ownerDrain, previous = drain?.containment;
        if (binding?.revoked || drain?.phase !== 'draining' || !previous || drain.nextTransitionID !== requested?.grant?.id ||
            drain.oldReceiverHash !== binding.receiverHash || compromised) throw unavailable();
        state = await owner.observe();
        if (state.containerID === previous.containerID) {
          if (state.daemonID !== previous.daemonID || state.operationID !== previous.operationID) throw unavailable();
          const { volume } = await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite');
          if (volume.name !== previous.volume.name || volume.createdAt !== previous.volume.createdAt ||
              volume.destination !== previous.volume.destination || compromised) throw unavailable();
          if (state.running) await owner.stop();
          if (compromised) throw unavailable();
          const retired = await owner.retireVolumeOwner();
          if (retired.containerID !== previous.containerID || compromised) throw unavailable();
          await owner.createVolumeSuccessor(); if (compromised) throw unavailable();
          await owner.start(); state = await owner.observe();
        } else {
          const observed = await owner.observeVolumeSuccessor({ daemonID: previous.daemonID, operationID: previous.operationID,
            containerID: previous.containerID, volume: previous.volume });
          if (observed.containerID !== state.containerID || compromised) throw unavailable();
        }
      } finally { unlock(); }
    }
    if (!state) try { state = await owner.observe(); } catch (error) { if (error.code !== 'ENOENT' || config.recovery) throw error; state = await owner.create(); created = true; }
    if (created) {
      const { volume } = await owner.assertDatabaseVolume('/var/lib/turnlink/opencode.sqlite');
      // This is a new, journalled volume only; refuse to modify existing data.
      await run(config.docker, ['run', '--rm', '--network=none', '--user=0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
        '--mount', `type=volume,src=${volume.name},dst=/v,volume-nocopy`, '--entrypoint', '/bin/sh', manifest.image,
        '-c', 'test -z "$(ls -A /v)" && chmod 700 /v && chown 10001:10001 /v'], { timeout: 30000 });
      await owner.start(); state = await owner.observe();
    } else if (state.phase === 'created' && state.status === 'created') { await owner.start(); state = await owner.observe(); }
    if (!state.running || state.status !== 'running' || state.phase !== 'started') throw unavailable();
    identity = { containerID: state.containerID, daemonID: state.daemonID, operationID: state.operationID };
    let takeover, sourceRecovery;
    if (config.recovery) {
      for (const [generation, directory] of [[config.recovery.takeoverGeneration, '/tmp/turnlink-takeover'], [config.recovery.sourceGeneration, '/tmp/turnlink-source']])
        relays.push(await createContainedVerifierRelay({ owner, docker: config.docker, ...identity, generation,
          hostDirectory: config.broker.verifierDirectory, containerDirectory: directory }));
      const containedTakeover = makeContainedOwnerTakeoverVerifier({ owner, nativeVerifier: makeRemoteOpenCodeTakeoverVerifier({ path: relays[0].path, secret: tokens[4] }) });
      takeover = input => { try { onGuestDiagnostic?.('takeover:BEGIN'); } catch {} return containedTakeover(input); };
      Object.defineProperty(takeover, 'requiresLease', { value: true });
      sourceRecovery = makeRemoteOpenCodeSourceRecoveryVerifier({ path: relays[1].path, secret: tokens[5] });
    }
    const completion = makeRemoteOpenCodeGenerationVerifier({ directory: config.broker.verifierDirectory, secret: tokens[2] });
    const contain = async input => {
      const result = await registry.verify(input);
      input.lease.onClose(() => { try { onGuestDiagnostic?.('owner:LEASE_CLOSED'); } catch {} });
      return result;
    };
    let endpointObserved = false;
    const resolveEndpoint = input => {
      const endpoint = registry.endpoint(input);
      if (endpoint) endpointObserved = true;
      else if (endpointObserved) { endpointObserved = false; try { onGuestDiagnostic?.('owner:ENDPOINT_UNAVAILABLE'); } catch {} }
      return endpoint;
    };
    broker = createBroker({ directory: config.broker.directory, port: config.broker.port, secret: tokens[0], adminSecret: tokens[1],
      controlPlane: true, worktreeGrants: true, receiverHandoff: true, taskDispatch: true, worktreeTaskDispatch: true,
      ownerLeaseRequired: true, ownerEndpointDirectory: config.broker.endpointDirectory, completionVerifier: completion,
      ownerContainmentVerifier: contain, ownerEndpointResolver: resolveEndpoint,
      ...(takeover ? { ownerTakeoverVerifier: takeover, sourceRecoveryVerifier: sourceRecovery } : {}) });
    await once(broker.server, 'listening');
    announcementServer = createServer(socket => {
      sockets.add(socket); socket.once('close', () => { sockets.delete(socket); try { onGuestDiagnostic?.('announcement:CLOSED'); } catch {} });
      void registry.accept({ stream: socket, secret: tokens[3], owner, docker: config.docker, ...identity,
        hostDirectory: config.broker.verifierDirectory, containerDirectory: '/tmp/turnlink-host-verifiers',
        guestEndpointDirectory: '/tmp/turnlink-host-endpoints', hostEndpointDirectory: config.broker.endpointDirectory,
        proxyPath: '/assets/http-proxy.cjs' }).catch(() => socket.destroy());
    });
    announcementServer.listen(0, '127.0.0.1'); await once(announcementServer, 'listening');
    for (const [brokerPort, containerPort] of [[broker.server.address().port, config.announcement.brokerPort],
      [announcementServer.address().port, config.announcement.guestPort], ...(config.modelTunnel ? [[config.modelTunnel.hostPort, config.modelTunnel.guestPort]] : [])])
      tunnels.push(await createContainedOpenCodeBrokerTunnel({ owner, docker: config.docker, ...identity, brokerPort, containerPort,
        muxPath: '/code/src/opencode-container-mux.js', onClose: () => { void close(); } }));
    let guest;
    if (config.guest) {
      const ownerConfig = JSON.parse(readPrivate(config.guest.ownerFile, 65536));
      const environment = z.record(z.string(), z.string()).parse(JSON.parse(readPrivate(config.guest.environmentFile, 65536)));
      const insideVolume = value => typeof value === 'string' && value.startsWith('/var/lib/turnlink/') && normalize(value) === value;
      if (!ownerConfig || ownerConfig.hostId !== 'local' || !insideVolume(ownerConfig.database) || !insideVolume(ownerConfig.grant?.from) || !insideVolume(ownerConfig.grant?.to) ||
          ownerConfig.source?.directory !== ownerConfig.grant.from || !insideVolume(ownerConfig.credentialDirectory) ||
          !insideVolume(ownerConfig.liveJournalDirectory) ||
          (ownerConfig.promotionJournalDirectory !== undefined && !insideVolume(ownerConfig.promotionJournalDirectory)) ||
          (config.guest.mode !== 'completion' && !['recoveryJournalDirectory', 'detachmentJournalDirectory', 'destinationJournalDirectory']
            .every(name => insideVolume(ownerConfig[name])))) throw unavailable();
      const fixed = { ...ownerConfig, runtime: '/usr/local/bin/turnlink-bun',
        entrypoint: '/code/.native-runtimes/opencode/packages/cli/src/native-recovery-host.ts',
        ...(config.guest.mode === 'completion' ? { verifierDirectory: '/tmp/turnlink-host-verifiers', endpointDirectory: '/tmp/turnlink-host-endpoints' } :
          { mode: 'successor', finish: true, ownerLease: true, refreshRecoveryIdle: true,
            verifierSocket: `/tmp/turnlink-source/${config.recovery.sourceGeneration}.sock`, completionVerifierDirectory: '/tmp/turnlink-host-verifiers',
            endpointDirectory: '/tmp/turnlink-host-endpoints', brokerUrl: `ws://127.0.0.1:${config.announcement.brokerPort}` }) };
      let takeoverContext;
      if (config.guest.mode === 'takeover') {
        const binding = broker.store.bindings[ownerConfig.grant.agentId], drain = binding?.ownerDrain, previous = drain?.containment;
        if (binding?.revoked || drain?.phase !== 'draining' || !previous || drain.nextTransitionID !== ownerConfig.grant.id ||
            drain.oldReceiverHash !== binding.receiverHash) throw unavailable();
        const observed = await owner.observeVolumeSuccessor({ daemonID: previous.daemonID, operationID: previous.operationID,
          containerID: previous.containerID, volume: previous.volume });
        if (observed.containerID !== identity.containerID || observed.operationID !== identity.operationID) throw unavailable();
        takeoverContext = { previousTransitionID: drain.oldTransitionID,
          successor: { ...previous, generation: config.recovery.takeoverGeneration, containerID: identity.containerID, operationID: identity.operationID } };
      }
      const offset = config.recovery ? 6 : 4;
      guestProcess = spawn(config.docker, ['exec', '-i', '-w', '/code', '-e', 'TURNLINK_LINUX_ABSTRACT_VERIFIERS=1', identity.containerID,
        '/usr/local/bin/turnlink-node', 'src/opencode-contained-guest.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
      guestProcess.stdin.on('error', () => {});
      let diagnosticBuffer = '';
      guestProcess.stderr.on('data', chunk => {
        diagnosticBuffer = `${diagnosticBuffer}${chunk}`.slice(-4096);
        const lines = diagnosticBuffer.split('\n'); diagnosticBuffer = lines.pop();
        for (const line of lines) {
          const safe = /^Turnlink delivery blocked or uncertain \(([A-Z0-9_]{1,100})\); inspect private receipts$/.exec(line);
          if (safe || line === 'Turnlink contained guest unavailable') try { onGuestDiagnostic?.(safe ? `guest:${safe[1]}` : 'guest:UNAVAILABLE'); } catch {}
        }
      });
      const exited = once(guestProcess, 'exit');
      const ready = once(createInterface({ input: guestProcess.stdout }), 'line');
      guestProcess.stdin.write(`${JSON.stringify({ version: 1, mode: config.guest.mode, owner: fixed, environment,
        announcementPort: config.announcement.guestPort, brokerPort: config.announcement.brokerPort,
        ...takeoverContext,
        secrets: { host: tokens[0], completion: tokens[2], announcement: tokens[3],
          adapter: tokens[offset], movement: tokens[offset + 1], ...(config.guest.mode !== 'completion' ? { source: tokens[5] } : {}),
          ...(config.guest.mode === 'takeover' ? { takeover: tokens[4] } : {}) } })}\n`);
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), 90000); });
      let line;
      try { [line] = await Promise.race([ready, exited.then(() => { throw unavailable(); }), timeout]); }
      finally { clearTimeout(timer); }
      guest = z.strictObject({ state: z.string(), transitionID: z.string().uuid() }).parse(JSON.parse(line));
      void exited.then(() => close());
    }
    return Object.freeze({ broker, owner, identity, guest, close });
  } catch { await close(); throw unavailable(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let host;
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw unavailable();
    host = await startContainedOpenCodeHost(JSON.parse(readPrivate(process.argv[3], 65536)),
      { onGuestDiagnostic: value => console.error(`Turnlink ${value}`) });
    process.stdout.write(`${JSON.stringify({ state: 'ready', brokerPort: host.broker.server.address().port, ...host.identity, ...(host.guest ? { guest: host.guest } : {}) })}\n`);
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => { void host.close(); });
  } catch { await host?.close(); console.error('Turnlink contained host unavailable'); process.exitCode = 1; }
}
