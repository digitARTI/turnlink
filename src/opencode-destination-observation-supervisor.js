import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Duplex } from 'node:stream';

// Experimental supervisor-side capability. The caller must own the child and
// its VM/daemon lease; this only retains an observation and never attests that
// the daemon, plugin graph, or destination execution owner is trustworthy.
export function superviseOpenCodeDestinationObservation({ child, directory, signal, timeoutMs = 30000, hosted = false }) {
  if (!child?.stdin?.write || !child?.stdout?.on || !child?.kill || typeof directory !== 'string' || !directory.startsWith('/') || signal?.aborted ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE');
  const components = z.strictObject(Object.fromEntries(['agent', 'model', 'permissions', 'permissionRules', 'hooks', 'tools', 'toolDefinitions', 'instructions']
    .map(name => [name, z.string().regex(/^[a-f0-9]{64}$/)])));
  const initialSchema = z.strictObject({ pluginBlocked: z.literal(true), mcpExecuted: z.literal(false), nativeSnapshot: z.literal('observed'),
    executionEligible: z.literal(false), authorityDigest: z.string().regex(/^[a-f0-9]{64}$/), holdID: z.string().uuid(), revision: z.number().int().nonnegative().safe(),
    componentDigests: components.optional(), modelResolution: z.enum(['current', 'unavailable']).optional(),
    projectInstructionFilesDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    hostedActivations: z.array(z.strictObject({ definition: z.string().uuid(), bundleDigest: z.string().regex(/^[a-f0-9]{64}$/) })).max(64).optional(),
    hostedHookActivations: z.array(z.strictObject({ definition: z.string().uuid(), bundleDigest: z.string().regex(/^[a-f0-9]{64}$/) })).max(64).optional() });
  const checkSchema = z.strictObject({ status: z.literal('held') });
  let active = true, buffer = Buffer.alloc(0), waiter, pending = false, evidence, activated = false, hostedStream, resolveReady, rejectReady;
  const listeners = new Set();
  const fail = () => {
    if (!active) return; active = false; signal?.removeEventListener('abort', fail);
    // The Docker CLI can trap SIGTERM while waiting on a container. Do not
    // let that postpone revocation or keep the local supervisor alive.
    child.stdout.off('data', onData); child.kill('SIGKILL');
    hostedStream?.destroy();
    if (waiter) { clearTimeout(waiter.timer); waiter.reject(new Error('DESTINATION_OBSERVATION_UNAVAILABLE')); waiter = undefined; }
    rejectReady?.(new Error('DESTINATION_OBSERVATION_UNAVAILABLE'));
    for (const listener of listeners) { try { listener(); } catch {} }
    listeners.clear();
  };
  const onData = chunk => {
    if (!active) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.length > (hosted ? 2 * 1024 * 1024 : 16384)) return fail();
    for (;;) {
      const end = buffer.indexOf(10); if (end < 0) return;
      let value; try { value = JSON.parse(buffer.subarray(0, end).toString('utf8')); } catch { return fail(); }
      buffer = buffer.subarray(end + 1);
      if (hosted && value && Object.keys(value).join() === 'rpc' && typeof value.rpc === 'string') {
        if (value.rpc.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.rpc) ||
            !hostedStream?.push(Buffer.from(value.rpc, 'base64'))) return fail();
        continue;
      }
      if (!waiter) return fail();
      const target = waiter; waiter = undefined; clearTimeout(target.timer); target.resolve(value);
    }
  };
  const receive = () => new Promise((resolve, reject) => {
    if (!active || waiter) return reject(new Error('DESTINATION_OBSERVATION_UNAVAILABLE'));
    waiter = { resolve, reject, timer: setTimeout(fail, timeoutMs) };
  });
  child.stdout.on('data', onData); child.stdout.on('end', fail); child.stdout.on('error', fail);
  child.stdin.on('error', fail); child.once('exit', fail); child.once('error', fail); signal?.addEventListener('abort', fail, { once: true });
  if (hosted) hostedStream = new Duplex({ readableHighWaterMark: 2 * 1024 * 1024, read() {}, write(chunk, _encoding, callback) {
    if (!active || chunk.length > 1024 * 1024) return callback(new Error('DESTINATION_OBSERVATION_UNAVAILABLE'));
    child.stdin.write(JSON.stringify({ rpc: Buffer.from(chunk).toString('base64') }) + '\n', callback);
  }, destroy(error, callback) { fail(); callback(error); } });
  const parseObservation = value => {
    const observed = initialSchema.parse(value);
    if (!active) throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE');
    evidence = Object.freeze({ directory, holdID: observed.holdID, revision: observed.revision,
      authorityDigest: observed.authorityDigest, observerID: randomUUID(), ...(observed.componentDigests ? { componentDigests: observed.componentDigests } : {}),
      ...(observed.modelResolution ? { modelResolution: observed.modelResolution } : {}),
      ...(observed.projectInstructionFilesDigest ? { projectInstructionFilesDigest: observed.projectInstructionFilesDigest } : {}),
      ...(observed.hostedActivations ? { hostedActivations: observed.hostedActivations } : {}),
      ...(observed.hostedHookActivations ? { hostedHookActivations: observed.hostedHookActivations } : {}) });
    return evidence;
  };
  const hostedReady = hosted ? receive().then(value => { if (value?.phase !== 'hosted-ready' || Object.keys(value).length !== 1) throw new Error('Unavailable'); }) : undefined;
  const activate = async () => {
    if (!hosted || activated) throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE'); activated = true;
    try { await hostedReady; const response = receive(); child.stdin.write('hold\n', error => { if (error) fail(); }); return parseObservation(await response); }
    catch { fail(); throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE'); }
  };
  const ready = hosted ? new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }) :
    receive().then(parseObservation).catch(() => { fail(); throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE'); });
  const activateHosted = async () => { try { const value = await activate(); resolveReady(value); return value; } catch (error) { rejectReady(error); throw error; } };
  void hostedReady?.catch(fail);
  void ready.catch(() => {});
  const check = async () => {
    if (pending) { fail(); throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE'); }
    pending = true;
    try {
      await ready; if (!active) throw new Error('Unavailable');
      const response = receive(); child.stdin.write('check\n', error => { if (error) fail(); });
      checkSchema.parse(await response); if (!active) throw new Error('Unavailable');
      return evidence;
    } catch { fail(); throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE'); }
    finally { pending = false; }
  };
  const onClose = listener => { if (typeof listener !== 'function') throw new Error('DESTINATION_OBSERVATION_UNAVAILABLE');
    if (!active) listener(); else listeners.add(listener); return () => listeners.delete(listener); };
  return Object.freeze({ ready, check, close: fail, onClose, ...(hosted ? { hostedReady, hostedStream, activate: activateHosted } : {}) });
}
