import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { isolatedDesktopLaunch } from '../src/codex-desktop-launch.js';

test('sandboxed Desktop parent uses isolated Electron and Codex homes',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_DESKTOP_REAL_APP_INTEGRATION !== '1', timeout: 45000 }, async t => {
    const root = realpathSync(mkdtempSync('/private/tmp/turnlink-desktop-real-'));
    const home = join(root, 'home'), trap = join(home, '.codex');
    mkdirSync(trap, { recursive: true, mode: 0o700 });
    writeFileSync(join(trap, 'sentinel'), 'untouched\n');
    const launch = isolatedDesktopLaunch({ home, env: {} });
    const systemTmp = realpathSync(tmpdir());
    // Chromium's singleton uses a local Unix socket; deny IP sockets without
    // disabling the local socket needed to start the disposable app.
    const profile = `(version 1)(allow default)(deny network-outbound (remote ip))(deny network-inbound (local ip))(deny mach-lookup (global-name "com.apple.securityd"))(deny file-read* (subpath ${JSON.stringify(process.env.HOME)}))(deny file-write* (require-all (require-not (subpath ${JSON.stringify(root)})) (require-not (subpath ${JSON.stringify(systemTmp)}))))`;
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/Applications/Codex.app/Contents/MacOS/Codex', `--user-data-dir=${launch.profile}`], {
      cwd: root, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: {
        PATH: process.env.PATH, HOME: home, TMPDIR: root, CODEX_HOME: launch.codexHome, CODEX_SQLITE_HOME: launch.codexHome,
        CODEX_ELECTRON_USER_DATA_PATH: launch.profile, NO_PROXY: '*', no_proxy: '*',
      },
    });
    let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4000); });
    const closed = once(child, 'close');
    t.after(async () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
      await closed; rmSync(root, { recursive: true, force: true });
    });
    const hasApplicationDatabase = () => ['codex.db', 'codex-dev.db'].some(name => existsSync(join(launch.codexHome, 'sqlite', name)));
    for (let i = 0; i < 200 && child.exitCode === null; i++) {
      if (readdirSync(launch.profile).length > 0 && hasApplicationDatabase()) break;
      await delay(100);
    }
    await delay(1000);
    assert.equal(child.exitCode, null, `Desktop exited before isolation evidence (${diagnostic.slice(-400)})`);
    assert.ok(readdirSync(launch.profile).length, 'Desktop did not initialize its isolated Electron profile');
    assert.ok(hasApplicationDatabase(), 'Desktop did not create its application database in the isolated home');
    assert.deepEqual(readdirSync(trap), ['sentinel']);
    assert.equal(readFileSync(join(trap, 'sentinel'), 'utf8'), 'untouched\n');
  });

