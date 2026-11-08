import { execFileSync } from 'node:child_process';

const unavailable = () => new Error('CODEX_PROCESS_OBSERVATION_UNAVAILABLE');
const observations = new WeakSet();
const integer = value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff;

// This is a point-in-time diagnostic only. ps exposes creation time at one
// second resolution, so PID reuse within that second is indistinguishable.
// A successful check never authorizes dispatch or proves later liveness.
function readProcess(pid) {
  if (process.platform !== 'darwin' || !integer(pid)) throw unavailable();
  let output;
  try { output = execFileSync('/bin/ps', ['-o', 'pid=', '-o', 'ppid=', '-o', 'lstart=', '-o', 'stat=', '-p', String(pid)],
    { encoding: 'utf8', timeout: 250, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { throw unavailable(); }
  const fields = output.split(/\s+/);
  if (fields.length !== 8 || Number(fields[0]) !== pid || !integer(Number(fields[1])) || !/^[A-Za-z+<>]+$/.test(fields[7]) ||
      /^[ZT]/.test(fields[7]) || !/^\d{2}:\d{2}:\d{2}$/.test(fields[5]) || !/^\d{4}$/.test(fields[6])) throw unavailable();
  return Object.freeze({ pid, parentPID: Number(fields[1]), started: fields.slice(2, 7).join(' ') });
}

export function sameProcessMetadata(left, right) {
  return !!left && !!right && integer(left.pid) && integer(left.parentPID) && typeof left.started === 'string' &&
    left.pid === right.pid && left.parentPID === right.parentPID && left.started === right.started;
}

export function captureCodexProcessObservation({ pid, parentPID }) {
  if (!integer(parentPID)) throw unavailable();
  const identity = readProcess(pid);
  if (identity.parentPID !== parentPID) throw unavailable();
  const value = Object.freeze({ identity, check() {
    if (!sameProcessMetadata(identity, readProcess(pid))) throw unavailable();
    return true;
  } });
  observations.add(value); return value;
}
export const isCodexProcessObservation = value => observations.has(value);
