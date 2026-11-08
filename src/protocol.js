import { z } from 'zod';
import { StorageStatus, ReclamationRequest, HistoryReclamationRequest } from './control/storage-contracts.js';
import { AdapterHealthReport } from './control/health-contracts.js';

export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 65536;
export const MAX_RESPONSE_BYTES = 49152;
export const MAX_TEXT_BYTES = 12000;
export const MAX_MANUAL_HOST_CANCELLATIONS = 32;
export const OpenCodeContainment = z.strictObject({ version: z.literal(1), generation: z.string().uuid(),
  containerID: z.string().regex(/^[a-f0-9]{64}$/), daemonID: z.string().min(1).max(256).regex(/^\S+$/), operationID: z.string().uuid(),
  volume: z.strictObject({ name: z.string().regex(/^turnlink-opencode-volume-[a-f0-9-]{36}$/), createdAt: z.string().min(1).max(128),
    destination: z.literal('/var/lib/turnlink') }) });
const bounded = max => z.string().min(1).max(max).refine(s => s.trim() === s && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(s) && Buffer.byteLength(s) <= max);
export const HostID = bounded(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const Channel = HostID;
export const Hello = z.strictObject({ protocol: z.literal(2), hostId: HostID, admin: z.boolean() });
export const SessionID = bounded(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const Harness = z.enum(['opencode', 'codex', 'claude']);
const Name = bounded(128).transform(s => s.normalize('NFKC')).pipe(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/));
export const AgentID = bounded(220).regex(/^(opencode|codex|claude):[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const proof = z.string().regex(/^[a-f0-9]{64}$/);
export const project = z.strictObject({ name: bounded(128), root: bounded(2048) });
const owned = { agentId: AgentID, proof };
const query = { agentId: AgentID.optional(), proof: proof.optional(), channel: Channel,
  limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(10000).optional() };
const channelPrecondition = z.strictObject({ policyRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activeID: z.string().uuid().nullable(), proposalID: z.string().uuid().nullable(), electionID: z.string().uuid().nullable(),
  volunteersDigest: z.string().regex(/^[a-f0-9]{64}$/) });
const methods = {
  hello: z.strictObject({}),
  join: z.strictObject({ harness: Harness, sessionId: SessionID, proof, channel: Channel,
    name: Name, role: bounded(512), project }),
  subscribe: z.strictObject({ ...owned, receiverKey: proof.optional(), observedCwd: bounded(2048).optional(), manualWorktreeHost: z.literal(true).optional() }), unsubscribe: z.strictObject(owned), leave: z.strictObject(owned), resume: z.strictObject(owned),
  send: z.strictObject({ ...owned, to: z.union([AgentID, z.literal('*')]),
    text: z.string().min(1).max(16000).refine(s => s.trim().length > 0 && Buffer.byteLength(s) <= MAX_TEXT_BYTES),
    messageId: bounded(128), masterGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }),
  ack: z.strictObject({ ...owned, id: z.string().uuid() }),
  members: z.strictObject(query), history: z.strictObject(query),
  release: z.strictObject({ channel: Channel, name: Name }),
  enroll: z.strictObject({ hostId: HostID, credential: z.string().regex(/^[a-f0-9]{64}$/),
    channels: z.array(z.union([Channel, z.literal('*')])).min(1).max(32), broadcast: z.boolean(),
    adopt: z.array(AgentID).max(128).optional() }),
  revoke: z.strictObject({ hostId: HostID }),
  revoke_session: z.strictObject({ agentId: AgentID }),
  control_codex_effect_reconcile_revocation: z.discriminatedUnion('method', [
    z.strictObject({ method: z.literal('revoke_session'), params: z.strictObject({ agentId: AgentID }) }),
    z.strictObject({ method: z.literal('revoke'), params: z.strictObject({ hostId: HostID }) }),
    z.strictObject({ method: z.literal('control_revoke_adapter'), params: z.strictObject({ hostId: HostID }) }),
  ]),
  handoff: z.strictObject({}),
  control_info: z.strictObject({}),
  control_manual_resume_arm: z.strictObject({ ...owned, channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid() }),
  control_manual_resume_status: z.strictObject({ ...owned, channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid() }),
  control_manual_resume_review: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid() }),
  control_manual_resume_authorize_host: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(),
    targetHostId: HostID, transferID: z.string().uuid(), sourceStopped: z.literal(true) }),
  control_manual_resume_cancel_host: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(), transferID: z.string().uuid() }),
  control_manual_resume_reset: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(), recordID: z.string().uuid() }),
  control_manual_resume_takeover_prepare: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(), nextCoordinator: AgentID.optional() }),
  control_manual_resume_takeover_cancel: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(), takeoverID: z.string().uuid() }),
  control_manual_resume_takeover: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(), takeoverID: z.string().uuid(),
    previousCoordinator: AgentID, nextCoordinator: AgentID, previousRecordID: z.string().uuid(), nextRecordID: z.string().uuid(), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  control_manual_resume_confirm: z.strictObject({ channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(),
    recordID: z.string().uuid(), requestID: z.string().uuid(), receiptID: z.string().uuid(), sourceStopped: z.literal(true) }),
  control_manual_resume_observe: z.strictObject({ ...owned, credential: proof, channel: Channel, taskID: z.string().uuid(), previewID: z.string().uuid(), cwd: z.string().min(1).max(2048) }),
  control_command: z.strictObject({ agentId: AgentID.optional(), proof: proof.optional(), command: z.unknown(),
    expected: channelPrecondition.optional(), expectedTask: z.strictObject({ taskID: z.string().uuid(), digest: proof }).optional() }),
  control_worktree_authorize: z.strictObject({ ...owned, credential: proof, channel: Channel, grant: z.unknown(), peerGrant: z.unknown().optional(), action: z.enum(['checkpoint-inspect', 'cleanup-provider', 'release-provider', 'observe-provider', 'cleanup-mcp', 'observe-mcp', 'observe-destination-owners', 'observe-destination-step', 'prepare-destination-step', 'dispose-destination-step', 'bind-destination-grant', 'handoff-receiver', 'cancel-destination-grant', 'shutdown-source-mcp', 'observe-source-mcp-shutdown', 'retire-source-contained', 'observe-source-contained-retirement', 'shutdown-source-model', 'observe-source-model-shutdown', 'observe-worktree', 'observe-moved-worktree', 'seal-worktree-membership', 'detach-worktree-membership', 'check-codex-source-receiver', 'place-worktree']).optional() }).refine(p => ['observe-destination-owners', 'observe-destination-step', 'prepare-destination-step', 'dispose-destination-step'].includes(p.action) === (p.peerGrant !== undefined)),
  control_checkpoint_observe: z.strictObject({ ...owned, credential: proof, channel: Channel, requestID: z.string().uuid(), grant: z.unknown(), reservation: z.unknown(), stageDestination: z.boolean().optional() }),
  control_checkpoint_observation: z.strictObject({ channel: Channel, requestID: z.string().uuid() }),
  control_receiver_offer: z.strictObject({ ...owned, credential: proof, channel: Channel, grant: z.unknown(), receiverKeyHash: proof }),
  control_receiver_ready: z.strictObject({ ...owned, credential: proof, channel: Channel, offerID: z.string().uuid() }),
  control_receiver_commit: z.strictObject({ ...owned, credential: proof, channel: Channel, offerID: z.string().uuid() }),
  control_receiver_detached: z.strictObject({ agentId: AgentID, offerID: z.string().uuid() }),
  control_receiver_check_source: z.strictObject({ ...owned, credential: proof, channel: Channel, offerID: z.string().uuid() }),
  control_receiver_recover_source: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid() }),
  control_receiver_recover_owner: z.strictObject({ ...owned, credential: proof, channel: Channel, grant: z.unknown(), receiverKeyHash: proof }),
  control_receiver_release: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid() }),
  control_receiver_release_verified: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid(), ownerGeneration: z.string().uuid().optional(), ownerProof: proof.optional() }),
  control_receiver_owner_activate: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid(), ownerGeneration: z.string().uuid() }),
  control_receiver_owner_status: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid(), ownerGeneration: z.string().uuid() }),
  control_receiver_owner_drain: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid(), ownerGeneration: z.string().uuid(),
    nextGrant: z.unknown(), drainID: z.string().uuid(), ownerProof: proof }),
  control_receiver_owner_drain_observe: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid(), ownerGeneration: z.string().uuid(),
    nextGrant: z.unknown(), drainID: z.string().uuid(), ownerProof: proof }),
  control_receiver_owner_endpoint: z.strictObject({ agentId: AgentID, channel: Channel, transitionID: z.string().uuid() }),
  control_receiver_observe_verified: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid() }),
  control_receiver_observe_prepared: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid() }),
  control_receiver_observe: z.strictObject({ ...owned, credential: proof, channel: Channel, transitionID: z.string().uuid() }),
  control_codex_effect_begin: z.strictObject({ ...owned, credential: proof, channel: Channel, grant: z.unknown(), effectID: z.string().uuid(),
    kind: z.enum(['stop', 'remove']), resourceID: z.string().uuid(), ownerProof: proof }),
  control_codex_effect_bind_arbiter: z.strictObject({ ...owned, credential: proof, channel: Channel, grant: z.unknown() }),
  control_codex_effect_finish: z.strictObject({ ...owned, credential: proof, channel: Channel, effectID: z.string().uuid(), ownerProof: proof }),
  control_codex_effect_status: z.strictObject({ ...owned, credential: proof, channel: Channel, effectID: z.string().uuid(), ownerProof: proof }),
  control_adapter: z.strictObject({ ...owned, credential: z.string().regex(/^[a-f0-9]{64}$/), command: z.unknown() }),
  control_query: z.strictObject({ channel: Channel, agentId: AgentID.optional(), proof: proof.optional(),
    view: z.enum(['channel', 'tasks', 'actions', 'incidents', 'events', 'messages', 'notices', 'previews', 'transitions', 'evidence', 'managedPreviews', 'health']),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    offset: z.number().int().min(0).max(100000).optional(), limit: z.number().int().min(1).max(100).optional(), entityID: z.string().uuid().optional() })
    .refine(p => !p.entityID || ['tasks', 'actions', 'incidents', 'evidence', 'previews', 'transitions', 'managedPreviews'].includes(p.view)),
  control_notice_ack: z.strictObject({ ...owned, credential: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().uuid(),
    receiptID: z.string().regex(/^msg_[a-zA-Z0-9_-]{1,124}$/) }),
  control_task_pull: z.strictObject({ ...owned, credential: z.string().regex(/^[a-f0-9]{64}$/), channel: Channel,
    cwd: z.string().min(1).max(2048), scopeDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
  control_task_watch: z.strictObject({ ...owned, credential: z.string().regex(/^[a-f0-9]{64}$/) }),
  control_authority_watch: z.strictObject({ ...owned, credential: proof, channel: Channel, grant: z.unknown().optional() }),
  control_enroll_adapter: z.strictObject({ hostId: HostID, credential: z.string().regex(/^[a-f0-9]{64}$/) }),
  control_revoke_adapter: z.strictObject({ hostId: HostID }),
  control_storage_reclaim: ReclamationRequest,
  control_storage_reclaim_history: HistoryReclamationRequest,
  control_delivery_pull: z.strictObject({ ...owned, credential: proof, messageID: z.string().uuid() }),
  control_delivery_finish: z.strictObject({ ...owned, credential: proof, actionID: z.string().uuid(), outcome: z.enum(['admitted', 'unadmitted', 'uncertain']), admissionID: bounded(128).optional() }),
  control_storage_status: z.strictObject({}),
  control_storage_watch: z.strictObject({}),
  control_receipt: z.strictObject({ channel: Channel, commandID: z.string().uuid() }),
  control_activity_status: z.strictObject({}),
  control_alerts: z.strictObject({ ...owned, channel: Channel }),
  control_notifications: z.strictObject({ channel: Channel, after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(100).optional(), pendingOnly: z.boolean().optional(), id: z.string().uuid().optional() })
    .refine(p => !p.id || [p.after, p.limit, p.pendingOnly].every(value => value === undefined)),
  control_notification_ack: z.strictObject({ channel: Channel, id: z.string().uuid(), expected: channelPrecondition.optional() }),
  control_health_report: z.strictObject({ ...owned, credential: proof, report: AdapterHealthReport }),
  control_activity: z.strictObject({ channel: Channel, after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(100).optional() }),
  control_export: z.strictObject({ id: z.string().uuid() }),
  control_export_read: z.strictObject({ id: z.string().uuid(), offset: z.number().int().nonnegative().max(1024 * 1024 * 1024),
    limit: z.number().int().min(1).max(24576).optional() }),
};
const envelope = z.strictObject({ v: z.literal(PROTOCOL_VERSION), id: z.union([z.number().int().min(1).max(2147483647), bounded(128)]),
  method: bounded(64), params: z.unknown() });
export function parseRequest(raw) {
  if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) throw new Error('Frame too large');
  const parsed = envelope.parse(JSON.parse(raw));
  try {
    if (!Object.hasOwn(methods, parsed.method)) { const error = new Error('Unknown protocol method'); error.name = 'ProtocolError'; throw error; }
    return { ...parsed, params: methods[parsed.method].parse(parsed.params) };
  }
  catch (error) { error.requestId = parsed.id; throw error; }
}
const agent = z.object({ agentId: AgentID, hostId: HostID, harness: Harness, sessionId: SessionID,
  channel: Channel, name: Name, role: bounded(512), project,
  lastSeenAt: z.number().finite().optional(), disconnectedAt: z.number().finite().nullable().optional(),
  reservationExpiresAt: z.number().finite().nullable().optional() }).strict();
