import { readFileSync, mkdirSync, writeFileSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startOpenCodeCompletionOwner } from '../../src/opencode-completion-owner.js';
import { OpenCodeContainedOwner } from '../../src/opencode-contained-owner.js';
import { launchContainedOpenCodeRecovery } from '../../src/opencode-container-native-recovery.js';
import { announceContainedVerifier } from '../../src/opencode-container-verifier-relay.js';

let owner, next, stage = 'fixture-start', nativePid, containerIdentity, gateway, announcedGeneration, nextAnnouncedGeneration;
const gatewaySockets = new Set();
const closeGateway = () => { for (const socket of gatewaySockets) socket.destroy(); gateway?.close(); };
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { controller.abort(); void owner?.close(); });
try {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  let nativeLauncher;
  if (process.env.TURNLINK_FIXTURE_CONTAINER_OWNER === '1') {
    process.env.DOCKER_HOST = process.env.TURNLINK_FIXTURE_DOCKER_HOST;
    const root = dirname(dirname(config.database)), modelConfig = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT), muxPort = 31679;
    const originalBroker = new URL(modelConfig.plugins[0].options.url), originalModel = new URL(modelConfig.providers.fixture.settings.baseURL);
    gateway = createServer(socket => { gatewaySockets.add(socket); socket.once('close', () => gatewaySockets.delete(socket)); socket.once('data', first => {
      const port = first.toString('utf8', 0, Math.min(first.length, 256)).startsWith('GET /broker ') ? Number(originalBroker.port) : Number(originalModel.port);
      const target = createConnection({ host: '127.0.0.1', port });
      socket.on('error', () => target.destroy()); target.on('error', () => socket.destroy());
      target.once('connect', () => { target.write(first); socket.pipe(target); target.pipe(socket); });
    }); });
    gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
    modelConfig.plugins[0].package = 'file:///bundle/turnlink-plugin';
    modelConfig.plugins[0].options.url = `ws://127.0.0.1:${muxPort}/broker`;
    modelConfig.providers.fixture.settings.baseURL = `http://127.0.0.1:${muxPort}/v1`;
    const temp = join(root, 'contained-owner-tmp'), journal = join(root, 'contained-owner-journal');
    mkdirSync(temp, { mode: 0o700 }); mkdirSync(journal, { mode: 0o700 });
    const sameMount = (source, mode) => ({ source, destination: source, mode });
    const spec = { resourceID: randomUUID(), image: 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5',
      command: ['/bridge.cjs'], mounts: [
        { source: resolve('src/opencode-container-fd-bridge.cjs'), destination: '/bridge.cjs', mode: 'ro' },
        { source: resolve('src/opencode-container-http-proxy.cjs'), destination: '/http-proxy.cjs', mode: 'ro' },
        { source: resolve('src/opencode-container-mux.js'), destination: '/mux.mjs', mode: 'ro' },
        { source: resolve('.native-runtimes/opencode-linux-bundle/tree-27fe131feefb18761cca6b2f3bcc6d6171cc2824'), destination: '/bundle', mode: 'ro' },
        sameMount(dirname(config.database), 'rw'), sameMount(config.source.directory, 'rw'), sameMount(config.grant.to, 'rw'),
        sameMount(join(root, 'destination-second'), 'rw'), sameMount(config.credentialDirectory, 'rw'),
        sameMount(config.hostTokenFile, 'ro'), sameMount(config.adapterTokenFile, 'ro'), sameMount(config.movementTokenFile, 'ro'),
        { source: temp, destination: '/tmp', mode: 'rw' },
      ] };
    writeFileSync(join(root, 'contained-owner-spec.json'), JSON.stringify({ directory: journal, docker: '/opt/homebrew/bin/docker', spec }), { mode: 0o600 });
    nativeLauncher = async options => {
      stage = 'container-launch';
      const managed = new OpenCodeContainedOwner({ directory: journal, docker: '/opt/homebrew/bin/docker', spec });
      let instance;
      try { instance = await launchContainedOpenCodeRecovery({ owner: managed, onStage: value => { stage = value; }, entrypoint: '/bundle/native-recovery-host.js', database: options.database,
        sessionID: options.sessionID, pluginID: options.pluginID, source: options.source, environment: { FIXTURE_MODEL_KEY: 'fixture-key' },
        docker: '/opt/homebrew/bin/docker', http: true, brokerPort: gateway.address().port, containerBrokerPort: muxPort,
        configContent: JSON.stringify(modelConfig), timeoutMs: options.timeoutMs }); }
      catch (error) {
        for (const [index, mount] of spec.mounts.entries()) try {
          const info = lstatSync(mount.source); let issue = realpathSync(mount.source) === mount.source ? '' : 'noncanonical';
          if (info.isDirectory()) {
            const pending = [mount.source]; let count = 0;
            while (pending.length && !issue) for (const item of readdirSync(pending.pop(), { withFileTypes: true })) {
              if (++count > 20000) { issue = 'too-many'; break; }
              if (item.isSymbolicLink()) { issue = 'symlink'; break; }
              if (item.isSocket()) { issue = 'socket'; break; }
              if (item.isDirectory()) pending.push(join(item.parentPath, item.name));
            }
          }
          if (issue) console.error(`fixture mount ${index}: ${issue}`);
        } catch (diagnostic) { console.error(`fixture mount ${index}: ${diagnostic.code || 'unavailable'}`); }
        console.error(`Contained native start failed (${/^[A-Z0-9_]{1,100}$/.test(error?.code || '') ? error.code : 'UNAVAILABLE'})`); throw error;
      }
      containerIdentity = { containerID: instance.containerID, daemonID: instance.daemonID, operationID: instance.operationID };
      stage = 'container-ready';
      return { recovery: instance.recovery, ready: Promise.resolve(instance.endpoint), exit: instance.exit, pid: undefined,
        close: async () => { try { return await instance.close(); } finally { managed.close(); closeGateway(); } } };
    };
  }
  const onVerifierRegistered = process.env.TURNLINK_FIXTURE_ANNOUNCE === '1' ? async ({ generation, signal }) => {
    if (signal.aborted || nextAnnouncedGeneration) throw new Error('fixture announcement unavailable');
    if (announcedGeneration) nextAnnouncedGeneration = generation; else announcedGeneration = generation;
    if (process.env.TURNLINK_FIXTURE_EXTERNAL_ANNOUNCE_PORT) {
      const port = Number(process.env.TURNLINK_FIXTURE_EXTERNAL_ANNOUNCE_PORT), secret = process.env.TURNLINK_FIXTURE_EXTERNAL_ANNOUNCE_SECRET;
      if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('fixture announcement unavailable');
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.on('error', () => socket.destroy());
      await once(socket, 'connect');
      return announceContainedVerifier({ stream: socket, secret, generation, signal });
    }
    return { close() {} };
  } : undefined;
  owner = await startOpenCodeCompletionOwner(config, { signal: controller.signal, onNextStage: value => { stage = value; }, onNativeStart: value => { nativePid = value; }, ...(nativeLauncher ? { nativeLauncher } : {}), ...(onVerifierRegistered ? { onVerifierRegistered } : {}) });
  process.stdout.write(`${JSON.stringify({ state: owner.state, transitionID: owner.transitionID, endpointFile: owner.endpointFile, nativePid, containerIdentity, announcedGeneration })}\n`);
  process.on('message', message => {
    void (async () => {
      if (message?.method === 'promoteAndPrepare' && owner.promoteNext && !next) {
        next = await owner.promoteNext(message.grant);
        const intent = await next.bridge.prepare(message.grant);
        process.send?.({ status: 'prepared', transitionID: intent.transitionID, source: intent.source, directory: intent.directory });
      } else if (message?.method === 'releaseAndDrain' && next && owner.drainNext) {
        await next.bridge.releaseTransport(message.grant);
        const result = await owner.drainNext(message.grant);
        process.send?.({ status: result.phase, transitionID: message.grant.id });
      } else if (message?.method === 'detachAndStage' && next && owner.detachNext) {
        const result = await owner.detachNext(message.grant);
        process.send?.({ status: 'staged', transitionID: result.transitionID, source: result.source, destination: result.destination });
      } else if (message?.method === 'completeNext' && next && owner.completeNext) {
        const result = await owner.completeNext(message.grant);
        process.send?.({ status: 'released', ...result, ...(nextAnnouncedGeneration ? { nextAnnouncedGeneration } : {}) });
      } else throw new Error('unavailable');
    })().catch(error => process.send?.({ status: 'error', code: /^[A-Z0-9_]{1,100}$/.test(error?.code || '') ? error.code : 'UNAVAILABLE', ...(stage ? { stage } : {}) }));
  });
  const result = await owner.exit; await owner.close();
  if (!controller.signal.aborted || result.error || result.code !== 0 || result.signal !== null) {
    console.error(`Turnlink: native exit code=${result.code} signal=${result.signal} aborted=${controller.signal.aborted} error=${!!result.error}`);
    process.exitCode = 1;
  }
} catch (error) { await owner?.close(); closeGateway(); console.error(`Turnlink: promotion fixture unavailable (${/^[A-Z0-9_]{1,100}$/.test(error?.code || '') ? error.code : 'UNAVAILABLE'}, ${stage})`); process.exitCode = 1; }
finally { process.disconnect?.(); }
