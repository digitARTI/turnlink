import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest } from '../src/config.js';
import { atomicWrite, privateDirectory, readPrivate } from '../src/storage.js';

const Hash = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const Journal = z.strictObject({ version: z.literal(1), status: z.enum(['prepared', 'complete', 'rolled_back', 'needs_review']),
  changes: z.array(z.strictObject({ path: z.string().refine(isAbsolute), backup: z.string().refine(isAbsolute),
    originalHash: Hash, proposedHash: Hash })).min(1).max(8) });
const current = path => {
  try { return readPrivate(path, 4 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const hash = value => value === null ? null : digest(value);
export function rollbackConfiguration(path, write = atomicWrite) {
  const journal = Journal.parse(JSON.parse(readPrivate(path)));
  const conflicts = [];
  for (const c of [...journal.changes].reverse()) {
    const found = hash(current(c.path));
    if (found === c.originalHash) continue;
    if (found !== c.proposedHash) { conflicts.push(c.path); continue; }
    if (c.originalHash === null) unlinkSync(c.path);
    else {
      const backup = readPrivate(c.backup);
      if (digest(backup) !== c.originalHash) throw new Error('Backup integrity check failed');
      write(c.path, backup);
    }
  }
  journal.status = conflicts.length ? 'needs_review' : 'rolled_back';
  write(path, JSON.stringify(journal));
  return { restored: conflicts.length === 0, conflicts };
}
export function applyConfiguration(journalPath, changes, write = atomicWrite) {
  if (existsSync(journalPath)) throw new Error('Configuration journal exists; explicitly rollback or inspect it first');
  privateDirectory(dirname(journalPath));
  const backups = join(dirname(journalPath), 'backups'); privateDirectory(backups);
  const journal = { version: 1, status: 'prepared', changes: [] };
  for (const change of changes) {
    if (!isAbsolute(change.path)) throw new Error('Configuration paths must be absolute');
    const old = current(change.path), backup = join(backups, `${randomUUID()}.bak`);
    if (old !== null) write(backup, old);
    journal.changes.push({ path: change.path, backup, originalHash: hash(old), proposedHash: digest(change.content) });
  }
  Journal.parse(journal);
  write(journalPath, JSON.stringify(journal)); // Recovery intent is durable before either user file changes.
  try {
    for (let i = 0; i < changes.length; i++) {
      if (hash(current(changes[i].path)) !== journal.changes[i].originalHash) throw new Error('User configuration changed during installation');
      write(changes[i].path, changes[i].content);
    }
    journal.status = 'complete'; write(journalPath, JSON.stringify(journal));
  } catch (error) {
    try { rollbackConfiguration(journalPath, write); } catch { /* durable journal/backups remain for explicit recovery */ }
    throw error;
  }
  return { configured: true, journal: journalPath };
}
