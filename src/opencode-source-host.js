#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { readPrivate } from './storage.js';
import { assertEndpointAvailable, publishEndpoint } from './opencode-completion-owner.js';
import { launchOpenCodeNativeLive } from './opencode-native-live-launcher.js';
import { launchOpenCodeDestinationFixture } from './opencode-destination-fixture-launcher.js';

const path = z.string().refine(isAbsolute);
const configSchema = z.strictObject({ version: z.literal(1), runtime: path, entrypoint: path, database: path,
  sessionID: z.string().startsWith('ses_'), source: z.strictObject({ directory: path, workspaceID: z.string().optional() }),
  environment: z.record(z.string(), z.string()), endpointFile: path, timeoutMs: z.number().int().min(1000).max(300000).optional(),
  destinationFixture: z.strictObject({ directory: path, nativeBundle: path, runner: path, denyFixture: z.boolean().optional() }).optional() });
const unavailable = () => new Error('OPENCODE_SOURCE_HOST_UNAVAILABLE');

// Explicit opt-in startup for a new source runtime. The delegated native
// descriptor cannot prepare or move; this command does not close Gate 2.
export async function startOpenCodeSourceHost(input, { destinationSupervisor } = {}) {
  const config = configSchema.parse(input); assertEndpointAvailable(config.endpointFile);
  if (config.destinationFixture && destinationSupervisor) throw unavailable();
  const fixture = config.destinationFixture ? await launchOpenCodeDestinationFixture(config.destinationFixture) : undefined;
  destinationSupervisor ??= fixture?.supervisor;
  let host;
  try { host = launchOpenCodeNativeLive({ runtime: config.runtime, entrypoint: config.entrypoint, database: config.database,
    sessionID: config.sessionID, source: config.source, pluginID: 'turnlink', env: config.environment,
    timeoutMs: config.timeoutMs, delegateOwnerControl: true }, { destinationSupervisor }); }
  catch { await fixture?.close(); throw unavailable(); }
  let remove, timer, closing;
  const close = () => closing ??= (async () => { clearInterval(timer); remove?.(); await host.close(); await fixture?.close(); })();
  try {
    const endpoint = await host.ready;
    remove = publishEndpoint(config.endpointFile, endpoint);
    timer = setInterval(() => { if (!remove.check()) void close(); }, 1000); timer.unref();
    void host.exit.then(() => close());
    return Object.freeze({ close, exit: host.exit });
  } catch { await close(); throw unavailable(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let host;
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw unavailable();
    host = await startOpenCodeSourceHost(JSON.parse(readPrivate(process.argv[3], 1024 * 1024)));
    process.stdout.write(JSON.stringify({ state: 'ready' }) + '\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void host.close(); });
    await host.exit;
  } catch { await host?.close(); console.error('Turnlink source host unavailable'); process.exitCode = 1; }
}
