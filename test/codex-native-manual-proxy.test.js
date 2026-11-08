import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';

// The opt-in wrapper runs the unmodified native binary with isolated storage
// and an offline synthetic model. Participant reports below are test inputs;
// they do not establish that a real model collected the record itself.
const executable = process.env.TURNLINK_OFFLINE_CODEX_EXECUTABLE;
test('native Codex proxy resumes a manually moved task in the same thread',
  { skip: !executable, timeout: 120000 }, async t => {
    const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-codex-manual-native-')));
    const nativeRoot = join(root, 'native'); mkdirSync(nativeRoot, { mode: 0o700 });
    const codexState = join(nativeRoot, 'codex'); mkdirSync(codexState, { mode: 0o700 });
    const workspaces = join(nativeRoot, 'workspaces'); mkdirSync(workspaces, { mode: 0o700 });
    for (const name of ['source', 'destination']) mkdirSync(join(workspaces, name), { mode: 0o700 });
    writeFileSync(join(codexState, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[features]\nplugins = false\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:42325/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
    const adapter = join(root, 'adapter.token'); writeFileSync(adapter, '3'.repeat(64), { mode: 0o600 });
    const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true,
      taskDispatch: true, codexTasks: true, worktreeGrants: true, worktreeTaskDispatch: true, manualWorktreeOnly: true });
    await once(broker.server, 'listening');
    const url = `ws://127.0.0.1:${broker.server.address().port}`, proofs = join(root, 'proofs');
    const admin = new ChannelClient({ url, token: '2'.repeat(64), credentialDirectory: proofs });
    const reviewer = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: proofs });
    const participant = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: proofs });
    let proxy, coordinator;
    const stop = async () => { if (proxy && proxy.exitCode === null && proxy.signalCode === null) { const exited = once(proxy, 'exit'); proxy.kill(); await exited; } };
    t.after(async () => { coordinator?.clearSessionWatches(); await stop(); participant.close(); reviewer.close(); admin.close(); await broker.close(); rmSync(root, { recursive: true, force: true }); });
    const wait = async fn => { for (let i = 0; i < 300; i++) { try { const result = await fn(); if (result) return result; }
      catch (error) { if (error.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH') throw error; } await delay(100); } throw new Error('Native manual fixture timed out'); };
    const run = (client, agentId, op, fields = {}) => client.request('control_command', { ...(agentId ? { agentId } : {}),
      command: { id: randomUUID(), channel: 'dev', op, ...fields } });
    const query = async view => (await admin.request('control_query', { channel: 'dev', view })).entries;
    const frames = [];
    const send = frame => proxy.stdin.write(`${JSON.stringify(frame)}\n`);
    const start = async (method, threadId) => {
      proxy = spawn(process.execPath, [resolve('src/codex-proxy.js'), 'app-server'], { cwd: root, env: {
        PATH: process.env.PATH, TURNLINK_NATIVE_TEST_ROOT: nativeRoot, AGENT_CHANNEL_CODEX_EXECUTABLE: executable,
        AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: '1'.repeat(64), AGENT_CHANNEL_CREDENTIAL_DIR: proofs,
        AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_CODEX_TASKS: '1', AGENT_CHANNEL_CODEX_WORKTREE_TASKS: '1',
        AGENT_CHANNEL_ADAPTER_TOKEN_FILE: adapter, AGENT_CHANNEL_RPC_TIMEOUT_MS: '5000',
      }, stdio: ['pipe', 'pipe', 'pipe'] });
      proxy.stderr.resume(); createInterface({ input: proxy.stdout }).on('line', line => { try { frames.push(JSON.parse(line)); } catch { /* Not a protocol frame. */ } });
      const init = randomUUID(); send({ id: init, method: 'initialize', params: { clientInfo: { name: 'synthetic/manual', version: '1' }, capabilities: { experimentalApi: true } } });
      const initial = await wait(() => frames.find(frame => frame.id === init)); assert.ok(initial.result, 'initialization succeeded');
      send({ method: 'initialized', params: {} });
      const id = randomUUID(); send({ id, method, params: method === 'thread/start' ? { cwd: '/workspace/source', sandbox: 'read-only', approvalPolicy: 'on-request' } :
        { threadId, cwd: '/workspace/destination', sandbox: 'read-only', approvalPolicy: 'on-request' } });
      const response = await wait(() => frames.find(frame => frame.id === id));
      assert.ok(response.result?.thread?.id, `native ${method} succeeded: ${JSON.stringify(response.error)}`);
      return response.result.thread.id;
    };
    await run(admin, null, 'channel.configure'); await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
    await reviewer.request('join', { harness: 'opencode', sessionId: 'reviewer', channel: 'dev', name: 'reviewer', role: 'review', project: { name: 'fixture', root: '/workspace/source' } });
    await reviewer.subscribe('opencode:reviewer'); await run(reviewer, 'opencode:reviewer', 'master.volunteer', { eligible: true });
    const proposal = await run(admin, null, 'master.appoint', { candidate: 'opencode:reviewer' });
    const notice = (await reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries[0];
    await reviewer.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_native_reviewer' });
    await run(reviewer, 'opencode:reviewer', 'master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
    const thread = await start('thread/start'), agentId = `codex:${thread}`;
    const joinAt = path => participant.request('join', { harness: 'codex', sessionId: thread, channel: 'dev', name: 'worker', role: 'synthetic', project: { name: 'fixture', root: path } });
    await joinAt('/workspace/source');
    await wait(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(member => member.agentId === agentId)?.connected);
    const taskID = (await run(admin, null, 'task.create', { title: 'Native manual task', instructions: 'Respond with the fixture result.', criteria: 'Report the completed result.', requiresWorktree: true })).commandID;
    await run(participant, agentId, 'task.claim', { taskID });
    coordinator = new ToolSession(reviewer, { harness: 'opencode', sessionId: 'reviewer' }); coordinator.agentId = 'opencode:reviewer'; coordinator.channel = 'dev';
    const previewID = (await coordinator.call('channel_manual_preview', { taskID, destination: '/workspace/destination' })).commandID;
    await run(admin, null, 'worktree.approve', { taskID, previewID });
    const prep = await coordinator.call('channel_prepare_session', { taskID, previewID, messageId: 'native-manual-prepare' });
    await wait(() => broker.store.messages.find(message => message.id === prep.id)?.delivered.includes(agentId));
    const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: agentId, source: '/workspace/source', destination: '/workspace/destination',
      runtime: 'codex 0.165.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'synthetic saved work' };
    const saved = await participant.request('send', { agentId, to: 'opencode:reviewer', text: JSON.stringify(record), messageId: 'native-manual-record' });
    await wait(() => broker.store.bindings[agentId]?.manualResume?.status === 'armed');
    await wait(() => broker.store.messages.find(message => message.messageId === `turnlink-armed-${saved.id}`)?.delivered.includes(agentId));
    await stop(); await wait(() => broker.store.bindings[agentId]?.manualResume?.status === 'detached');
    await joinAt('/workspace/destination'); assert.equal(await start('thread/resume', thread), thread);
    const request = await wait(() => broker.store.messages.find(message => message.messageId === `turnlink-verify-${saved.id}`));
    const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: agentId, recordID: saved.id, requestID: request.id, runtime: 'codex 0.165.0',
      checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
    await participant.request('send', { agentId, to: 'opencode:reviewer', text: JSON.stringify(report), messageId: 'native-manual-report' });
    await admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: saved.id, requestID: request.id, receiptID: randomUUID(), sourceStopped: true });
    const stopped = await wait(async () => (await query('tasks')).find(task => task.id === taskID && task.stoppedEvidence));
    const artifact = (await query('evidence')).find(entry => entry.entityID === taskID && entry.kind === 'artifact');
    assert.equal(stopped.status, 'uncertain'); assert.equal(artifact.artifact.sessionID, thread);
    await run(participant, agentId, 'task.report', { taskID, summary: 'Synthetic native result', evidence: [artifact.id] });
    await run(reviewer, 'opencode:reviewer', 'task.review', { taskID, generation: 1, accept: true, evidenceID: artifact.id });
    assert.equal((await query('tasks')).find(task => task.id === taskID).status, 'completed');
  });
