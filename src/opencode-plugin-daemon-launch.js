import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

// A host-created process capability pins a Docker client to one Unix socket.
// This observes socket continuity; it does not establish exclusive custody.
const launches = new WeakMap();
const unavailable = () => new Error('PLUGIN_DAEMON_LAUNCH_UNAVAILABLE');
const socketIdentity = endpoint => {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'unix:' || url.host || url.search || url.hash) throw unavailable();
    const path = decodeURIComponent(url.pathname);
    const stat = statSync(path, { bigint: true });
    if (!stat.isSocket()) throw unavailable();
    return `${path}:${stat.dev}:${stat.ino}:${stat.uid}`;
  } catch { throw unavailable(); }
};

export function launchOpenCodeSealedPlugin({ docker, endpoint, name, image, sessionID, directory }) {
  if (docker !== '/opt/homebrew/bin/docker' || !/^turnlink-plugin-test-[0-9a-f-]{36}$/.test(name || '') ||
      !/^sha256:[a-f0-9]{64}$/.test(image || '') || !sessionID?.startsWith('ses_') || !directory?.startsWith('/')) throw unavailable();
  const identity = socketIdentity(endpoint);
  const args = ['--host', endpoint, 'run', '--rm', '-i', '--name', name, '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--entrypoint', '/usr/bin/env', image, '-i', 'TURNLINK_STREAM_IPC=1', 'NODE_NO_WARNINGS=1',
    '/usr/local/bin/turnlink-node', '--permission', '--allow-fs-read=/sealed', '--disallow-code-generation-from-strings', '--import', '/sealed/guard.mjs',
    '/sealed/plugin.mjs', 'unused', sessionID, directory];
  const child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const capability = Object.freeze({ child });
  launches.set(capability, { docker, endpoint, identity, args, name, image, sessionID, directory });
  return capability;
}

export function inspectOpenCodeDaemonLaunch(capability, child) {
  const entry = launches.get(capability);
  if (!entry || capability.child !== child || child.spawnfile !== entry.docker ||
      JSON.stringify(child.spawnargs) !== JSON.stringify([entry.docker, ...entry.args]) ||
      child.exitCode !== null || child.signalCode !== null || socketIdentity(entry.endpoint) !== entry.identity) throw unavailable();
  return { docker: entry.docker, endpoint: entry.endpoint, name: entry.name, image: entry.image,
    sessionID: entry.sessionID, directory: entry.directory };
}
