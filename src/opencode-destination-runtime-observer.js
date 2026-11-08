import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile), unavailable = () => new Error('DESTINATION_RUNTIME_OBSERVATION_UNAVAILABLE');
const observations = new WeakSet();
export const isOpenCodeDestinationRuntimeObservation = value => typeof value === 'object' && value !== null && observations.has(value);
export const fingerprintOpenCodeDestinationFile = path => {
  const before = statSync(path), bytes = readFileSync(path), after = statSync(path);
  if (!before.isFile() || bytes.length > 64 * 1024 * 1024 || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw unavailable();
  return createHash('sha256').update(bytes).digest('hex');
};

// Fixture-only inspection of a live runtime and its read-only input mounts.
// The daemon and build provenance remain unattested; this cannot authorize work.
export async function observeOpenCodeDestinationRuntime({ docker, endpoint, checkSocket, runtimeArgs, name, image, directory, nativeBundle, runner, expectedBundle, expectedRunner, supervisor, signal }) {
  if (docker !== '/opt/homebrew/bin/docker' || !/^turnlink-destination-test-[0-9a-f-]{36}$/.test(name || '') ||
      image !== 'sha256:38eeb2705cd19ac5698f3236477570b5cc9aaff5abfb6eea567999fd9dd890a6' ||
      !endpoint?.startsWith('unix:///') || typeof checkSocket !== 'function' || !Array.isArray(runtimeArgs) || !supervisor?.check || signal?.aborted)
    throw unavailable();
  try {
    const native = await supervisor.check(), bundleDigest = fingerprintOpenCodeDestinationFile(nativeBundle), runnerDigest = fingerprintOpenCodeDestinationFile(runner);
    if (bundleDigest !== expectedBundle || runnerDigest !== expectedRunner) throw unavailable();
    const inspect = async () => {
      if (!checkSocket()) throw unavailable();
      const format = '[{{json .Id}},{{json .Image}},{{json .Config.Image}},{{json .Config.User}},{{json .Path}},{{json .Args}},{{json .State.Running}},{{json .State.Pid}},{{json .State.StartedAt}},{{json .HostConfig.NetworkMode}},{{json .HostConfig.ReadonlyRootfs}},{{json .HostConfig.Privileged}},{{json .HostConfig.CapDrop}},{{json .HostConfig.CapAdd}},{{json .HostConfig.Devices}},{{json .HostConfig.DeviceRequests}},{{json .HostConfig.SecurityOpt}},{{json .Mounts}}]';
      const { stdout } = await run(docker, ['--host', endpoint, 'inspect', '--format', format, name], { encoding: 'utf8', maxBuffer: 65536, timeout: 30000, signal });
      const [id, actualImage, configuredImage, user, path, args, running, pid, startedAt, network, readOnly, privileged, capDrop, capAdd, devices, requests, security, mounts] = JSON.parse(stdout);
      if (!/^[a-f0-9]{64}$/.test(id) || actualImage !== image || configuredImage !== image || user !== '10001:10001' || path !== '/usr/bin/env' ||
          JSON.stringify(args) !== JSON.stringify(runtimeArgs) || !running || !Number.isSafeInteger(pid) || pid < 1 || typeof startedAt !== 'string' || network !== 'none' || !readOnly || privileged ||
          !capDrop?.includes('ALL') || (capAdd || []).length || (devices || []).length || (requests || []).length || !checkSocket() ||
          !security?.some(value => value === 'no-new-privileges' || value === 'no-new-privileges=true') || !Array.isArray(mounts) || mounts.length !== 3)
        throw unavailable();
      for (const [destination, source] of [['/project', directory], ['/assets/bundle/native-recovery-host.js', nativeBundle], ['/runner.mjs', runner]]) {
        const mount = mounts.find(value => value.Destination === destination);
        if (!mount || mount.Type !== 'bind' || mount.RW !== false || realpathSync(mount.Source) !== realpathSync(source)) throw unavailable();
      }
      return { id, pid, startedAt };
    };
    const before = await inspect();
    const script = "const f=require('node:fs'),c=require('node:crypto');const h=p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex');console.log(JSON.stringify({bundle:h('/assets/bundle/native-recovery-host.js'),runner:h('/runner.mjs')}))";
    const { stdout } = await run(docker, ['--host', endpoint, 'exec', '--user=10001:10001', name, '/usr/local/bin/turnlink-node', '-e', script],
      { encoding: 'utf8', maxBuffer: 1024, timeout: 30000, signal });
    const values = JSON.parse(stdout), after = await inspect(), current = await supervisor.check();
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(native) !== JSON.stringify(current) || values.bundle !== bundleDigest || values.runner !== runnerDigest ||
        fingerprintOpenCodeDestinationFile(nativeBundle) !== bundleDigest || fingerprintOpenCodeDestinationFile(runner) !== runnerDigest) throw unavailable();
    const observation = Object.freeze({ ...before, image, bundleDigest, runnerDigest, executionEligible: false });
    observations.add(observation); return observation;
  } catch { throw unavailable(); }
}
