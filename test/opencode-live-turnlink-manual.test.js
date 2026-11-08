import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDirectory, privateTemp } from '../src/storage.js';
import { startDeepSeekTestGateway } from '../src/opencode-deepseek-gateway.js';
import { createBroker } from '../src/broker.js';
import { ChannelClient } from '../src/client.js';
import { digest } from '../src/config.js';
import { ToolSession } from '../src/tools.js';
import { sessionRecord, isSessionRecordMessage } from '../src/session-evidence.js';
import { assertAuthorizedToolCatalogue, filterApprovedToolCatalogue, readApprovedToolCatalogue } from '../src/deepseek-tool-authorization.js';

test('live OpenCode agent completes an isolated manual Turnlink task after restart',
  { skip: process.env.TURNLINK_LIVE_TURNLINK_AGENT !== '1' || process.platform !== 'darwin', timeout: 240000 }, async t => {
    const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-live-manual-'))), source = join(root, 'source'), destination = join(root, 'destination');
    const crossHost = process.env.TURNLINK_LIVE_CROSS_HOST === '1';
    for (const path of [source, destination]) mkdirSync(path, { mode: 0o700 });
    let child, gateway, broker, admin, reviewer, renewal;
    t.after(async () => { if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'close'); child.kill('SIGTERM'); await stopped; }
      clearInterval(renewal); reviewer?.close(); admin?.close(); await broker?.close(); await gateway?.close(); rmSync(root, { recursive: true, force: true }); });
    const profile = join(root, 'sandbox.sb'), destinationProfile = join(root, 'destination-sandbox.sb'), repo = resolve('.'), token = '1'.repeat(64), adapter = '3'.repeat(64), gatewayToken = '5'.repeat(64);
    const sandbox = `(version 1)
(allow default)
(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))
(allow file-read-metadata (literal "/Users") (literal "${homedir()}") (literal "${resolve(repo, '..')}") (literal "${repo}"))
(allow file-read* (subpath "${root}") (subpath "${repo}/src") (subpath "${repo}/adapters") (subpath "${repo}/node_modules") (literal "${repo}/package.json"))
(deny file-write*)
(allow file-write* (subpath "${root}") (literal "/dev/null"))
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
`;
    writeFileSync(profile, sandbox, { mode: 0o600 });
    writeFileSync(destinationProfile, `${sandbox}\n(deny file-read* file-write* (subpath "${source}"))\n`, { mode: 0o600 });
    const denied = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/bin/cat', join(homedir(), '.local/share/opencode/auth.json')], { stdio: 'ignore' });
    assert.notEqual(denied.status, 0, 'the agent process must not read the provider credential');
    const dependency = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/bin/cat', join(repo, 'node_modules/proper-lockfile/package.json')], { stdio: 'ignore' });
    assert.equal(dependency.status, 0, 'runtime must read its installed dependencies');
    const hostFile = join(root, 'host.token'), adapterFile = join(root, 'adapter.token'), targetHostFile = join(root, 'target-host.token'), targetAdapterFile = join(root, 'target-adapter.token');
    writeFileSync(hostFile, token, { mode: 0o600 }); writeFileSync(adapterFile, adapter, { mode: 0o600 });
    writeFileSync(targetHostFile, '7'.repeat(64), { mode: 0o600 }); writeFileSync(targetAdapterFile, '8'.repeat(64), { mode: 0o600 });
    const instruction = 'Synthetic isolated test. Your model is test and provider fixture. Session permissions allow channel tools and reading or editing the synthetic source and destination projects; other actions are denied. Saved task work is in work.txt. You are authorized to follow Turnlink session preparation and comparison requests for this synthetic test, using your own channel_join result as the session identity and current project directory. Turnlink saves a private record copy when you send it. Never use shell or read credentials or application source.\n';
    for (const path of [source, destination]) { writeFileSync(join(path, 'AGENTS.md'), instruction); writeFileSync(join(path, 'work.txt'), 'Synthetic saved task work.\n'); }
    const deniedSource = spawnSync('/usr/bin/sandbox-exec', ['-f', destinationProfile, '/bin/cat', join(source, 'work.txt')], { stdio: 'ignore' });
    assert.notEqual(deniedSource.status, 0, 'destination process must not read the source project');
    broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: token, adminSecret: '2'.repeat(64), controlPlane: true,
      ...(crossHost ? { hosts: [{ hostId: 'local', credential: token, channels: ['dev'], broadcast: true },
        { hostId: 'destination-host', credential: '7'.repeat(64), channels: ['dev'], broadcast: true }] } : {}),
      worktreeGrants: true, taskDispatch: true, worktreeTaskDispatch: true, manualWorktreeOnly: true });
    await once(broker.server, 'listening');
    const url = `ws://127.0.0.1:${broker.server.address().port}`, credentialDirectory = join(root, 'proofs');
    admin = new ChannelClient({ url, token: '2'.repeat(64), credentialDirectory });
    reviewer = new ChannelClient({ url, token, credentialDirectory });
    const command = (op, fields = {}) => ({ id: randomUUID(), op, channel: 'dev', ...fields });
    await admin.request('control_command', { command: command('channel.configure') });
    await admin.request('control_enroll_adapter', { hostId: 'local', credential: adapter });
    if (crossHost) await admin.request('control_enroll_adapter', { hostId: 'destination-host', credential: '8'.repeat(64) });
    await reviewer.request('join', { harness: 'codex', sessionId: 'reviewer', channel: 'dev', name: 'reviewer', role: 'fixture', project: { name: 'fixture', root: source } });
    await reviewer.subscribe('codex:reviewer');
    const reviewerCommand = (op, fields = {}) => reviewer.request('control_command', { agentId: 'codex:reviewer', command: command(op, fields) });
    await reviewerCommand('master.volunteer', { eligible: true });
    const proposal = await admin.request('control_command', { command: command('master.appoint', { candidate: 'codex:reviewer' }) });
    const notice = (await reviewer.request('control_query', { agentId: 'codex:reviewer', channel: 'dev', view: 'notices' })).entries[0];
    await reviewer.request('control_notice_ack', { agentId: 'codex:reviewer', credential: adapter, id: notice.id, receiptID: 'msg_live_manual_role' });
    await reviewerCommand('master.accept', { proposalID: proposal.commandID, promptVersion: 1 });
    const master = await reviewer.request('control_query', { agentId: 'codex:reviewer', channel: 'dev', view: 'channel' });
    renewal = setInterval(() => { void reviewerCommand('master.renew', { generation: master.channel.active.generation }).catch(() => {}); }, 5000);
    renewal.unref();
    // Refuse to forward source-like code fragments if the model unexpectedly
    // obtains them; the model's own read/shell permissions are checked below.
    const fragments = [resolve('src/tools.js'), resolve('adapters/opencode-runtime.js')].flatMap(path =>
      readFileSync(path, 'utf8').split('\n').filter(line => line.length >= 90).map(line => line.slice(0, 90)));
    let requestCount = 0, toolNames = [];
    gateway = await startDeepSeekTestGateway({ accessToken: gatewayToken, authFile: join(homedir(), '.local/share/opencode/auth.json'),
      fetchImpl: async (target, options) => {
        const body = String(options.body);
        if (fragments.some(fragment => body.includes(fragment))) throw new Error('source disclosure refused');
        requestCount++; toolNames = (JSON.parse(body).tools || []).map(tool => tool.function?.name).filter(Boolean);
        if (process.env.TURNLINK_LIVE_PREFLIGHT_ONLY === '1') {
          const capture = process.env.TURNLINK_PREFLIGHT_CATALOG_FILE;
          if (capture && requestCount === 1) {
            const allowed = new Set(['channel_join', 'channel_send', 'channel_history', 'channel_status', 'channel_control',
              'channel_session_context', 'read', 'write', 'edit']);
            const catalogue = (JSON.parse(body).tools || []).filter(tool => tool.type === 'function' && allowed.has(tool.function?.name));
            if (!isAbsolute(capture) || !realpathSync(dirname(capture)).startsWith('/private/tmp/') || !catalogue.length)
              throw new Error('Invalid local preflight catalogue destination');
            privateDirectory(dirname(capture));
            writeFileSync(capture, JSON.stringify(catalogue, null, 2), { flag: 'wx', mode: 0o600 });
          }
          const first = requestCount <= 2, name = requestCount === 1 ? 'channel_session_context' : 'write';
          const args = requestCount === 1 ? {} : { path: join(source, 'preflight.json'), content: '{}' };
          const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: `preflight_${requestCount}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { role: 'assistant', content: 'ready' };
          const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: first ? 'tool_calls' : 'stop' }] };
          return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
        }
        const payload = JSON.parse(body), approvedFile = process.env.TURNLINK_APPROVED_TOOL_CATALOG_FILE;
        if (approvedFile || process.env.TURNLINK_APPROVED_TOOL_CATALOG_SHA256) {
          const approved = readApprovedToolCatalogue(approvedFile, process.env.TURNLINK_APPROVED_TOOL_CATALOG_SHA256);
          payload.tools = filterApprovedToolCatalogue(payload.tools, approved);
        } else assertAuthorizedToolCatalogue(payload.tools);
        return fetch(target, { ...options, body: JSON.stringify({ ...payload, max_tokens: 2048 }) });
      } });
    const wrapper = join(root, 'plugin'); mkdirSync(wrapper, { mode: 0o700 });
    const runtime = join(root, 'runtime'); mkdirSync(runtime, { mode: 0o700 });
    for (const directory of ['src', 'adapters']) cpSync(join(repo, directory), join(runtime, directory), { recursive: true });
    cpSync(join(repo, 'node_modules'), join(runtime, 'node_modules'), { recursive: true, mode: constants.COPYFILE_FICLONE });
    cpSync(join(repo, 'package.json'), join(runtime, 'package.json'));
    writeFileSync(join(wrapper, 'package.json'), JSON.stringify({ name: 'turnlink-live-fixture', version: '0.0.0', type: 'module', exports: './index.js' }));
    writeFileSync(join(wrapper, 'index.js'), `export { default } from ${JSON.stringify(pathToFileURL(join(runtime, 'adapters/opencode.js')).href)};\n`);
    const rules = [{ action: '*', resource: '*', effect: 'deny' }, { action: 'channel_*', resource: '*', effect: 'allow' }];
    for (const directory of [source, destination]) for (const action of ['read', 'edit', 'external_directory']) {
      rules.push({ action, resource: directory, effect: 'allow' }, { action, resource: `${directory}/*`, effect: 'allow' });
    }
    for (const action of ['read', 'edit']) for (const resource of ['AGENTS.md', 'work.txt', 'session-record.json', 'preflight.json'])
      rules.push({ action, resource, effect: 'allow' });
    rules.push({ action: 'read', resource: '.', effect: 'allow' });
    const config = { model: 'fixture/test', snapshots: false, permissions: rules,
      plugins: [{ package: pathToFileURL(wrapper).href, options: { url, tokenFile: hostFile, adapterTokenFile: adapterFile,
        credentialDirectory, control: true, tasks: true, worktreeTasks: true } }],
      providers: { fixture: { env: ['TURNLINK_SYNTHETIC_GATEWAY_KEY'], package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${gateway.port}/v1` }, models: { test: {
          capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 64000, output: 2048 } } } } } };
    const env = { PATH: process.env.PATH, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
      XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: root, OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FFF: '1', OPENCODE_FILEWATCHER_DISABLE: '1', TURNLINK_SYNTHETIC_GATEWAY_KEY: gatewayToken };
    const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`; let logs = '', password, currentDirectory = source, destinationProcess = false;
    const api = async (path, body) => {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json',
        'x-opencode-directory': encodeURIComponent(currentDirectory), ...(password ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Synthetic OpenCode API returned ${response.status}`);
      if (response.status === 204) return;
      const value = await response.json(); return value.data ?? value;
    };
    const start = async () => {
      logs = ''; password = undefined;
      child = spawn('/usr/bin/sandbox-exec', ['-f', destinationProcess && crossHost ? destinationProfile : profile, '/opt/homebrew/bin/opencode', 'serve', '--hostname', '127.0.0.1', '--port', String(port), '--print-logs'],
        { cwd: destinationProcess && crossHost ? root : source, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = chunk => { logs = (logs + chunk).slice(-12000); password = logs.match(/server password (\S+)/)?.[1] || password; };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      for (let i = 0; i < 300; i++) { if (child.exitCode !== null || child.signalCode !== null) throw new Error('Sandboxed OpenCode exited');
        try { if (await api('/api/info')) return; } catch { /* Wait for service. */ } await delay(50); }
      throw new Error('Sandboxed OpenCode did not start');
    };
    const wait = async check => { for (let i = 0; i < 200; i++) {
      try { const value = await check(); if (value) return value; }
      catch (error) { if (error.code !== 'BROKER_RATE_LIMITED_BEFORE_DISPATCH') throw error; }
      await delay(300);
    } throw new Error('Synthetic manual flow timed out'); };
    await start();
    const session = await api('/api/session', { location: { directory: source }, title: 'Synthetic manual task', agent: 'build', permissions: rules }), agentId = `opencode:${session.id}`, prefix = `/api/session/${session.id}`;
    assert.equal(session.agent, 'build');
    for (const [action, resource] of [['read', resolve('src/tools.js')], ['read', join(runtime, 'src/tools.js')], ['read', adapterFile],
      ['read', targetHostFile], ['read', targetAdapterFile], ['bash', '*']]) {
      const permission = await api(`${prefix}/permission`, { action, resources: [resource] });
      assert.equal(permission.effect, 'deny', `agent must not access ${action} outside the synthetic project`);
    }
    for (const [action, resource] of [['read', source], ['read', join(source, 'AGENTS.md')], ['edit', join(source, 'session.json')]]) {
      const permission = await api(`${prefix}/permission`, { action, resources: [resource] });
      assert.equal(permission.effect, 'allow', `fixture must allow ${action} in the synthetic project`);
    }
    if (process.env.TURNLINK_LIVE_PREFLIGHT_ONLY === '1') {
      await api(`${prefix}/prompt`, { text: 'Synthetic preflight.' }); await api(`/api/experimental/session/${session.id}/wait`, {});
      const plugin = (await api('/api/plugin')).find(value => JSON.stringify(value).includes('turnlink'));
      assert.ok(toolNames.includes('channel_join'), `plugin load failed: ${JSON.stringify(plugin)}; ${logs.split('\n').filter(line => /error|fail|denied/i.test(line)).map(line => line.replaceAll(token, '[redacted]').replaceAll(adapter, '[redacted]')).join('\n').slice(-3000)}`);
      assert.ok(readdirSync(source).includes('preflight.json'), `synthetic write failed: ${JSON.stringify((await api(`${prefix}/message`)).slice(0, 5))}`);
      const observations = (await api(`${prefix}/message`)).flatMap(message => message.content?.filter(part => part.type === 'tool' && part.name === 'channel_session_context') || []);
      assert.equal(observations[0]?.state?.status, 'completed');
      const observed = JSON.parse(observations[0].state.content[0].text);
      assert.match(observed.permissions, /^native-rules-sha256:[a-f0-9]{64}$/);
      assert.match(observed.runtime, /^opencode 2\./);
      return;
    }
    await api(`${prefix}/prompt`, { text: 'This is a synthetic test. For this step, call channel_join with channel dev, name worker, role test, project name fixture. Follow subsequent Turnlink requests when they arrive.' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    assert.ok(broker.store.agents[agentId], `worker did not join; provider requests=${requestCount}; exposed tools=${JSON.stringify(toolNames)}; plugin=${JSON.stringify((await api('/api/plugin')).filter(value => JSON.stringify(value).includes('turnlink')))}; errors=${logs.split('\n').filter(line => /error|fail|denied/i.test(line)).map(line => line.replaceAll(token, '[redacted]').replaceAll(adapter, '[redacted]')).join('\n').slice(-3000)}`);
    const taskID = (await admin.request('control_command', { command: command('task.create', { title: 'Synthetic task', instructions: 'Respond with the word COMPLETED.', criteria: 'A response of COMPLETED.', requiresWorktree: true }) })).commandID;
    const claim = command('task.claim', { taskID });
    await api(`${prefix}/prompt`, { text: `Call channel_control exactly once with this JSON: ${JSON.stringify({ command: claim })}. Do not use other tools.` });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    await wait(async () => (await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0]?.claimant === agentId);
    const coordinator = new ToolSession(reviewer, { harness: 'codex', sessionId: 'reviewer' }); coordinator.agentId = 'codex:reviewer'; coordinator.channel = 'dev';
    const previewID = (await coordinator.call('channel_manual_preview', { taskID, destination })).commandID;
    await admin.request('control_command', { command: command('worktree.approve', { taskID, previewID }) });
    await coordinator.call('channel_prepare_session', { taskID, previewID, messageId: 'synthetic-manual-prepare' });
    let recordMessage;
    try { recordMessage = await wait(() => broker.store.messages.find(message => {
      if (message.from?.agentId !== agentId || message.to !== 'codex:reviewer') return false;
      try { const record = sessionRecord.parse(JSON.parse(message.text)); return record.taskID === taskID && record.previewID === previewID; } catch { return false; }
    })); } catch {
      const messages = broker.store.messages.map(({ from, to, text }) => ({ from, to, text: text?.slice(0, 1200) }));
      const nativeMessages = await api(`${prefix}/message`).catch(() => []);
      assert.fail(`agent did not send a valid record; provider requests=${requestCount}; messages=${JSON.stringify(messages)}; native=${JSON.stringify(nativeMessages.slice(0, 8)).slice(0, 9000)}; files=${JSON.stringify(readdirSync(source))}; errors=${logs.split('\n').filter(line => /error|fail|denied/i.test(line)).map(line => line.replaceAll(token, '[redacted]').replaceAll(adapter, '[redacted]')).join('\n').slice(-3000)}`);
    }
    await api(`/api/experimental/session/${session.id}/wait`, {});
    await wait(() => broker.store.bindings[agentId]?.manualResume?.status === 'armed');
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const readyToStop = () => {
      const observation = broker.store.bindings[agentId]?.manualResume, id = observation?.recordID;
      const records = broker.store.messages.filter(message => message.from?.agentId === agentId && message.to === 'codex:reviewer' &&
        isSessionRecordMessage(message.text, taskID, previewID));
      const notice = broker.store.messages.find(message => message.messageId === `turnlink-armed-${id}`);
      const outstanding = broker.store.messages.some(message => message.recipients.includes(agentId) &&
        !message.delivered.includes(agentId) && !message.cancelled[agentId] && message.offered?.includes(agentId));
      if (observation?.status !== 'armed' || !records.length || records.at(-1).id !== id || !notice?.delivered.includes(agentId) || outstanding) return false;
      recordMessage = records.at(-1); return true;
    };
    await wait(readyToStop); await api(`/api/experimental/session/${session.id}/wait`, {}); await wait(readyToStop);
    const sourceRecordFile = join(credentialDirectory, 'manual-session-records', digest(agentId), `${taskID}-${previewID}.json`);
    assert.equal(readFileSync(sourceRecordFile, 'utf8'), recordMessage.text, 'the private source record must match the sent record');
    const stopped = once(child, 'close'); child.kill('SIGTERM'); await stopped;
    await wait(() => broker.store.bindings[agentId]?.manualResume?.status === 'detached');
    if (crossHost) {
      try { await admin.request('control_manual_resume_authorize_host', { channel: 'dev', taskID, previewID, targetHostId: 'destination-host', transferID: randomUUID(), sourceStopped: true }); }
      catch (error) { throw new Error(`Host authorization failed: ${error.message}; observation=${JSON.stringify(broker.store.bindings[agentId]?.manualResume)}; outstanding=${JSON.stringify(broker.store.messages.filter(message => message.recipients.includes(agentId) && !message.delivered.includes(agentId) && !message.cancelled[agentId] && message.offered?.includes(agentId)).map(message => message.messageId))}`); }
      const targetState = join(root, 'target-state'); mkdirSync(targetState, { mode: 0o700 });
      for (const [key, name] of [['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data'], ['XDG_CACHE_HOME', 'cache'], ['XDG_STATE_HOME', 'state']]) {
        const target = join(targetState, name); if (existsSync(env[key])) cpSync(env[key], target, { recursive: true, mode: constants.COPYFILE_FICLONE });
        env[key] = target;
      }
      Object.assign(config.plugins[0].options, { tokenFile: targetHostFile, adapterTokenFile: targetAdapterFile, credentialDirectory: join(targetState, 'proofs') });
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config); destinationProcess = true;
    }
    await start();
    await api(`${prefix}/move`, { directory: destination, delivery: 'queue' });
    await api(`/api/experimental/session/${session.id}/wait`, {}); currentDirectory = destination;
    await api(`${prefix}/prompt`, { text: 'For this step, call channel_join with channel dev, name worker, role test, project name fixture. Follow subsequent Turnlink requests when they arrive.' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    if (crossHost) {
      assert.equal(broker.store.bindings[agentId].hostId, 'destination-host');
      assert.equal(broker.store.bindings[agentId].manualResume.hostTransfer.status, 'completed');
    }
    await delay(10000);
    let verify = broker.store.messages.find(message => message.messageId === `turnlink-verify-${recordMessage.id}`);
    if (!verify) {
      const nativeMessages = await api(`${prefix}/message`).catch(() => []);
      let diagnostic;
      try { diagnostic = await reviewer.request('control_manual_resume_status', { agentId: 'codex:reviewer', channel: 'dev', taskID, previewID }); }
      catch (error) { diagnostic = { message: error.message, code: error.code }; }
      assert.fail(`comparison was not requested; diagnostic=${JSON.stringify(diagnostic)}; members=${JSON.stringify(await reviewer.request('members', { agentId: 'codex:reviewer', channel: 'dev' }))}; observation=${JSON.stringify(broker.store.bindings[agentId]?.manualResume)}; watcher=${JSON.stringify(coordinator.sessionWatches?.get(previewID))}; native=${JSON.stringify(nativeMessages.slice(0, 5)).slice(0, 6000)}`);
    }
    let lastStatus;
    const status = await wait(async () => { const value = lastStatus = await coordinator.call('channel_session_status', { taskID, previewID });
      if (['differences', 'invalid_record', 'invalid_report', 'incomplete'].includes(value.status)) throw new Error(`Synthetic comparison returned ${JSON.stringify(value)}`);
      return value.status === 'reported_match' ? value : undefined; }).catch(async error => {
        const messages = broker.store.messages.filter(message => message.from?.agentId === agentId).map(message => message.text);
        const nativeMessages = await api(`${prefix}/message`).catch(() => []);
        const explanations = nativeMessages.slice(0, 8).flatMap(message => message.content?.filter(part => part.type === 'text').map(part => part.text) || []);
        throw new Error(`${error.message}; last status=${JSON.stringify(lastStatus)}; worker messages=${JSON.stringify(messages)}; explanations=${JSON.stringify(explanations)}`);
      });
    assert.equal(status.requestID, verify.id); assert.equal(status.recordID, recordMessage.id);
    const baseline = sessionRecord.parse(JSON.parse(recordMessage.text));
    assert.match(baseline.permissions, /native-rules-sha256:[a-f0-9]{64}/, 'the agent must record the observed native-rule fingerprint');
    const contextCalls = (await api(`${prefix}/message`)).flatMap(message => message.content?.filter(part => part.type === 'tool' &&
      part.name === 'channel_session_context' && part.state?.status === 'completed') || []);
    assert.ok(contextCalls.length >= 2, 'the agent must observe native rules before and after resumption');
    const observations = contextCalls.map(call => JSON.parse(call.state.content[0].text));
    assert.ok(baseline.runtime.includes(observations[0].runtime));
    assert.equal(observations[0].runtime, observations.at(-1).runtime);
    assert.equal(observations[0].permissions, observations.at(-1).permissions);
    assert.ok(baseline.permissions.includes(observations[0].permissions));
    await admin.request('control_manual_resume_confirm', { channel: 'dev', taskID, previewID, recordID: status.recordID,
      requestID: status.requestID, receiptID: randomUUID(), sourceStopped: true });
    const reviewed = await wait(async () => (await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries.find(task => task.status === 'review')).catch(async error => {
      const tasks = await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID });
      const nativeMessages = await api(`${prefix}/message`).catch(() => []);
      throw new Error(`${error.message}; task=${JSON.stringify(tasks.entries)}; logs=${logs.split('\n').filter(line => /Turnlink|error|warn/i.test(line)).map(line => line.replaceAll(token, '[redacted]').replaceAll(adapter, '[redacted]')).join('\n').slice(-5000)}; native=${JSON.stringify(nativeMessages.slice(0, 4)).slice(0, 3000)}`);
    });
    await reviewerCommand('task.review', { taskID, generation: 1, evidenceID: reviewed.result.evidence[0], accept: true });
    assert.equal((await admin.request('control_query', { channel: 'dev', view: 'tasks', entityID: taskID })).entries[0].status, 'completed');
  });
