import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { promises as fs, readdirSync } from 'node:fs';
import { WorktreeTransition } from './control/contracts.js';
import { isCodexContainedOwner } from './codex-contained-owner.js';
import { privateDirectory, readPrivate } from './storage.js';

const unavailable = () => new Error('CODEX_MCP_ATTEMPT_OWNER_UNAVAILABLE');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Review-only: the caller must establish an OS-protected inherited channel.
// Same-UID streams and their peers are not an authenticated authority.
export function attachCodexMcpAttemptOwner({ stream, directory, owner, grant: input, effectID, resourceID, kind, checkDeadline = () => true }) {
  const grant = WorktreeTransition.parse(input);
  const scope = createHash('sha256').update(JSON.stringify(grant)).digest('hex');
  if (!isAbsolute(directory) || !isCodexContainedOwner(owner) || !owner.matches(grant) || !stream?.on || !stream?.write || !stream?.destroy || typeof checkDeadline !== 'function') throw unavailable();
  privateDirectory(directory);
  const lease = owner.acquireBrokerObservation({ grant, effectID, resourceID, kind });
  const check = () => { lease.check(); if (checkDeadline() !== true) throw unavailable(); };
  let buffer = '', closed = false, processing = false, expectedSequence = 1;
  const stop = () => { if (closed) return; closed = true; lease.release(); stream.destroy(); };
  lease.onInvalidate(stop);
  stream.on('error', stop); stream.on('close', stop); stream.on('end', stop);
  const drain = async () => {
    if (processing || closed) return;
    processing = true;
    try {
      for (;;) {
        check();
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const msg = JSON.parse(line);
        if (!msg || Object.keys(msg).sort().join(',') !== 'scope,sequence,toolSha256,version' || msg.version !== 1 ||
            msg.scope !== scope || msg.sequence !== expectedSequence || !hex(msg.toolSha256)) throw unavailable();
        const entries = await fs.readdir(directory);
        if (entries.length >= 1024 || entries.some(name => !/^attempt-\d{4}$/.test(name))) throw unavailable();
        let slot = 0; while (entries.includes(`attempt-${String(slot).padStart(4, '0')}`)) slot++;
        if (slot >= 1024) throw unavailable();
        const path = join(directory, `attempt-${String(slot).padStart(4, '0')}`);
        const fd = await fs.open(path, 'wx', 0o600);
        try { await fd.writeFile(JSON.stringify({ version: 1, scope, attempt: slot, toolSha256: msg.toolSha256, status: 'uncertain' })); await fd.sync(); }
        finally { await fd.close(); }
        const dir = await fs.open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
        check();
        if (!stream.write(`${JSON.stringify({ version: 1, scope, sequence: msg.sequence, status: 'recorded' })}\n`)) throw unavailable();
        expectedSequence++;
      }
    } catch { stop(); }
    finally { processing = false; }
  };
  stream.on('data', chunk => { buffer += chunk.toString('utf8'); if (buffer.length > 2048) stop(); else void drain(); });
  return Object.freeze({ scope, close: stop,
    // A snapshot is evidence of attempts, not proof of coverage or completion.
    observe() {
      check(); const entries = readdirSync(directory).sort();
      if (entries.length > 1024 || entries.some(name => !/^attempt-\d{4}$/.test(name))) throw unavailable();
      const attempts = entries.map(name => {
        const value = JSON.parse(readPrivate(join(directory, name), 1024));
        if (Object.keys(value).sort().join(',') !== 'attempt,scope,status,toolSha256,version' || value.version !== 1 || value.scope !== scope ||
            value.status !== 'uncertain' || !hex(value.toolSha256) || !Number.isSafeInteger(value.attempt) || value.attempt < 0 || value.attempt >= 1024 ||
            name !== `attempt-${String(value.attempt).padStart(4, '0')}`) throw unavailable();
        return value;
      });
      check(); return { scope, attempts, inventory: 'partial', releaseAllowed: false };
    } });
}
