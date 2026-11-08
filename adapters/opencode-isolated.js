import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { Plugin } from '@opencode/plugin';
import { Rpc } from '@opencode/plugin/rpc';
import { ChannelClient } from '../src/client.js';
import { digest, matches, validateCredential } from '../src/config.js';
import { readPrivate } from '../src/storage.js';
import { Command, NativeAuthorityObservationPair, WorktreeTransition } from '../src/control/contracts.js';
import { launchOpenCodeSealedPlugin } from '../src/opencode-plugin-daemon-launch.js';
import { startOpenCodePluginOwnerBridge } from '../src/opencode-plugin-owner-bridge.js';
import { connectOpenCodeNativeOwner } from '../src/opencode-native-owner-client.js';
import { connectOpenCodeDestinationOwner } from '../src/opencode-destination-owner-client.js';
import { linkOpenCodeObservationOwners } from '../src/opencode-observation-owner-link.js';
import { acknowledgeOpenCodeVMHashProbe } from '../src/opencode-vm-hash-ack.js';
import { OpenCodeSourceReceiver } from '../src/opencode-source-receiver.js';
import { TurnlinkMovement, makeOpenCodeMovementRpc } from './opencode-movement-rpc.js';

const secret = z.string().regex(/^[a-f0-9]{64}$/), path = z.string().refine(isAbsolute);
const optionsSchema = z.strictObject({ sessionID: z.string().startsWith('ses_'), channel: z.string().min(1).max(128),
  url: z.string().url(), tokenFile: path, adapterTokenFile: path, movementTokenFile: path, credentialDirectory: path,
  childDirectory: path, journalDirectory: path, manifestFile: path, docker: z.literal('/opt/homebrew/bin/docker'),
  dockerEndpoint: z.string().startsWith('unix:///'), containerName: z.string().regex(/^turnlink-plugin-test-[0-9a-f-]{36}$/).optional(),
  nativeFd: z.literal(5), destinationFd: z.literal(6).optional(), vmHashAck: z.literal(true).optional(), initialMovement: z.literal(true) });
const manifestSchema = z.object({ version: z.literal(1), image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  bundleSha256: secret, guardSha256: secret, executionAuthority: z.literal(false) }).passthrough();
const auth = z.strictObject({ token: secret, credential: secret });
const SourceHold = Rpc.define({ id: 'turnlink.isolated-source', methods: {
  hold: { input: auth, output: z.record(z.string(), z.unknown()) },
  check: { input: auth, output: z.record(z.string(), z.unknown()) },
  observeAuthority: { input: auth, output: z.record(z.string(), z.unknown()) },
  observeDestination: { input: auth, output: z.record(z.string(), z.unknown()) },
  observePair: { input: auth, output: z.record(z.string(), z.unknown()) },
  observeComponents: { input: auth, output: z.record(z.string(), z.unknown()) },
  recordPreview: { input: auth.extend({ command: Command }), output: z.record(z.string(), z.unknown()) },
  observeGrant: { input: auth.extend({ grant: WorktreeTransition }), output: z.record(z.string(), z.unknown()) },
  release: { input: auth, output: z.record(z.string(), z.unknown()) },
}, events: {} });

