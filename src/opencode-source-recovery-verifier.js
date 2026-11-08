import { z } from 'zod';
import { digest } from './config.js';
import { AgentID, Channel, HostID } from './protocol.js';
import { WorktreeTransition } from './control/contracts.js';
import { membershipSealSchema } from './opencode-native-recovery.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const NativeSourceRecoveryProof = z.strictObject({ version: z.literal(1), hostId: HostID, agentId: AgentID,
  channel: Channel, transitionID: z.string().uuid(), from: z.string(), to: z.string(), receiverHash: hash,
  previousLease: z.string().uuid(), currentLease: z.string().uuid(), sealLease: z.string().uuid(), sealNonce: z.string().uuid() });

// Construct this only in the trusted broker host with an already claimed
// native recovery owner. Caller-supplied evidence is never accepted.
export function makeOpenCodeSourceRecoveryVerifier({ recovery, client, mode = 'live' }) {
  if (!recovery?.inspect || !recovery?.observeLiveDetachment || !recovery?.observeDetachedMembership ||
    !(client?.receiverKeys instanceof Map) || !['live', 'successor'].includes(mode)) throw new Error('Native source recovery unavailable');
  return async ({ grant: value, hostId, receiverHash, signal }) => {
    const grant = WorktreeTransition.parse(value);
    const current = () => !signal?.aborted && client.hostId === hostId &&
      digest(client.receiverKeys.get(grant.agentId) || '') === receiverHash;
    if (!current() || !grant.agentId.startsWith('opencode:') || !['prepared', 'uncertain'].includes(grant.status) || grant.purpose)
      throw new Error('Native source recovery unavailable');
    const before = await recovery.inspect(grant);
    const detached = await (mode === 'live' ? recovery.observeLiveDetachment(grant) : recovery.observeDetachedMembership(grant));
    const after = await recovery.inspect(grant);
    if (!current() || detached.status !== 'detached' || before.membershipPresent || after.membershipPresent ||
      !before.membershipSeal || !after.membershipSeal || JSON.stringify(before.recovery) !== JSON.stringify(after.recovery) ||
      JSON.stringify(before.membershipSeal) !== JSON.stringify(after.membershipSeal) ||
      JSON.stringify(detached.seal) !== JSON.stringify(after.membershipSeal)) throw new Error('Native source recovery unavailable');
    const seal = membershipSealSchema.parse(after.membershipSeal), owner = after.recovery;
    const sessionID = grant.agentId.slice('opencode:'.length);
    if (owner.sessionID !== sessionID || owner.transitionID !== grant.id || owner.previousLeaseIncarnation === owner.leaseIncarnation ||
      seal.sessionID !== sessionID || seal.transitionID !== grant.id || seal.pluginID !== 'turnlink' ||
      seal.source.directory !== grant.from || seal.destination !== grant.to ||
      (mode === 'live' ? seal.leaseIncarnation !== owner.previousLeaseIncarnation : seal.leaseIncarnation === owner.previousLeaseIncarnation) ||
      after.session.id !== sessionID || after.session.location.directory !== grant.from)
      throw new Error('Native source recovery unavailable');
    return NativeSourceRecoveryProof.parse({ version: 1, hostId, agentId: grant.agentId, channel: grant.channel,
      transitionID: grant.id, from: grant.from, to: grant.to, receiverHash,
      previousLease: owner.previousLeaseIncarnation, currentLease: owner.leaseIncarnation, sealLease: seal.leaseIncarnation, sealNonce: seal.nonce });
  };
}
