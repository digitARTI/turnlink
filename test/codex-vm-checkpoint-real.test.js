import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startBrokerVMFixture } from './fixtures/codex-vm-xpc/broker-vm-fixture.js';
import { connectOpenCodeVMSupervisorFixture } from '../src/opencode-vm-supervisor-fixture-client.js';
import { transferCheckpointToVMFixture } from '../src/codex-vm-checkpoint-transfer.js';

const hash = value => createHash('sha256').update(value).digest('hex');
test('fixture VM imports a synthetic checkpoint once and returns a quarantined receipt',
  { skip: process.env.TURNLINK_CODEX_VM_CHECKPOINT_TEST !== '1', timeout: 180000 }, async () => {
    const root = mkdtempSync('/private/tmp/tl-codex-vm-'), socket = join(root, 'vm.sock');
    const key = readFileSync(process.env.TURNLINK_CHECKPOINT_VM_KEY), vmInstance = readFileSync(process.env.TURNLINK_CHECKPOINT_VM_INSTANCE, 'utf8').trim();
    const threadId = randomUUID(), transitionId = randomUUID(), reservation = { generation: randomUUID(), revision: 1 };
    const config = Buffer.from('model = "fixture"\n'), grant = { id: transitionId, channel: 'dev', taskID: randomUUID(), agentId: `codex:${threadId}`,
      previewID: randomUUID(), claimGeneration: 1, from: '/source', to: '/destination', configurationDigest: 'a'.repeat(64), authorityDigest: 'b'.repeat(64),
      checkpointConfigSha256: hash(config), status: 'prepared', preparedAt: 1 };
    const rollout = Buffer.from(`${JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: threadId } })}\n`);
    const journal = Buffer.from(JSON.stringify({ thread_id: threadId, phase: 'grant_bound', reservation, host_grant: grant }));
    const metadata = { version: 1, threadId, transitionId, reservation, rolloutSha256: hash(rollout), journalSha256: hash(journal), rolloutBytes: rollout.length, journalBytes: journal.length };
    metadata.digest = hash(`${threadId}:${transitionId}:${reservation.generation}:${reservation.revision}:${metadata.rolloutSha256}:${metadata.journalSha256}:${rollout.length}`);
    const checkpoint = { ...metadata, rollout, journal, releaseAllowed: false };
    let fixture, stopped = false;
    try {
      fixture = await startBrokerVMFixture(root, { streamSocket: socket, diskBytes: 2 * 1024 ** 3 });
      const connect = () => connectOpenCodeVMSupervisorFixture({ path: socket, kind: 'import' });
      const receipt = await transferCheckpointToVMFixture({ stream: await connect(), key, vmInstance, grant, config, checkpoint });
      assert.equal(receipt.vmInstance, vmInstance); assert.equal(receipt.checkpointDigest, metadata.digest);
      assert.equal(receipt.status, 'quarantined'); assert.equal(receipt.releaseAllowed, false);
      await assert.rejects(transferCheckpointToVMFixture({ stream: await connect(), key, vmInstance, grant, config, checkpoint }), /CHECKPOINT_TRANSFER_UNAVAILABLE/);
      await fixture.close(); stopped = true;
    } finally {
      key.fill(0);
      if (fixture && !stopped) { await fixture.close(); stopped = true; }
      if (stopped) rmSync(root, { recursive: true, force: true });
    }
  });
