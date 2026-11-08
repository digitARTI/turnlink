import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { privateTemp } from '../src/storage.js';

const windows = process.platform === 'win32';
const script = process.env.TURNLINK_WINDOWS_ATTENTION_HELPER || resolve('deploy/setup-windows-attention.ps1');
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const run = args => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', script, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
function fixture(t) {
  const root = privateTemp(join(tmpdir(), 'turnlink-shortcut-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, 'private configuration.json'); writeFileSync(config, '{}', { mode: 0o600 });
  const shortcut = join(root, 'Turnlink fixture.lnk');
  return { root, shortcut, args: ['-NodeExecutable', process.execPath, '-AttentionScript', resolve('src/operator-attention.js'), '-ConfigPath', config] };
}
test('Windows notification shortcut planning is read-only and targets only private status inspection', { skip: !windows }, t => {
  const f = fixture(t), result = run(['-Operation', 'Plan', ...f.args, '-ShortcutPath', f.shortcut]);
  assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(result.stdout);
  assert.equal(plan.appUserModelID, 'Turnlink'); assert.equal(plan.created, false); assert.equal(plan.startMenuInstalled, false);
  assert.ok(plan.arguments.includes(' status ')); assert.equal(existsSync(f.shortcut), false);
});
test('isolated Windows shortcut sets and reads the actual AppUserModelID and refuses replacement', { skip: !windows }, t => {
  const f = fixture(t), args = [...f.args, '-ShortcutPath', f.shortcut];
  const created = run(['-Operation', 'Stage', ...args]); assert.equal(created.status, 0, created.stderr);
  const staged = JSON.parse(created.stdout); assert.equal(staged.created, true); assert.equal(staged.startMenuInstalled, false);
  assert.equal(staged.appUserModelID, 'Turnlink'); assert.equal(staged.target, process.execPath);
  const before = statSync(f.shortcut).mtimeMs;
  const repeated = run(['-Operation', 'Stage', ...args]); assert.equal(repeated.status, 0, repeated.stderr); assert.equal(JSON.parse(repeated.stdout).created, false);
  assert.equal(statSync(f.shortcut).mtimeMs, before);
  const inspected = run(['-Operation', 'Inspect', ...args]); assert.equal(inspected.status, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).appUserModelID, 'Turnlink');
  const otherConfig = join(f.root, 'different.json'); writeFileSync(otherConfig, '{}');
  const mismatch = run(['-Operation', 'Stage', '-NodeExecutable', process.execPath, '-AttentionScript', resolve('src/operator-attention.js'), '-ConfigPath', otherConfig, '-ShortcutPath', f.shortcut]);
  assert.notEqual(mismatch.status, 0); assert.equal(statSync(f.shortcut).mtimeMs, before);
});
test('Windows fixture staging cannot write into the real Start menu', { skip: !windows }, t => {
  const f = fixture(t), shortcut = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Turnlink fixture forbidden.lnk');
  const before = existsSync(shortcut);
  const result = run(['-Operation', 'Stage', ...f.args, '-ShortcutPath', shortcut]);
  assert.notEqual(result.status, 0); assert.equal(existsSync(shortcut), before);
});