const message = z.object({ id: z.string().uuid(), messageId: bounded(128), to: z.union([AgentID, z.literal('*')]), channel: Channel,
  from: agent, text: z.string().min(1).max(16000), createdAt: z.string().datetime(),
  recipients: z.array(AgentID).max(32), delivered: z.array(AgentID).max(32),
  cancelled: z.record(AgentID, z.string()).default({}), offered: z.array(AgentID).max(32).optional() }).strict();
const manualResumeObservation = z.strictObject({ version: z.union([z.literal(1), z.literal(2)]), taskID: z.string().uuid(), previewID: z.string().uuid(), channel: Channel,
  claimGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), from: bounded(2048), to: bounded(2048),
  coordinator: AgentID, recordID: z.string().uuid(), status: z.enum(['armed', 'detached', 'uncertain', 'confirmed']),
  requestID: z.string().uuid().optional(), receiptID: z.string().uuid().optional(), reportRecordID: z.string().uuid().optional(), sourceStopped: z.literal(true).optional(),
  hostTransfer: z.strictObject({ id: z.string().uuid(), from: HostID, to: HostID, sourceStopped: z.literal(true),
    status: z.enum(['pending', 'completed', 'cancelled']) }).optional(),
  hostTransferCancellations: z.array(z.string().uuid()).max(MAX_MANUAL_HOST_CANCELLATIONS).optional(),
  pendingTakeover: z.strictObject({ id: z.string().uuid(), previousCoordinator: AgentID, nextCoordinator: AgentID,
    previousRecordID: z.string().uuid(), nextRecordID: z.string().uuid(), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).optional(),
  takeoverCancellations: z.array(z.string().uuid()).max(32).optional(),
  takeovers: z.array(z.strictObject({ id: z.string().uuid(), previousCoordinator: AgentID, nextCoordinator: AgentID,
    previousRecordID: z.string().uuid(), nextRecordID: z.string().uuid(), generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(32).optional() })
  .refine(v => v.status === 'confirmed' ? !!v.requestID && !!v.receiptID && v.sourceStopped === true :
    v.requestID === undefined && v.receiptID === undefined && v.reportRecordID === undefined && v.sourceStopped === undefined)
  .refine(v => !v.takeovers || v.takeovers.every(item => item.previousCoordinator !== item.nextCoordinator && item.previousRecordID !== item.nextRecordID))
  .refine(v => { const entries = v.takeovers || []; return (!entries.length || (v.hostTransfer?.status === 'completed' &&
    entries.at(-1).nextCoordinator === v.coordinator && entries.at(-1).nextRecordID === v.recordID)) &&
    entries.every((item, index) => index === 0 || (entries[index - 1].nextCoordinator === item.previousCoordinator && entries[index - 1].nextRecordID === item.previousRecordID)); })
  .refine(v => !v.pendingTakeover || (v.status === 'detached' && v.pendingTakeover.previousCoordinator === v.coordinator &&
    v.hostTransfer?.status === 'completed' && v.pendingTakeover.previousRecordID === v.recordID && v.pendingTakeover.previousCoordinator !== v.pendingTakeover.nextCoordinator &&
    v.pendingTakeover.previousRecordID !== v.pendingTakeover.nextRecordID))
  .refine(v => { const ids = [...(v.takeoverCancellations || []), ...(v.takeovers || []).map(item => item.id), ...(v.pendingTakeover ? [v.pendingTakeover.id] : [])]; return new Set(ids).size === ids.length; })
  .refine(v => { const ids = v.hostTransferCancellations || []; return new Set(ids).size === ids.length && (!v.hostTransfer || !ids.includes(v.hostTransfer.id)); })
  .refine(v => v.version === 1 ? v.hostTransfer === undefined : !!v.hostTransfer && v.hostTransfer.from !== v.hostTransfer.to &&
    (v.hostTransfer.status !== 'pending' || v.status === 'detached') &&
    (v.hostTransfer.status !== 'completed' || ['detached', 'confirmed'].includes(v.status)));
export const Store = z.strictObject({ version: z.literal(3), agents: z.record(AgentID, agent),
  codexEffectFence: z.strictObject({ version: z.literal(1), phase: z.enum(['active', 'revocation_pending']), effectID: z.string().uuid(),
    agentId: AgentID, hostId: HostID, channel: Channel, transitionID: z.string().uuid(), resourceID: z.string().uuid(), kind: z.enum(['stop', 'remove']),
    receiverHash: proof, grantDigest: proof, ownerProofHash: proof,
    pending: z.strictObject({ method: z.string().min(1).max(64), principal: z.string().min(1).max(64), fingerprint: proof }).optional(),
    pendingQueue: z.array(z.strictObject({ method: z.string().min(1).max(64), principal: z.string().min(1).max(64), fingerprint: proof })).max(16).optional(),
    pendingConflict: z.boolean().optional(), replayUncertain: z.boolean().optional(),
    revocationMode: z.literal('immediate_session_host_adapter_no_new_effects').optional(), revocationRequested: z.boolean().optional() }).optional(),
  bindings: z.record(AgentID, z.strictObject({ hostId: HostID, proofHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), revoked: z.boolean().default(false), receiverHash: proof.optional(),
    manualResume: manualResumeObservation.optional(), manualResumeHistory: z.array(manualResumeObservation).max(256).optional(),
    ownerDrain: z.strictObject({ version: z.literal(1), drainID: z.string().uuid(), oldTransitionID: z.string().uuid(), nextTransitionID: z.string().uuid(),
      ownerGeneration: z.string().uuid(), oldReceiverHash: proof, containment: OpenCodeContainment.optional(), phase: z.enum(['draining', 'rotated', 'detached']) }).optional(),
    receiverHandoff: z.strictObject({ transitionID: z.string().uuid(), taskID: z.string().uuid(), previewID: z.string().uuid(),
      claimGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), channel: Channel,
      from: z.string().min(1).max(2048), to: z.string().min(1).max(2048), configurationDigest: proof, authorityDigest: proof,
      status: z.enum(['held', 'released']), sourceDetached: z.boolean().default(false),
      sourceRecovery: z.strictObject({ version: z.literal(1), previousLease: z.string().uuid(), currentLease: z.string().uuid(),
        sealLease: z.string().uuid(), sealNonce: z.string().uuid() }).optional(),
      nativeCompletion: z.strictObject({ version: z.literal(1), receiptID: z.string().uuid(), receiverHash: proof,
        eventID: z.string().startsWith('evt_').max(1024), eventSeq: z.number().int().nonnegative().safe(), leaseIncarnation: z.string().uuid() }).optional(),
      ownerPreparation: z.strictObject({ version: z.literal(1), generation: z.string().uuid(), receiverHash: proof, receiptID: z.string().uuid(), activated: z.boolean().optional(), containment: OpenCodeContainment.optional(), endpointAuthority: z.literal('host').optional(),
        endpoint: z.strictObject({ name: z.string().regex(/^turnlink-[0-9a-f-]{36}\.json$/), device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/), digest: proof }).optional() }).optional() }).optional() })),
  messages: z.array(message).max(10000),
  wakePolicies: z.record(AgentID, z.strictObject({ channel: Channel, policy: z.enum(['steer', 'queue', 'paused']), actionID: z.string().uuid() })).optional(),
  deliveryRetries: z.record(z.string().uuid(), z.strictObject({ channel: Channel, target: AgentID, messageID: z.string().uuid(), outcome: z.enum(['admitted', 'unadmitted', 'uncertain']).optional(), evidenceID: z.string().uuid().optional(), admissionID: bounded(128).optional() })).optional(),
  deliveryPauses: z.record(AgentID, z.strictObject({ channel: Channel, actionID: z.string().uuid() })).optional(),
  effectReceipts: z.record(z.string().uuid(), z.strictObject({ id: z.string().uuid(), channel: Channel, target: AgentID,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/), outcome: z.enum(['succeeded', 'failed']), at: z.number().int().nonnegative() })).optional() });
