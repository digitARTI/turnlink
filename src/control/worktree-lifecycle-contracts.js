import { transitionHoldsConversation } from './worktree-holds.js';
import { z } from 'zod';
import { posix, win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentID, HostID, Channel } from '../protocol.js';

export const LifecycleStamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uuid = z.string().uuid();
const path = z.string().min(1).max(2048).refine(v => !v.includes('\0') && (posix.isAbsolute(v) || win32.isAbsolute(v)));
// NTFS file IDs can exceed Number.MAX_SAFE_INTEGER. Preserve them as canonical
// decimal strings; older, safely representable numeric journal entries remain valid.
const IdentityPart = z.union([LifecycleStamp, z.string().regex(/^[1-9][0-9]{15,19}$/)
  .refine(value => BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER) && BigInt(value) <= 18446744073709551615n)]);
export const DirectoryIdentity = z.strictObject({ dev: IdentityPart, ino: IdentityPart });
export const usesModernManagedRecords = state => state.managedPreviews.some(value => value.manualConfirmation ||
  [value.directory, value.preview.directory].some(identity => identity && (typeof identity.dev === 'string' || typeof identity.ino === 'string')));
export const ManualWorktreeConfirmation = z.strictObject({ id: uuid, at: LifecycleStamp, scope: z.literal('operator-confirms-no-active-use') });
export const LifecycleRecord = z.strictObject({ id: uuid, kind: z.enum(['create', 'remove']), resourceID: uuid,
  agentId: AgentID, taskID: uuid, claimGeneration: LifecycleStamp, repository: path, common: path, destination: path,
  revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), phase: z.enum(['preview', 'reserved', 'inflight', 'created', 'removed', 'failed', 'uncertain']),
  directory: DirectoryIdentity.optional(), createdAt: LifecycleStamp, expiresAt: LifecycleStamp });
export const LifecyclePreview = LifecycleRecord.extend({ phase: z.literal('preview') }).refine(p =>
  p.expiresAt > p.createdAt && p.expiresAt - p.createdAt <= 300000 &&
  (p.kind === 'create' ? p.id === p.resourceID && !p.directory : p.id !== p.resourceID && !!p.directory));
export const lifecycleDigest = input => {
  const { phase, directory, ...preview } = LifecycleRecord.parse(input);
  return createHash('sha256').update(JSON.stringify({ ...preview, ...(preview.kind === 'remove' ? { directory } : {}) })).digest('hex');
};
export const ManagedPreview = z.strictObject({ id: uuid, channel: Channel, agentId: AgentID, hostId: HostID, preview: LifecyclePreview,
  digest: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['pending', 'approved', 'rejected', 'executing', 'created', 'removed', 'failed', 'uncertain']),
  policyRevision: LifecycleStamp, at: LifecycleStamp, approvedAt: LifecycleStamp.optional(), intentID: uuid.optional(),
  manualConfirmation: ManualWorktreeConfirmation.optional(),
  receiptID: uuid.optional(), directory: DirectoryIdentity.optional(), settledAt: LifecycleStamp.optional() });

export function validateManagedPreviews(state) {
  const tasks = new Map(state.tasks.map(t => [t.id, t])), ids = new Map(state.managedPreviews.map(p => [p.id, p]));
  const channels = new Map(state.channels.map(c => [c.id, c]));
  const locked = new Set();
  for (const value of state.managedPreviews) {
    const p = value.preview, task = tasks.get(p.taskID);
    const paths = p.destination.startsWith('/') ? posix : win32;
    if (value.id !== p.id || value.agentId !== p.agentId || value.digest !== lifecycleDigest(p) || task?.channel !== value.channel ||
      p.destination !== paths.join(paths.dirname(paths.dirname(p.destination)), p.resourceID, 'tree')) throw new Error('Invalid managed worktree preview');
    if (value.at < p.createdAt || value.at >= p.expiresAt || value.at > state.lastNow ||
      value.policyRevision > channels.get(value.channel).policyRevision || (value.approvedAt !== undefined &&
        (value.approvedAt < value.at || value.approvedAt >= p.expiresAt || value.approvedAt > state.lastNow)) ||
      (value.settledAt !== undefined && (value.settledAt < (value.approvedAt ?? value.at) || value.settledAt > state.lastNow)))
      throw new Error('Invalid managed worktree chronology');
    if (p.kind === 'remove') {
      const source = ids.get(p.resourceID);
      if (source?.preview.kind !== 'create' || source.status !== 'created' || source.hostId !== value.hostId || source.agentId !== value.agentId ||
        source.channel !== value.channel || source.preview.taskID !== p.taskID || source.preview.claimGeneration !== p.claimGeneration ||
        source.preview.repository !== p.repository || source.preview.common !== p.common || source.preview.destination !== p.destination ||
        source.preview.revision !== p.revision || JSON.stringify(source.directory) !== JSON.stringify(p.directory)) throw new Error('Invalid managed worktree resource');
    }
    if (['approved', 'executing', 'created', 'removed', 'failed', 'uncertain'].includes(value.status) && value.approvedAt === undefined)
      throw new Error('Managed worktree approval missing');
    if (value.manualConfirmation && (value.approvedAt === undefined || ['pending', 'rejected'].includes(value.status) ||
      value.manualConfirmation.at < value.approvedAt || value.manualConfirmation.at >= p.expiresAt || value.manualConfirmation.at > state.lastNow))
      throw new Error('Invalid manual worktree confirmation');
    if (['executing', 'created', 'removed', 'failed', 'uncertain'].includes(value.status) && !value.intentID) throw new Error('Managed worktree intent missing');
    if (['created', 'removed', 'failed', 'uncertain'].includes(value.status) && (!value.receiptID || value.settledAt === undefined))
      throw new Error('Managed worktree receipt missing');
    if ((!['executing', 'created', 'removed', 'failed', 'uncertain'].includes(value.status) && value.intentID !== undefined) ||
      (!['created', 'removed', 'failed', 'uncertain'].includes(value.status) && (value.receiptID !== undefined || value.settledAt !== undefined)) ||
      (['pending', 'rejected'].includes(value.status) && value.approvedAt !== undefined) ||
      (value.status !== 'created' && value.directory !== undefined)) throw new Error('Invalid managed worktree receipt');
    if ((value.status === 'created' && (p.kind !== 'create' || !value.directory)) || (value.status === 'removed' && p.kind !== 'remove'))
      throw new Error('Invalid managed worktree outcome');
    if (['executing', 'uncertain'].includes(value.status)) {
      if (locked.has(value.agentId) || task.claimant !== value.agentId || task.claimGeneration !== p.claimGeneration) throw new Error('Invalid managed worktree exclusion');
      if (state.transitions.some(t => t.agentId === value.agentId && transitionHoldsConversation(t))) throw new Error('Invalid managed worktree exclusion');
      locked.add(value.agentId);
    }
  }
}
