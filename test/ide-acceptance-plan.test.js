import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../deploy/ide-acceptance-plan.js');
const mac = {
  platform: 'darwin', root: '/tmp/turnlink-ide-fixture',
  editor: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  extension: '/installed/openai.chatgpt', native: '/installed/bin/codex',
  proxy: '/repo/src/codex-proxy.js',
};

test('IDE plan isolates editor state and never reuses a real profile or inherits account variables', async () => {
  const { planIDEAcceptance } = await load();
  const inherited = { PATH: '/fixture/bin:/usr/bin', HOME: '/real/home', CODEX_HOME: '/real/codex',
    OPENAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', CODEX_SQLITE_HOME: '/real/db',
    VSCODE_PORTABLE: '/real/portable', VSCODE_IPC_HOOK_CLI: '/real/ipc',
    NODE_OPTIONS: '--require=/real/injection.js', HTTPS_PROXY: 'https://real-proxy', SSH_AUTH_SOCK: '/real/agent' };
  const before = structuredClone(inherited);
  const plan = planIDEAcceptance(mac, inherited);
  assert.deepEqual(inherited, before);
  assert.deepEqual(plan.argv, ['--new-window', '--user-data-dir', '/tmp/turnlink-ide-fixture/editor',
    '--extensions-dir', '/tmp/turnlink-ide-fixture/extensions', '--sync', 'off',
    '--skip-add-to-recently-opened', '/tmp/turnlink-ide-fixture/project']);
  assert.equal(plan.environment.HOME, '/tmp/turnlink-ide-fixture/home');
  assert.equal(plan.environment.CODEX_HOME, '/tmp/turnlink-ide-fixture/codex');
  assert.equal(plan.environment.CODEX_SQLITE_HOME, '/tmp/turnlink-ide-fixture/sqlite');
  assert.equal(plan.environment.AGENT_CHANNEL_CODEX_EXECUTABLE, mac.native);
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'VSCODE_PORTABLE', 'VSCODE_IPC_HOOK_CLI', 'NODE_OPTIONS', 'HTTPS_PROXY', 'SSH_AUTH_SOCK'])
    assert.equal(plan.environment[key], undefined);
  assert.equal(plan.settings['chatgpt.cliExecutable'], mac.proxy);
  assert.equal(plan.settings['telemetry.telemetryLevel'], 'off');
  assert.equal(plan.settings['extensions.autoUpdate'], false);
  assert.equal(plan.launchAuthorized, false);
  assert.equal(plan.networkIsolation, false);
});

test('Windows IDE plan uses native executable and private AppData without a shell command string', async () => {
  const { planIDEAcceptance } = await load();
  const plan = planIDEAcceptance({ platform: 'win32', root: 'C:\\Temp\\turnlink fixture',
    editor: 'C:\\Program Files\\Microsoft VS Code\\Code.exe', extension: 'C:\\installed\\extension',
    native: 'C:\\installed\\codex.exe', proxy: 'C:\\fixture\\turnlink-codex.exe' },
  { PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe', USERPROFILE: 'C:\\real', APPDATA: 'C:\\real\\app' });
  assert.equal(plan.environment.USERPROFILE, 'C:\\Temp\\turnlink fixture\\home');
  assert.equal(plan.environment.APPDATA, 'C:\\Temp\\turnlink fixture\\home\\AppData\\Roaming');
  assert.equal(plan.environment.TEMP, 'C:\\Temp\\turnlink fixture\\temp');
  assert.equal(plan.environment.SystemRoot, 'C:\\Windows');
  assert.equal(plan.shell, false);
  assert.equal(plan.settings['chatgpt.runCodexInWindowsSubsystemForLinux'], false);
  assert.ok(plan.argv.includes('C:\\Temp\\turnlink fixture\\project'));
});

test('IDE plan refuses relative, overlapping state/artifact paths and unsupported inputs', async () => {
  const { planIDEAcceptance } = await load();
  for (const bad of [
    { root: 'relative' }, { root: '/' }, { platform: 'linux' },
    { native: '/tmp/turnlink-ide-fixture/native' },
    { root: '/installed' }, { extension: '/tmp/turnlink-ide-fixture-old/../turnlink-ide-fixture/ext' },
    { launch: true }, { proxy: '/path/with\nnewline' },
  ]) assert.throws(() => planIDEAcceptance({ ...mac, ...bad }, {}));
  assert.throws(() => planIDEAcceptance({ ...mac, platform: 'win32', root: 'C:\\Temp\\fixture',
    editor: 'C:\\Code.exe', extension: 'C:\\ext', native: 'C:\\codex.exe', proxy: 'C:\\proxy.js' }, {}), /native.*exe/i);
});

test('IDE plan requires fixture-only preparation and an explicit UI evidence checklist', async () => {
  const { planIDEAcceptance } = await load();
  const plan = planIDEAcceptance(mac, {});
  assert.equal(plan.extensionSource, mac.extension);
  assert.ok(plan.prerequisites.some(step => step.includes('auth.json')));
  assert.ok(plan.prerequisites.some(step => step.includes('loopback')));
  for (const phase of ['baseline', 'role', 'task', 'alert', 'approvals', 'reconnect']) assert.ok(plan.evidence.includes(phase));
  assert.equal(plan.movementEnabled, false);
});
