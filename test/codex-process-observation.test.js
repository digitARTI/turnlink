import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { captureCodexProcessObservation, sameProcessMetadata } from '../src/codex-process-observation.js';

test('OS process observation rejects another live PID but is not ABA-proof', { skip: process.platform !== 'darwin' }, async t => {
  const children = [0, 1].map(() => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  const exits = children.map(child => once(child, 'exit'));
  t.after(async () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await Promise.all(exits); });
  const first = captureCodexProcessObservation({ pid: children[0].pid, parentPID: process.pid });
  const second = captureCodexProcessObservation({ pid: children[1].pid, parentPID: process.pid });
  assert.equal(first.check(), true); assert.equal(second.check(), true);
  assert.equal(sameProcessMetadata(first.identity, second.identity), false);
  // The OS display is second-granularity. A reused PID with the same parent
  // and timestamp has the same metadata; it cannot be accepted as a lifetime proof.
  assert.equal(sameProcessMetadata(first.identity, { ...first.identity }), true);
  if (process.env.TURNLINK_ARBITER_AUTH_BENCH === '1') {
    const samples = [];
    for (let index = 0; index < 24; index++) { const start = performance.now(); first.check(); samples.push(performance.now() - start); }
    samples.sort((a, b) => a - b);
    t.diagnostic(`OS process observation: n=24 median=${samples[12].toFixed(3)}ms p95=${samples[22].toFixed(3)}ms max=${samples[23].toFixed(3)}ms`);
  }
  children[0].kill('SIGKILL'); await exits[0];
  assert.throws(() => first.check(), /CODEX_PROCESS_OBSERVATION_UNAVAILABLE/);
});
