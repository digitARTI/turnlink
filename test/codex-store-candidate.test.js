import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCodexStoreCandidate } from '../src/codex-store-candidate.js';

const darwin = process.platform === 'darwin' && typeof process.getuid === 'function' && process.getuid() > 0;
const otherUid = () => process.getuid() === 1 ? 2 : 1;
function fixture(t) {
  const root = realpathSync(mkdtempSync('/private/tmp/turnlink-codex-store-candidate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const codexHome = join(root, 'codex'), sqliteHome = join(root, 'sqlite');
  mkdirSync(codexHome, { mode: 0o700 }); mkdirSync(sqliteHome, { mode: 0o700 });
  return { root, codexHome, sqliteHome, desktopUid: otherUid() };
}

test('candidate metadata requires separate declared identity, private homes and trusted parents', { skip: !darwin }, t => {
  const value = fixture(t);
  assert.doesNotThrow(() => checkCodexStoreCandidate(value));
  assert.throws(() => checkCodexStoreCandidate({ ...value, desktopUid: process.getuid() }), /UNAVAILABLE/);
  assert.throws(() => checkCodexStoreCandidate({ ...value, desktopUid: 0 }), /UNAVAILABLE/);
  assert.throws(() => checkCodexStoreCandidate({ ...value, sqliteHome: 'relative' }), /UNAVAILABLE/);
  chmodSync(value.sqliteHome, 0o750);
  assert.throws(() => checkCodexStoreCandidate(value), /UNAVAILABLE/);
  chmodSync(value.sqliteHome, 0o700);
  chmodSync(value.root, 0o777);
  assert.throws(() => checkCodexStoreCandidate(value), /UNAVAILABLE/);
  chmodSync(value.root, 0o700);
  const link = join(value.root, 'alias'); symlinkSync(value.codexHome, link, 'dir');
  assert.throws(() => checkCodexStoreCandidate({ ...value, codexHome: link }), /UNAVAILABLE/);
});

test('candidate metadata rejects ACLs on the store and any parent', { skip: !darwin }, t => {
  const value = fixture(t);
  for (const path of [value.codexHome, value.root]) {
    const add = spawnSync('/bin/chmod', ['+a', 'everyone allow search', path], { encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    assert.throws(() => checkCodexStoreCandidate(value), /UNAVAILABLE/);
    const remove = spawnSync('/bin/chmod', ['-N', path], { encoding: 'utf8' });
    assert.equal(remove.status, 0, remove.stderr);
  }
});

test('proxy candidate preflight is opt-in and refuses before child launch', { skip: !darwin }, t => {
  const value = fixture(t), marker = join(value.root, 'launched'), executable = join(value.root, 'native');
  writeFileSync(executable, `#!/bin/sh\n[ -z "$AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID" ] || exit 29\nprintf launched > '${marker}'\n`, { mode: 0o700 });
  const env = { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: executable, CODEX_HOME: value.codexHome, CODEX_SQLITE_HOME: value.sqliteHome };
  delete env.AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID;
  const run = options => spawnSync(process.execPath, ['src/codex-proxy.js'], { encoding: 'utf8', timeout: 10000, ...options });
  let result = run({ env: { ...env, AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID: String(process.getuid()) } });
  assert.equal(result.status, 1); assert.match(result.stderr, /candidate metadata unavailable/); assert.equal(existsSync(marker), false);
  result = run({ env: { ...env, AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID: String(value.desktopUid) } });
  assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(marker), true);
  result = run({ env }); assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(marker), true);
});
