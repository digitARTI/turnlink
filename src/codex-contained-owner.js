import { createHash, randomUUID } from 'node:crypto';
import { existsSync, promises as fs, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { WorktreeTransition } from './control/contracts.js';

const unavailable = () => new Error('CODEX_CONTAINED_OWNER_UNAVAILABLE');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = z.strictObject({ version: z.literal(1), effectID: z.string().uuid(), grantDigest: z.string().regex(/^[a-f0-9]{64}$/),
  transitionID: z.string().uuid(), kind: z.enum(['stop', 'remove']), resourceID: z.string().uuid(), operationID: z.string().uuid(),
  containerID: z.string().regex(/^[a-f0-9]{64}$/), wrapperPID: z.number().int().positive(), daemonID: z.string().min(1).max(256) });
const revocationRecord = z.strictObject({ version: z.literal(1), effectID: z.string().uuid(), grantDigest: z.string().regex(/^[a-f0-9]{64}$/) });
const containedOwners = new WeakSet();

async function atomicWriteAsync(path, body) {
  const tmp = `${path}.${randomUUID()}.tmp`; let file;
  try {
    file = await fs.open(tmp, 'wx', 0o600); await file.writeFile(body); await file.sync(); await file.close(); file = undefined;
    await fs.rename(tmp, path);
    if (process.platform !== 'win32') { const directory = await fs.open(path.slice(0, path.lastIndexOf('/')), 'r');
      try { await directory.sync(); } finally { await directory.close(); } }
  } finally { if (file) await file.close(); await fs.unlink(tmp).catch(() => {}); }
}

// Experimental owner preparation only: there is deliberately no Docker or
// dispatch method. The asserted effective UID is checked, but a declared UID
// says nothing about Desktop, other writers or inherited descriptors.
export function createCodexContainedOwner({ directory, grant: input, effectID, resourceID, kind, expectedUID, writeIntent = atomicWriteAsync, writeRevocation = atomicWriteAsync }) {
  if (!isAbsolute(directory) || process.platform === 'win32' || typeof process.geteuid !== 'function' ||
      !Number.isSafeInteger(expectedUID) || expectedUID < 0 || process.geteuid() !== expectedUID || typeof writeIntent !== 'function' || typeof writeRevocation !== 'function') throw unavailable();
  const grant = WorktreeTransition.parse(input);
  if (grant.sourceRetirement?.version !== 2 || grant.status !== 'prepared' || !['stop', 'remove'].includes(kind)) throw unavailable();
  const selected = grant.sourceRetirement.owners.find(value => value.resourceID === resourceID);
  if (!selected) throw unavailable();
  const intent = identity.parse({ version: 1, effectID, grantDigest: hash(grant), transitionID: grant.id, kind,
    resourceID, operationID: selected.operationID, containerID: selected.containerID, wrapperPID: selected.wrapperPID, daemonID: selected.daemonID });
  privateDirectory(directory);
  const ownerPath = join(directory, 'owner'), intentPath = join(directory, 'intent.json'), revokedPath = join(directory, 'revoked.json');
  let ownsPath = false;
  try { mkdirSync(ownerPath, { mode: 0o700 }); ownsPath = true;
    if (existsSync(intentPath) || existsSync(revokedPath)) throw unavailable();
    atomicWrite(join(ownerPath, 'token'), randomUUID()); }
  catch (error) { if (ownsPath) rmSync(ownerPath, { recursive: true, force: true }); throw Object.assign(unavailable(), { cause: error }); }
  let revoked = false, closed = false, faulted = false, phase = 'prepared', pending = 0, revocation, attached = false, authorityGuard = () => false;
  const leases = new Set();
  const invalidateLeases = () => { for (const invalidate of [...leases]) invalidate(); };
  const result = Object.freeze({
    snapshot() { if (closed || process.geteuid() !== expectedUID) throw unavailable();
      return Object.freeze({ phase, revoked, faulted, effectiveUID: process.geteuid(), dispatchAvailable: false }); },
    matches(candidate) { try { return hash(WorktreeTransition.parse(candidate)) === intent.grantDigest; } catch { return false; } },
    attachGuard(guard) { if (attached || typeof guard !== 'function') throw unavailable(); attached = true; authorityGuard = guard; },
    // Process-local observation of the broker's existing live guard. This is
    // not an authenticated cross-UID lease and never authorizes dispatch.
    acquireBrokerObservation({ grant: candidate, effectID: candidateEffect, resourceID: candidateResource, kind: candidateKind }) {
      if (!attached || leases.size >= 64 || candidateEffect !== intent.effectID || candidateResource !== intent.resourceID || candidateKind !== intent.kind ||
          !result.matches(candidate) || closed || revoked || faulted || process.geteuid() !== expectedUID || authorityGuard() !== true || revoked) throw unavailable();
      let live = true; const listeners = new Set();
      const invalidate = () => { if (!live) return; live = false; leases.delete(invalidate);
        for (const callback of listeners) { try { callback(); } catch { /* invalidation remains final */ } } listeners.clear(); };
      const check = () => {
        try { if (!live || closed || revoked || faulted || process.geteuid() !== expectedUID || authorityGuard() !== true || revoked) throw unavailable(); return true; }
        catch { invalidate(); throw unavailable(); }
      };
      leases.add(invalidate);
      try { check(); } catch (error) { invalidate(); throw error; }
      return Object.freeze({ transitionID: intent.transitionID, effectID: intent.effectID, resourceID: intent.resourceID, kind: intent.kind,
        dispatchAvailable: false, check, release: invalidate,
        onInvalidate(callback) { if (typeof callback !== 'function') throw unavailable(); if (!live) { callback(); return () => {}; }
          listeners.add(callback); return () => listeners.delete(callback); } });
    },
    async prepare() {
      if (closed || revoked || faulted || process.geteuid() !== expectedUID || phase !== 'prepared' || authorityGuard() !== true || revoked) throw unavailable();
      phase = 'intent_writing'; pending++;
      try {
        await writeIntent(intentPath, JSON.stringify(intent));
        phase = 'intent_recorded';
        if (closed || revoked || process.geteuid() !== expectedUID || authorityGuard() !== true || revoked) throw unavailable();
        return { status: 'intent_recorded', effectID, dispatchAvailable: false };
      } catch (error) { if (phase === 'intent_writing') { phase = 'uncertain'; faulted = true; } throw Object.assign(unavailable(), { cause: error }); }
      finally { pending--; }
    },
    revoke() {
      if (closed) return Promise.reject(unavailable());
      if (revocation) return revocation;
      // The in-memory gate closes synchronously, independently of intent I/O.
      revoked = true; invalidateLeases(); pending++;
      revocation = Promise.resolve().then(() => writeRevocation(revokedPath, JSON.stringify({ version: 1, effectID, grantDigest: intent.grantDigest })))
        .then(() => ({ revoked: true, durable: true }), error => { faulted = true; throw Object.assign(unavailable(), { cause: error }); })
        .finally(() => { pending--; });
      return revocation;
    },
    close() { if (closed) return; if (pending || faulted) throw unavailable(); closed = true; invalidateLeases(); rmSync(ownerPath, { recursive: true, force: true }); },
  });
  containedOwners.add(result); return result;
}
export const isCodexContainedOwner = value => containedOwners.has(value);

// Read-only recovery: no PID, stale timer or missing response authorizes replay.
export function inspectCodexContainedOwner(directory) {
  if (!isAbsolute(directory)) throw unavailable();
  const read = name => { try { return JSON.parse(readPrivate(join(directory, name), 8192)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const value = read('intent.json'), revocation = read('revoked.json');
  const intent = value ? identity.parse(value) : null, revoked = revocation ? revocationRecord.parse(revocation) : null;
  if (intent && revoked && (intent.effectID !== revoked.effectID || intent.grantDigest !== revoked.grantDigest)) throw unavailable();
  return { intent, revoked: !!revoked, dispatchAvailable: false };
}
