import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Rpc } from '@opencode/plugin/rpc';
import { Command, WorktreeTransition } from '../src/control/contracts.js';
import { digest, matches, receiverHandoffKey, validateCredential } from '../src/config.js';
import { readPrivate } from '../src/storage.js';
import { retryBrokerPreDispatch } from '../src/broker-rate-limit.js';

const credential = z.string().regex(/^[a-f0-9]{64}$/);
const input = z.strictObject({ token: credential, credential, grant: WorktreeTransition });
const offerInput = input.extend({ previousTransitionID: z.string().uuid().optional() });
const sourceInput = input.extend({ method: z.enum(['bind', 'authorize', 'idle', 'watch']), epoch: z.number().int().nonnegative().safe().optional(), incarnation: z.string().uuid().optional() });
const request = input.extend({ method: z.enum(['authorize', 'observe', 'checkSource', 'recoverSource', 'recoveryIdle', 'releaseVerified', 'settlePlacement', 'ownerActivate', 'ownerStatus', 'ownerDrain', 'ownerDrainObserve', 'nextAdapter', 'nextAuthorize']),
  ownerGeneration: z.string().uuid().optional(),
  ownerProof: credential.optional(),
  drainID: z.string().uuid().optional(),
  nextTaskID: z.string().uuid().optional(), nextCommand: z.unknown().optional(), nextGrant: WorktreeTransition.optional(),
  action: z.enum(['observe-worktree', 'observe-moved-worktree', 'detach-worktree-membership', 'place-worktree']).optional(), offerID: z.string().uuid().optional(),
  settlement: z.strictObject({ commandID: z.string().uuid(), receiptID: z.string().uuid() }).optional(),
  epoch: z.number().int().nonnegative().safe(), incarnation: z.string().uuid(), receiverHash: credential });
const status = z.strictObject({ state: z.enum(['pending', 'held', 'prepared', 'released']), hostId: z.string().nullable(),
  receiverHash: credential.optional(), offerID: z.string().uuid().optional(), sourceDetached: z.boolean().optional(),
  receiptID: z.string().uuid().optional(), epoch: z.number().int().nonnegative().safe(), incarnation: z.string().uuid() });
export const TurnlinkMovement = Rpc.define({ id: 'turnlink.movement', methods: {
  offer: { input: offerInput, output: z.strictObject({ offerID: z.string().uuid() }) },
  resume: { input, output: status },
  reconcile: { input, output: status },
  status: { input, output: status },
  request: { input: request, output: z.record(z.string(), z.unknown()) },
  source: { input: sourceInput, output: z.record(z.string(), z.unknown()) },
}, events: {} });

