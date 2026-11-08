import { Duplex, PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { OpenCodeNativeRecovery } from './opencode-native-recovery.js';
import { createContainedOpenCodeHttpTunnel } from './opencode-container-http-tunnel.js';
import { createContainedOpenCodeBrokerTunnel } from './opencode-container-broker-tunnel.js';

const unavailable = () => Object.assign(new Error('CONTAINED_NATIVE_RECOVERY_UNAVAILABLE'), { code: 'CONTAINED_NATIVE_RECOVERY_UNAVAILABLE' });
const supervised = new WeakMap();
export const isSupervisedContainedNative = (native, owner) => supervised.get(native) === owner;
const path = z.string().refine(isAbsolute);
const schema = z.strictObject({ entrypoint: path, database: path, sessionID: z.string().startsWith('ses_'), pluginID: z.string().min(1),
  source: z.strictObject({ directory: path, workspaceID: z.string().optional() }), environment: z.record(z.string(), z.string()),
  timeoutMs: z.number().int().min(1000).max(30000).optional(), http: z.boolean().optional(), docker: path.optional(),
  brokerPort: z.number().int().min(1).max(65535).optional(), containerBrokerPort: z.number().int().min(1).max(65535).optional(),
  configContent: z.string().max(8192).optional(), assetPrefix: z.literal('/assets').optional(),
  secretFiles: z.strictObject({ 'host.token': z.string().regex(/^[a-f0-9]{64}$/).optional(), 'adapter.token': z.string().regex(/^[a-f0-9]{64}$/).optional(),
    'movement.token': z.string().regex(/^[a-f0-9]{64}$/).optional() }).optional() })
  .refine(value => !!value.brokerPort === !!value.containerBrokerPort && (!!value.docker === (!!value.http || !!value.brokerPort)));

// The factory is passed only by a trusted host supervisor. The completion
// owner separately checks the actual container and volume before publishing.
export function containedOpenCodeOwnerLauncher(options) {
  if (!options?.owner || options.http !== true) throw unavailable();
  return async ({ runtime, entrypoint, database, sessionID, pluginID, source, env, timeoutMs, serveCandidate }) => {
    if (runtime !== '/usr/local/bin/turnlink-bun' || serveCandidate !== true) throw unavailable();
    return launchContainedOpenCodeRecovery({ ...options, entrypoint, database, sessionID, pluginID, source, environment: env, timeoutMs });
  };
}

// Experimental descriptor bridge; this does not expose the native HTTP server
// or give the container broker authority. The caller owns the durable container.
export async function launchContainedOpenCodeRecovery({ owner, onStage, prepareVolume, reuseCreated = false, ...value }) {
  const options = schema.parse(value);
  if (!owner?.create || !owner?.observe || !owner?.startInteractive || !owner?.stop || !owner?.assertDatabaseVolume || typeof reuseCreated !== 'boolean') throw unavailable();
  onStage?.('container-create'); const created = reuseCreated ? await owner.observe() : await owner.create();
  if (reuseCreated && (created.phase !== 'created' || created.running || created.status !== 'created')) throw unavailable();
  const beforeVolume = await owner.assertDatabaseVolume(options.database);
  if (beforeVolume.containerID !== created.containerID || beforeVolume.daemonID !== created.daemonID) throw unavailable();
  if (prepareVolume) {
    await prepareVolume(beforeVolume);
    const preparedVolume = await owner.assertDatabaseVolume(options.database);
    if (JSON.stringify(beforeVolume) !== JSON.stringify(preparedVolume)) throw unavailable();
  }
  onStage?.('container-attach'); const attached = await owner.startInteractive();
  if (attached.containerID !== created.containerID || attached.operationID !== created.operationID || attached.daemonID !== created.daemonID) throw unavailable();
  const afterVolume = await owner.assertDatabaseVolume(options.database);
  if (JSON.stringify(beforeVolume) !== JSON.stringify(afterVolume)) throw unavailable();
  const { child, exited } = attached, inbound = new PassThrough();
  child.stderr.resume(); child.stdout.on('error', () => inbound.destroy());
  child.stdout.on('end', () => inbound.end());
  let buffer = Buffer.alloc(0), ready = false;
  const endpoint = new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(unavailable()); } inbound.destroy(); };
    const timer = setTimeout(fail, options.timeoutMs ?? 15000);
    child.stdout.on('data', data => {
      if (ready) { inbound.write(data); return; }
      buffer = Buffer.concat([buffer, data]); if (buffer.length > 16384) return fail();
      const end = buffer.indexOf(10); if (end < 0) return;
      try {
        const result = z.strictObject({ url: z.string().url() }).parse(JSON.parse(buffer.subarray(0, end).toString('utf8'))), url = new URL(result.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw unavailable();
        ready = true; settled = true; clearTimeout(timer);
        const tail = buffer.subarray(end + 1); buffer = Buffer.alloc(0); if (tail.length) inbound.write(tail);
        resolve(Object.freeze({ url: url.origin }));
      } catch { fail(); }
    });
    void exited.then(fail);
  });
  void endpoint.catch(() => {});
  let broker, recovery;
  if (options.brokerPort) try {
    onStage?.('container-broker-tunnel');
    broker = await createContainedOpenCodeBrokerTunnel({ owner, docker: options.docker, containerID: created.containerID, daemonID: created.daemonID,
      operationID: created.operationID, brokerPort: options.brokerPort, containerPort: options.containerBrokerPort, muxPath: options.assetPrefix ? '/assets/mux.mjs' : '/mux.mjs',
      onClose: () => { recovery?.close(); child.stdin.end(); } });
  } catch (error) { child.stdin.end(); throw error; }
  const password = randomBytes(32).toString('base64url');
  child.stdin.write(`${JSON.stringify({ entrypoint: options.entrypoint, database: options.database, sessionID: options.sessionID, pluginID: options.pluginID,
    directory: options.source.directory, ...(options.source.workspaceID ? { workspaceID: options.source.workspaceID } : {}), password,
    environment: options.environment, ...(options.configContent === undefined ? {} : { configContent: options.configContent }),
    ...(options.secretFiles === undefined ? {} : { secretFiles: options.secretFiles }) })}\n`);
  const stream = Duplex.from({ readable: inbound, writable: child.stdin });
  recovery = new OpenCodeNativeRecovery({ stream, sessionID: options.sessionID, pluginID: options.pluginID, source: options.source,
    timeoutMs: options.timeoutMs });
  void exited.then(() => recovery.close());
  let nativeEndpoint;
  try { onStage?.('container-native-ready'); nativeEndpoint = await endpoint; }
  catch (error) { broker?.close(); recovery.close(); child.stdin.end(); throw error; }
  let http;
  if (options.http) try {
    onStage?.('container-http-tunnel');
    http = await createContainedOpenCodeHttpTunnel({ owner, docker: options.docker, containerID: created.containerID, daemonID: created.daemonID,
      operationID: created.operationID, nativePort: Number(new URL(nativeEndpoint.url).port), password,
      proxyPath: options.assetPrefix ? '/assets/http-proxy.cjs' : '/http-proxy.cjs' });
  } catch (error) { broker?.close(); recovery.close(); child.stdin.end(); throw error; }
  let closing;
  const close = () => closing ??= (async () => { await http?.close(); broker?.close(); recovery.close(); child.stdin.end(); await owner.stop(); return exited; })();
  const native = Object.freeze({ recovery, close, exit: exited, containerID: created.containerID, daemonID: created.daemonID, operationID: created.operationID, volume: beforeVolume.volume,
    ...(http ? { endpoint: http.endpoint, ready: Promise.resolve(http.endpoint) } : {}) });
  supervised.set(native, owner);
  return native;
}
