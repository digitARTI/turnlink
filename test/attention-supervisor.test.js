import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';

function invoke(t, spec) {
  const root = privateTemp(join(tmpdir(), 'turnlink-supervisor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'service.json'); writeFileSync(file, JSON.stringify(spec), { mode: 0o600 });
  const result = spawnSync(process.execPath, [resolve('deploy/render-attention-supervisor.js'), file], { encoding: 'utf8', timeout: 30000 });
  assert.deepEqual(readdirSync(root), ['service.json'], 'rendering must not install artifacts or create service state');
  return result;
}
const unix = { nodeExecutable: '/opt/Node Tools/node', attentionScript: '/home/operator/turnlink/attention.js', configFile: '/home/operator/private/config.json' };

test('launchd rendering preserves exact arguments and disables automatic startup and restart', t => {
  const spec = { platform: 'darwin', ...unix, attentionScript: '/Users/operator/Project & "Tools"/attention.js' };
  const result = invoke(t, spec); assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Project &amp; &quot;Tools&quot;'));
  if (process.platform === 'darwin') {
    const parsed = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: result.stdout, encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr); const job = JSON.parse(parsed.stdout);
    assert.deepEqual(job.ProgramArguments, [spec.nodeExecutable, spec.attentionScript, 'run', spec.configFile]);
    assert.equal(job.RunAtLoad, false); assert.equal(job.KeepAlive, false); assert.equal(job.Umask, 63);
  }
});
test('systemd rendering prevents dollar percent quote and backslash expansion in exact argv', t => {
  const spec = { platform: 'linux', ...unix, attentionScript: '/home/operator/${USER} %h/"script".js', configFile: '/home/operator/private/config\\file.json' };
  const result = invoke(t, spec); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split('\n').find(line => line.startsWith('ExecStart=')), "ExecStart=\"/opt/Node Tools/node\" \"/home/operator/$${USER} %%h/\\\"script\\\".js\" \"run\" \"/home/operator/private/config\\\\file.json\"");
  assert.ok(result.stdout.includes('UMask=0077')); assert.ok(result.stdout.includes('Restart=no')); assert.ok(!result.stdout.includes('[Install]'));
});
test('systemd executable paths preserve literal dollars and refuse parser-unsupported characters', t => {
  const spec = { platform: 'linux', ...unix, nodeExecutable: '/opt/Node ${USER} %h/node' };
  const result = invoke(t, spec); assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('ExecStart="/opt/Node ${USER} %%h/node" '));
  for (const nodeExecutable of ['/opt/"Node"/node', "/opt/Node's/node", '/opt/Node\\Tools/node', '/opt/node/']) {
    const refused = invoke(t, { ...spec, nodeExecutable });
    assert.notEqual(refused.status, 0); assert.equal(refused.stdout, '');
  }
});
test('Linux native systemd parser accepts literal executable paths and both startup modes', {
  skip: process.platform !== 'linux' || process.env.TURNLINK_SYSTEMD_VERIFY !== '1',
}, t => {
  const root = privateTemp(join(tmpdir(), 'turnlink-systemd-parser-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'Node ${USER} %h Tools'); mkdirSync(bin, { mode: 0o700 });
  const nodeExecutable = join(bin, 'node'); symlinkSync(process.execPath, nodeExecutable);
  for (const startAtLogin of [false, true]) {
    const rendered = invoke(t, { platform: 'linux', ...unix, nodeExecutable, startAtLogin,
      attentionScript: join(root, '${USER} %h "script".js'), configFile: join(root, 'config\\file.json') });
    assert.equal(rendered.status, 0, rendered.stderr);
    const unit = join(root, `turnlink-attention-${startAtLogin}.service`);
    writeFileSync(unit, rendered.stdout, { mode: 0o600 });
    const parsed = spawnSync('systemd-analyze', ['verify', '--man=no', unit], { encoding: 'utf8', timeout: 30000 });
    assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
  }
});
test('Windows task rendering uses an explicit interactive least-privilege principal and is initially disabled', t => {
  const result = invoke(t, { platform: 'win32', userSID: 'S-1-5-21-1-2-3-1001', nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe', attentionScript: 'C:\\Turnlink & tools\\attention.js', configFile: 'C:\\private\\configuration.json' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('<LogonType>InteractiveToken</LogonType>'));
  assert.ok(result.stdout.includes('<RunLevel>LeastPrivilege</RunLevel>'));
  assert.ok(result.stdout.includes('<Enabled>false</Enabled>'));
  assert.ok(result.stdout.includes('Turnlink &amp; tools'));
  assert.ok(result.stdout.includes('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>'));
  if (process.platform === 'win32') {
    const command = `$ErrorActionPreference='Stop'; $service=New-Object -ComObject 'Schedule.Service'; $service.Connect(); $task=$service.NewTask(0); $task.XmlText=[Console]::In.ReadToEnd(); @{enabled=$task.Settings.Enabled;runLevel=$task.Principal.RunLevel;logon=$task.Principal.LogonType;command=$task.Actions.Item(1).Path;arguments=$task.Actions.Item(1).Arguments} | ConvertTo-Json -Compress`;
    const parsed = spawnSync(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { input: result.stdout, encoding: 'utf8', timeout: 30000 });
    assert.equal(parsed.status, 0, parsed.stderr); const task = JSON.parse(parsed.stdout);
    assert.equal(task.enabled, false); assert.equal(task.runLevel, 0); assert.equal(task.logon, 3);
    assert.equal(task.command, 'C:\\Program Files\\nodejs\\node.exe');
    assert.equal(task.arguments, '"C:\\Turnlink & tools\\attention.js" "run" "C:\\private\\configuration.json"');
  }
});
test('supervisor login startup requires an explicit input and never enables automatic process restart', t => {
  const result = invoke(t, { platform: 'darwin', ...unix, startAtLogin: true }); assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('<key>RunAtLoad</key><true/>'));
  assert.ok(result.stdout.includes('<key>KeepAlive</key><false/>'));
  const linux = invoke(t, { platform: 'linux', ...unix, startAtLogin: true }); assert.equal(linux.status, 0, linux.stderr);
  assert.ok(linux.stdout.includes('[Install]\nWantedBy=default.target'));
  const windows = invoke(t, { platform: 'win32', userSID: 'S-1-5-21-1-2-3-1001', nodeExecutable: 'C:\\node.exe', attentionScript: 'C:\\turnlink\\attention.js', configFile: 'C:\\private\\config.json', startAtLogin: true });
  assert.equal(windows.status, 0, windows.stderr); assert.ok(windows.stdout.includes('<LogonTrigger>')); assert.ok(!windows.stdout.includes('<Enabled>false</Enabled>'));
});
test('supervisor inputs refuse relative or control-bearing paths and unexpected secrets without echoing them', t => {
  for (const spec of [{ platform: 'linux', ...unix, configFile: 'relative.json' }, { platform: 'linux', ...unix, nodeExecutable: '/opt/node\nExecStart=/bad' },
    { platform: 'win32', ...unix }, { platform: 'linux', ...unix, credential: 'PRIVATE_SECRET_SENTINEL' }]) {
    const result = invoke(t, spec); assert.notEqual(result.status, 0); assert.ok(!result.stderr.includes('PRIVATE_SECRET_SENTINEL'));
    assert.equal(result.stdout, '');
  }
});
