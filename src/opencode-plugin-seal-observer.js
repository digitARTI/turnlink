import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isOpenCodePluginStreamPortOpen } from './opencode-plugin-stream-port.js';
import { inspectOpenCodeDaemonLaunch } from './opencode-plugin-daemon-launch.js';

const unavailable = () => new Error('PLUGIN_SEAL_OBSERVATION_UNAVAILABLE');
const run = promisify(execFile);
const observations = new WeakSet();
export const isOpenCodePluginSealObservation = value => typeof value === 'object' && value !== null && observations.has(value);

// Point-in-time observation of an explicitly pinned test container. This
// does not attest all possible Node execution paths or native exclusion and
// therefore cannot make a worktree snapshot executable.
export async function observeOpenCodePluginSeal({ docker, containerID, image, bundleSha256, guardSha256, sessionID, directory, child, launch, port, signal, ackHashProbe }) {
  if (docker !== '/opt/homebrew/bin/docker' || !/^[a-f0-9]{64}$/.test(containerID || '') || !/^sha256:[a-f0-9]{64}$/.test(image || '') ||
      !/^[a-f0-9]{64}$/.test(bundleSha256 || '') || !/^[a-f0-9]{64}$/.test(guardSha256 || '') || !sessionID?.startsWith('ses_') ||
      !directory?.startsWith('/') || !child?.pid || signal?.aborted || (ackHashProbe !== undefined && typeof ackHashProbe !== 'function')) throw unavailable();
  let launchInfo;
  try { launchInfo = inspectOpenCodeDaemonLaunch(launch, child); } catch { throw unavailable(); }
  if (launchInfo.docker !== docker || launchInfo.image !== image || launchInfo.sessionID !== sessionID || launchInfo.directory !== directory) throw unavailable();
  const live = () => { if (signal?.aborted || !isOpenCodePluginStreamPortOpen(port, child)) throw unavailable();
    inspectOpenCodeDaemonLaunch(launch, child); };
  const expectedArgs = ['-i', 'TURNLINK_STREAM_IPC=1', 'NODE_NO_WARNINGS=1', '/usr/local/bin/turnlink-node', '--permission', '--allow-fs-read=/sealed', '--disallow-code-generation-from-strings', '--import', '/sealed/guard.mjs',
    '/sealed/plugin.mjs', 'unused', sessionID, directory];
  const { name, endpoint } = launchInfo;
  const inspect = async () => {
    const format = '[{{json .Id}},{{json .Image}},{{json .Config.Image}},{{json .Config.User}},{{json .Path}},{{json .Args}},{{json .State.Running}},{{json .State.Pid}},{{json .State.StartedAt}},{{json .HostConfig.NetworkMode}},{{json .HostConfig.ReadonlyRootfs}},{{json .HostConfig.Privileged}},{{json .HostConfig.CapDrop}},{{json .HostConfig.CapAdd}},{{json .HostConfig.SecurityOpt}},{{json .HostConfig.Devices}},{{json .HostConfig.DeviceRequests}},{{len .Mounts}},{{json .Name}}]';
    live(); const { stdout } = await run(docker, ['--host', endpoint, 'inspect', '--format', format, containerID], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024, signal });
    live(); const [id, actualImage, configuredImage, user, path, args, running, pid, startedAt, network, readOnly, privileged, capDrop, capAdd,
      security, devices, deviceRequests, mountCount, actualName] = JSON.parse(stdout);
    if (id !== containerID || actualImage !== image || configuredImage !== image || user !== '10001:10001' || path !== '/usr/bin/env' ||
        JSON.stringify(args) !== JSON.stringify(expectedArgs) || !running || !Number.isSafeInteger(pid) || pid < 1 || typeof startedAt !== 'string' ||
        network !== 'none' || readOnly !== true || privileged === true || !capDrop?.includes('ALL') || (capAdd || []).length ||
        !security?.some(value => value === 'no-new-privileges' || value === 'no-new-privileges=true') ||
        (devices || []).length || (deviceRequests || []).length || mountCount !== 0 || actualName !== `/${name}`) throw unavailable();
    return { id, image: actualImage, pid, startedAt };
  };
  let stage = 'daemon-before';
  try {
    const daemon = async () => {
      live();
      const { stdout } = await run(docker, ['--host', endpoint, 'info', '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024, signal });
      const id = stdout.trim();
      if (!id || id.length > 128 || /\s/.test(id)) throw unavailable();
      live(); return id;
    };
    const daemonID = await daemon();
    stage = 'inspect-before';
    const before = await inspect();
    stage = 'exec-hash';
    const script = "const f=require('node:fs'),c=require('node:crypto');const h=p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex');console.log(JSON.stringify({bundle:h('/sealed/plugin.mjs'),guard:h('/sealed/guard.mjs')}))";
    const { stdout } = await run(docker, ['--host', endpoint, 'exec', '--user=10001:10001', containerID, '/usr/local/bin/turnlink-node', '-e', script],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024, signal });
    stage = 'live-after-exec';
    live(); stage = 'parse-hash'; const hashes = JSON.parse(stdout);
    stage = 'compare-hash';
    if (Object.keys(hashes).sort().join(',') !== 'bundle,guard' || hashes.bundle !== bundleSha256 || hashes.guard !== guardSha256) throw unavailable();
    if (ackHashProbe) { stage = 'ack-hash'; live(); await ackHashProbe(signal); live(); }
    stage = 'inspect-after';
    const after = await inspect();
    stage = 'daemon-after';
    if (JSON.stringify(before) !== JSON.stringify(after) || await daemon() !== daemonID) throw unavailable();
    const observation = Object.freeze({ ...after, daemonID, sessionID, directory, bundleSha256, guardSha256, executionEligible: false, issue: 'COMPLETE_EXECUTION_GRAPH_UNATTESTED' });
    observations.add(observation); return observation;
  } catch { if (process.env.TURNLINK_SEAL_DIAGNOSTIC === '1') process.stderr.write(`SEAL_STAGE:${stage}\n`); throw unavailable(); }
}
