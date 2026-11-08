import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { once } from 'node:events';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { superviseOpenCodeDestinationObservation } from './opencode-destination-observation-supervisor.js';
import { fingerprintOpenCodeDestinationFile, observeOpenCodeDestinationRuntime } from './opencode-destination-runtime-observer.js';

// Explicit experiment only: this fixture excludes external plugin/MCP graphs
// and uses a shared daemon. It cannot establish an executable authority.
export async function launchOpenCodeDestinationFixture(input) {
  const absolute = z.string().refine(isAbsolute);
  const config = z.strictObject({ directory: absolute, nativeBundle: absolute, runner: absolute, denyFixture: z.boolean().optional(),
    hostedSessionID: z.string().startsWith('ses_').max(1024).optional() }).parse(input);
  const expectedBundle = fingerprintOpenCodeDestinationFile(config.nativeBundle), expectedRunner = fingerprintOpenCodeDestinationFile(config.runner);
  const docker = '/opt/homebrew/bin/docker', name = `turnlink-destination-test-${randomUUID()}`;
  const endpoint = execFileSync(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8', timeout: 30000 }).trim();
  const parsed = new URL(endpoint); if (parsed.protocol !== 'unix:' || parsed.hostname || !parsed.pathname.startsWith('/')) throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE');
  const socketPath = decodeURIComponent(parsed.pathname), socket = statSync(socketPath);
  if (!socket.isSocket()) throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE');
  const checkSocket = () => { const current = statSync(socketPath); return current.isSocket() && current.dev === socket.dev && current.ino === socket.ino; };
  const runtimeArgs = ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'TURNLINK_DESTINATION_KEEP=1',
    ...(config.denyFixture ? ['TURNLINK_DESTINATION_DENY_FIXTURE=1'] : []),
    ...(config.hostedSessionID ? ['TURNLINK_DESTINATION_HOSTED=1', `TURNLINK_DESTINATION_SESSION=${config.hostedSessionID}`] : []),
    '/usr/local/bin/turnlink-node', '/runner.mjs'];
  const child = spawn(docker, ['--host', endpoint, 'run', '--rm', '-i', '--name', name, '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=64', '--tmpfs', '/state:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700',
    '--tmpfs', '/tmp:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700', '--mount', `type=bind,src=${config.directory},dst=/project,readonly`,
    '--mount', `type=bind,src=${config.nativeBundle},dst=/assets/bundle/native-recovery-host.js,readonly`,
    '--mount', `type=bind,src=${config.runner},dst=/runner.mjs,readonly`, '--entrypoint', '/usr/bin/env',
    'sha256:38eeb2705cd19ac5698f3236477570b5cc9aaff5abfb6eea567999fd9dd890a6', ...runtimeArgs], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = Promise.race([once(child, 'exit'), once(child, 'error')]);
  const supervisor = superviseOpenCodeDestinationObservation({ child, directory: config.directory, hosted: !!config.hostedSessionID });
  let closing;
  const close = () => closing ??= Promise.resolve().then(async () => {
    supervisor.close(); await exited.catch(() => {});
    const cleanup = spawn(docker, ['--host', endpoint, 'rm', '-f', name], { stdio: 'ignore' });
    const timer = setTimeout(() => cleanup.kill('SIGKILL'), 10000);
    try { await Promise.race([once(cleanup, 'exit'), once(cleanup, 'error')]).catch(() => {}); }
    finally { clearTimeout(timer); }
  });
  // Revocation can close the observation before the enclosing CLI stops.
  // Dispose the fixture immediately instead of leaving its container alive.
  supervisor.onClose(() => { void close().catch(() => {}); });
  const observeRuntime = () => observeOpenCodeDestinationRuntime({ docker, endpoint, checkSocket, runtimeArgs, name,
    image: 'sha256:38eeb2705cd19ac5698f3236477570b5cc9aaff5abfb6eea567999fd9dd890a6',
    directory: config.directory, nativeBundle: config.nativeBundle, runner: config.runner, expectedBundle, expectedRunner, supervisor });
  try { await (config.hostedSessionID ? supervisor.hostedReady : supervisor.ready); return Object.freeze({ supervisor, close, observeRuntime }); }
  catch { await close(); throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE'); }
}
