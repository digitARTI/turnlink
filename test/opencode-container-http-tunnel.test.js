import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenCodeContainedOwner } from '../src/opencode-contained-owner.js';
import { createContainedOpenCodeHttpTunnel } from '../src/opencode-container-http-tunnel.js';

test('container HTTP tunnel reaches only the exact running owner',
  { skip: process.env.OPENCODE_DOCKER_BRIDGE_TEST !== '1', timeout: 30000 }, async t => {
    const root = mkdtempSync('/private/tmp/turnlink-http-tunnel-'), journal = join(root, 'journal'); mkdirSync(journal, { mode: 0o700 });
    const image = process.env.OPENCODE_DOCKER_BRIDGE_IMAGE || 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5';
    const owner = new OpenCodeContainedOwner({ directory: journal, docker: '/opt/homebrew/bin/docker', spec: { resourceID: randomUUID(), image,
      command: ['/server.cjs'], mounts: [{ source: resolve('src/opencode-container-http-proxy.cjs'), destination: '/http-proxy.cjs', mode: 'ro' },
        { source: resolve('test/fixtures/opencode-container-http-server.cjs'), destination: '/server.cjs', mode: 'ro' }] } });
    let created, tunnel;
    t.after(async () => { await tunnel?.close(); if (created) { const child = spawn('/opt/homebrew/bin/docker', ['rm', '--force', created.containerID], { stdio: 'ignore' }); await once(child, 'close'); }
      owner.close(); rmSync(root, { recursive: true, force: true }); });
    created = await owner.create(); await owner.start();
    tunnel = await createContainedOpenCodeHttpTunnel({ owner, docker: '/opt/homebrew/bin/docker', ...created, nativePort: 31234, password: 'a'.repeat(43) });
    const auth = `Basic ${Buffer.from(`opencode:${'a'.repeat(43)}`).toString('base64')}`;
    let result;
    for (let i = 0; i < 30; i++) { try { result = await fetch(tunnel.endpoint.url, { headers: { authorization: auth } }); if (result.ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(await result?.text(), 'isolated-native');
    const concurrent = await Promise.all(Array.from({ length: 5 }, async () => {
      const response = await fetch(tunnel.endpoint.url, { headers: { authorization: auth, connection: 'close' } }); return response.text();
    }));
    assert.deepEqual(concurrent, Array(5).fill('isolated-native'));
    await owner.stop();
    await assert.rejects(fetch(tunnel.endpoint.url, { headers: { authorization: auth } }));
  });
