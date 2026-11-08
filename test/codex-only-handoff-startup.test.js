import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { ChannelClient } from '../src/client.js';
import { sessionProof } from '../src/config.js';
import { brokerEnvironmentOptions, brokerEnvironmentOpenCodeCompletionVerifier, brokerEnvironmentOpenCodeSourceRecoveryVerifier, createBroker } from '../src/broker.js';
import { ControlGateway } from '../src/control/gateway.js';

const HOST = '1'.repeat(64), ADMIN = '2'.repeat(64), ADAPTER = '3'.repeat(64);

test('Codex-only broker mode remains explicit and does not relax ordinary OpenCode startup', () => {
  const options = brokerEnvironmentOptions({ AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_WORKTREE_GRANTS: '1',
    AGENT_CHANNEL_RECEIVER_HANDOFF: '1', AGENT_CHANNEL_CODEX_HANDOFF_ONLY: '1' });
  assert.equal(options.codexHandoffOnly, true);
  assert.equal(brokerEnvironmentOpenCodeCompletionVerifier({}, options), undefined);
  assert.throws(() => brokerEnvironmentOpenCodeCompletionVerifier({}, { ...options, codexHandoffOnly: false }), /requires an OpenCode completion verifier/);
  assert.throws(() => brokerEnvironmentOpenCodeCompletionVerifier({ AGENT_CHANNEL_OPENCODE_COMPLETION_SOCKET: '/tmp/socket' }, options), /cannot enable an OpenCode verifier/);
  assert.throws(() => brokerEnvironmentOpenCodeSourceRecoveryVerifier({ AGENT_CHANNEL_OPENCODE_SOURCE_RECOVERY_SOCKET: '/tmp/socket' }, options), /cannot enable an OpenCode verifier/);
  assert.throws(() => brokerEnvironmentOptions({ AGENT_CHANNEL_CODEX_HANDOFF_ONLY: 'yes' }), /must be 0 or 1/);
  for (const overrides of [{ receiverHandoff: false }, { worktreeTaskDispatch: true }, { controlEffects: true }, { ownerLeaseRequired: true },
    { codexHandoffOnly: '1' }, { completionVerifier: async () => null }, { sourceRecoveryVerifier: async () => null },
    { mcpCleanupVerifier: async () => null }, { destinationCancellationVerifier: async () => null }, { codexEffectVerifier: async () => null }, { codexEffectArbiter: {} }]) {
    assert.throws(() => createBroker({ secret: HOST, adminSecret: ADMIN, controlPlane: true, worktreeGrants: true,
      receiverHandoff: true, codexHandoffOnly: true, ...overrides }), /Codex-only handoff/);
  }
});

test('Codex-only gateway rejects internal OpenCode paths using the authenticated harness', () => {
  const gateway = Object.create(ControlGateway.prototype), agent = { agentId: 'opencode:fixture', harness: 'opencode', channel: 'dev' };
  Object.assign(gateway, { codexHandoffOnly: true, worktreeGrants: true, boundMember: () => agent, adapter: () => agent });
  const socket = { principal: { admin: false, hostId: 'local' } }, params = { agentId: agent.agentId, channel: 'dev', proof: '4'.repeat(64), credential: ADAPTER };
  assert.throws(() => gateway.receiverCandidate(socket, params), /OPENCODE_HANDOFF_DISABLED/);
  assert.throws(() => gateway.receiverRecoveryCandidate(socket, params), /OPENCODE_HANDOFF_DISABLED/);
  assert.throws(() => gateway.receiverRelease(socket, params, {}), /RECEIVER_HANDOFF_UNAVAILABLE/);
  assert.throws(() => gateway.handle(socket, 'control_worktree_authorize', params), /OPENCODE_HANDOFF_DISABLED/);
  assert.throws(() => gateway.command(socket, { ...params, command: { id: randomUUID(), channel: 'dev', op: 'worktree.begin', taskID: randomUUID(),
    previewID: randomUUID(), claimGeneration: 1, configurationDigest: 'a'.repeat(64), authorityDigest: 'a'.repeat(64) } }, true), /OPENCODE_HANDOFF_DISABLED/);
});

