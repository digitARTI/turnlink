import { z } from 'zod';
import { posix, win32 } from 'node:path';
const uuid = z.string().uuid();
const stamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().min(1).max(2048).refine(v => !v.includes('\0') && (posix.isAbsolute(v) || win32.isAbsolute(v)));
export const NativeReservation = z.strictObject({ generation: uuid, revision: stamp });
// A native opaque plan reference and disclosure, never an execution-readiness seal.
const providerPlanFields = { id: uuid, harness: z.literal('codex'),
  processGeneration: uuid, agentId: z.string().regex(/^codex:[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/), reservation: NativeReservation,
  from: path, to: path, providerID: z.string().min(1).max(200), family: z.enum(['configured', 'gcp', 'bedrock']), digest };
const ProviderModelContext = z.strictObject({ model: z.string().min(1).max(200), catalogSource: z.enum(['configured', 'provider-default']),
  apiKeyDiscovery: z.boolean(), cache: z.literal('native') });
const ProviderCatalogEffects = z.strictObject({ network: z.literal('native-provider-catalog'), credentials: z.literal('native-provider-auth'), cache: z.literal('native-model-cache') });
export const ProviderEstablishmentPlan = z.discriminatedUnion('kind', [
  z.strictObject({ id: uuid, kind: z.literal('provider_factory'), ...providerPlanFields }),
  z.strictObject({ id: uuid, kind: z.literal('provider_context'), ...providerPlanFields, modelContext: ProviderModelContext }),
  z.strictObject({ id: uuid, kind: z.literal('provider_catalog'), ...providerPlanFields, modelContext: ProviderModelContext, catalogEffects: ProviderCatalogEffects }),
]);
const resourceKind = z.enum(['provider_factory', 'provider_context', 'provider_catalog']);
export const ProviderEstablishmentReceipt = z.strictObject({ transitionID: uuid, planID: uuid, reservation: NativeReservation,
  resourceID: uuid, processGeneration: uuid, kind: resourceKind, phase: z.enum(['constructed', 'retained']) });
export const providerEstablishment = value => value.purpose === 'establish-provider';
export const sameProviderPlan = (a, b) => JSON.stringify(ProviderEstablishmentPlan.parse(a)) === JSON.stringify(ProviderEstablishmentPlan.parse(b));
export const receiptMatchesPlan = (receipt, transition) => receipt.kind === transition.providerPlan.kind && receipt.processGeneration === transition.providerPlan.processGeneration && receipt.transitionID === transition.id && receipt.planID === transition.providerPlan.id &&
  receipt.reservation.generation === transition.providerPlan.reservation.generation && receipt.reservation.revision === transition.providerPlan.reservation.revision;
export const usesProviderEstablishment = state => state.previews.some(v => v.purpose !== undefined || v.providerPlan !== undefined) ||
  state.transitions.some(v => v.purpose !== undefined || v.providerPlan !== undefined || v.resourceReceipt !== undefined) ||
  state.evidence.some(v => v.nativeProviderFactory !== undefined);

// Releases an unpublished owner, including a separately reconciled completed
// catalog owner. This is not global cleanup, placement authority or permission
// to dispose an installed provider.
export const ProviderCleanupReceipt = z.strictObject({ cleanupID: uuid, resource: ProviderEstablishmentReceipt,
  sourceCwd: path, kind: resourceKind, phase: z.literal('owner_released') }).refine(v => v.kind === v.resource.kind);
export const cleanupMatchesOwner = (receipt, transition) => !!transition.resourceReceipt &&
  receiptMatchesPlan(receipt.resource, transition) && receipt.sourceCwd === transition.from &&
  JSON.stringify(ProviderEstablishmentReceipt.parse(receipt.resource)) === JSON.stringify(ProviderEstablishmentReceipt.parse(transition.resourceReceipt));
export const usesProviderCleanup = state => state.transitions.some(v => v.cleanupReceipt !== undefined);

// Schema 20 adds the explicitly approved local model-manager scope. Older stores
// must not reinterpret it as a factory-only owner or drop its cleanup hold.
export const usesProviderModelContext = state => state.previews.some(v => v.providerPlan?.kind === 'provider_context') ||
  state.transitions.some(v => v.providerPlan?.kind === 'provider_context' || v.resourceReceipt?.kind === 'provider_context');

export const ProviderObservation = z.strictObject({ plan: ProviderEstablishmentPlan, resource: ProviderEstablishmentReceipt,
  status: z.enum(['owned', 'cleanup_pending', 'released']), cleanup: ProviderCleanupReceipt.optional() }).refine(v =>
    v.resource.planID === v.plan.id && v.resource.kind === v.plan.kind && v.resource.processGeneration === v.plan.processGeneration &&
    JSON.stringify(v.resource.reservation) === JSON.stringify(v.plan.reservation) &&
    (v.status === 'released' ? !!v.cleanup && JSON.stringify(v.cleanup.resource) === JSON.stringify(v.resource) && v.cleanup.sourceCwd === v.plan.from : !v.cleanup));
export const usesProviderReconciliation = state => state.transitions.some(v => v.resourceReceipt?.phase === 'retained' || v.cleanupReceipt?.resource.phase === 'retained');

// Schema 22 preserves the separate catalog/auth/cache approval across restart/export.
export const usesProviderCatalog = state => state.previews.some(v => v.providerPlan?.kind === 'provider_catalog') ||
  state.transitions.some(v => v.providerPlan?.kind === 'provider_catalog' || v.resourceReceipt?.kind === 'provider_catalog');
