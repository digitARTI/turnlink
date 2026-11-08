import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, privateDirectory, readPrivate } from './storage.js';
import { WorktreeTransition } from './control/contracts.js';

const unavailable = () => new Error('CODEX_EFFECT_ARBITER_UNAVAILABLE');
const descriptor = z.strictObject({ effectID: z.string().uuid(), grantDigest: z.string().regex(/^[a-f0-9]{64}$/),
  executable: z.string().refine(value => isAbsolute(value) && !value.includes('\0')),
  args: z.array(z.string().max(4096).refine(value => !value.includes('\0'))).max(32) });
const record = z.strictObject({ version: z.literal(1), descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/),
  effectID: z.string().uuid(), phase: z.enum(['prepared', 'intent', 'dispatched']), revoked: z.boolean() });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Experimental single-process ordering primitive, not a broker or Docker
// authority. Both revoke() and spawn() must enter this one object. The private
// ownership marker deliberately has no stale timeout: crash requires external
// reconciliation and cannot cause an automatic replay or successor takeover.
export function createCodexEffectArbiter({ directory, effect, guard }) {
  if (!isAbsolute(directory) || typeof guard !== 'function') throw unavailable();
  effect = descriptor.parse(effect); privateDirectory(directory);
  const statePath = join(directory, 'effect.json'), ownership = join(directory, 'owner'), ownerToken = randomUUID();
  let owned = false, failed = false, closed = false;
  try {
    mkdirSync(ownership, { mode: 0o700 }); owned = true;
    atomicWrite(join(ownership, 'token'), ownerToken);
    if (existsSync(statePath)) throw unavailable();
  } catch (error) {
    if (owned) rmSync(ownership, { recursive: true, force: true });
    throw Object.assign(unavailable(), { cause: error });
  }
  let state = { version: 1, descriptorDigest: digest(effect), effectID: effect.effectID, phase: 'prepared', revoked: false };
  const save = () => { try { atomicWrite(statePath, JSON.stringify(record.parse(state))); } catch (error) { failed = true; throw error; } };
  try { save(); } catch (error) { rmSync(ownership, { recursive: true, force: true }); throw Object.assign(unavailable(), { cause: error }); }
  const check = () => { if (closed || failed || readFileSync(join(ownership, 'token'), 'utf8') !== ownerToken) throw unavailable(); };
  return Object.freeze({
    snapshot() { check(); return structuredClone(state); },
    revoke() { check(); if (!state.revoked) { state.revoked = true; save(); } return { revoked: true }; },
    prepare() {
      check(); if (state.revoked || state.phase !== 'prepared' || guard() !== true || state.revoked) throw unavailable();
      state.phase = 'intent'; save();
      return { prepared: true };
    },
    dispatch() {
      // The intent is already durable. Nothing may yield or write to disk
      // between this final authority check and the local spawn invocation.
      check(); if (state.revoked || state.phase !== 'intent' || guard() !== true || state.revoked) throw unavailable();
      // No Promise, callback, or event-loop turn occurs between the final
      // revocation check and child creation. The child may still act later.
      let child;
      try { child = spawn(effect.executable, effect.args, { stdio: 'ignore' }); }
      catch (error) { failed = true; throw Object.assign(unavailable(), { cause: error }); }
      child.on('error', () => {});
      // The durable intent remains ambiguous until a later independent
      // observation. Never write a success claim based only on spawn().
      state.phase = 'dispatched'; return child;
    },
    close() { if (closed) return; check(); closed = true; rmSync(ownership, { recursive: true, force: true }); },
  });
}

// Read-only crash inspection. An intent or dispatched record says nothing
// about the external outcome and must never be replayed automatically.
export function inspectCodexEffectArbiter(directory) {
  if (!isAbsolute(directory)) throw unavailable();
  return record.parse(JSON.parse(readPrivate(join(directory, 'effect.json'), 4096)));
}

const containedArbiters = new WeakSet();

// Binding-only wrapper: it cannot dispatch. The broker must independently
// validate the current grant before accepting the binding.
export function createCodexContainedEffectArbiter({ directory, grant: input, effectID, resourceID, kind, docker }) {
  const grant = WorktreeTransition.parse(input);
  if (grant.sourceRetirement?.version !== 2 || grant.status !== 'prepared' || !['stop', 'remove'].includes(kind) ||
      typeof docker !== 'string' || !isAbsolute(docker)) throw unavailable();
  const owner = grant.sourceRetirement.owners.find(value => value.resourceID === resourceID);
  if (!owner) throw unavailable();
  let authorityGuard = () => false, attached = false;
  const grantDigest = digest(grant), primitive = createCodexEffectArbiter({ directory, guard: () => authorityGuard(),
    effect: { effectID, grantDigest, executable: docker, args: [kind === 'stop' ? 'stop' : 'rm', owner.containerID] } });
  const binding = Object.freeze({ revoke: () => primitive.revoke(), snapshot: () => primitive.snapshot(), close: () => primitive.close(),
    matches(candidate) { try { return digest(WorktreeTransition.parse(candidate)) === grantDigest; } catch { return false; } },
    attachGuard(guard) { if (attached || typeof guard !== 'function') throw unavailable(); attached = true; authorityGuard = guard; } });
  containedArbiters.add(binding); return binding;
}
export const isCodexContainedEffectArbiter = value => containedArbiters.has(value);
