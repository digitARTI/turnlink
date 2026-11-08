import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { privateTemp } from '../src/storage.js';
import { createCodexEffectArbiter, inspectCodexEffectArbiter } from '../src/codex-effect-arbiter.js';

const effect = () => ({ effectID: randomUUID(), grantDigest: 'a'.repeat(64), executable: process.execPath,
  args: ['-e', 'setTimeout(() => {}, 200)'] });

test('one owner orders revocation and child dispatch without replay', async t => {
  const root = privateTemp('/private/tmp/turnlink-arbiter-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = createCodexEffectArbiter({ directory: join(root, 'revoked'), effect: effect(), guard: () => true });
  assert.equal(a.revoke().revoked, true); assert.throws(() => a.dispatch(), /CODEX_EFFECT_ARBITER_UNAVAILABLE/);
  assert.deepEqual({ phase: a.snapshot().phase, revoked: a.snapshot().revoked }, { phase: 'prepared', revoked: true }); a.close();
  const marker = join(root, 'post-revoke'), plan = { ...effect(), args: ['-e',
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done'), 200)`] };
  const b = createCodexEffectArbiter({ directory: join(root, 'dispatched'), effect: plan, guard: () => true });
  assert.throws(() => createCodexEffectArbiter({ directory: join(root, 'dispatched'), effect: plan, guard: () => true }));
  assert.deepEqual(b.prepare(), { prepared: true });
  const child = b.dispatch(); assert.equal(b.revoke().revoked, true);
  assert.throws(() => b.dispatch(), /CODEX_EFFECT_ARBITER_UNAVAILABLE/);
  assert.deepEqual({ phase: b.snapshot().phase, revoked: b.snapshot().revoked }, { phase: 'dispatched', revoked: true });
  await once(child, 'exit'); assert.equal(existsSync(marker), true, 'a dispatched process can still act after revocation'); b.close();
  assert.throws(() => createCodexEffectArbiter({ directory: join(root, 'dispatched'), effect: plan, guard: () => true }));
});

test('process death leaves durable uncertain dispatch and refuses a successor owner', async t => {
  const root = privateTemp('/private/tmp/turnlink-arbiter-crash-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const plan = effect(), module = pathToFileURL(resolve('src/codex-effect-arbiter.js')).href;
  const script = `import { createCodexEffectArbiter } from ${JSON.stringify(module)};
    const value = JSON.parse(process.argv[1]); const gate = createCodexEffectArbiter({ ...value, guard: () => true });
    gate.prepare(); gate.dispatch(); process.send({ type: 'dispatched' }); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ directory: root, effect: plan })], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const [message] = await once(child, 'message'); assert.equal(message.type, 'dispatched');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  assert.equal(inspectCodexEffectArbiter(root).phase, 'intent');
  assert.equal(existsSync(join(root, 'owner')), true);
  assert.throws(() => createCodexEffectArbiter({ directory: root, effect: plan, guard: () => true }), /CODEX_EFFECT_ARBITER_UNAVAILABLE/);
});

test('authority expiring while durable intent is written prevents spawn and replay', t => {
  const root = privateTemp('/private/tmp/turnlink-arbiter-expiry-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  let checks = 0; const gate = createCodexEffectArbiter({ directory: root, effect: effect(), guard: () => ++checks === 1 });
  gate.prepare(); assert.throws(() => gate.dispatch(), /CODEX_EFFECT_ARBITER_UNAVAILABLE/);
  assert.equal(checks, 2); assert.equal(gate.snapshot().phase, 'intent');
  assert.throws(() => gate.dispatch(), /CODEX_EFFECT_ARBITER_UNAVAILABLE/); gate.close();
  assert.equal(inspectCodexEffectArbiter(root).phase, 'intent');
});

test('synchronous revocation during final authority validation prevents spawn', t => {
  const root = privateTemp('/private/tmp/turnlink-arbiter-revoke-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  let checks = 0, gate;
  gate = createCodexEffectArbiter({ directory: root, effect: effect(), guard: () => { if (++checks === 2) gate.revoke(); return true; } });
  gate.prepare(); assert.throws(() => gate.dispatch(), /CODEX_EFFECT_ARBITER_UNAVAILABLE/);
  assert.equal(gate.snapshot().phase, 'intent'); assert.equal(gate.snapshot().revoked, true); gate.close();
});

test('a stalled synchronous authority read delays a queued revocation', async t => {
  const root = privateTemp('/private/tmp/turnlink-arbiter-latency-'); t.after(() => rmSync(root, { recursive: true, force: true }));
  let checks = 0; const wait = new Int32Array(new SharedArrayBuffer(4));
  const gate = createCodexEffectArbiter({ directory: root, effect: effect(), guard: () => {
    if (++checks === 2) Atomics.wait(wait, 0, 0, 200);
    return true;
  } });
  gate.prepare(); const started = performance.now();
  const revocation = new Promise(resolve => setTimeout(() => { gate.revoke(); resolve(performance.now() - started); }, 0));
  const child = gate.dispatch(), exited = once(child, 'exit');
  const elapsed = await revocation;
  assert.ok(elapsed >= 175, `queued revocation was delayed ${elapsed.toFixed(1)}ms`);
  assert.equal(gate.snapshot().revoked, true); await exited; gate.close();
});

test('a spawned Docker CLI may reach the real daemon only after revocation',
  { skip: process.env.TURNLINK_CODEX_MCP_CONTAINER_PROBE !== '1', timeout: 30000 }, async t => {
    const root = privateTemp('/private/tmp/turnlink-arbiter-daemon-'); t.after(() => rmSync(root, { recursive: true, force: true }));
    const docker = '/opt/homebrew/bin/docker', ready = join(root, 'allow'), shim = join(root, 'docker-shim');
    const container = execFileSync(docker, ['create', '--pull=never', '--label', 'org.turnlink.mcp.owner=arbiter-test', 'alpine:3.21', 'true'], { encoding: 'utf8' }).trim();
    t.after(() => { try { execFileSync(docker, ['rm', '--force', container], { stdio: 'ignore' }); } catch {} });
    writeFileSync(shim, `#!/bin/sh\nwhile [ ! -f '${ready}' ]; do sleep 0.02; done\nexec '${docker}' "$@"\n`, { mode: 0o700 });
    const gate = createCodexEffectArbiter({ directory: join(root, 'gate'), guard: () => true,
      effect: { effectID: randomUUID(), grantDigest: 'a'.repeat(64), executable: shim, args: ['rm', container] } });
    gate.prepare(); const child = gate.dispatch(), exited = once(child, 'exit'); gate.revoke();
    assert.doesNotThrow(() => execFileSync(docker, ['inspect', container], { stdio: 'ignore' }));
    writeFileSync(ready, 'allow'); const [code] = await exited; assert.equal(code, 0);
    assert.throws(() => execFileSync(docker, ['inspect', container], { stdio: 'ignore' }));
    assert.equal(gate.snapshot().revoked, true); gate.close();
  });
