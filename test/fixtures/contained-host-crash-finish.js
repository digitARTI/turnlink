import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ChannelClient } from '../../src/client.js';
import { startOpenCodeSourceRecoveryOwner } from '../../src/opencode-source-recovery-owner.js';
import { announceContainedVerifier } from '../../src/opencode-container-verifier-relay.js';

const [nextID, sourceGeneration] = process.argv.slice(2), base = '/var/lib/turnlink/tmp';
const roots = readdirSync(base).filter(name => name.startsWith('turnlink-native-live-handoff-'));
assert.equal(roots.length, 1);
const root = join(base, roots[0]), credentialDirectory = join(root, 'proofs'), tokenFile = join(root, 'host.token'),
  adapterTokenFile = join(root, 'adapter.token'), movementTokenFile = join(root, 'movement.token');
const options = { url: 'ws://127.0.0.1:31683', token: '1'.repeat(64), tokenFile, adapterTokenFile, credentialDirectory,
  control: true, receiverHandoff: true, tasks: true, worktreeTasks: true, nextMovement: true };
const admin = new ChannelClient({ ...options, token: '2'.repeat(64) }), controller = new AbortController();
let owner, announcements, modelRequests = 0, stage = 'fixture-start';
const model = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)), last = body.messages.at(-1); modelRequests++;
    const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    let delta = { content: 'Fixture task completed.' }, finish = 'stop';
    if (last.role === 'user' && text.includes('TASK_RESULT_DATA\n')) {
      const data = JSON.parse(text.split('TASK_RESULT_DATA\n')[1]);
      delta = { tool_calls: [{ index: 0, id: 'call_task_report', type: 'function', function: { name: 'channel_control',
        arguments: JSON.stringify({ command: { id: randomUUID(), op: 'task.report', channel: 'dev', taskID: data.taskID,
          evidence: data.evidence, summary: 'Fixture task completed in destination.' } }) } }] }; finish = 'tool_calls';
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (value, done) => ({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason: done }] });
    res.write(`data: ${JSON.stringify(event({ role: 'assistant', ...delta }, null))}\n\n`);
    res.write(`data: ${JSON.stringify(event({}, finish))}\n\n`); res.end('data: [DONE]\n\n');
  } catch { res.writeHead(500); res.end(); }
});
try {
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const transitions = await admin.request('control_query', { channel: 'dev', view: 'transitions', entityID: nextID });
  const grant = transitions.entries.find(entry => entry.id === nextID); assert.ok(grant);
  const sourceDirectory = '/tmp/turnlink-source', verifierDirectory = '/tmp/turnlink-host-verifiers', endpointDirectory = '/tmp/turnlink-host-endpoints';
  for (const directory of [sourceDirectory, verifierDirectory, endpointDirectory]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const sourceToken = join(sourceDirectory, 'token'), completionToken = join(verifierDirectory, 'token');
  writeFileSync(sourceToken, '6'.repeat(64), { mode: 0o600 }); writeFileSync(completionToken, '7'.repeat(64), { mode: 0o600 });
  const environment = { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'),
    FIXTURE_MODEL_KEY: 'fixture-key', EXPECT_FIXTURE_MODEL_KEY: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FFF: '1',
    OPENCODE_CONFIG_PROJECT_DISABLE: '1', OPENCODE_FILEWATCHER_DISABLE: '1', OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'fixture/test', snapshots: false,
      providers: { fixture: { env: ['FIXTURE_MODEL_KEY'], package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1` }, models: { test: { capabilities: { tools: true, input: ['text'], output: ['text'] },
          limit: { context: 32000, output: 2048 } } } } },
      plugins: [{ package: pathToFileURL(join(root, 'native-plugin')).href, options: { ...options, movementTokenFile } }] }) };
  owner = await startOpenCodeSourceRecoveryOwner({ version: 1, hostId: 'local', grant, mode: 'successor', runtime: '/usr/local/bin/turnlink-bun',
    entrypoint: resolve('.native-runtimes/opencode/packages/cli/src/native-recovery-host.ts'), database: join(root, 'movement.sqlite'),
    source: { directory: grant.from }, credentialDirectory, liveJournalDirectory: join(root, 'journal'), recoveryJournalDirectory: join(root, 'recovery-journal'),
    detachmentJournalDirectory: join(root, 'detachment-journal'), destinationJournalDirectory: join(root, 'destination-journal'),
    hostTokenFile: tokenFile, adapterTokenFile, movementTokenFile, verifierTokenFile: sourceToken,
    verifierSocket: join(sourceDirectory, `${sourceGeneration}.sock`), finish: true, refreshRecoveryIdle: true, brokerUrl: options.url,
    completionVerifierTokenFile: completionToken, completionVerifierDirectory: verifierDirectory, endpointDirectory, ownerLease: true,
    nativeEnvironmentAllowlist: ['EXPECT_FIXTURE_MODEL_KEY', 'FIXTURE_MODEL_KEY'], timeoutMs: 30000 }, {
    env: environment, signal: controller.signal, onStage: value => { stage = value; }, onVerifierRegistered: async ({ generation, signal }) => {
      const socket = createConnection({ host: '127.0.0.1', port: 31681 }); socket.on('error', () => socket.destroy());
      await once(socket, 'connect'); announcements = await announceContainedVerifier({ stream: socket, secret: '9'.repeat(64), generation, signal }); return announcements;
    } });
  assert.equal(owner.state, 'released');
  let task;
  for (let i = 0; i < 150; i++) {
    task = (await admin.request('control_query', { channel: 'dev', view: 'tasks' })).entries.find(item => item.id === grant.taskID);
    if (task?.status === 'review' && task.stoppedEvidence) break;
    await delay(200);
  }
  assert.equal(task?.status, 'review'); assert.ok(task.stoppedEvidence);
  process.stdout.write(JSON.stringify({ state: owner.state, transitionID: grant.id, task: task.status, modelRequests }));
} catch (error) { console.error(`SOURCE_STAGE_${stage}`); throw error; }
finally { controller.abort(); announcements?.close(); await owner?.close(); admin.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); }