for (const status of ['held', 'released']) test(`Codex-only broker refuses existing ${status} OpenCode handoff state before listening`, t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-only-state-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = 'opencode:held', proof = '4'.repeat(64), hold = { transitionID: randomUUID(), taskID: randomUUID(), previewID: randomUUID(),
    claimGeneration: 1, channel: 'dev', from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64), authorityDigest: 'a'.repeat(64), status, sourceDetached: status === 'released' };
  const state = JSON.stringify({ version: 3, agents: {}, messages: [], bindings: { [id]: { hostId: 'local', proofHash: proof, receiverHash: proof, revoked: false, receiverHandoff: hold } } });
  writeFileSync(join(root, 'store.json'), state, { mode: 0o600 });
  assert.throws(() => createBroker({ directory: root, port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true, worktreeGrants: true,
    receiverHandoff: true, codexHandoffOnly: true }), /existing OpenCode handoff state/);
  assert.equal(readFileSync(join(root, 'store.json'), 'utf8'), state, 'refusal must preserve existing handoff state');
});

test('mode changes preserve pending and terminal OpenCode grants without allowing settlement in Codex-only mode', { timeout: 30000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-only-mode-')), proofs = join(root, 'proofs'), clients = [];
  let broker; const closeClients = () => { for (const client of clients.splice(0)) client.close(); };
  t.after(async () => { closeClients(); if (broker) await broker.close(); rmSync(root, { recursive: true, force: true }); });
  const start = async codexHandoffOnly => {
    broker = createBroker({ directory: root, port: 0, secret: HOST, adminSecret: ADMIN, controlPlane: true, worktreeGrants: true,
      receiverHandoff: true, codexHandoffOnly }); await once(broker.server, 'listening');
    const url = `ws://127.0.0.1:${broker.server.address().port}`;
    return token => { const value = new ChannelClient({ url, token, credentialDirectory: proofs }); clients.push(value); return value; };
  };
  let make = await start(false), admin = make(ADMIN), pending = make(HOST), terminal = make(HOST);
  await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'channel.configure' } });
  await admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  const setup = async (client, sessionId, settle) => {
    const agentId = `opencode:${sessionId}`;
    await client.request('join', { harness: 'opencode', sessionId, name: sessionId, role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
    await client.subscribe(agentId);
    const run = command => client.request('control_adapter', { agentId, credential: ADAPTER, command: { channel: 'dev', ...command } });
    const task = await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'task.create', title: sessionId, instructions: 'fixture', criteria: 'fixture', requiresWorktree: true } });
    await client.request('control_command', { agentId, command: { id: randomUUID(), channel: 'dev', op: 'task.claim', taskID: task.commandID } });
    const previewID = randomUUID(), digest = 'a'.repeat(64);
    await run({ id: previewID, op: 'worktree.preview', taskID: task.commandID, from: '/source', to: '/destination', configurationDigest: digest,
      binding: { harness: 'opencode', projectID: 'fixture', sourceAuthorityDigest: digest, destinationAuthorityDigest: digest, sources: [{ path: '/source/AGENTS.md', digest }] } });
    await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'worktree.approve', taskID: task.commandID, previewID } });
    for (const kind of ['capability', 'idle']) await run({ id: randomUUID(), op: 'evidence.record', entityID: task.commandID, kind,
      ...(kind === 'capability' ? { sameConversationWorktree: true } : {}) });
    const transitionID = randomUUID();
    await run({ id: transitionID, op: 'worktree.begin', taskID: task.commandID, previewID, claimGeneration: 1, configurationDigest: digest, authorityDigest: digest });
    const finish = { op: 'worktree.settle', transitionID, outcome: 'failed', actualLocation: '/source', configurationDigest: digest, authorityDigest: digest, receiptID: randomUUID() };
    if (settle) await run({ id: randomUUID(), ...finish });
    return { agentId, transitionID, finish };
  };
  const active = await setup(pending, 'pending', false), ended = await setup(terminal, 'terminal', true);
  closeClients(); await broker.close(); broker = undefined;
  make = await start(true); admin = make(ADMIN); pending = make(HOST); await pending.subscribe(active.agentId);
  const page = await admin.request('control_query', { channel: 'dev', view: 'transitions' });
  assert.equal(page.entries.find(value => value.id === active.transitionID)?.status, 'prepared');
  assert.equal(page.entries.find(value => value.id === ended.transitionID)?.status, 'failed');
  await assert.rejects(admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', ...active.finish } }), /CONTROL_OPERATION_DISABLED/);
  const codex = make(HOST), threadId = randomUUID(), codexID = `codex:${threadId}`;
  await codex.request('join', { harness: 'codex', sessionId: threadId, name: 'nested-check', role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
  await codex.subscribe(codexID);
  await assert.rejects(codex.request('control_adapter', { agentId: codexID, credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', ...active.finish } }), /WORKTREE_TRANSITION_NOT_PENDING/);
  await assert.rejects(pending.request('control_adapter', { agentId: active.agentId, credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', ...active.finish } }), /OPENCODE_HANDOFF_DISABLED/);
  closeClients(); await broker.close(); broker = undefined;
  make = await start(false); admin = make(ADMIN); pending = make(HOST); await pending.subscribe(active.agentId);
  const settled = await pending.request('control_adapter', { agentId: active.agentId, credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', ...active.finish } });
  assert.ok(settled.commandID);
  const final = await admin.request('control_query', { channel: 'dev', view: 'transitions' });
  assert.equal(final.entries.find(value => value.id === active.transitionID)?.status, 'failed');
  assert.equal(final.entries.find(value => value.id === ended.transitionID)?.status, 'failed');
});

test('normal broker process accepts only Codex inspection and retains source receiver', { timeout: 30000 }, async t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-codex-only-cli-'));
  writeFileSync(join(root, 'admin-token'), ADMIN, { mode: 0o600 });
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const url = `ws://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/broker.js'], { stdio: ['ignore', 'ignore', 'pipe'], env: {
    PATH: process.env.PATH, HOME: root, AGENT_CHANNEL_STATE_DIR: root, AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: HOST,
    AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_WORKTREE_GRANTS: '1', AGENT_CHANNEL_RECEIVER_HANDOFF: '1', AGENT_CHANNEL_CODEX_HANDOFF_ONLY: '1',
  } });
  const exited = once(child, 'exit'); let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  t.after(async () => { if (child.exitCode === null) child.kill('SIGTERM'); await exited; rmSync(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('broker startup timeout')); }, 10000);
    const poll = setInterval(() => { if (stderr.includes('Turnlink protocol v2 listening')) { clearInterval(poll); clearTimeout(timeout); resolve(); }
      else if (child.exitCode !== null) { clearInterval(poll); clearTimeout(timeout); reject(new Error(`broker exited: ${stderr}`)); } }, 20);
  });
  const options = { url, credentialDirectory: join(root, 'proofs') }, clients = [];
  const client = token => { const value = new ChannelClient({ ...options, token }); clients.push(value); return value; };
  t.after(() => clients.forEach(value => value.close()));
  const admin = client(ADMIN), source = client(HOST), target = client(HOST), openSource = client(HOST), openTarget = client(HOST);
  const threadId = randomUUID(), agentId = `codex:${threadId}`, openId = 'opencode:fixture';
  for (const [connection, harness, sessionId, name] of [[source, 'codex', threadId, 'codex-fixture'], [openSource, 'opencode', 'fixture', 'open-fixture']]) {
    await connection.request('join', { harness, sessionId, name, role: 'fixture', channel: 'dev', project: { name: 'fixture', root: '/source' } });
    await connection.subscribe(`${harness}:${sessionId}`);
  }
  await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'channel.configure' } });
  await admin.request('control_enroll_adapter', { hostId: 'local', credential: ADAPTER });
  assert.deepEqual((await admin.request('control_info')).receiverHandoffHarnesses, ['codex']);
  const deniedGrant = { id: randomUUID() };
  await openTarget.connect();
  const proof = sessionProof('local', openId, options.credentialDirectory, false), common = { agentId: openId, proof, channel: 'dev', credential: ADAPTER },
    transition = randomUUID(), offer = randomUUID(), generation = randomUUID(), drain = randomUUID();
  const routes = [
    ['control_receiver_offer', { ...common, grant: deniedGrant, receiverKeyHash: '4'.repeat(64) }],
    ['control_receiver_ready', { ...common, offerID: offer }], ['control_receiver_commit', { ...common, offerID: offer }],
    ['control_receiver_check_source', { ...common, offerID: offer }], ['control_receiver_detached', { agentId: openId, offerID: offer }],
    ['control_receiver_recover_source', { ...common, transitionID: transition }],
    ['control_receiver_recover_owner', { ...common, grant: deniedGrant, receiverKeyHash: '4'.repeat(64) }],
    ...['control_receiver_observe', 'control_receiver_release', 'control_receiver_release_verified', 'control_receiver_observe_verified', 'control_receiver_observe_prepared']
      .map(method => [method, { ...common, transitionID: transition }]),
    ...['control_receiver_owner_activate', 'control_receiver_owner_status'].map(method => [method, { ...common, transitionID: transition, ownerGeneration: generation }]),
    ...['control_receiver_owner_drain', 'control_receiver_owner_drain_observe'].map(method => [method, { ...common, transitionID: transition, ownerGeneration: generation,
      nextGrant: deniedGrant, drainID: drain, ownerProof: '4'.repeat(64) }]),
    ['control_receiver_owner_endpoint', { agentId: openId, channel: 'dev', transitionID: transition }],
  ];
  for (const [method, params] of routes) await assert.rejects(openTarget.rpc(method, params), /OPENCODE_HANDOFF_DISABLED/, method);
  await delay(800);
  await assert.rejects(openSource.request('control_worktree_authorize', { agentId: openId, channel: 'dev', credential: ADAPTER, grant: deniedGrant }), /OPENCODE_HANDOFF_DISABLED/);
  await assert.rejects(openSource.request('control_authority_watch', { agentId: openId, channel: 'dev', credential: ADAPTER, grant: deniedGrant }), /OPENCODE_HANDOFF_DISABLED/);
  for (const op of ['worktree.begin', 'worktree.settle']) await assert.rejects(openSource.request('control_adapter', { agentId: openId, credential: ADAPTER,
    command: { id: randomUUID(), channel: 'dev', op } }), /OPENCODE_HANDOFF_DISABLED/);
  const send = command => source.request('control_adapter', { agentId, credential: ADAPTER, command: { channel: 'dev', ...command } });
  const task = await admin.request('control_command', { command: { id: randomUUID(), channel: 'dev', op: 'task.create', title: 'Migration fixture', instructions: 'fixture', criteria: 'fixture', requiresWorktree: true } });
  await source.request('control_command', { agentId, command: { id: randomUUID(), channel: 'dev', op: 'task.claim', taskID: task.commandID } });
  const configurationDigest = 'a'.repeat(64), authorityDigest = 'b'.repeat(64), checkpointConfigSha256 = 'c'.repeat(64), previewID = randomUUID();
  await send({ id: previewID, op: 'worktree.preview', taskID: task.commandID, from: '/source', to: '/destination', configurationDigest,
    binding: { harness: 'codex', projectID: 'fixture', sourceAuthorityDigest: authorityDigest, destinationAuthorityDigest: authorityDigest,
      sources: [{ path: '/source/AGENTS.md', digest: authorityDigest }], checkpointConfigSha256 } });
  const reviewProcess = spawn(process.execPath, ['src/control-admin.js', 'worktree-review', 'dev', previewID], { stdio: ['ignore', 'pipe', 'pipe'], env: {
    PATH: process.env.PATH, HOME: root, AGENT_CHANNEL_STATE_DIR: root, AGENT_CHANNEL_URL: url,
  } });
  let reviewOutput = '', reviewError = '';
  reviewProcess.stdout.on('data', chunk => { reviewOutput += chunk; });
  reviewProcess.stderr.on('data', chunk => { reviewError += chunk; });
  const [reviewExit] = await once(reviewProcess, 'close');
  assert.equal(reviewExit, 0, reviewError);
  const review = JSON.parse(reviewOutput);
  assert.equal(review.preview.id, previewID);
  assert.equal(review.approval.checkpointConfigSha256, checkpointConfigSha256);
  await admin.request('control_command', { command: { id: randomUUID(), ...review.approval } });
  for (const kind of ['capability', 'idle']) await send({ id: randomUUID(), op: 'evidence.record', entityID: task.commandID, kind,
    ...(kind === 'capability' ? { sameConversationWorktree: true } : {}) });
  const transitionID = randomUUID();
  await send({ id: transitionID, op: 'worktree.begin', taskID: task.commandID, previewID, claimGeneration: 1, configurationDigest, authorityDigest, checkpointConfigSha256 });
  const transitions = await source.request('control_query', { agentId, channel: 'dev', view: 'transitions' });
  const grant = transitions.entries.find(value => value.id === transitionID); assert.ok(grant);
  const authorized = await source.request('control_worktree_authorize', { agentId, channel: 'dev', credential: ADAPTER, grant, action: 'checkpoint-inspect' });
  assert.equal(authorized.grant.id, transitionID);
  const { checkpointConfigSha256: _ignored, ...openGrant } = grant;
  await assert.rejects(source.request('control_worktree_authorize', { agentId, channel: 'dev', credential: ADAPTER,
    grant: { ...openGrant, agentId: openId } }), /TRANSITION_IDENTITY_MISMATCH/);
  await assert.rejects(target.offerReceiverHandoff(agentId, ADAPTER, grant), /CHECKPOINT_POLICY_UNVERIFIED/);
  await assert.rejects(send({ id: randomUUID(), op: 'worktree.settle', transitionID, outcome: 'moved', actualLocation: '/destination',
    configurationDigest, authorityDigest, receiptID: randomUUID() }), /CHECKPOINT_POLICY_UNVERIFIED/);
  const members = await source.request('members', { agentId, channel: 'dev' });
  assert.equal(members.find(value => value.agentId === agentId)?.connected, true);
  assert.equal(source.subscriptions.has(agentId), true); assert.equal(target.subscriptions.has(agentId), false);
});