test('sandboxed Desktop application completes an isolated local-model session',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_DESKTOP_REAL_TURN_INTEGRATION !== '1', timeout: 120000 }, async t => {
    const { chromium } = await import('../dashboard/node_modules/playwright/index.mjs');
    const root = realpathSync(mkdtempSync('/private/tmp/turnlink-desktop-turn-'));
    const home = join(root, 'home'), trap = join(home, '.codex');
    mkdirSync(trap, { recursive: true, mode: 0o700 });
    writeFileSync(join(trap, 'sentinel'), 'untouched\n');
    writeFileSync(join(trap, 'AGENTS.md'), 'SHARED_HOME_INSTRUCTION_TRAP_MUST_NOT_REACH_MODEL\n');
    const launch = isolatedDesktopLaunch({ home, env: {} });
    let requests = 0, leakedInstruction = false;
    const model = createServer((request, response) => {
      if (request.method !== 'POST' || !request.url.startsWith('/v1/responses')) { response.writeHead(404); response.end(); return; }
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        requests++;
        leakedInstruction ||= Buffer.concat(chunks).includes('SHARED_HOME_INSTRUCTION_TRAP_MUST_NOT_REACH_MODEL');
        const id = randomUUID(), item = { id: `msg_${id}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: 'Isolated fixture response.', annotations: [] }] };
        const result = { id: `resp_${id}`, object: 'response', created_at: 1, status: 'completed', model: 'fixture', output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        event('response.created', { response: { ...result, status: 'in_progress', output: [] } });
        event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
        event('response.output_text.delta', { output_index: 0, content_index: 0, item_id: item.id, delta: 'Isolated fixture response.' });
        event('response.output_item.done', { output_index: 0, item }); event('response.completed', { response: result }); response.end();
      });
    });
    model.listen(0, '127.0.0.1'); await once(model, 'listening');
    writeFileSync(join(launch.codexHome, 'config.toml'), `model = "fixture"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nenv_key = "TURNLINK_FIXTURE_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
    const systemTmp = realpathSync(tmpdir());
    // The outer sandbox allows the local mock and debug connection only; the
    // renderer inherits it. Chromium's nested sandbox cannot start inside it.
    const profile = `(version 1)(allow default)(deny network-outbound (remote ip))(allow network-outbound (remote ip "localhost:*"))(deny network-inbound (local ip))(allow network-inbound (local ip "localhost:*"))(deny mach-lookup (global-name "com.apple.securityd"))(deny file-read* (subpath ${JSON.stringify(process.env.HOME)}))(deny file-write* (require-all (require-not (subpath ${JSON.stringify(root)})) (require-not (subpath ${JSON.stringify(systemTmp)}))))`;
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/Applications/Codex.app/Contents/MacOS/Codex',
      `--user-data-dir=${launch.profile}`, '--remote-debugging-port=0', '--no-sandbox'], {
      cwd: root, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: {
        PATH: process.env.PATH, HOME: home, TMPDIR: root, CODEX_HOME: launch.codexHome, CODEX_SQLITE_HOME: launch.codexHome,
        CODEX_ELECTRON_USER_DATA_PATH: launch.profile, TURNLINK_FIXTURE_KEY: 'local-fixture-only', NO_PROXY: '*', no_proxy: '*',
      },
    });
    let diagnostic = ''; child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4000); });
    const closed = once(child, 'exit'); let browser;
    t.after(async () => {
      await browser?.close().catch(() => {});
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
      await closed.catch(() => {});
      await new Promise(resolve => model.close(resolve));
      rmSync(root, { recursive: true, force: true });
    });
    const portFile = join(launch.profile, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !existsSync(portFile) && child.exitCode === null; i++) await delay(100);
    assert.ok(existsSync(portFile), `Desktop debugging endpoint unavailable (${diagnostic.slice(-500)})`);
    const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    for (let i = 0; i < 100 && !browser.contexts().some(context => context.pages().length); i++) await delay(100);
    const page = browser.contexts().flatMap(context => context.pages())[0];
    assert.ok(page, 'Desktop did not open an application window');
    await page.getByRole('button', { name: 'Skip', exact: true }).click({ timeout: 30000 });
    const currentModel = page.getByRole('button', { name: 'Continue with current model' });
    if (await currentModel.isVisible({ timeout: 10000 })) await currentModel.click();
    const disable = page.getByRole('button', { name: 'Disable', exact: true });
    if (await disable.isVisible()) await disable.click();
    const composer = page.locator('[data-codex-composer="true"]');
    await composer.fill('Reply with the fixture response.'); await composer.press('Enter');
    await page.getByText('Isolated fixture response.', { exact: true }).waitFor({ timeout: 30000 });
    assert.ok(requests > 0, 'Desktop did not call the fixture model');
    assert.equal(leakedInstruction, false, 'shared-home instruction reached the model');
    let files, rolloutMatches = false;
    for (let attempt = 0; attempt < 50 && !rolloutMatches; attempt++) {
      files = readdirSync(launch.codexHome, { recursive: true }).map(String);
      rolloutMatches = files.filter(name => name.endsWith('.jsonl')).some(name => {
        const content = readFileSync(join(launch.codexHome, name), 'utf8');
        return content.includes('Reply with the fixture response.') && content.includes('Isolated fixture response.');
      });
      if (!rolloutMatches) await delay(100);
    }
    assert.ok(files.some(name => /(?:^|\/)state_\d+\.sqlite$/.test(name)), 'native session SQLite is absent from isolated home');
    assert.ok(rolloutMatches, 'the fixture conversation is absent from isolated native session rollouts');
    assert.ok(['codex.db', 'codex-dev.db'].some(name => existsSync(join(launch.codexHome, 'sqlite', name))), 'Desktop application SQLite is absent');
    assert.deepEqual(readdirSync(trap).sort(), ['AGENTS.md', 'sentinel']);
    assert.equal(readFileSync(join(trap, 'sentinel'), 'utf8'), 'untouched\n');
    assert.equal(readFileSync(join(trap, 'AGENTS.md'), 'utf8'), 'SHARED_HOME_INSTRUCTION_TRAP_MUST_NOT_REACH_MODEL\n');
  });
