#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyDesktopSession } from './verify-codex-desktop-session.js';
import { assertIndependentCodexStores } from '../src/codex-desktop-isolation.js';

const expectedRuntimeHash = 'c2663b1f51185720f97842e5a966c35b4ce23c7aeaa8654c13e0b6cf2230b878';
const resources = process.env.TURNLINK_CODEX_DESKTOP_RESOURCES ?? '/Applications/Codex.app/Contents/Resources';
const installed = join(resources, 'codex');
const preserved = join(resources, 'codex.turnlink-unisolated-0.135.0-alpha.1');
const sourceWrapper = join(dirname(fileURLToPath(import.meta.url)), 'codex-desktop-isolated-wrapper.sh');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

assert.equal(digest(installed), digest(sourceWrapper), 'installed Desktop launch path is not the reviewed isolation wrapper');
assert.equal(digest(preserved), expectedRuntimeHash, 'preserved incompatible runtime changed');
assert.ok(statSync(installed).mode & 0o100, 'isolation wrapper is not executable');
assert.ok(statSync(preserved).mode & 0o100, 'preserved runtime is not executable by the wrapper');
// This is a current path observation, not a lock held over future movement.
const actualDesktopHome = join(process.env.HOME, 'Library', 'Application Support', 'Turnlink', 'CodexDesktopHome');
assertIndependentCodexStores(actualDesktopHome, join(process.env.HOME, '.codex'));
if (process.env.CODEX_HOME) assertIndependentCodexStores(actualDesktopHome, process.env.CODEX_HOME);
if (process.env.CODEX_SQLITE_HOME) assertIndependentCodexStores(actualDesktopHome, process.env.CODEX_SQLITE_HOME);

const root = mkdtempSync(join(tmpdir(), 'turnlink-codex-desktop-isolation-'));
try {
  const home = join(root, 'home');
  const sharedTrap = join(home, '.codex');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const fixture = join(root, 'fixture');
  mkdirSync(fixture);
  copyFileSync(sourceWrapper, join(fixture, 'codex'));
  writeFileSync(join(fixture, 'codex.turnlink-unisolated-0.135.0-alpha.1'), '#!/bin/sh\nprintf "%s\\n%s\\n" "$CODEX_HOME" "$CODEX_SQLITE_HOME"\n', { mode: 0o755 });
  const fixtureResult = spawnSync(join(fixture, 'codex'), [], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, HOME: home, CODEX_HOME: sharedTrap, CODEX_SQLITE_HOME: sharedTrap },
  });
  const isolated = join(home, 'Library', 'Application Support', 'Turnlink', 'CodexDesktopHome');
  assert.equal(fixtureResult.status, 0, fixtureResult.stderr);
  assert.equal(fixtureResult.stdout, `${isolated}\n${isolated}\n`, 'wrapper failed to override both home variables');
  const result = spawnSync(installed, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, HOME: home, CODEX_HOME: sharedTrap, CODEX_SQLITE_HOME: sharedTrap },
  });
  assert.equal(result.status, 0, result.stderr || 'isolated Desktop runtime failed');
  assert.match(result.stdout, /^codex-cli 0\.135\.0-alpha\.1\s*$/);
  assert.equal(existsSync(sharedTrap), false, 'Desktop touched the inherited shared Codex home');
  assert.equal(existsSync(isolated), true, 'Desktop isolation home was not created');
  const session = await verifyDesktopSession({ executable: installed, home, isolated, sharedTrap, cwd: root, tmp: root });
  console.log(JSON.stringify({ runtimeSessionIsolation: true, actualStorePathsIndependentAtCheck: true, fullDesktopIsolation: false,
    version: result.stdout.trim(), wrapperSha256: digest(installed), preservedSha256: digest(preserved), session }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
