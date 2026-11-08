import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { digest } from './config.js';
import { acquireStore, atomicWrite, privateDirectory, readPrivate } from './storage.js';

const Record = z.strictObject({ version: z.literal(1), sessionID: z.string().startsWith('ses_'), operationID: z.string().uuid(),
  method: z.enum(['set', 'remove']), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['inflight', 'uncertain', 'accepted']) });

// There is currently no end-to-end acknowledgement from the sealed child.
// Therefore any persisted operation, even a successful one, fences later
// writes on this journal. Restart never dispatches the old operation again.
export function createOpenCodeDestinationStorageJournal({ directory, sessionID }) {
  if (!directory?.startsWith('/') || !sessionID?.startsWith('ses_')) throw new Error('DESTINATION_STORAGE_UNAVAILABLE');
  privateDirectory(directory);
  const path = join(directory, `${digest(sessionID)}.destination-storage.json`), lock = join(directory, `${digest(sessionID)}.destination-storage-writer`);
  const read = () => { try { return Record.parse(JSON.parse(readPrivate(path))); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
  let pending = false;
  const run = async (method, value, dispatch) => {
    if (pending || !['set', 'remove'].includes(method) || typeof dispatch !== 'function') throw new Error('DESTINATION_STORAGE_UNAVAILABLE');
    pending = true; let compromised = false, unlock;
    try {
      unlock = acquireStore(lock, () => { compromised = true; });
      if (read() || compromised) throw new Error('Unavailable');
      const record = Record.parse({ version: 1, sessionID, operationID: randomUUID(), method,
        fingerprint: digest(JSON.stringify({ sessionID, method, value })), state: 'inflight' });
      atomicWrite(path, JSON.stringify(record));
      try {
        const result = await dispatch();
        if (compromised || JSON.stringify(read()) !== JSON.stringify(record)) throw new Error('Unavailable');
        atomicWrite(path, JSON.stringify({ ...record, state: 'accepted' })); return result;
      } catch (cause) {
        if (!compromised && JSON.stringify(read()) === JSON.stringify(record)) atomicWrite(path, JSON.stringify({ ...record, state: 'uncertain' }));
        throw cause;
      }
    } catch { throw new Error('DESTINATION_STORAGE_UNAVAILABLE'); }
    finally { unlock?.(); pending = false; }
  };
  return Object.freeze({ run, status: () => { const value = read(); return value ? (value.state === 'inflight' ? 'uncertain' : value.state) : 'empty'; } });
}
