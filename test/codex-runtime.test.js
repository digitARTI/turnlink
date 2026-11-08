import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCodexRuntime, stageCodexRuntime } from '../deploy/codex-runtime.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'turnlink-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profile = join(root, 'profile'), deployment = join(root, 'deployment');
  mkdirSync(join(deployment, 'bin'), { recursive: true });
  const install = (version, complete = true) => {
    const runtime = join(profile, '.vscode', 'extensions', `openai.chatgpt-${version}-win32-x64`, 'bin', 'windows-x86_64');
    mkdirSync(join(runtime, 'assets'), { recursive: true });
    writeFileSync(join(runtime, 'codex.exe'), `inert executable ${version}`);
    if (complete) writeFileSync(join(runtime, 'codex-code-mode-host.exe'), `inert companion ${version}`);
    writeFileSync(join(runtime, 'assets', 'resource.dat'), `runtime resource ${version}`);
    return join(runtime, 'codex.exe');
  };
  return { profile, deployment, install };
}

test('staged Codex and companions survive extension cleanup, with idempotent prepare', t => {
  const { profile, deployment, install } = fixture(t);
  install('26.9.1');
  const official = install('26.10.2');
  install('26.11.1', false);
  assert.equal(resolveCodexRuntime(profile), official);
  const staged = stageCodexRuntime(deployment, official);
  assert.equal(stageCodexRuntime(deployment, official), staged);
  rmSync(join(profile, '.vscode', 'extensions'), { recursive: true });
  assert.equal(readFileSync(staged, 'utf8'), 'inert executable 26.10.2');
  assert.equal(readFileSync(join(dirname(staged), 'assets', 'resource.dat'), 'utf8'), 'runtime resource 26.10.2');
  assert.equal(readFileSync(join(deployment, 'bin', 'codex-code-mode-host.exe'), 'utf8'),
    readFileSync(join(dirname(staged), 'codex-code-mode-host.exe'), 'utf8'));
});

test('incomplete explicit runtime fails before staging any files', t => {
  const { profile, deployment, install } = fixture(t);
  const official = install('26.10.2', false);
  assert.throws(() => resolveCodexRuntime(profile, official), /codex-code-mode-host/);
  assert.throws(() => stageCodexRuntime(deployment, official), /codex-code-mode-host/);
  assert.equal(existsSync(join(deployment, 'bin', 'codex-code-mode-host.exe')), false);
});

test('mismatched companion and damaged staged runtime are never silently replaced', t => {
  const { deployment, install } = fixture(t);
  const official = install('26.10.2'), staged = stageCodexRuntime(deployment, official);
  const next = install('26.10.3');
  assert.throws(() => stageCodexRuntime(deployment, next), /companion differs/);
  assert.equal(readFileSync(staged, 'utf8'), 'inert executable 26.10.2');
  writeFileSync(join(dirname(staged), 'assets', 'resource.dat'), 'damaged');
  assert.throws(() => stageCodexRuntime(deployment, official), /runtime differs/);
  assert.equal(readFileSync(join(dirname(staged), 'assets', 'resource.dat'), 'utf8'), 'damaged');
});
