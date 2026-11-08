import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDirectory, privateTemp } from '../src/storage.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { ToolSession } from '../src/tools.js';
import { sessionRecord } from '../src/session-evidence.js';
import { digest } from '../src/config.js';
import { startCodexDeepSeekGateway } from './fixtures/codex-deepseek-gateway.js';

// An isolated, deterministic model invokes real MCP tools from a real native
// thread. It does not attest that a general-purpose model collected settings.
const localAgent = process.env.TURNLINK_LOCAL_CODEX_AGENT === '1' && process.platform === 'darwin' && process.env.TURNLINK_OFFLINE_CODEX_AGENT !== '1';
const liveAgent = localAgent && process.env.TURNLINK_LOCAL_CODEX_LIVE === '1';
const physicalAgent = localAgent && process.env.TURNLINK_CODEX_PHYSICAL_REBORN === '1';
const managedWorktree = localAgent && process.env.TURNLINK_CODEX_MANAGED_WORKTREE === '1';
const liveControl = liveAgent && Boolean(process.env.TURNLINK_CODEX_CONTROL_TOOL_FILE || process.env.TURNLINK_CODEX_CONTROL_TOOL_SHA256);
const executable = process.env.TURNLINK_OFFLINE_CODEX_AGENT === '1' ? '/tool/codex' : localAgent ? 'installed' : undefined;
test('native Codex invokes Turnlink MCP tools before and after a manual move',
  { skip: !executable, timeout: physicalAgent ? 900000 : liveAgent ? 420000 : 120000 }, async t => {
    const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-codex-manual-native-')));
    const nativeRoot = join(root, 'native'); mkdirSync(nativeRoot, { mode: 0o700 });
    const codexState = localAgent ? join(nativeRoot, 'codex') : '/root/.codex'; mkdirSync(codexState, { mode: 0o700, recursive: true });
    const source = localAgent ? join(nativeRoot, 'source') : '/workspace/source';
    let destination = localAgent ? join(nativeRoot, 'destination') : '/workspace/destination';
    mkdirSync(source, { mode: 0o700 });
    if (!physicalAgent && !managedWorktree) mkdirSync(destination, { mode: 0o700 });
    assert.ok(!(managedWorktree && (physicalAgent || liveAgent)), 'managed lifecycle fixture uses local synthetic inference only');
    const commandFile = localAgent ? join(root, 'model-command.json') : '/tmp/turnlink-model-command.json';
    const catalogueFile = localAgent ? join(root, 'model-tools.json') : '/tmp/turnlink-model-tools.json';
    let model, sourceGateway, destinationGateway, proxy, coordinator, broker, admin, reviewer, participant, targetParticipant,
      remoteFixture, fixtureCall, remote, renewal, nativeExecutable = executable, proxyErrors = '', destinationProcess = false;
    const stop = async () => { if (proxy && proxy.exitCode === null && proxy.signalCode === null) { const exited = once(proxy, 'exit'); proxy.kill(); await exited; } };
    t.after(async () => {
      clearInterval(renewal); coordinator?.clearSessionWatches(); await stop(); targetParticipant?.close(); participant?.close(); reviewer?.close(); admin?.close(); await broker?.close();
      if (model && model.exitCode === null && model.signalCode === null) { const stopped = once(model, 'exit'); model.kill('SIGTERM'); await stopped; }
      await sourceGateway?.close(); await destinationGateway?.close();
      if (remoteFixture && remoteFixture.exitCode === null && remoteFixture.signalCode === null) {
        try { await fixtureCall({ op: 'cleanup' }); } finally { remoteFixture.stdin.end(); await once(remoteFixture, 'exit'); }
      }
      rmSync(root, { recursive: true, force: true });
    });
    let modelPort = 42325;
    if (localAgent) {
      const found = spawnSync('/usr/bin/which', ['codex'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      assert.equal(found.status, 0, 'installed Codex must be on PATH');
      const resolved = realpathSync(found.stdout.trim()), arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const vendor = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
      const nativeBinary = resolved.endsWith('.js')
        ? realpathSync(join(dirname(resolved), '..', 'node_modules', '@openai', `codex-darwin-${arch}`, 'vendor', vendor, 'bin', 'codex'))
        : resolved;
      const version = spawnSync(nativeBinary, ['--version'], { encoding: 'utf8', timeout: 10000,
        env: { HOME: root, CODEX_HOME: codexState, PATH: '/usr/bin:/bin', TMPDIR: root } });
      assert.equal(version.status, 0, 'installed Codex version must be observable in the isolated profile');
      assert.match(version.stdout.trim(), /^codex-cli 0\.165\.0$/, 'installed Codex must match the pinned destination runtime');
      const sandbox = join(root, 'sandbox.sb'), wrapper = join(root, 'codex');
      writeFileSync(sandbox, `(version 1)\n(allow default)\n(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))\n` +
        `(allow file-read-metadata (subpath "/Users") (subpath "/private/tmp") (subpath "/private/var/folders"))\n` +
        `(allow file-read* (subpath "${root}") (literal "${nativeBinary}") (literal "${process.execPath}") (subpath "${resolve('src')}") (subpath "${resolve('node_modules')}") (literal "${resolve('package.json')}"))\n` +
        `(deny file-write*)\n(allow file-write* (subpath "${root}") (literal "/dev/null"))\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`, { mode: 0o600 });
      const denied = spawnSync('/usr/bin/sandbox-exec', ['-f', sandbox, '/bin/cat', resolve('README.md')], { stdio: 'ignore' });
      assert.notEqual(denied.status, 0, 'the native fixture must not read unrelated repository files');
      writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f '${sandbox}' '${nativeBinary}' "$@"\n`, { mode: 0o700 }); chmodSync(wrapper, 0o700); nativeExecutable = wrapper;
      if (liveAgent) {
        const gatewayArgs = { accessToken: '5'.repeat(64), authFile: join(homedir(), '.local/share/opencode/auth.json'),
          ...(liveControl ? { approvedControlFile: process.env.TURNLINK_CODEX_CONTROL_TOOL_FILE, approvedControlSha256: process.env.TURNLINK_CODEX_CONTROL_TOOL_SHA256 } : {}) };
        sourceGateway = await startCodexDeepSeekGateway(gatewayArgs);
        destinationGateway = await startCodexDeepSeekGateway(gatewayArgs);
        modelPort = sourceGateway.port;
      } else {
        model = spawn('/usr/bin/python3', [resolve('test/fixtures/codex-agent-model.py')], { env: { PATH: '/usr/bin:/bin',
          TURNLINK_CODEX_FIXTURE_PORT: '0', TURNLINK_CODEX_FIXTURE_COMMAND: commandFile, TURNLINK_CODEX_FIXTURE_CATALOGUE: catalogueFile,
          ...(process.env.TURNLINK_CODEX_FIXTURE_CAPTURE ? { TURNLINK_CODEX_FIXTURE_CAPTURE: process.env.TURNLINK_CODEX_FIXTURE_CAPTURE } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
        model.stderr.resume();
        const lines = createInterface({ input: model.stdout });
        const [line] = await Promise.race([once(lines, 'line'), once(model, 'exit').then(() => { throw new Error('Local synthetic model exited before startup'); })]);
        modelPort = Number(line); lines.close();
        assert.ok(Number.isSafeInteger(modelPort) && modelPort > 0, 'local synthetic model port');
      }
    }
    if (physicalAgent) {
      const remoteTemp = process.env.TURNLINK_TEST_WINDOWS_TEMP?.replace(/\/$/, '');
      const sshTarget = process.env.TURNLINK_TEST_WINDOWS_SSH_TARGET;
      const sshKey = process.env.TURNLINK_TEST_WINDOWS_SSH_KEY;
      assert.match(remoteTemp || '', /^[A-Za-z]:\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/);
      assert.ok(!remoteTemp.split('/').includes('..'));
      assert.match(sshTarget || '', /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/);
      assert.ok(sshKey && sshKey.startsWith('/'));
      remoteFixture = spawn('/usr/bin/python3', [resolve('test/fixtures/codex-physical-host.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
      remoteFixture.stderr.resume(); const replies = createInterface({ input: remoteFixture.stdout })[Symbol.asyncIterator]();
      fixtureCall = async command => {
        remoteFixture.stdin.write(`${JSON.stringify(command)}\n`);
        const reply = await replies.next(); if (reply.done) throw new Error('Codex Windows fixture exited');
        const value = JSON.parse(reply.value); if (!value.ok) throw new Error(value.error || value.cleanup); return value.result;
      };
      remote = await fixtureCall({ op: 'prepare' }); destination = remote.destination;
      if (!remote.root.startsWith(`${remoteTemp}/turnlink-codex-physical-`) || !/\/turnlink-codex-physical-[a-f0-9]{32}$/.test(remote.root))
        throw new Error('Unexpected synthetic Windows fixture location');
    }
    const adapter = join(root, 'adapter.token'); writeFileSync(adapter, '3'.repeat(64), { mode: 0o600 });
    broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: '1'.repeat(64), adminSecret: '2'.repeat(64), controlPlane: true,
      managedRecords: managedWorktree,
      ...(physicalAgent ? { hosts: [{ hostId: 'local', credential: '1'.repeat(64), channels: ['dev'], broadcast: true },
        { hostId: 'destination', credential: '7'.repeat(64), channels: ['dev'], broadcast: true }] } : {}),
      taskDispatch: true, codexTasks: true, worktreeGrants: true, worktreeTaskDispatch: true, manualWorktreeOnly: true });
    await once(broker.server, 'listening');
    const url = `ws://127.0.0.1:${broker.server.address().port}`, proofs = join(root, 'proofs');
    const liveTools = ['channel_join', 'channel_send', 'channel_history', 'channel_status', ...(!liveAgent || liveControl ? ['channel_control'] : [])];
    const writeConfig = (port, allowShell) => writeFileSync(join(codexState, 'config.toml'), `model = "${liveAgent ? 'deepseek-flash' : 'fixture'}"\nmodel_provider = "fixture"\napproval_policy = "${liveAgent ? 'never' : 'on-request'}"\n[features]\nplugins = false\n${liveAgent ? `shell_tool = ${allowShell}\n` : ''}[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n[mcp_servers.turnlink]\ncommand = ${JSON.stringify(localAgent ? process.execPath : '/tool/node')}\nargs = [${JSON.stringify(localAgent ? resolve('src/mcp.js') : '/repo/src/mcp.js')}, "--codex-stdio", "--control-plane"]\n[mcp_servers.turnlink.env]\nAGENT_CHANNEL_URL = "${url}"\nAGENT_CHANNEL_TOKEN = "${'1'.repeat(64)}"\nAGENT_CHANNEL_CREDENTIAL_DIR = "${proofs}"\n${liveAgent ? liveTools.map(name => `[mcp_servers.turnlink.tools.${name}]\napproval_mode = "approve"\n`).join('') : ''}`);
    writeConfig(modelPort, false);
    admin = new ChannelClient({ url, token: '2'.repeat(64), credentialDirectory: proofs });
    reviewer = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: proofs });
    participant = new ChannelClient({ url, token: '1'.repeat(64), credentialDirectory: proofs });
    const reviewerFailures = [], reviewerSteps = [], reviewerRequest = reviewer.request.bind(reviewer);
    const rejectedStatusTarget = Number(process.env.TURNLINK_CODEX_FIXTURE_REJECT_STATUS_COUNT || 0);
    assert.ok(Number.isInteger(rejectedStatusTarget) && rejectedStatusTarget >= 0 && rejectedStatusTarget <= 8);
    let rejectedStatusCount = 0;
    const traceReviewer = step => { reviewerSteps.push(step); if (reviewerSteps.length > 40) reviewerSteps.shift(); };
    const safeErrors = new Set(['MANUAL_RESUME_UNAVAILABLE', 'STALE_MASTER', 'BROKER_RATE_LIMITED_BEFORE_DISPATCH',
      'CONTROL_UNAVAILABLE', 'Session ownership denied', 'No recipient in this channel', 'Invalid request schema or protocol version']);
    reviewer.request = async (method, params) => {
      try {
        if (method === 'control_manual_resume_status' && rejectedStatusCount < rejectedStatusTarget &&
            Object.values(broker.store.agents).some(agent => agent.project?.root === destination)) {
          rejectedStatusCount++;
          throw Object.assign(new Error('MANUAL_RESUME_UNAVAILABLE'), { code: 'MANUAL_RESUME_UNAVAILABLE' });
        }
        const result = await reviewerRequest(method, params);
        if (['members', 'history', 'control_manual_resume_arm', 'control_manual_resume_status'].includes(method))
          traceReviewer({ method, ...(Array.isArray(result) ? { count: result.length } : {}),
            ...(typeof result?.status === 'string' ? { status: result.status } : {}) });
        else if (method === 'send' && params.messageId?.startsWith('turnlink-verify-')) traceReviewer({ method: 'comparison_send', result: 'accepted' });
        return result;
      }
      catch (error) {
        const reason = safeErrors.has(error.message) ? error.message : safeErrors.has(error.code) ? error.code : 'other';
        reviewerFailures.push({ method, reason }); traceReviewer({ method, reason });
        if (reviewerFailures.length > 20) reviewerFailures.shift();
        throw error;
      }
    };
    const wait = async fn => { for (let i = 0; i < (liveAgent ? 1200 : 300); i++) { try { const result = await fn(); if (result) return result; }
      catch (error) { if (error.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH') throw error; } await delay(100); } throw new Error(`Native manual fixture timed out: ${proxyErrors}`); };
    const run = (client, agentId, op, fields = {}) => client.request('control_command', { ...(agentId ? { agentId } : {}),
      command: { id: randomUUID(), channel: 'dev', op, ...fields } });
    const query = async view => (await admin.request('control_query', { channel: 'dev', view })).entries;
    const frames = [];
    const send = frame => proxy.stdin.write(`${JSON.stringify(frame)}\n`);
    const start = async (method, threadId, resumeCwd = destination) => {
      proxyErrors = '';
      if (destinationProcess) {
        const brokerPort = randomInt(41000, 45000), providerPort = randomInt(45001, 49000), remoteProofs = `${remote.root}/proofs`;
        const config = `model = "${liveAgent ? 'deepseek-flash' : 'fixture'}"\nmodel_provider = "fixture"\napproval_policy = "${liveAgent ? 'never' : 'on-request'}"\n[features]\nplugins = false\nshell_tool = false\n` +
          `[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${providerPort}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n` +
          `[mcp_servers.turnlink]\ncommand = ${JSON.stringify(`${remote.root}/node.exe`)}\nargs = [${JSON.stringify(`${remote.root}/payload/src/mcp.js`)}, "--codex-stdio", "--control-plane"]\n` +
          `[mcp_servers.turnlink.env]\nAGENT_CHANNEL_URL = "ws://127.0.0.1:${brokerPort}"\nAGENT_CHANNEL_TOKEN = "${'7'.repeat(64)}"\nAGENT_CHANNEL_CREDENTIAL_DIR = ${JSON.stringify(remoteProofs)}\n` +
          liveTools.map(name => `[mcp_servers.turnlink.tools.${name}]\napproval_mode = "approve"\n`).join('');
        const config64 = Buffer.from(config).toString('base64');
        const script = `$ErrorActionPreference='Stop';$root='${remote.root}';` +
          `[IO.File]::WriteAllBytes(($root+'/profile/config.toml'),[Convert]::FromBase64String('${config64}'));` +
          `$env:CODEX_HOME=$root+'/profile';$env:HOME=$root;$env:TEMP=$root;$env:TMP=$root;` +
          `$env:TURNLINK_FIXTURE_KEY='${'5'.repeat(64)}';$env:AGENT_CHANNEL_CODEX_EXECUTABLE=$root+'/codex.exe';` +
          `$env:AGENT_CHANNEL_URL='ws://127.0.0.1:${brokerPort}';$env:AGENT_CHANNEL_TOKEN='${'7'.repeat(64)}';` +
          `$env:AGENT_CHANNEL_CREDENTIAL_DIR=$root+'/proofs';$env:AGENT_CHANNEL_STATE_DIR=$root+'/state';` +
          `$env:AGENT_CHANNEL_CONTROL='1';$env:AGENT_CHANNEL_CODEX_TASKS='1';$env:AGENT_CHANNEL_CODEX_WORKTREE_TASKS='1';$env:AGENT_CHANNEL_HEALTH='1';` +
          `$env:AGENT_CHANNEL_ADAPTER_TOKEN_FILE=$root+'/adapter.token';$env:AGENT_CHANNEL_RPC_TIMEOUT_MS='5000';` +
          `& ($root+'/node.exe') ($root+'/payload/src/codex-proxy.js') app-server;exit $LASTEXITCODE`;
        proxy = spawn('ssh', ['-i', process.env.TURNLINK_TEST_WINDOWS_SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
          '-o', 'ExitOnForwardFailure=yes', '-R', `127.0.0.1:${brokerPort}:127.0.0.1:${broker.server.address().port}`,
          '-R', `127.0.0.1:${providerPort}:127.0.0.1:${liveAgent ? destinationGateway.port : modelPort}`, process.env.TURNLINK_TEST_WINDOWS_SSH_TARGET,
          'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'pipe'] });
      } else {
        proxy = spawn(process.execPath, [resolve('src/codex-proxy.js'), 'app-server'], { cwd: root, env: {
          PATH: process.env.PATH, ...(localAgent ? { HOME: root, CODEX_HOME: codexState, TMPDIR: root } : {}),
          TURNLINK_FIXTURE_KEY: liveAgent ? '5'.repeat(64) : 'local-fixture-only', AGENT_CHANNEL_CODEX_EXECUTABLE: nativeExecutable,
          AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: '1'.repeat(64), AGENT_CHANNEL_CREDENTIAL_DIR: proofs,
          AGENT_CHANNEL_CONTROL: '1', AGENT_CHANNEL_CODEX_TASKS: '1', AGENT_CHANNEL_CODEX_WORKTREE_TASKS: '1', ...(liveAgent ? { AGENT_CHANNEL_HEALTH: '1' } : {}),
          AGENT_CHANNEL_ADAPTER_TOKEN_FILE: adapter, AGENT_CHANNEL_RPC_TIMEOUT_MS: '5000',
        }, stdio: ['pipe', 'pipe', 'pipe'] });
      }
      proxy.stderr.on('data', chunk => { proxyErrors = (proxyErrors + chunk.toString()).slice(-3000); });
      createInterface({ input: proxy.stdout }).on('line', line => {
        try {
          const frame = JSON.parse(line); frames.push(frame);
          // This approval applies only to the synthetic, local fixture server.
          if (frame.method === 'mcpServer/elicitation/request' && frame.id !== undefined && frame.params?.serverName === 'turnlink' &&
              JSON.stringify(frame.params.requestedSchema) === JSON.stringify({ type: 'object', properties: {} }))
            proxy.stdin.write(`${JSON.stringify({ id: frame.id, result: { action: 'accept', content: {} } })}\n`);
        } catch { /* Not a protocol frame. */ }
      });
      const init = randomUUID(); send({ id: init, method: 'initialize', params: { clientInfo: { name: 'synthetic/manual', version: '1' }, capabilities: { experimentalApi: true } } });
      const initial = await wait(() => {
        const response = frames.find(frame => frame.id === init);
        if (!response && proxy.exitCode !== null) throw new Error(`Native proxy exited before initialization: ${proxyErrors}`);
        return response;
      }); assert.ok(initial.result, 'initialization succeeded');
      send({ method: 'initialized', params: {} });
      const settings = { sandbox: 'read-only', approvalPolicy: liveAgent ? 'never' : 'on-request' };
      const id = randomUUID(); send({ id, method, params: method === 'thread/start' ? { cwd: source, ...settings } :
        { threadId, cwd: resumeCwd, ...settings } });
      const response = await wait(() => frames.find(frame => frame.id === id));
      assert.ok(response.result?.thread?.id, `native ${method} succeeded: ${JSON.stringify(response.error)}`);
      return response.result.thread.id;
    };
    const agentTool = async (threadId, name, args) => {
      await delay(800);
      if (!liveAgent) writeFileSync(commandFile, JSON.stringify({ name, arguments: args }), { mode: 0o600 });
      const command = args.command;
      const governancePrompt = liveControl && process.env.TURNLINK_CODEX_EXPLICIT_CONTROL !== '1' && name === 'channel_control' && ['task.claim', 'task.report'].includes(command?.op)
        ? `Synthetic coordination test in channel dev. Available channel_control commands include task.claim (fields id, op, channel, taskID) and task.report (fields id, op, channel, taskID, summary, evidence). ` +
          `For this operation use the fresh command UUID ${command.id} and task ID ${command.taskID}. ` +
          (command.op === 'task.claim'
            ? 'The task is unclaimed and you are ready to take responsibility for doing it. Take the appropriate coordination action.'
            : `Your task has finished. Inform the coordinator of the result and include native evidence ${JSON.stringify(command.evidence)}. Summary: ${command.summary}.`)
        : undefined;
      const requestId = randomUUID(); send({ id: requestId, method: 'turn/start', params: { threadId,
        input: [{ type: 'text', text: liveAgent ? (governancePrompt || `Synthetic test: use ${name} with these arguments: ${JSON.stringify(args)}. `) +
          `Only channel_join, channel_send, channel_history, channel_status${liveControl ? ' and channel_control' : ''} are available; there is no shell or file tool. ` +
          `Turnlink stores a private copy automatically when the session record is sent. The test operator set this thread's current directory to ${args.project?.root || source}; ` +
          'the synthetic settings for later comparison are model deepseek-flash, provider fixture, permissions read-only, and saved work "synthetic work with no external actions". Do not guess unavailable settings.' : 'TURNLINK_SYNTHETIC_TOOL_REQUEST' }] } });
      const response = await wait(() => frames.find(frame => frame.id === requestId));
      assert.ok(response.result?.turn?.id, `native tool turn started: ${JSON.stringify(response.error)}`);
      const turnId = response.result.turn.id;
      const completed = await wait(() => frames.find(frame => frame.method === 'turn/completed' && frame.params?.turn?.id === turnId))
        .catch(error => { throw new Error(`${error.message}; recent=${JSON.stringify(frames.slice(-15).map(frame => ({ method: frame.method, id: frame.id, item: frame.params?.item?.type, status: frame.params?.item?.status, error: frame.error })))}; commandPending=${existsSync(commandFile)}; catalogue=${existsSync(catalogueFile) ? readFileSync(catalogueFile,'utf8') : 'unavailable'}`); });
      assert.equal(completed.params.turn.status, 'completed');
      if (!liveAgent) assert.equal(existsSync(commandFile), false, `model saw requested tool; catalogue=${existsSync(catalogueFile) ? readFileSync(catalogueFile,'utf8') : 'unavailable'}`);
    };
    await run(admin, null, 'channel.configure'); await admin.request('control_enroll_adapter', { hostId: 'local', credential: '3'.repeat(64) });
    if (physicalAgent) await admin.request('control_enroll_adapter', { hostId: 'destination', credential: '8'.repeat(64) });
    await reviewer.request('join', { harness: 'opencode', sessionId: 'reviewer', channel: 'dev', name: 'reviewer', role: 'review', project: { name: 'fixture', root: source } });
    await reviewer.subscribe('opencode:reviewer'); await run(reviewer, 'opencode:reviewer', 'master.volunteer', { eligible: true });
    const proposal = await run(admin, null, 'master.appoint', { candidate: 'opencode:reviewer' });
    const notice = (await reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'notices' })).entries[0];
    await reviewer.request('control_notice_ack', { agentId: 'opencode:reviewer', credential: '3'.repeat(64), id: notice.id, receiptID: 'msg_native_reviewer' });
    await run(reviewer, 'opencode:reviewer', 'master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
    const master = await reviewer.request('control_query', { agentId: 'opencode:reviewer', channel: 'dev', view: 'channel' });
    const generation = master.channel.active.generation;
    renewal = setInterval(() => { void run(reviewer, 'opencode:reviewer', 'master.renew', { generation }).catch(() => {}); }, 5000);
    renewal.unref();
    const thread = await start('thread/start'), agentId = `codex:${thread}`;
    const joinAt = path => agentTool(thread, 'channel_join', { channel: 'dev', name: 'worker', role: 'synthetic', project: { name: 'fixture', root: path } });
    await joinAt(source);
    await wait(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(member => member.agentId === agentId)?.connected);
    const taskID = (await run(admin, null, 'task.create', { title: 'Native manual task', instructions: 'Respond with the fixture result.', criteria: 'Report the completed result.', requiresWorktree: true })).commandID;
    if (liveAgent && !liveControl) await run(participant, agentId, 'task.claim', { taskID });
    else await agentTool(thread, 'channel_control', { command: { id: randomUUID(), channel: 'dev', op: 'task.claim', taskID } });
    let managedResource, managedSettings;
    const managedCli = async (file, ...args) => {
      const child = spawn(process.execPath, [resolve(file), ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH,
        AGENT_CHANNEL_URL: url, AGENT_CHANNEL_TOKEN: '1'.repeat(64), AGENT_CHANNEL_STATE_DIR: join(root, 'operator') } });
      let output = '', errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      assert.equal((await once(child, 'close'))[0], 0, errors); return JSON.parse(output);
    };
    if (managedWorktree) {
      await stop(); await wait(() => broker.store.agents[agentId]?.disconnectedAt !== null);
      const template = join(root, 'git-template'); mkdirSync(template, { mode: 0o700 });
      const git = args => { const value = spawnSync('git', args, { cwd: source, encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH,
        HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TEMPLATE_DIR: template } });
      assert.equal(value.status, 0, 'synthetic repository setup failed'); };
      git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
      writeFileSync(join(source, 'source-file'), 'fixture\n'); git(['add', 'source-file']); git(['commit', '-m', 'fixture']);
      mkdirSync(join(root, 'operator'), { mode: 0o700 }); writeFileSync(join(root, 'operator', 'admin-token'), '2'.repeat(64), { mode: 0o600 });
      managedSettings = join(root, 'managed-settings.json');
      writeFileSync(managedSettings, JSON.stringify({ version: 1, agentId, channel: 'dev', repository: source,
        directory: join(root, 'managed-state'), worktreeRoot: join(root, 'managed-trees'), adapterCredentialFile: adapter, credentialDirectory: proofs }), { mode: 0o600 });
      const preview = await managedCli('src/manual-managed-worktree.js', 'preview-create', managedSettings, taskID, '1');
      await managedCli('src/control-admin.js', 'managed-worktree-approve', 'dev', preview.id);
      managedResource = await managedCli('src/manual-managed-worktree.js', 'create', managedSettings, preview.id, preview.digest, '--confirm-no-active-use');
      destination = managedResource.destination;
      assert.equal(await start('thread/resume', thread, source), thread);
      await wait(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members.find(member => member.agentId === agentId)?.connected);
      await joinAt(source);
    }
    coordinator = new ToolSession(reviewer, { harness: 'opencode', sessionId: 'reviewer' }); coordinator.agentId = 'opencode:reviewer'; coordinator.channel = 'dev';
    const previewID = (await coordinator.call('channel_manual_preview', { taskID, destination }).catch(async error => {
      const [state, tasks] = await Promise.all([
        admin.request('control_query', { channel: 'dev', view: 'channel' }).catch(() => null),
        admin.request('control_query', { channel: 'dev', view: 'tasks' }).catch(() => null),
      ]);
      const task = tasks?.entries?.find(value => value.id === taskID);
      const calls = frames.filter(frame => frame.method === 'item/completed' && frame.params?.item?.type === 'mcpToolCall')
        .slice(-5).map(frame => ({ tool: frame.params.item.tool, status: frame.params.item.status,
          operation: frame.params.item.arguments?.command?.op || null }));
      throw new Error(`${error.message}; taskStatus=${task?.status || 'unavailable'}; claimedBySession=${task?.claimant === agentId}; ` +
        `coordinatorActive=${state?.channel?.active?.agentId === 'opencode:reviewer'}; ` +
        `claimantConnected=${state?.members?.some(member => member.agentId === agentId && member.connected) === true}; ` +
        `calls=${JSON.stringify(calls)}; reviewerFailures=${JSON.stringify(reviewerFailures)}`);
    })).commandID;
    await run(admin, null, 'worktree.approve', { taskID, previewID });
    const prep = await coordinator.call('channel_prepare_session', { taskID, previewID, messageId: 'native-manual-prepare' });
    await wait(() => broker.store.messages.find(message => message.id === prep.id)?.delivered.includes(agentId));
    let saved;
    if (liveAgent) {
      saved = await wait(() => broker.store.messages.find(message => {
        if (message.from?.agentId !== agentId || message.to !== 'opencode:reviewer') return false;
        try { const record = sessionRecord.parse(JSON.parse(message.text)); return record.taskID === taskID && record.previewID === previewID; } catch { return false; }
      }));
    } else {
      const record = { type: 'turnlink.session_record.v2', taskID, previewID, session: agentId, source, destination,
        runtime: 'codex 0.165.0', model: 'fixture', provider: 'fixture', permissions: 'read-only', work: 'synthetic saved work' };
      await agentTool(thread, 'channel_send', { to: 'opencode:reviewer', text: JSON.stringify(record), messageId: 'native-manual-record' });
      saved = await wait(() => broker.store.messages.find(message => message.messageId === 'native-manual-record'));
    }
    const privateRecord = join(proofs, 'manual-session-records', digest(agentId), `${taskID}-${previewID}.json`);
    assert.equal(readFileSync(privateRecord, 'utf8'), saved.text, 'the source copy must exactly match the agent record sent to the coordinator');
    await wait(() => broker.store.bindings[agentId]?.manualResume?.status === 'armed').catch(async error => {
      const state = await admin.request('control_query', { channel: 'dev', view: 'channel' }).catch(() => null);
      const watch = coordinator.sessionWatches?.get(previewID);
      throw new Error(`${error.message}; coordinatorActive=${state?.channel?.active?.agentId === 'opencode:reviewer'}; watchError=${watch?.lastError || 'none'}; retryRequired=${watch?.retryRequired === true}; reviewerFailures=${JSON.stringify(reviewerFailures)}`);
    });
    if (physicalAgent) console.log('CODEX_SOURCE_RECORD_SAVED');
    await wait(() => broker.store.messages.find(message => message.messageId === `turnlink-armed-${saved.id}`)?.delivered.includes(agentId));
    await stop(); await wait(() => broker.store.bindings[agentId]?.manualResume?.status === 'detached');
    if (physicalAgent) console.log('CODEX_SOURCE_STOPPED');
    if (physicalAgent) {
      await admin.request('control_manual_resume_authorize_host', { channel: 'dev', taskID, previewID, targetHostId: 'destination',
        transferID: randomUUID(), sourceStopped: true });
      const archive = join(root, 'synthetic-rollout.zip');
      const script = `import os,sys,zipfile\nroot,out=sys.argv[1:]\nsessions=os.path.join(root,'sessions')\nassert os.path.isdir(sessions)\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n for base,dirs,files in os.walk(sessions,followlinks=False):\n  dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(base,d))]\n  for name in files:\n   path=os.path.join(base,name)\n   if name.endswith('.jsonl') and not os.path.islink(path):z.write(path,os.path.relpath(path,root))`;
      const packaged = spawnSync('/usr/bin/python3', ['-c', script, codexState, archive], { encoding: 'utf8', timeout: 30000 });
      assert.equal(packaged.status, 0, 'synthetic Codex rollout packaging failed');
      await fixtureCall({ op: 'upload_state', archive }); destinationProcess = true;
    }
    if (liveAgent) writeConfig(destinationGateway.port, false);
    assert.equal(await start('thread/resume', thread), thread); await joinAt(destination);
    if (physicalAgent) {
      await wait(async () => (await admin.request('control_query', { channel: 'dev', view: 'channel' })).members
        .find(member => member.agentId === agentId)?.connected);
      if (liveAgent && !liveControl) {
        const proof = await fixtureCall({ op: 'read_proof', hostDigest: digest('destination'), agentDigest: digest(agentId) });
        const targetRoot = join(root, 'target-proofs'), hostRoot = join(targetRoot, digest('destination'));
        privateDirectory(targetRoot); privateDirectory(hostRoot);
        writeFileSync(join(hostRoot, `${digest(agentId)}.key`), proof.proof, { mode: 0o600, flag: 'wx' });
        targetParticipant = new ChannelClient({ url, token: '7'.repeat(64), credentialDirectory: targetRoot });
      }
      console.log('CODEX_DESTINATION_JOINED');
    }
    const request = await wait(() => broker.store.messages.find(message => message.messageId === `turnlink-verify-${saved.id}`)).catch(error => {
      const watch = coordinator.sessionWatches?.get(previewID);
      const calls = frames.filter(frame => frame.method === 'item/completed' && frame.params?.item?.type === 'mcpToolCall').slice(-3)
        .map(frame => ({ tool: frame.params.item.tool, status: frame.params.item.status }));
      throw new Error(`${error.message}; observation=${broker.store.bindings[agentId]?.manualResume?.status}; connected=${broker.store.agents[agentId]?.disconnectedAt === null}; watch=${watch?.lastError}; retryRequired=${watch?.retryRequired === true}; watchBusy=${watch?.busy === true}; uncertainComparison=${!!watch?.uncertainComparison}; reviewerFailures=${JSON.stringify(reviewerFailures)}; reviewerSteps=${JSON.stringify(reviewerSteps)}; calls=${JSON.stringify(calls)}`);
    });
    assert.equal(rejectedStatusCount, rejectedStatusTarget, 'all configured destination observation failures must be exercised');
    if (rejectedStatusTarget) console.log(`CODEX_DESTINATION_RETRIED_${rejectedStatusCount}`);
    if (liveAgent) {
      await wait(async () => (await coordinator.call('channel_session_status', { taskID, previewID })).status === 'reported_match');
      if (physicalAgent) console.log('CODEX_COMPARISON_MATCHED');
    }
    else {
      const report = { type: 'turnlink.session_report.v2', taskID, previewID, session: agentId, recordID: saved.id, requestID: request.id, runtime: 'codex 0.165.0',
        checks: { session: 'match', destination: 'match', runtime: 'match', model: 'match', provider: 'match', permissions: 'match', work: 'match' } };
      await agentTool(thread, 'channel_send', { to: 'opencode:reviewer', text: JSON.stringify(report), messageId: 'native-manual-report' });
    }
    await admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: saved.id, requestID: request.id, receiptID: randomUUID(), sourceStopped: true });
    const stopped = await wait(async () => (await query('tasks')).find(task => task.id === taskID && task.stoppedEvidence));
    const artifact = (await query('evidence')).find(entry => entry.entityID === taskID && entry.kind === 'artifact');
    assert.equal(stopped.status, 'uncertain'); assert.equal(artifact.artifact.sessionID, thread);
    if (liveAgent && !liveControl) await run(targetParticipant || participant, agentId, 'task.report', { taskID, summary: 'Synthetic native result', evidence: [artifact.id] });
    else await agentTool(thread, 'channel_control', { command: { id: randomUUID(), channel: 'dev', op: 'task.report', taskID, summary: 'Synthetic native result', evidence: [artifact.id] } });
    await run(reviewer, 'opencode:reviewer', 'task.review', { taskID, generation: 1, accept: true, evidenceID: artifact.id });
    assert.equal((await query('tasks')).find(task => task.id === taskID).status, 'completed');
    if (managedWorktree) {
      await stop(); await wait(() => broker.store.agents[agentId]?.disconnectedAt !== null);
      const removal = await managedCli('src/manual-managed-worktree.js', 'preview-remove', managedSettings, managedResource.id);
      await managedCli('src/control-admin.js', 'managed-worktree-approve', 'dev', removal.id);
      const removed = await managedCli('src/manual-managed-worktree.js', 'remove', managedSettings, removal.id, removal.digest, '--confirm-no-active-use');
      assert.equal(removed.phase, 'removed'); assert.equal(existsSync(destination), false);
    }
    if (physicalAgent) console.log('CODEX_TASK_COMPLETED');
  });
