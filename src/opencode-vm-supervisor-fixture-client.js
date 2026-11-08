import { createConnection } from 'node:net';
import { lstatSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { privateDirectory } from './storage.js';

// Fixture-only bridge to a retained VZ connection. A private same-UID Unix
// socket is not supervisor identity or an isolation boundary.
export async function connectOpenCodeVMSupervisorFixture({ path, kind, signal, timeoutMs = 10000 }) {
  if (!isAbsolute(path || '') || !['control', 'api', 'import'].includes(kind) || signal?.aborted ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('VM_SUPERVISOR_FIXTURE_UNAVAILABLE');
  privateDirectory(dirname(path));
  const stat = lstatSync(path);
  if (!stat.isSocket() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error('VM_SUPERVISOR_FIXTURE_UNAVAILABLE');
  const socket = createConnection(path); let timer;
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); socket.off('connect', connected); socket.off('error', fail); socket.off('close', fail); signal?.removeEventListener('abort', fail); };
      const fail = () => { cleanup(); reject(new Error('VM_SUPERVISOR_FIXTURE_UNAVAILABLE')); };
      const connected = () => {
        try { const after = lstatSync(path); if (!after.isSocket() || after.dev !== stat.dev || after.ino !== stat.ino || after.uid !== stat.uid) throw new Error(); }
        catch { fail(); return; }
        socket.write(kind === 'control' ? 'C' : kind === 'api' ? 'A' : 'I', error => { if (error) return fail(); cleanup(); resolve(); });
      };
      timer = setTimeout(fail, timeoutMs); socket.once('connect', connected); socket.once('error', fail); socket.once('close', fail); signal?.addEventListener('abort', fail, { once: true });
      if (signal?.aborted) fail();
    });
    if (signal) { const revoke = () => socket.destroy(); signal.addEventListener('abort', revoke, { once: true });
      socket.once('close', () => signal.removeEventListener('abort', revoke)); if (signal.aborted) { revoke(); throw new Error(); } }
    return socket;
  } catch { socket.destroy(); throw new Error('VM_SUPERVISOR_FIXTURE_UNAVAILABLE'); }
}
