import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { privateTemp } from '../src/storage.js';
import { startDeepSeekTestGateway } from '../src/opencode-deepseek-gateway.js';
import { sessionRecord } from '../src/session-evidence.js';
import { assertAuthorizedToolCatalogue, filterApprovedToolCatalogue, readApprovedToolCatalogue } from '../src/deepseek-tool-authorization.js';

test('installed OpenCode with a live model saves and compares a synthetic record after session restart and move',
  { skip: process.env.TURNLINK_LIVE_SYNTHETIC_AGENT !== '1' || process.platform !== 'darwin', timeout: 120000 }, async t => {
    const root = realpathSync(privateTemp(join(tmpdir(), 'turnlink-live-record-'))), project = join(root, 'project'), destination = join(root, 'destination');
    mkdirSync(project, { mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
    let child, gateway;
    t.after(async () => { if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'close'); }
      await gateway?.close(); rmSync(root, { recursive: true, force: true }); });
    const profile = join(root, 'sandbox.sb'), token = '5'.repeat(64);
    // The model process has no access to the user's home or repository, and
    // cannot contact the provider directly. Its only network route is the
    // synthetic local gateway, which keeps the real credential in this parent.
    writeFileSync(profile, `(version 1)
(allow default)
(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))
(allow file-read* (subpath "${root}"))
(deny file-write*)
(allow file-write* (subpath "${root}") (literal "/dev/null"))
(deny network-outbound)
(allow network-outbound (remote ip "localhost:*"))
`, { mode: 0o600 });
    const denied = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/bin/cat', join(homedir(), '.local/share/opencode/auth.json')], { stdio: 'ignore' });
    assert.notEqual(denied.status, 0, 'sandbox must deny the child access to the provider credential');
    const deniedRepository = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, '/bin/cat', join(process.cwd(), 'package.json')], { stdio: 'ignore' });
    assert.notEqual(deniedRepository.status, 0, 'sandbox must deny the child access to the project repository');
    gateway = await startDeepSeekTestGateway({ accessToken: token, authFile: join(homedir(), '.local/share/opencode/auth.json'),
      fetchImpl: async (target, options) => {
        const payload = JSON.parse(String(options.body)), file = process.env.TURNLINK_APPROVED_TOOL_CATALOG_FILE;
        if (file || process.env.TURNLINK_APPROVED_TOOL_CATALOG_SHA256) {
          const approved = readApprovedToolCatalogue(file, process.env.TURNLINK_APPROVED_TOOL_CATALOG_SHA256);
          payload.tools = filterApprovedToolCatalogue(payload.tools, approved);
        } else assertAuthorizedToolCatalogue(payload.tools);
        return fetch(target, { ...options, body: JSON.stringify(payload) });
      } });
    const taskID = randomUUID(), previewID = randomUUID();
    const config = { model: 'fixture/test', snapshots: false,
      permissions: [{ action: '*', resource: '*', effect: 'deny' }, { action: 'edit', resource: '*', effect: 'allow' },
        { action: 'read', resource: '*', effect: 'allow' }, { action: 'external_directory', resource: '*', effect: 'allow' }],
      providers: { fixture: { env: ['TURNLINK_SYNTHETIC_GATEWAY_KEY'], package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${gateway.port}/v1` }, models: { test: {
          capabilities: { tools: true, input: ['text'], output: ['text'] }, limit: { context: 32000, output: 256 } } } } } };
    const env = { PATH: process.env.PATH, XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
      XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'), TMPDIR: root,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_FFF: '1',
      OPENCODE_FILEWATCHER_DISABLE: '1', TURNLINK_SYNTHETIC_GATEWAY_KEY: token };
    const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const base = `http://127.0.0.1:${port}`; let logs = '', password, currentDirectory = project;
    const api = async (path, body) => {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(currentDirectory),
          ...(password ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Synthetic OpenCode API returned ${response.status}`);
      if (response.status === 204) return;
      const value = await response.json(); return value.data ?? value;
    };
    const start = async () => {
      logs = ''; password = undefined;
      child = spawn('/usr/bin/sandbox-exec', ['-f', profile, '/opt/homebrew/bin/opencode', 'serve', '--hostname', '127.0.0.1', '--port', String(port), '--print-logs'],
        { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = chunk => { logs = (logs + chunk).slice(-10000); password = logs.match(/server password (\S+)/)?.[1] || password; };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      for (let i = 0; i < 300; i++) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Sandboxed OpenCode service exited before startup');
        try { if (await api('/api/info')) return; } catch { /* Wait for local service. */ }
        await delay(50);
      }
      throw new Error('Sandboxed OpenCode service did not start');
    };
    await start();
    const info = await api('/api/info'); assert.match(info.version, /^2\./);
    t.diagnostic(`Installed OpenCode version: ${info.version}`);
    const session = await api('/api/session', { location: { directory: project }, title: 'Synthetic session record' });
    const prefix = `/api/session/${session.id}`, bound = `opencode:${session.id}`;
    const prompt = `This is a synthetic isolated test. Remember the marker SYNTHETIC_CONTEXT_MARKER. Use the file-writing tool to create session.json in the current directory. ` +
      `Write a JSON object with exactly these keys and values: type="turnlink.session_record.v2", taskID="${taskID}", previewID="${previewID}", ` +
      `session="${bound}", source="/synthetic/source", destination="/synthetic/destination", runtime="opencode 2.2.5", model="fixture", provider="fixture", ` +
      'permissions="synthetic", work="synthetic saved work". Do not use the shell or access other files. Then respond DONE.';
    await api(`${prefix}/prompt`, { text: prompt }); await api(`/api/experimental/session/${session.id}/wait`, {});
    const record = sessionRecord.parse(JSON.parse(readFileSync(join(project, 'session.json'), 'utf8')));
    assert.equal(record.taskID, taskID); assert.equal(record.previewID, previewID); assert.equal(record.session, bound);
    assert.equal(record.work, 'synthetic saved work');
    const exited = once(child, 'close'); child.kill('SIGTERM'); await exited;
    await start();
    const reopened = await api(prefix); assert.equal(reopened.id, session.id);
    await api(`${prefix}/move`, { directory: destination, delivery: 'queue' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    currentDirectory = destination;
    const moved = await api(prefix); assert.equal(moved.id, session.id); assert.equal(moved.location.directory, destination);
    await api(`${prefix}/prompt`, { text: 'Read ../project/session.json. Write report.json in the current directory as JSON with exactly two keys: work, copied from the record, and remembered, set to the marker I asked you to remember earlier in this conversation. Do not use the shell.' });
    await api(`/api/experimental/session/${session.id}/wait`, {});
    const report = JSON.parse(readFileSync(join(destination, 'report.json'), 'utf8'));
    assert.equal(report.work, record.work); assert.equal(report.remembered, 'SYNTHETIC_CONTEXT_MARKER');
  });
