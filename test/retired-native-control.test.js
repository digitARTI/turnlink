import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Codex proxy refuses the retired automatic native-control launch', () => {
  const child = spawnSync(process.execPath, [resolve('src/codex-proxy.js'), 'app-server'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, AGENT_CHANNEL_CODEX_EXECUTABLE: process.execPath, AGENT_CHANNEL_CODEX_NATIVE_CONTROL: '1' },
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /automatic native transfer is not supported/i);
});
