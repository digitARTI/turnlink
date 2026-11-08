import { z } from 'zod';
import { posix, win32 } from 'node:path';
import { NativeReservation } from './provider-establishment-contracts.js';

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().min(1).max(2048).refine(v => !v.includes('\0') && (posix.isAbsolute(v) || win32.isAbsolute(v)));

// Opaque native-plan identity and an explicit effect disclosure. No command,
// environment value, credential, URL or tool payload belongs in this plan.
export const McpEstablishmentPlan = z.strictObject({
  id: uuid, kind: z.literal('mcp_runtime'), harness: z.literal('codex'), processGeneration: uuid,
  agentId: z.string().regex(/^codex:[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/), reservation: NativeReservation,
  from: path, to: path, digest,
  effects: z.strictObject({ processes: z.boolean(), network: z.boolean(), credentials: z.boolean(),
    filesystem: z.boolean(), plugins: z.boolean(), bindingCapture: z.literal(true).optional(), pluginCapture: z.literal(true).optional(), skillCapture: z.literal(true).optional(),
    stepPreparation: z.literal(true).optional() })
    .refine(effects => !effects.skillCapture || (effects.bindingCapture && effects.pluginCapture),
      'skill capture requires binding and plugin capture')
    .refine(effects => !effects.stepPreparation || (effects.skillCapture && effects.processes && effects.network && effects.credentials && effects.filesystem && effects.plugins),
      'step preparation requires skill capture and a complete contributor effect ceiling'),
});
export const McpEstablishmentReceipt = z.strictObject({ transitionID: uuid, planID: uuid, reservation: NativeReservation,
  resourceID: uuid, processGeneration: uuid, kind: z.literal('mcp_runtime'), phase: z.enum(['constructed', 'retained']) });
export const McpCleanupReceipt = z.strictObject({ cleanupID: uuid, resource: McpEstablishmentReceipt,
  sourceCwd: path, kind: z.literal('mcp_runtime'), phase: z.literal('owner_released') });
// Tracked shutdown evidence cannot settle or clear the broker resource hold.
export const McpQuiescence = z.strictObject({ shutdownID: uuid, resource: McpEstablishmentReceipt, status: z.literal('quiesced') });
export const McpObservation = z.strictObject({ plan: McpEstablishmentPlan, resource: McpEstablishmentReceipt,
  status: z.enum(['owned', 'released']), cleanup: McpCleanupReceipt.optional(), quiescence: McpQuiescence.optional() });
export const mcpEstablishment = value => value.purpose === 'establish-mcp';
export const sameMcpPlan = (a, b) => JSON.stringify(McpEstablishmentPlan.parse(a)) === JSON.stringify(McpEstablishmentPlan.parse(b));
export const mcpReceiptMatchesPlan = (receipt, transition) => !!transition.mcpPlan && receipt.kind === 'mcp_runtime' &&
  receipt.processGeneration === transition.mcpPlan.processGeneration && receipt.transitionID === transition.id &&
  receipt.planID === transition.mcpPlan.id && receipt.reservation.generation === transition.mcpPlan.reservation.generation &&
  receipt.reservation.revision === transition.mcpPlan.reservation.revision;
export const mcpCleanupMatchesOwner = (receipt, transition) => !!transition.resourceReceipt &&
  mcpReceiptMatchesPlan(receipt.resource, transition) && receipt.sourceCwd === transition.from &&
  JSON.stringify(McpEstablishmentReceipt.parse(receipt.resource)) === JSON.stringify(McpEstablishmentReceipt.parse(transition.resourceReceipt));
export const usesMcpEstablishment = state => state.previews.some(v => mcpEstablishment(v) || v.mcpPlan !== undefined) ||
  state.transitions.some(v => mcpEstablishment(v) || v.mcpPlan !== undefined || v.resourceReceipt?.kind === 'mcp_runtime') ||
  state.evidence.some(v => v.nativeMcpRuntime !== undefined);
export const usesMcpBindingCapture = state => state.previews.some(v => v.mcpPlan?.effects.bindingCapture === true) ||
  state.transitions.some(v => v.mcpPlan?.effects.bindingCapture === true);

export const usesMcpPluginCapture = state => state.previews.some(v => v.mcpPlan?.effects.pluginCapture === true) ||
  state.transitions.some(v => v.mcpPlan?.effects.pluginCapture === true);

export const usesMcpSkillCapture = state => state.previews.some(v => v.mcpPlan?.effects.skillCapture === true) ||
  state.transitions.some(v => v.mcpPlan?.effects.skillCapture === true);

// Step preparation invokes native contributors and may access external
// providers or shared caches; this disclosure is not a dispatch authorization.
export const usesMcpStepPreparation = state => state.previews.some(v => v.mcpPlan?.effects.stepPreparation === true) ||
  state.transitions.some(v => v.mcpPlan?.effects.stepPreparation === true);
