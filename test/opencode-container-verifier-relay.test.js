import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createConnection, createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenCodeContainedOwner } from '../src/opencode-contained-owner.js';
import { acceptContainedVerifierAnnouncement, createContainedVerifierRelay, createContainedVerifierRegistry, announceContainedVerifier } from '../src/opencode-container-verifier-relay.js';
import { localVerifierTransport } from '../src/codex-cancellation-verifier-transport.js';
import { digest } from '../src/config.js';
import { placementReceiptID } from '../src/opencode-native-recovery.js';
import { makeRemoteOpenCodeGenerationVerifier } from '../src/opencode-completion-verifier-transport.js';
import { codexVerifierLease } from '../src/codex-verifier-lease.js';

test('an announcement timing out during owner observation cannot be accepted late', { timeout: 15000 }, async () => {
  const generation = randomUUID(), operationID = randomUUID(), containerID = 'a'.repeat(64), daemonID = 'fixture';
  const owner = Object.create(OpenCodeContainedOwner.prototype); let observations = 0;
  owner.observe = async () => { observations++; await new Promise(resolve => setTimeout(resolve, 10300));
    return { running: true, status: 'running', containerID, daemonID, operationID }; };
  const root = mkdtempSync('/private/tmp/relay-timeout-'), secret = '7'.repeat(64);
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const incoming = once(server, 'connection'), client = createConnection(server.address().port, '127.0.0.1');
    const [socket] = await incoming;
    const acceptance = acceptContainedVerifierAnnouncement({ stream: socket, secret, owner, docker: '/fixture/docker', containerID,
      daemonID, operationID, hostDirectory: root, containerDirectory: '/fixture' });
    const announcement = announceContainedVerifier({ stream: client, secret, generation });
    await assert.rejects(announcement, /CONTAINED_VERIFIER_RELAY_UNAVAILABLE/);
    await assert.rejects(acceptance, /CONTAINED_VERIFIER_RELAY_UNAVAILABLE/);
    assert.equal(observations, 1);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
});

test('generation relay forwards only to its container, closes on container death, preserves replacement',
  { skip: process.env.OPENCODE_DOCKER_TEST !== '1' || process.platform !== 'darwin', timeout: 60000 }, async () => {
    const root = realpathSync(mkdtempSync('/private/tmp/vr-')), docker = '/opt/homebrew/bin/docker';
    const run = (...args) => execFileSync(docker, args, { encoding: 'utf8', timeout: 15000 }).trim();
    const image = 'sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5';
    const owner = new OpenCodeContainedOwner({ directory: root, docker, spec: { resourceID: randomUUID(), image,
      command: ['-e', 'setInterval(()=>{},1000)'], mounts: [] } });
    let id, relay, socket;
    try {
      const created = await owner.create(); id = created.containerID; await owner.start();
      const generation = randomUUID(), directory = '/run/verifiers', target = join(directory, `${generation}.sock`);
      const hash = createHash('sha256').update(target).digest('hex');
      const script = "require('net').createServer(s=>s.pipe(s)).listen('\\0turnlink-v1-'+process.argv[1]);";
      run('exec', '-d', id, '/usr/local/bin/turnlink-node', '-e', script, hash);
      relay = await createContainedVerifierRelay({ owner, docker, containerID: id, daemonID: created.daemonID,
        operationID: created.operationID, hostDirectory: root, containerDirectory: directory, generation });
      await assert.rejects(createContainedVerifierRelay({ owner, docker, containerID: id, daemonID: created.daemonID,
        operationID: created.operationID, hostDirectory: root, containerDirectory: directory, generation }));
      socket = createConnection(relay.path); await once(socket, 'connect');
      socket.write('lease-fixture'); const [data] = await once(socket, 'data'); assert.equal(String(data), 'lease-fixture');
      const closed = once(socket, 'close'); await owner.stop(); await closed;
      unlinkSync(relay.path); writeFileSync(relay.path, 'foreign'); await relay.close();
      assert.equal(readFileSync(relay.path, 'utf8'), 'foreign');
    } finally {
      socket?.destroy(); await relay?.close(); owner.close(); if (id) try { run('rm', '-f', id); } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  });