// The RPC is registered only in an explicitly opted-in Location. The separate
// file-backed capability is not an adapter credential and is never returned.
export function makeOpenCodeMovementRpc({ ctx, channel, options, signal, onCandidate }) {
  const candidates = new Map();
  const sources = new Map(), sourceIncarnation = randomUUID(); let sourceEpoch = 0;
  const ownsCandidate = (agentId, marker) => {
    const candidate = candidates.get(agentId);
    return !!candidate && candidate.grant.id === marker.transitionID;
  };
  const binding = (agentId, marker) => {
    const candidate = candidates.get(agentId), key = channel.receiverKeys.get(agentId);
    if (!ownsCandidate(agentId, marker) || !key || digest(key) !== marker.receiverHash ||
      candidate.hostId !== channel.hostId || !channel.activeSubscriptions.has(agentId) || channel.socket?.readyState !== 1) return undefined;
    return { candidate, key, socket: channel.socket, epoch: candidate.epoch };
  };
  const announce = candidate => {
    const key = channel.receiverKeys.get(candidate.grant.agentId);
    if (key && channel.activeSubscriptions.has(candidate.grant.agentId)) onCandidate?.(candidate.grant, digest(key));
  };
  const sameIdentity = (a, b) => ['id', 'agentId', 'channel', 'taskID', 'previewID', 'claimGeneration', 'from', 'to',
    'configurationDigest', 'authorityDigest', 'pluginProvenanceDigest', 'nativeAuthorityObservationDigest', 'preparedAt'].every(key => a[key] === b[key]);
  const check = (args, existing = true) => {
    const capability = validateCredential(readPrivate(options.movementTokenFile, 128).trim());
    const adapter = validateCredential(readPrivate(options.adapterTokenFile, 128).trim());
    const host = validateCredential(readPrivate(options.tokenFile, 128).trim());
    if (signal.aborted || matches(capability, digest(adapter)) || matches(capability, digest(host)) || !matches(args.token, digest(capability)) ||
      !matches(args.credential, digest(adapter))) throw new Error('Movement capability unavailable');
    const grant = WorktreeTransition.parse(args.grant);
    if (!grant.agentId.startsWith('opencode:') || grant.to !== ctx.location.directory || !['prepared', 'uncertain', 'moved'].includes(grant.status) || grant.purpose)
      throw new Error('Movement candidate unavailable');
    const candidate = candidates.get(grant.agentId);
    if (existing && (!candidate || !sameIdentity(candidate.grant, grant))) throw new Error('Movement candidate unavailable');
    return { grant, candidate };
  };
  // The source owner never obtains the plugin's session proof. Every request
  // uses the actual subscribed plugin socket and checks the native session
  // and membership on both sides of the broker operation.
  const source = async args => {
    if (options.initialMovement !== true || signal.aborted) throw new Error('Movement source unavailable');
    const capability = validateCredential(readPrivate(options.movementTokenFile, 128).trim());
    const adapter = validateCredential(readPrivate(options.adapterTokenFile, 128).trim());
    const host = validateCredential(readPrivate(options.tokenFile, 128).trim());
    if (matches(capability, digest(adapter)) || matches(capability, digest(host)) || !matches(args.token, digest(capability)) ||
        !matches(args.credential, digest(adapter))) throw new Error('Movement capability unavailable');
    const grant = WorktreeTransition.parse(args.grant), sessionID = grant.agentId.slice('opencode:'.length);
    if (!grant.agentId.startsWith('opencode:ses_') || grant.status !== 'prepared' || grant.purpose || grant.from !== ctx.location.directory ||
        grant.to === grant.from || !channel.hostId || !channel.activeSubscriptions.has(grant.agentId) || channel.socket?.readyState !== 1)
      throw new Error('Movement source unavailable');
    const socket = channel.socket, hostId = channel.hostId, epoch = sourceEpoch;
    const current = () => {
      if (signal.aborted || sourceEpoch !== epoch || channel.socket !== socket || socket.readyState !== 1 ||
          channel.hostId !== hostId || !channel.activeSubscriptions.has(grant.agentId)) throw new Error('Movement source unavailable');
    };
    const inspect = async () => {
      const [session, membership] = await Promise.all([ctx.session.get({ sessionID }, { signal }), ctx.storage.get(`memberships/${sessionID}`)]);
      current();
      if (session?.id !== sessionID || session.location?.directory !== grant.from || membership?.sessionID !== sessionID ||
          membership.directory !== grant.from || membership.channel !== grant.channel || membership.receiverHandoff) throw new Error('Movement source unavailable');
      return membership;
    };
    const membership = await inspect();
    if (args.method === 'bind') {
      const prior = sources.get(grant.agentId);
      if (args.epoch !== undefined || args.incarnation !== undefined || (prior && (prior.socket !== socket || prior.hostId !== hostId ||
          prior.epoch !== epoch || JSON.stringify(prior.grant) !== JSON.stringify(grant)))) throw new Error('Movement source unavailable');
      const authorized = await channel.request('control_worktree_authorize', { agentId: grant.agentId, channel: grant.channel,
        credential: args.credential, grant, action: 'observe-worktree' });
      current(); if (JSON.stringify(WorktreeTransition.parse(authorized.grant)) !== JSON.stringify(grant)) throw new Error('Movement source unavailable');
      await inspect(); sources.set(grant.agentId, { grant, socket, hostId, epoch });
      return { hostId, epoch, incarnation: sourceIncarnation };
    }
    const saved = sources.get(grant.agentId);
    if (!saved || saved.socket !== socket || saved.hostId !== hostId || saved.epoch !== epoch || args.epoch !== epoch ||
        args.incarnation !== sourceIncarnation || JSON.stringify(saved.grant) !== JSON.stringify(grant)) throw new Error('Movement source unavailable');
    let result;
    if (args.method === 'idle') {
      if (typeof ctx.session.wait !== 'function' || typeof ctx.permission?.list !== 'function' || typeof ctx.session.context !== 'function')
        throw new Error('Movement source unavailable');
      await ctx.session.wait({ sessionID }, { signal });
      const [permissions, context] = await Promise.all([ctx.permission.list({ sessionID }, { signal }), ctx.session.context({ sessionID }, { signal })]);
      current();
      if (!Array.isArray(permissions) || permissions.length || !Array.isArray(context) || !Array.isArray(membership.forms) || membership.forms.length ||
          context.some(message => message.type === 'assistant' && message.content?.some(part => part.type === 'tool' && part.name === 'question' && ['running', 'streaming'].includes(part.state?.status))))
        throw new Error('Movement source unavailable');
      const confirmed = await inspect(); if (JSON.stringify(confirmed) !== JSON.stringify(membership)) throw new Error('Movement source unavailable');
      result = await channel.request('control_adapter', { agentId: grant.agentId, credential: args.credential,
        command: { id: randomUUID(), channel: grant.channel, op: 'evidence.record', entityID: grant.taskID, kind: 'idle' } });
    } else if (args.method === 'watch') {
      result = await channel.request('control_authority_watch', { agentId: grant.agentId, channel: grant.channel, credential: args.credential, grant });
      if (result?.watching !== true) throw new Error('Movement source unavailable');
    } else {
      result = await channel.request('control_worktree_authorize', { agentId: grant.agentId, channel: grant.channel, credential: args.credential, grant });
      if (JSON.stringify(WorktreeTransition.parse(result.grant)) !== JSON.stringify(grant)) throw new Error('Movement source unavailable');
    }
    current(); await inspect(); return result;
  };
  const offer = async args => {
    const { grant } = check(args, false);
    if (grant.status !== 'prepared') throw new Error('Movement candidate unavailable');
    if (args.previousTransitionID && (options.nextMovement !== true || args.previousTransitionID === grant.id)) throw new Error('Movement candidate unavailable');
    if (candidates.has(grant.agentId)) throw new Error('Movement candidate already exists');
    const candidate = { grant, offerID: undefined, hostId: undefined, epoch: 0, incarnation: randomUUID() };
    candidates.set(grant.agentId, candidate);
    // Keep the entry if the reply is lost: creating another offer would guess
    // whether the source committed the first one.
    await channel.connect();
    candidate.hostId = channel.hostId;
    check(args);
    if (args.previousTransitionID) {
      if (channel.receiverKeys.has(grant.agentId) || channel.subscriptions.has(grant.agentId)) throw new Error('Movement candidate unavailable');
      channel.receiverKeys.set(grant.agentId, receiverHandoffKey(candidate.hostId, grant.agentId, args.previousTransitionID, options.credentialDirectory));
    }
    const result = await channel.offerReceiverHandoff(grant.agentId, args.credential, grant);
    if (check(args).candidate !== candidate || signal.aborted || (candidate.offerID && candidate.offerID !== result.offerID))
      throw new Error('Movement candidate unavailable');
    candidate.offerID = result.offerID;
    return { offerID: result.offerID };
  };
  const status = async args => {
    const { grant, candidate } = check(args);
    const key = channel.receiverKeys.get(grant.agentId);
    if (!key || !channel.activeSubscriptions.has(grant.agentId)) return { state: 'pending', hostId: channel.hostId, epoch: candidate.epoch, incarnation: candidate.incarnation,
      ...(candidate.offerID ? { offerID: candidate.offerID } : {}) };
    const epoch = candidate.epoch, socket = channel.socket;
    const current = () => {
      if (check(args).candidate !== candidate || signal.aborted || candidate.epoch !== epoch || channel.socket !== socket ||
          socket?.readyState !== 1 || channel.hostId !== candidate.hostId || channel.receiverKeys.get(grant.agentId) !== key ||
          !channel.activeSubscriptions.has(grant.agentId)) throw new Error('Movement receiver unavailable');
    };
    const request = (method, params) => retryBrokerPreDispatch(() => channel.request(method, params), { check: current, signal });
    try {
      await request('control_worktree_authorize', { agentId: grant.agentId, channel: grant.channel,
        credential: args.credential, grant, action: grant.status === 'moved' ? 'observe-moved-worktree' : 'observe-worktree' });
    } catch (error) {
      if (grant.status === 'moved' && ['RECEIVER_HANDOFF_UNAVAILABLE', 'STALE_TASK_CLAIM', 'WORKTREE_TRANSITION_UNRESOLVED'].includes(error.message)) {
        let confirmed;
        try { confirmed = await request('control_receiver_observe_verified', { agentId: grant.agentId, channel: grant.channel,
          credential: args.credential, transitionID: grant.id }); }
        catch (error) {
          if (error.message !== 'RECEIVER_HANDOFF_UNAVAILABLE') throw error;
          confirmed = await request('control_receiver_observe_prepared', { agentId: grant.agentId, channel: grant.channel,
            credential: args.credential, transitionID: grant.id });
        }
        current();
        if (check(args).candidate !== candidate || signal.aborted || candidate.epoch !== epoch ||
          channel.receiverKeys.get(grant.agentId) !== key || !channel.activeSubscriptions.has(grant.agentId) ||
          !['released', 'prepared'].includes(confirmed.status) || confirmed.sourceDetached !== true || confirmed.transitionID !== grant.id ||
          confirmed.receiverHash !== digest(key) || confirmed.receiptID !== grant.receiptID) throw new Error('Movement receiver unavailable');
        return { state: confirmed.status, hostId: channel.hostId, receiverHash: digest(key), sourceDetached: true,
          receiptID: confirmed.receiptID, epoch, incarnation: candidate.incarnation, ...(candidate.offerID ? { offerID: candidate.offerID } : {}) };
      }
      throw error;
    }
    const hold = await request('control_receiver_observe', { agentId: grant.agentId, credential: args.credential, transitionID: grant.id, channel: grant.channel });
    current();
    if (check(args).candidate !== candidate || signal.aborted || candidate.epoch !== epoch || channel.receiverKeys.get(grant.agentId) !== key || hold.status !== 'held' || hold.transitionID !== grant.id)
      throw new Error('Movement receiver unavailable');
    announce(candidate);
    return { state: 'held', hostId: channel.hostId, receiverHash: digest(key), epoch, incarnation: candidate.incarnation,
      ...(candidate.offerID ? { offerID: candidate.offerID } : {}), sourceDetached: hold.sourceDetached };
  };
  const resume = async args => {
    const { grant } = check(args, false);
    if (candidates.has(grant.agentId)) throw new Error('Movement candidate already exists');
    const candidate = { grant, offerID: undefined, hostId: undefined, epoch: 0, incarnation: randomUUID() };
    candidates.set(grant.agentId, candidate);
    let key, preexisting = false, adoptedExisting = false;
    try {
      await channel.connect();
      candidate.hostId = channel.hostId;
      key = receiverHandoffKey(channel.hostId, grant.agentId, grant.id, options.credentialDirectory);
      check(args);
      preexisting = channel.subscriptions.has(grant.agentId);
      if (preexisting) {
        if (channel.receiverKeys.get(grant.agentId) !== key) throw new Error('Movement receiver unavailable');
        adoptedExisting = true;
        return await status(args);
      }
      await channel.resumeReceiverHandoff(grant.agentId, grant.id);
      if (channel.receiverKeys.get(grant.agentId) !== key) throw new Error('Movement receiver unavailable');
      return await status(args);
    } catch (error) {
      if (preexisting) {
        if (!adoptedExisting) candidates.delete(grant.agentId);
        throw error;
      }
      if (key) {
        channel.receiverKeys.set(grant.agentId, key);
        try { await channel.unsubscribe(grant.agentId); candidates.delete(grant.agentId); }
        catch { channel.socket?.terminate(); }
        channel.receiverKeys.delete(grant.agentId);
      } else candidates.delete(grant.agentId);
      throw error;
    }
  };
  const reconcile = async args => {
    const { grant, candidate } = check(args);
    if (channel.receiverKeys.has(grant.agentId) && channel.subscriptions.has(grant.agentId)) return status(args);
    if (!candidate.hostId) throw new Error('Movement receiver unavailable');
    const key = receiverHandoffKey(candidate.hostId, grant.agentId, grant.id, options.credentialDirectory);
    for (const [offerID, pending] of channel.handoffCandidates) {
      if (pending.agentId === grant.agentId && pending.key === key && !candidate.offerID) candidate.offerID = offerID;
    }
    try {
      // Install the persisted key before reconnect so automatic session resume
      // cannot fall back to the revoked source proof.
      channel.receiverKeys.set(grant.agentId, key);
      check(args);
      await channel.resumeReceiverHandoff(grant.agentId, grant.id);
      if (channel.hostId !== candidate.hostId || channel.receiverKeys.get(grant.agentId) !== key)
        throw new Error('Movement receiver unavailable');
      return await status(args);
    } catch (error) {
      channel.receiverKeys.set(grant.agentId, key);
      try { await channel.unsubscribe(grant.agentId); }
      catch { channel.socket?.terminate(); }
      channel.receiverKeys.delete(grant.agentId);
      throw error;
    }
  };
  const forward = async args => {
    const { grant, candidate } = check(args);
    if ((args.method === 'settlePlacement') !== !!args.settlement) throw new Error('Invalid movement request');
    if (args.ownerGeneration !== undefined && !['releaseVerified', 'ownerActivate', 'ownerStatus', 'ownerDrain', 'ownerDrainObserve', 'nextAdapter', 'nextAuthorize'].includes(args.method)) throw new Error('Invalid movement request');
    if (args.ownerProof !== undefined && !['releaseVerified', 'ownerDrain', 'ownerDrainObserve'].includes(args.method)) throw new Error('Invalid movement request');
    if (['ownerDrain', 'ownerDrainObserve'].includes(args.method) ? !args.drainID || !args.ownerProof || !args.ownerGeneration : args.drainID !== undefined) throw new Error('Invalid movement request');
    if (args.method === 'nextAdapter' ? (!args.nextTaskID || args.nextCommand === undefined || !args.ownerGeneration) :
      (args.nextTaskID !== undefined || args.nextCommand !== undefined)) throw new Error('Invalid movement request');
    if (['nextAuthorize', 'ownerDrain', 'ownerDrainObserve'].includes(args.method) !== !!args.nextGrant) throw new Error('Invalid movement request');
    if (args.incarnation !== candidate.incarnation || args.epoch !== candidate.epoch || !channel.receiverKeys.has(grant.agentId) ||
      digest(channel.receiverKeys.get(grant.agentId)) !== args.receiverHash || !channel.activeSubscriptions.has(grant.agentId))
      throw new Error('Movement receiver unavailable');
    const key = channel.receiverKeys.get(grant.agentId), socket = channel.socket, hostId = channel.hostId;
    const current = () => {
      if (check(args).candidate !== candidate || signal.aborted || candidate.epoch !== args.epoch || channel.socket !== socket ||
          socket?.readyState !== 1 || channel.hostId !== hostId || channel.receiverKeys.get(grant.agentId) !== key ||
          !channel.activeSubscriptions.has(grant.agentId)) throw new Error('Movement receiver unavailable');
    };
    const request = (method, params) => retryBrokerPreDispatch(() => channel.request(method, params), { check: current, signal });
    let result;
    if (args.method === 'authorize') {
      if (args.offerID !== undefined) throw new Error('Invalid movement request');
      result = await request('control_worktree_authorize', { agentId: grant.agentId, channel: grant.channel,
        credential: args.credential, grant, ...(args.action ? { action: args.action } : {}) });
    } else if (args.method === 'observe') {
      if (args.action !== undefined) throw new Error('Invalid movement request');
      if (args.offerID !== undefined) throw new Error('Invalid movement request');
      result = await request('control_receiver_observe', { agentId: grant.agentId, credential: args.credential, transitionID: grant.id, channel: grant.channel });
    } else if (args.method === 'recoverSource') {
      if (args.action !== undefined || args.offerID !== undefined) throw new Error('Invalid movement request');
      result = await request('control_receiver_recover_source', { agentId: grant.agentId, credential: args.credential,
        channel: grant.channel, transitionID: grant.id });
    } else if (args.method === 'recoveryIdle') {
      if (args.action !== undefined || args.offerID !== undefined || grant.status !== 'prepared' || typeof ctx.session.wait !== 'function')
        throw new Error('Movement receiver unavailable');
      const held = await request('control_receiver_observe', { agentId: grant.agentId, credential: args.credential, channel: grant.channel, transitionID: grant.id });
      if (held.status !== 'held' || held.sourceDetached !== true) throw new Error('Movement receiver unavailable');
      await ctx.session.wait({ sessionID: grant.agentId.slice('opencode:'.length) }, { signal }); current();
      const command = { id: randomUUID(), op: 'evidence.record', channel: grant.channel, entityID: grant.taskID, kind: 'idle' };
      result = await request('control_adapter', { agentId: grant.agentId, credential: args.credential, command });
      current();
    } else if (args.method === 'settlePlacement') {
      if (!['prepared', 'uncertain', 'moved'].includes(grant.status) || args.action !== undefined || args.offerID !== undefined ||
          (grant.status === 'moved' && grant.receiptID !== args.settlement.receiptID)) throw new Error('Invalid movement request');
      const { commandID, receiptID } = args.settlement;
      const command = { id: commandID, op: 'worktree.settle', channel: grant.channel, transitionID: grant.id, outcome: 'moved',
        actualLocation: grant.to, configurationDigest: grant.configurationDigest, authorityDigest: grant.authorityDigest, receiptID };
      const settled = await request('control_adapter', { agentId: grant.agentId, credential: args.credential, command });
      if (settled?.commandID !== commandID) throw new Error('Movement settlement unavailable');
      const page = await request('control_query', { agentId: grant.agentId, channel: grant.channel, view: 'transitions', entityID: grant.id, offset: 0, limit: 1 });
      if (!Array.isArray(page?.entries) || page.entries.length !== 1) throw new Error('Movement settlement unavailable');
      const current = WorktreeTransition.parse(page.entries[0]);
      if (!sameIdentity(current, grant) || current.status !== 'moved' || current.actualLocation !== grant.to || current.receiptID !== receiptID) throw new Error('Movement settlement unavailable');
      result = { grant: current };
    } else if (args.method === 'releaseVerified') {
      if (grant.status !== 'moved' || args.action !== undefined || args.offerID !== undefined) throw new Error('Invalid movement request');
      result = await request('control_receiver_release_verified', { agentId: grant.agentId, credential: args.credential,
        channel: grant.channel, transitionID: grant.id, ...(args.ownerGeneration ? { ownerGeneration: args.ownerGeneration } : {}),
        ...(args.ownerProof ? { ownerProof: args.ownerProof } : {}) });
    } else if (args.method === 'ownerActivate' || args.method === 'ownerStatus') {
      if (grant.status !== 'moved' || !args.ownerGeneration || args.action !== undefined || args.offerID !== undefined) throw new Error('Invalid movement request');
      result = await request(args.method === 'ownerActivate' ? 'control_receiver_owner_activate' : 'control_receiver_owner_status',
        { agentId: grant.agentId, credential: args.credential, channel: grant.channel, transitionID: grant.id, ownerGeneration: args.ownerGeneration });
    } else if (args.method === 'ownerDrain' || args.method === 'ownerDrainObserve') {
      if (options.nextMovement !== true || grant.status !== 'moved' || args.nextGrant.status !== 'prepared' || args.nextGrant.purpose ||
          args.nextGrant.agentId !== grant.agentId || args.nextGrant.channel !== grant.channel || args.nextGrant.from !== grant.to || args.nextGrant.id === grant.id ||
          args.action !== undefined || args.offerID !== undefined) throw new Error('Invalid movement request');
      result = await request(args.method === 'ownerDrain' ? 'control_receiver_owner_drain' : 'control_receiver_owner_drain_observe', { agentId: grant.agentId, credential: args.credential, channel: grant.channel,
        transitionID: grant.id, ownerGeneration: args.ownerGeneration, nextGrant: args.nextGrant, drainID: args.drainID, ownerProof: args.ownerProof });
    } else if (args.method === 'nextAuthorize') {
      if (options.nextMovement !== true || !args.ownerGeneration || grant.status !== 'moved' || args.action !== undefined || args.offerID !== undefined ||
          args.nextGrant.status !== 'prepared' || args.nextGrant.purpose || args.nextGrant.agentId !== grant.agentId ||
          args.nextGrant.channel !== grant.channel || args.nextGrant.from !== grant.to || args.nextGrant.id === grant.id) throw new Error('Invalid movement request');
      const active = await request('control_receiver_owner_status', { agentId: grant.agentId, credential: args.credential,
        channel: grant.channel, transitionID: grant.id, ownerGeneration: args.ownerGeneration });
      if (active?.active !== true || active.ownerGeneration !== args.ownerGeneration) throw new Error('Movement receiver unavailable');
      result = await request('control_worktree_authorize', { agentId: grant.agentId, credential: args.credential,
        channel: grant.channel, grant: args.nextGrant });
    } else if (args.method === 'nextAdapter') {
      if (options.nextMovement !== true) throw new Error('Next movement is not enabled');
      const command = Command.parse(args.nextCommand);
      if (grant.status !== 'moved' || args.action !== undefined || args.offerID !== undefined || command.channel !== grant.channel ||
          !['worktree.preview', 'worktree.begin', 'evidence.record'].includes(command.op) ||
          (command.op === 'evidence.record' ? command.entityID !== args.nextTaskID || !['idle', 'capability'].includes(command.kind) : command.taskID !== args.nextTaskID) ||
          (command.op === 'worktree.preview' && (command.from !== grant.to || command.purpose || command.binding?.harness !== 'opencode')) ||
          (command.op === 'worktree.begin' && command.purpose)) throw new Error('Invalid movement request');
      const active = await request('control_receiver_owner_status', { agentId: grant.agentId, credential: args.credential,
        channel: grant.channel, transitionID: grant.id, ownerGeneration: args.ownerGeneration });
      if (active?.active !== true || active.ownerGeneration !== args.ownerGeneration) throw new Error('Movement receiver unavailable');
      result = await request('control_adapter', { agentId: grant.agentId, credential: args.credential, command });
    } else {
      if (args.action !== undefined || !candidate.offerID || args.offerID !== candidate.offerID) throw new Error('Invalid movement request');
      result = await request('control_receiver_check_source', { agentId: grant.agentId, credential: args.credential, offerID: candidate.offerID, channel: grant.channel });
    }
    current();
    return result;
  };
  const handoff = event => {
    if (event.role !== 'target') return;
    const candidate = candidates.get(event.agentId);
    if (candidate && (!candidate.offerID || candidate.offerID === event.offerID)) {
      candidate.offerID = event.offerID;
      candidate.hostId = channel.hostId;
      announce(candidate);
    }
  };
  const disconnected = () => { sourceEpoch++; sources.clear(); for (const candidate of candidates.values()) candidate.epoch++; };
  channel.on('receiver_handoff', handoff);
  channel.on('disconnected', disconnected);
  return { handlers: { offer, resume, reconcile, status, request: forward, source }, ownsCandidate, binding, close: () => {
    channel.off('receiver_handoff', handoff); channel.off('disconnected', disconnected); sources.clear(); candidates.clear();
  } };
}
