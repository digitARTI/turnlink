import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenCodeContainedOwner } from '../src/opencode-contained-owner.js';
import { createContainedOpenCodeBrokerTunnel } from '../src/opencode-container-broker-tunnel.js';

test('broker tunnel attaches to the exact networkless owner and only its configured host port',
  { skip: process.env.OPENCODE_DOCKER_BRIDGE_TEST !== '1', timeout: 30000 }, async t => {
    const root = mkdtempSync('/private/tmp/turnlink-broker-tunnel-'), journal = join(root, 'journal'); mkdirSync(journal, { mode: 0o700 });
    const broker = createServer(socket => socket.pipe(socket)); broker.listen(0, '127.0.0.1'); await once(broker, 'listening');
    const image = process.env.OPENCODE_DOCKER_BRIDGE_IMAGE || 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5';
    const owner = new OpenCodeContainedOwner({ directory: journal, docker: '/opt/homebrew/bin/docker', spec: { resourceID: randomUUID(), image,
      command: ['-e', 'setInterval(()=>{},1000)'], mounts: [{ source: resolve('src/opencode-container-mux.js'), destination: '/mux.mjs', mode: 'ro' }] } });
    let created, tunnel;
    t.after(async () => { tunnel?.close(); if (created) { const rm = spawn('/opt/homebrew/bin/docker', ['rm', '--force', created.containerID], { stdio: 'ignore' }); await once(rm, 'close'); }
      await new Promise(resolve => broker.close(resolve)); owner.close(); rmSync(root, { recursive: true, force: true }); });
    created = await owner.create(); await owner.start();
    tunnel = await createContainedOpenCodeBrokerTunnel({ owner, docker: '/opt/homebrew/bin/docker', ...created, brokerPort: broker.address().port, containerPort: 31679 });
    const code = `const n=require('node:net'),s=n.connect(31679,'127.0.0.1',()=>s.end('fixture'));let x='';s.on('data',b=>x+=b);s.on('end',()=>{if(x!=='fixture')process.exit(3);process.stdout.write(x)});`;
    const result = await promisify(execFile)('/opt/homebrew/bin/docker', ['exec', created.containerID, '/usr/local/bin/turnlink-node', '-e', code], { timeout: 10000 });
    assert.equal(result.stdout, 'fixture');
  });
