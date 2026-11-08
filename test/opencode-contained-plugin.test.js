import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createBroker } from '../src/broker.js';
import { OpenCodeContainedOwner } from '../src/opencode-contained-owner.js';
import { containedOpenCodeOwnerLauncher } from '../src/opencode-container-native-recovery.js';
import { verifyContainedNativeOwner } from '../src/opencode-completion-owner.js';

const execFile = promisify(execFileCallback);

test('contained native plugin joins the real broker through the private networkless tunnel',
  { skip: process.env.OPENCODE_DOCKER_PLUGIN_TEST !== '1', timeout: 120000 }, async t => {
    const root = mkdtempSync('/private/tmp/turnlink-contained-plugin-');
    mkdirSync(join(root, 'journal'), { mode: 0o700 });
    const token = '1'.repeat(64);
    const broker = createBroker({ directory: join(root, 'broker'), port: 0, secret: token, adminSecret: '2'.repeat(64) }); await once(broker.server, 'listening');
    let modelRequests = 0, toolNames = [], toolMessages = [];
    const model = createHttpServer(async (req, res) => {
      modelRequests++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)), last = body.messages.at(-1);
      toolNames = body.tools?.map(value => value.function?.name) || [];
      toolMessages = body.messages.filter(value => value.role === 'tool').map(value => String(value.content).slice(0, 300));
      const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
      const join = last.role === 'user' && text.includes('TURNLINK_JOIN');
      const delta = join ? { tool_calls: [{ index: 0, id: 'fixture_join', type: 'function', function: { name: 'channel_join',
        arguments: JSON.stringify({ channel: 'development', name: 'container-fixture', role: 'test', project: { name: 'fixture' } }) } }] } : { content: 'done' };
      const part = (value, finish_reason) => ({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason }] });
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(part({ role: 'assistant', ...delta }, null))}\n\n`);
      res.write(`data: ${JSON.stringify(part({}, join ? 'tool_calls' : 'stop'))}\n\n`); res.end('data: [DONE]\n\n');
    });
    model.listen(0, '127.0.0.1'); await once(model, 'listening');
    const gateway = createTcpServer(socket => {
      socket.once('data', first => {
        const targetPort = first.toString('utf8', 0, Math.min(first.length, 256)).startsWith('GET /broker ') ? broker.server.address().port : model.address().port;
        const target = createConnection({ host: '127.0.0.1', port: targetPort });
        target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy());
        target.once('connect', () => { target.write(first); socket.pipe(target); target.pipe(socket); });
      });
    });
    gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
    const image = process.env.OPENCODE_DOCKER_OWNER_IMAGE || 'sha256:9f540f385b36f30d4084c73a4741d1122bd290abb97e95cfc6b92062d56aa136';
    const mounts = [];
    const owner = new OpenCodeContainedOwner({ directory: join(root, 'journal'), docker: '/opt/homebrew/bin/docker',
      spec: { resourceID: randomUUID(), image, command: ['/assets/bridge.cjs'], mounts, volume: { destination: '/var/lib/turnlink', mode: 'rw' },
        tmpfs: ['/tmp', '/run/turnlink-secrets'] } });
    let instance, containerID, volumeName;
    t.after(async () => {
      if (instance) { try { await instance.close(); } catch {} }
      if (!containerID) try { containerID = (await owner.observe()).containerID; } catch {}
      if (containerID && process.env.OPENCODE_KEEP_FIXTURE !== '1') { const rm = spawn('/opt/homebrew/bin/docker', ['rm', '--force', containerID], { stdio: 'ignore' }); await once(rm, 'close'); }
      if (volumeName && process.env.OPENCODE_KEEP_FIXTURE !== '1') { const rm = spawn('/opt/homebrew/bin/docker', ['volume', 'rm', volumeName], { stdio: 'ignore' }); await once(rm, 'close'); }
      owner.close(); gateway.closeAllConnections?.(); model.closeAllConnections(); await new Promise(resolve => gateway.close(resolve));
      await new Promise(resolve => model.close(resolve)); await broker.close(); if (process.env.OPENCODE_KEEP_FIXTURE !== '1') rmSync(root, { recursive: true, force: true });
    });
    const muxPort = 31679;
    const config = { model: 'fixture/test', snapshots: false, permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      plugins: [{ package: 'file:///assets/bundle/turnlink-plugin', options: { url: `ws://127.0.0.1:${muxPort}/broker`, tokenFile: '/run/turnlink-secrets/host.token', credentialDirectory: '/var/lib/turnlink/proofs' } }],
      providers: { fixture: { env: ['TURNLINK_FIXTURE_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${muxPort}/v1` },
        models: { test: { capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 2048 } } } } } };
    const prepareVolume = async identity => {
      volumeName = identity.volume.name;
      const init = spawn('/opt/homebrew/bin/docker', ['run', '--rm', '--network=none', '--read-only', '--user=0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
        '--security-opt=no-new-privileges', '--mount', `type=volume,src=${volumeName},dst=/owned,volume-nocopy`, '--entrypoint', '/bin/sh', image,
        '-c', 'mkdir -p /owned/workspace /owned/proofs && chmod 700 /owned/proofs && chown -R 10001:10001 /owned'], { stdio: 'ignore' });
      const [code] = await once(init, 'close'); if (code !== 0) throw new Error('Fixture volume preparation failed');
    };
    const launcherOptions = { owner,
      docker: '/opt/homebrew/bin/docker', http: true, brokerPort: gateway.address().port, containerBrokerPort: muxPort, assetPrefix: '/assets',
      secretFiles: { 'host.token': token }, configContent: JSON.stringify(config) };
    const launchInput = { runtime: '/usr/local/bin/turnlink-bun', entrypoint: '/assets/bundle/native-recovery-host.js', database: '/var/lib/turnlink/opencode.sqlite',
      sessionID: 'ses_fixture', pluginID: 'turnlink', source: { directory: '/var/lib/turnlink/workspace' }, env: { TURNLINK_FIXTURE_KEY: 'fixture-only' },
      timeoutMs: 15000, serveCandidate: true };
    instance = await containedOpenCodeOwnerLauncher({ ...launcherOptions, prepareVolume })(launchInput);
    containerID = instance.containerID;
    const verified = await verifyContainedNativeOwner(owner, '/var/lib/turnlink/opencode.sqlite', instance);
    assert.equal(verified.containerID, containerID);
    await assert.rejects(verifyContainedNativeOwner(owner, '/var/lib/turnlink/opencode.sqlite', { ...instance, operationID: randomUUID() }));
    await assert.rejects(verifyContainedNativeOwner(owner, '/var/lib/turnlink/opencode.sqlite', { ...instance, containerID: '0'.repeat(64) }));
    await assert.rejects(verifyContainedNativeOwner(owner, '/var/lib/turnlink/opencode.sqlite', { ...instance, daemonID: 'other-daemon' }));
    const inspect = await execFile('/opt/homebrew/bin/docker', ['inspect', '--format', '{{json .Config.Env}} {{json .Config.Cmd}} {{json .HostConfig.Tmpfs}}', containerID]);
    assert.ok(!inspect.stdout.includes(token), 'secret must not be in container configuration');
    assert.match(inspect.stdout, /\/run\/turnlink-secrets/);
    const secretCheck = await execFile('/opt/homebrew/bin/docker', ['exec', containerID, '/usr/local/bin/turnlink-node', '-e',
      "const fs=require('fs'); const p='/run/turnlink-secrets/host.token'; process.stdout.write(String((fs.statSync(p).mode & 0o777) === 0o600 && fs.readFileSync(p,'utf8') === '1'.repeat(64)))"]);
    assert.equal(secretCheck.stdout, 'true');
    const diff = await execFile('/opt/homebrew/bin/docker', ['diff', containerID]);
    assert.ok(!diff.stdout.split('\n').some(line => line.trimEnd().endsWith('/run/turnlink-secrets/host.token')),
      'secret file must not be in the writable container layer');
    const api = async (path, body) => {
      const response = await fetch(`${instance.endpoint.url}${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent('/var/lib/turnlink/workspace'),
          authorization: `Basic ${Buffer.from(`opencode:${instance.endpoint.password}`).toString('base64')}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Contained API ${path}: ${response.status}`); if (response.status === 204) return undefined;
      const value = await response.json(); return value.data ?? value;
    };
    const session = await api('/api/session', { location: { directory: '/var/lib/turnlink/workspace' }, title: 'container fixture', agent: 'plan' });
    await api(`/api/session/${session.id}/prompt`, { text: 'TURNLINK_JOIN' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    for (let i = 0; i < 100 && !broker.store.agents[`opencode:${session.id}`]; i++) await delay(100);
    assert.equal(broker.store.agents[`opencode:${session.id}`]?.name, 'container-fixture',
      `requests=${modelRequests}; tools=${JSON.stringify(toolNames)}; results=${JSON.stringify(toolMessages)}; configured=${JSON.stringify((await api('/api/config')).plugins?.map(value => value.package))}; plugins=${JSON.stringify((await api('/api/plugin')).filter(value => JSON.stringify(value).includes('turnlink')))}`);
    await instance.close();
    await assert.rejects(verifyContainedNativeOwner(owner, '/var/lib/turnlink/opencode.sqlite', instance));
    const retired = await owner.retireVolumeOwner(), successor = await owner.createVolumeSuccessor();
    assert.equal(successor.prior.containerID, retired.containerID); containerID = successor.containerID;
    instance = await containedOpenCodeOwnerLauncher({ ...launcherOptions, reuseCreated: true })(launchInput);
    assert.equal((await verifyContainedNativeOwner(owner, '/var/lib/turnlink/opencode.sqlite', instance)).volume.name, volumeName);
    assert.equal((await api(`/api/session/${session.id}`)).id, session.id);
  });
