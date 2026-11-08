import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedDesktopLaunch } from '../src/codex-desktop-launch.js';

test('Desktop launcher sets both native homes and a separate Electron profile before launch', t => {
  const home = mkdtempSync(join(tmpdir(), 'turnlink-desktop-launch-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.codex'));
  const launch = isolatedDesktopLaunch({ home, env: { CODEX_HOME: join(home, '.codex'), CODEX_SQLITE_HOME: join(home, '.codex') }, args: ['--fixture'] });
  assert.equal(launch.executable, '/usr/bin/open');
  assert.deepEqual(launch.args, ['-n', '-W', '--env', `CODEX_HOME=${launch.codexHome}`, '--env', `CODEX_SQLITE_HOME=${launch.codexHome}`,
    '--env', `CODEX_ELECTRON_USER_DATA_PATH=${launch.profile}`, '-a', '/Applications/Codex.app', '--args', `--user-data-dir=${launch.profile}`, '--fixture']);
  assert.throws(() => isolatedDesktopLaunch({ home, env: {}, args: ['--user-data-dir=/tmp/foreign'] }), /INVALID_DESKTOP_LAUNCH/);
  const alias = join(home, 'alias'); symlinkSync(launch.codexHome, alias, 'dir');
  assert.throws(() => isolatedDesktopLaunch({ home, env: { CODEX_SQLITE_HOME: alias } }), /CODEX_STORES_NOT_INDEPENDENT/);
  assert.throws(() => isolatedDesktopLaunch({ home, env: { CODEX_HOME: join(home, 'missing') } }), /ENOENT/);
});

test('macOS application launch receives isolated parent environment',
  { skip: process.platform !== 'darwin' || process.env.TURNLINK_DESKTOP_LAUNCH_INTEGRATION !== '1', timeout: 30000 }, async t => {
    const home = mkdtempSync(join(tmpdir(), 'turnlink-desktop-app-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(join(home, '.codex'));
    const app = join(home, 'Fixture.app'), contents = join(app, 'Contents'), macos = join(contents, 'MacOS');
    mkdirSync(macos, { recursive: true });
    writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>invalid.example.turnlink-fixture</string><key>CFBundleName</key><string>Turnlink fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    writeFileSync(join(macos, 'fixture'), '#!/bin/sh\nprintf "%s\\n%s\\n%s\\n" "$CODEX_HOME" "$CODEX_SQLITE_HOME" "$CODEX_ELECTRON_USER_DATA_PATH" > "$CODEX_ELECTRON_USER_DATA_PATH/receipt"\n', { mode: 0o755 });
    const launch = isolatedDesktopLaunch({ home, env: {}, application: app });
    const child = spawn(launch.executable, launch.args, { stdio: 'ignore' });
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null); assert.equal(code, 0);
    assert.equal(readFileSync(join(launch.profile, 'receipt'), 'utf8'), `${launch.codexHome}\n${launch.codexHome}\n${launch.profile}\n`);
  });