export const Security = z.strictObject({ version: z.literal(1), hosts: z.record(HostID, z.strictObject({
  hostId: HostID, tokenHash: z.string().regex(/^[a-f0-9]{64}$/), channels: z.array(z.union([Channel, z.literal('*')])).min(1).max(32),
  broadcast: z.boolean(), revoked: z.boolean(),
})) });
export function validateState(value) {
  const state = Store.parse(value);
  if (Object.keys(state.bindings).length > 8192) throw new Error('Stored binding limit exceeded');
  for (const [id, binding] of Object.entries(state.bindings)) if (binding.manualResume &&
    (!binding.proofHash || binding.manualResume.from === binding.manualResume.to || binding.manualResume.coordinator === id ||
      binding.receiverHandoff || binding.ownerDrain)) throw new Error('Invalid manual resume observation');
  for (const binding of Object.values(state.bindings)) if (binding.manualResume?.hostTransfer) {
    const transfer = binding.manualResume.hostTransfer;
    if (binding.hostId !== (transfer.status === 'completed' ? transfer.to : transfer.from)) throw new Error('Invalid manual host transfer binding');
  }
  for (const [id, binding] of Object.entries(state.bindings)) if (binding.manualResumeHistory?.some(item =>
    item.from === item.to || item.coordinator === id)) throw new Error('Invalid manual resume history');
  if (state.codexEffectFence) {
    const fence = state.codexEffectFence, binding = state.bindings[fence.agentId], hold = binding?.receiverHandoff;
    if (!fence.agentId.startsWith('codex:') || !binding || binding.revoked && fence.phase === 'active' && !fence.revocationRequested || binding.hostId !== fence.hostId ||
        binding.receiverHash !== fence.receiverHash || hold?.status !== 'held' || !hold.sourceDetached ||
        hold.transitionID !== fence.transitionID || hold.channel !== fence.channel ||
        fence.revocationRequested && fence.revocationMode !== 'immediate_session_host_adapter_no_new_effects' ||
        (fence.phase === 'revocation_pending' || fence.pendingConflict || fence.replayUncertain || fence.pendingQueue?.length) && !fence.pending ||
        fence.replayUncertain && fence.phase !== 'revocation_pending') throw new Error('Invalid Codex effect fence');
  }
  for (const [id, binding] of Object.entries(state.bindings)) if (binding.receiverHandoff &&
    (!binding.receiverHash || binding.proofHash !== binding.receiverHash ||
      (binding.receiverHandoff.status === 'released' && !binding.receiverHandoff.sourceDetached) ||
      (binding.receiverHandoff.nativeCompletion && (!id.startsWith('opencode:') || binding.receiverHandoff.status !== 'released' ||
        !binding.receiverHandoff.sourceDetached || binding.receiverHandoff.nativeCompletion.receiverHash !== binding.receiverHash)) ||
      (binding.receiverHandoff.ownerPreparation && (!binding.receiverHandoff.nativeCompletion ||
        binding.receiverHandoff.ownerPreparation.receiverHash !== binding.receiverHash ||
        (binding.receiverHandoff.ownerPreparation.containment && binding.receiverHandoff.ownerPreparation.containment.generation !== binding.receiverHandoff.ownerPreparation.generation) ||
        (binding.receiverHandoff.ownerPreparation.endpointAuthority === 'host' && !binding.receiverHandoff.ownerPreparation.containment) ||
        binding.receiverHandoff.ownerPreparation.receiptID !== binding.receiverHandoff.nativeCompletion.receiptID)) ||
      (binding.receiverHandoff.sourceRecovery && (!id.startsWith('opencode:') || !binding.receiverHandoff.sourceDetached ||
        binding.receiverHandoff.sourceRecovery.previousLease === binding.receiverHandoff.sourceRecovery.currentLease)))) throw new Error('Invalid stored receiver handoff');
  for (const [id, binding] of Object.entries(state.bindings)) if (binding.ownerDrain &&
    (!id.startsWith('opencode:') || !binding.receiverHandoff || binding.ownerDrain.oldTransitionID === binding.ownerDrain.nextTransitionID ||
      (binding.ownerDrain.containment && binding.ownerDrain.containment.generation !== binding.ownerDrain.ownerGeneration) ||
      (binding.ownerDrain.phase === 'draining' ? binding.receiverHandoff.transitionID !== binding.ownerDrain.oldTransitionID ||
        binding.receiverHash !== binding.ownerDrain.oldReceiverHash : binding.receiverHandoff.transitionID !== binding.ownerDrain.nextTransitionID ||
        (binding.ownerDrain.phase === 'rotated' && binding.receiverHandoff.status !== 'held') ||
        (binding.ownerDrain.phase === 'detached' && !binding.receiverHandoff.sourceDetached))))
    throw new Error('Invalid stored owner drain');
  for (const [id, a] of Object.entries(state.agents)) {
    if (id !== a.agentId || id !== `${a.harness}:${a.sessionId}` || state.bindings[id]?.hostId !== a.hostId) throw new Error('Invalid stored identity binding');
  }
  if (Object.keys(state.effectReceipts || {}).length > 4096 || Object.keys(state.deliveryPauses || {}).length > 4096) throw new Error('Stored effect limit exceeded');
  for (const [id, pause] of Object.entries(state.deliveryPauses || {})) {
    if (state.agents[id]?.channel !== pause.channel || !state.effectReceipts?.[pause.actionID] ||
      state.effectReceipts[pause.actionID].target !== id || state.effectReceipts[pause.actionID].channel !== pause.channel ||
      state.effectReceipts[pause.actionID].outcome !== 'succeeded') throw new Error('Invalid delivery pause');
  }
  for (const [id, policy] of Object.entries(state.wakePolicies || {})) if (state.agents[id]?.channel !== policy.channel || state.effectReceipts?.[policy.actionID]?.target !== id) throw new Error('Invalid wake policy');
  for (const [id, retry] of Object.entries(state.deliveryRetries || {})) if (state.effectReceipts?.[id]?.target !== retry.target || state.effectReceipts[id].channel !== retry.channel || !state.messages.some(m => m.id === retry.messageID && m.channel === retry.channel && m.recipients.includes(retry.target))) throw new Error('Invalid delivery retry');
  for (const m of state.messages) if (m.offered && (new Set(m.offered).size !== m.offered.length || m.offered.some(id => !m.recipients.includes(id)))) throw new Error('Invalid delivery exposure');
  return state;
}
export function parseFrame(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || value.v !== PROTOCOL_VERSION) throw new Error('Unsupported broker protocol');
  if (value.event === 'message') {
    z.strictObject({ v: z.literal(2), event: z.literal('message'), message }).parse(value);
  } else if (value.event === 'membership_removed') {
    z.strictObject({ v: z.literal(2), event: z.literal('membership_removed'), agentId: AgentID, reason: bounded(128) }).parse(value);
  } else if (value.event === 'presence') {
    z.strictObject({ v: z.literal(2), event: z.literal('presence'), agent }).parse(value);
  } else if (value.event === 'task_available') {
    z.strictObject({ v: z.literal(2), event: z.literal('task_available'), agentId: AgentID }).parse(value);
  } else if (value.event === 'receiver_handoff') {
    z.strictObject({ v: z.literal(2), event: z.literal('receiver_handoff'), agentId: AgentID, offerID: z.string().uuid(), role: z.enum(['source', 'target']) }).parse(value);
  } else if (value.event === 'receiver_handoff_offer') {
    z.strictObject({ v: z.literal(2), event: z.literal('receiver_handoff_offer'), agentId: AgentID, offerID: z.string().uuid(), grant: z.unknown() }).parse(value);
  } else if (value.event === 'receiver_handoff_check_source') {
    z.strictObject({ v: z.literal(2), event: z.literal('receiver_handoff_check_source'), agentId: AgentID, offerID: z.string().uuid() }).parse(value);
  } else if (value.event === 'control_storage') {
    z.strictObject({ v: z.literal(2), event: z.literal('control_storage'), status: StorageStatus }).parse(value);
  } else {
    z.strictObject({ v: z.literal(2), id: z.union([z.string(), z.number(), z.null()]), result: z.unknown().optional(), error: z.string().min(1).max(512).optional() })
      .refine(v => Object.hasOwn(v, 'result') !== Object.hasOwn(v, 'error')).parse(value);
  }
  return value;
}
