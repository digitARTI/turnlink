import { createInterface } from 'node:readline';
import { CodexAdmissionFence } from './codex-admission-fence.js';
import { CodexNativeControl } from './codex-native-control.js';

// Construct the stdio fence and private channel from one spawned child. The
// child remains owned by the proxy; this does not exclude other processes.
export function createCodexProxyBoundary({ child, client, credential, timeoutMs, nativeControlEnabled,
  activity, reply, beforeWrite, afterWrite, onRelease, onFatal, experimentalPublicationFixture = false, fenceTimeoutMs = 30000 }) {
  if (!child?.stdin?.write || !child?.stdout?.on || child.stdio?.[0] !== child.stdin || child.stdio?.[1] !== child.stdout ||
      typeof nativeControlEnabled !== 'boolean' || typeof experimentalPublicationFixture !== 'boolean' ||
      experimentalPublicationFixture && !nativeControlEnabled || (nativeControlEnabled && !child.stdio?.[3]?.write) ||
      !Number.isSafeInteger(fenceTimeoutMs) || fenceTimeoutMs < 1000 || fenceTimeoutMs > 600000 ||
      typeof beforeWrite !== 'function' || typeof afterWrite !== 'function') throw new Error('NATIVE_PROXY_BOUNDARY_UNAVAILABLE');
  let started = false, outputReady = false;
  const available = () => outputReady && !child.stdin.destroyed && !child.stdin.writableEnded && !child.stdout.destroyed && !child.stdout.readableEnded &&
    (!nativeControlEnabled || !child.stdio[3].destroyed && !child.stdio[3].readableEnded && !child.stdio[3].writableEnded) &&
    child.exitCode === null && child.signalCode === null;
  const fence = new CodexAdmissionFence({ activity, reply, onRelease, onFatal, publicationAvailable: available, timeoutMs: fenceTimeoutMs,
    write: (line, frame, internal) => {
      const context = beforeWrite(frame, internal);
      child.stdin.write(`${line}\n`);
      afterWrite(context);
    } });
  const nativeControl = nativeControlEnabled ? new CodexNativeControl({ stream: child.stdio[3], client, credential, timeoutMs, publicationFence: fence,
    experimentalStepPreparation: experimentalPublicationFixture, experimentalPublicationFixture }) : null;
  // A lost stream also destroys idle evidence when no fence is held yet.
  // Otherwise a later exclusive operation could start native work whose
  // completion and side effects can no longer be observed.
  const lostOutput = () => { outputReady = false; fence.observeUnknownOutput(); };
  child.stdin.on('error', lostOutput); child.stdin.on('close', lostOutput);
  child.stdout.on('error', lostOutput); child.stdout.on('end', lostOutput);
  return { fence, nativeControl, startOutput(onLine) {
    if (started || typeof onLine !== 'function') throw new Error('NATIVE_PROXY_BOUNDARY_UNAVAILABLE');
    started = true; outputReady = true;
    return createInterface({ input: child.stdout }).on('close', lostOutput).on('line', line => {
      let data;
      try {
        data = JSON.parse(line);
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            (typeof data.method !== 'string' && data.id === undefined)) throw new Error('Invalid native frame');
        fence.observe(data);
      } catch { fence.observeUnknownOutput(); data = undefined; }
      onLine(line, data);
    });
  } };
}
