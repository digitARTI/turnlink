import { createHash } from 'node:crypto';
import { z } from 'zod';

// This is disclosed authority for exact local contained source owners, not an
// observation that those owners exist, have stopped, or are safe to remove.
const name = z.string().min(1).max(128).refine(value => Buffer.byteLength(value, 'utf8') <= 128 && !value.includes('\0'));
const owner = z.strictObject({ names: z.array(name).min(1).max(64), resourceID: z.string().uuid(), operationID: z.string().uuid(),
  containerID: z.string().regex(/^[a-f0-9]{64}$/), wrapperPID: z.number().int().min(1).max(0xffffffff),
  daemonID: z.string().min(1).max(256).refine(value => !/\s/.test(value)) });
const v1 = z.strictObject({ version: z.literal(1), stop: z.literal(true), remove: z.literal(true), owners: z.array(owner).min(1).max(64) });
const v2 = z.strictObject({ ...v1.shape, version: z.literal(2),
  admittedEffectAfterNativeLoss: z.literal('may_complete'), revocation: z.literal('immediate_session_host_adapter_no_new_effects'),
  uncertainEffect: z.literal('hold_until_reconciled') });
const body = z.discriminatedUnion('version', [v1, v2]).superRefine((value, context) => {
    const names = new Set(), resources = new Set(), operations = new Set(), containers = new Set(), pids = new Set();
    let previous = '';
    for (const item of value.owners) {
      if (item.resourceID <= previous || resources.has(item.resourceID) || operations.has(item.operationID) || containers.has(item.containerID) || pids.has(item.wrapperPID))
        context.addIssue({ code: 'custom', message: 'Unsorted or duplicate contained source owner' });
      previous = item.resourceID; resources.add(item.resourceID); operations.add(item.operationID); containers.add(item.containerID); pids.add(item.wrapperPID);
      let last = '';
      for (const alias of item.names) {
        if (alias <= last || names.has(alias)) context.addIssue({ code: 'custom', message: 'Unsorted or duplicate contained source name' });
        last = alias; names.add(alias);
      }
    }
    if (names.size > 64 || Buffer.byteLength(JSON.stringify(value)) > 24000) context.addIssue({ code: 'custom', message: 'Contained source plan exceeds limits' });
  });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ContainedSourceRetirement = z.discriminatedUnion('version', [
  z.strictObject({ ...v1.shape, digest: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ ...v2.shape, digest: z.string().regex(/^[a-f0-9]{64}$/) }),
])
  .superRefine((value, context) => {
    const { digest: claimed, ...candidate } = value, parsed = body.safeParse(candidate);
    if (!parsed.success || digest(parsed.data) !== claimed) context.addIssue({ code: 'custom', message: 'Contained source retirement commitment mismatch' });
  });
export function makeContainedSourceRetirement(owners, { permitAdmittedEffectAfterNativeLoss = false } = {}) {
  if (typeof permitAdmittedEffectAfterNativeLoss !== 'boolean') throw new TypeError('Explicit retirement semantics required');
  // Match the validator's code-unit ordering regardless of the host locale.
  const ordered = owners.map(value => ({ ...value, names: [...value.names].sort() }))
    .sort((a, b) => a.resourceID < b.resourceID ? -1 : a.resourceID > b.resourceID ? 1 : 0);
  const plan = body.parse(permitAdmittedEffectAfterNativeLoss ? { version: 2, stop: true, remove: true, owners: ordered,
    admittedEffectAfterNativeLoss: 'may_complete', revocation: 'immediate_session_host_adapter_no_new_effects', uncertainEffect: 'hold_until_reconciled' } :
    { version: 1, stop: true, remove: true, owners: ordered });
  return ContainedSourceRetirement.parse({ ...plan, digest: digest(plan) });
}
