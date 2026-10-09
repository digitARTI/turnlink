import { z } from 'zod';

export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 65536;
export const MAX_RESPONSE_BYTES = 49152;
export const MAX_TEXT_BYTES = 12000;
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
const methods = {
  hello: z.strictObject({}),
  join: z.strictObject({ harness: Harness, sessionId: SessionID, proof, channel: Channel,
    name: Name, role: bounded(512), project }),
  subscribe: z.strictObject(owned), unsubscribe: z.strictObject(owned), leave: z.strictObject(owned), resume: z.strictObject(owned),
  send: z.strictObject({ ...owned, to: z.union([AgentID, z.literal('*')]),
    text: z.string().min(1).max(16000).refine(s => s.trim().length > 0 && Buffer.byteLength(s) <= MAX_TEXT_BYTES),
    messageId: bounded(128) }),
  ack: z.strictObject({ ...owned, id: z.string().uuid() }),
  members: z.strictObject(query), history: z.strictObject(query),
  release: z.strictObject({ channel: Channel, name: Name }),
  enroll: z.strictObject({ hostId: HostID, credential: z.string().regex(/^[a-f0-9]{64}$/),
    channels: z.array(z.union([Channel, z.literal('*')])).min(1).max(32), broadcast: z.boolean(),
    adopt: z.array(AgentID).max(128).optional() }),
  revoke: z.strictObject({ hostId: HostID }),
  revoke_session: z.strictObject({ agentId: AgentID }),
  handoff: z.strictObject({}),
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
  cancelled: z.record(AgentID, z.string()).default({}) }).strict();
export const Store = z.strictObject({ version: z.literal(3), agents: z.record(AgentID, agent),
  bindings: z.record(AgentID, z.strictObject({ hostId: HostID, proofHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), revoked: z.boolean().default(false) })),
  messages: z.array(message).max(10000) });
export const Security = z.strictObject({ version: z.literal(1), hosts: z.record(HostID, z.strictObject({
  hostId: HostID, tokenHash: z.string().regex(/^[a-f0-9]{64}$/), channels: z.array(z.union([Channel, z.literal('*')])).min(1).max(32),
  broadcast: z.boolean(), revoked: z.boolean(),
})) });
export function validateState(value) {
  const state = Store.parse(value);
  if (Object.keys(state.bindings).length > 8192) throw new Error('Stored binding limit exceeded');
  for (const [id, a] of Object.entries(state.agents)) {
    if (id !== a.agentId || id !== `${a.harness}:${a.sessionId}` || state.bindings[id]?.hostId !== a.hostId) throw new Error('Invalid stored identity binding');
  }
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
  } else {
    z.strictObject({ v: z.literal(2), id: z.union([z.string(), z.number(), z.null()]), result: z.unknown().optional(), error: z.string().min(1).max(512).optional() })
      .refine(v => Object.hasOwn(v, 'result') !== Object.hasOwn(v, 'error')).parse(value);
  }
  return value;
}