// Explicit opt-in source adapter. Its hold is observational and cannot
// authorize movement until daemon custody and the full graph are attested.
export default Plugin.define({ id: 'turnlink', async setup(ctx) {
  const options = optionsSchema.parse(ctx.options), directory = ctx.location.directory, sessionID = options.sessionID;
  if (!isAbsolute(directory)) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
  const manifest = manifestSchema.parse(JSON.parse(readPrivate(options.manifestFile, 65536)));
  const read = file => validateCredential(readPrivate(file, 128).trim());
  const hostToken = read(options.tokenFile), adapterToken = read(options.adapterTokenFile), movementToken = read(options.movementTokenFile);
  if (new Set([hostToken, adapterToken, movementToken]).size !== 3) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
  const channel = new ChannelClient({ url: options.url, tokenFile: options.tokenFile, credentialDirectory: options.credentialDirectory });
  const name = options.containerName ?? `turnlink-plugin-test-${randomUUID()}`;
  const launch = launchOpenCodeSealedPlugin({ docker: options.docker, endpoint: options.dockerEndpoint, name, image: manifest.image, sessionID, directory });
  const controller = new AbortController(); let bridge, native, destination, registration, movementRegistration, movement, lease, ownerLink, acquiring = false;
  const close = async () => {
    controller.abort(); ownerLink?.close(); lease?.close(); destination?.close(); native?.close(); movement?.close();
    await Promise.allSettled([registration?.dispose(), movementRegistration?.dispose(), bridge?.close()]);
  };
  try {
    bridge = await startOpenCodePluginOwnerBridge({ context: ctx, channel, sessionID, launch, childDirectory: options.childDirectory,
      journalDirectory: options.journalDirectory, allowedChannel: options.channel, allowTestSubscribe: true, allowParticipantControl: true,
      authorizeMembership: async ({ method, value }) => method === 'storage.remove' ||
        value?.sessionID === sessionID && value.directory === directory && value.channel === options.channel });
    native = connectOpenCodeNativeOwner({ fd: options.nativeFd, sessionID, source: { directory }, pluginID: 'turnlink' });
    if (options.destinationFd) {
      destination = connectOpenCodeDestinationOwner({ fd: options.destinationFd });
      destination.onClose(() => { lease?.close(); lease = undefined; });
    }
    movement = makeOpenCodeMovementRpc({ ctx, channel, options, signal: controller.signal });
    movementRegistration = await ctx.rpc.register(TurnlinkMovement, movement.handlers);
    const checkAuth = input => {
      const currentMovement = read(options.movementTokenFile), currentAdapter = read(options.adapterTokenFile);
      if (controller.signal.aborted || !matches(input.token, digest(currentMovement)) || !matches(input.credential, digest(currentAdapter)) ||
          currentMovement === currentAdapter || !channel.activeSubscriptions.has(`opencode:${sessionID}`)) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
    };
    const checkMembership = async () => {
      const [session, membership] = await Promise.all([ctx.session.get({ sessionID }), ctx.storage.get(`memberships/${sessionID}`)]);
      if (session?.id !== sessionID || session.location?.directory !== directory || membership?.sessionID !== sessionID ||
          membership.directory !== directory || membership.channel !== options.channel || membership.receiverHandoff) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
    };
    const observePair = async input => {
      checkAuth(input); if (!lease || !destination) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
      await checkMembership();
      const first = await lease.observeNativeAuthority(), target = await destination.check();
      const last = await lease.observeNativeAuthority(), targetAgain = await destination.check();
      if (JSON.stringify(first) !== JSON.stringify(last) || JSON.stringify(target) !== JSON.stringify(targetAgain)) throw new Error('Unavailable');
      await checkMembership(); checkAuth(input);
      const { componentDigests: _components, modelResolution: _modelResolution, projectInstructionFilesDigest: _files,
        hostedActivations: _activations, hostedHookActivations: _hooks, ...destinationObservation } = target;
      const fields = { version: 1, source: { directory, holdID: lease.provenance.nativeHoldID, revision: first.revision,
        authorityDigest: first.sourceAuthorityDigest }, destination: destinationObservation, comparison: 'unverified', executionEligible: false };
      return NativeAuthorityObservationPair.parse({ ...fields, digest: createHash('sha256').update(JSON.stringify(fields)).digest('hex') });
    };
    registration = await ctx.rpc.register(SourceHold, {
      hold: async input => {
        checkAuth(input); if (lease || acquiring) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); acquiring = true;
        try {
        await checkMembership();
        if (destination) await destination.check();
        const run = promisify(execFile), args = ['--host', options.dockerEndpoint];
        const info = await run(options.docker, [...args, 'info', '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 30000 });
        const container = await run(options.docker, [...args, 'inspect', '--format', '{{.Id}}', name], { encoding: 'utf8', timeout: 30000 });
        checkAuth(input); await checkMembership();
        lease = await bridge.holdProvenance({ native, daemonID: info.stdout.trim(), containerID: container.stdout.trim(),
          bundleSha256: manifest.bundleSha256, guardSha256: manifest.guardSha256,
          ...(options.vmHashAck ? { ackHashProbe: signal => acknowledgeOpenCodeVMHashProbe({ endpoint: options.dockerEndpoint, signal }) } : {}),
          watchAuthority: () => channel.request('control_authority_watch', { agentId: `opencode:${sessionID}`, channel: options.channel, credential: read(options.adapterTokenFile) }) });
        if (destination) ownerLink = linkOpenCodeObservationOwners(lease, destination);
        if (destination) await destination.check();
        checkAuth(input); return { provenance: lease.provenance };
        } catch { lease?.close(); lease = undefined; throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
        finally { acquiring = false; }
      },
      check: async input => { checkAuth(input); if (!lease) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); return { provenance: await lease.check() }; },
      observeAuthority: async input => {
        checkAuth(input); if (!lease) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
        try {
        await checkMembership(); const observation = await lease.observeNativeAuthority(); await checkMembership(); checkAuth(input);
        return observation;
        } catch { lease?.close(); lease = undefined; throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
      },
      observeDestination: async input => {
        checkAuth(input); if (!lease || !destination) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
        try {
          await checkMembership(); await lease.check(); const observation = await destination.check();
          await lease.check(); await checkMembership(); checkAuth(input);
          return { ...observation, executionEligible: false };
        } catch { lease?.close(); lease = undefined; destination.close(); throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
      },
      observePair: async input => {
        try { return await observePair(input); }
        catch { lease?.close(); lease = undefined; destination?.close(); throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
      },
      observeComponents: async input => {
        try {
          checkAuth(input); if (!lease || !destination) throw new Error('Unavailable');
          await checkMembership(); const first = await lease.observeNativeAuthority(), target = await destination.check();
          const last = await lease.observeNativeAuthority(), targetAgain = await destination.check();
          if (JSON.stringify(first) !== JSON.stringify(last) || JSON.stringify(target) !== JSON.stringify(targetAgain)) throw new Error('Unavailable');
          await checkMembership(); checkAuth(input);
          const names = ['agent', 'model', 'permissions', 'permissionRules', 'hooks', 'tools', 'toolDefinitions', 'instructions'];
          const components = Object.fromEntries(names.map(name => [name, !first.componentDigests?.[name] || !target.componentDigests?.[name] ? 'unavailable' :
            first.componentDigests[name] === target.componentDigests[name] ? 'identical-observation' : 'different-observation']));
          const projectInstructionFiles = !first.projectInstructionFilesDigest || !target.projectInstructionFilesDigest ? 'unavailable' :
            first.projectInstructionFilesDigest === target.projectInstructionFilesDigest ? 'identical-observation' : 'different-observation';
          return { components, modelResolution: { source: first.modelResolution ?? 'unavailable', destination: target.modelResolution ?? 'unavailable' },
            projectInstructionFiles, coverage: 'partial', mcp: 'unattested', pluginProvenance: 'unattested', normalized: false, executionEligible: false };
        } catch { lease?.close(); lease = undefined; destination?.close(); throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
      },
      recordPreview: async input => {
        let stage = 'pair';
        try {
          const command = input.command, pair = await observePair(input);
          stage = 'binding';
          if (command.op !== 'worktree.preview' || command.channel !== options.channel || command.from !== directory ||
              command.to !== pair.destination.directory || command.purpose || command.binding?.harness !== 'opencode' ||
              JSON.stringify(command.binding.pluginProvenance) !== JSON.stringify(lease.provenance) ||
              JSON.stringify(command.binding.nativeAuthorityObservation) !== JSON.stringify(pair)) throw new Error('Unavailable');
          stage = 'broker';
          const result = await channel.request('control_adapter', { agentId: `opencode:${sessionID}`, credential: read(options.adapterTokenFile), command });
          stage = 'recheck';
          if (JSON.stringify(await observePair(input)) !== JSON.stringify(pair)) throw new Error('Unavailable');
          return result;
        } catch { if (process.env.TURNLINK_SEAL_DIAGNOSTIC === '1') process.stderr.write(`PREVIEW_STAGE:${stage}\n`);
          lease?.close(); lease = undefined; destination?.close(); throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
      },
      observeGrant: async input => {
        checkAuth(input); if (!lease) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE');
        const source = new OpenCodeSourceReceiver({ rpc: (_method, args) => movement.handlers.source(args), token: async () => read(options.movementTokenFile),
          credential: async () => read(options.adapterTokenFile), grant: input.grant });
        try { return await lease.observeGrant(input.grant, source); } finally { source.close(); }
      },
      release: async input => { checkAuth(input); if (!lease) throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); await lease.release(); lease = undefined; return { released: true }; },
    });
    return close;
  } catch { await close(); throw new Error('PLUGIN_OWNER_BRIDGE_UNAVAILABLE'); }
} });
