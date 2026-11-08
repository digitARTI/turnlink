import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';
import { transferCheckpointToVMFixture } from '../src/codex-vm-checkpoint-transfer.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const key = Buffer.alloc(32, 0x11), vmInstance = 'a'.repeat(64), challenge = 'b'.repeat(64);
const mac = value => createHmac('sha256', key).update(value).digest('hex');
const frame = value => { const data = Buffer.from(JSON.stringify(value)), size = Buffer.alloc(4); size.writeUInt32BE(data.length); return Buffer.concat([size, data]); };
function fixture({ badTag = false, foreignVM = false, holdReceipt = false } = {}) {
  const a = new PassThrough(), b = new PassThrough(), stream = Duplex.from({ readable: b, writable: a });
  const guest = Duplex.from({ readable: a, writable: b });
  a.on('error', () => {}); b.on('error', () => {}); stream.on('error', () => {});
  let buffer = Buffer.alloc(0), auth;
  guest.on('error', () => {}); guest.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
      const size = buffer.readUInt32BE(0), data = buffer.subarray(4, 4 + size); buffer = buffer.subarray(4 + size);
      if (!auth) { auth = JSON.parse(data); continue; }
      const envelope = JSON.parse(data), envelopeSha256 = hash(data);
      assert.equal(auth.envelopeSha256, envelopeSha256);
      assert.equal(auth.tag, mac(`turnlink-vm-checkpoint-auth-v1\0${vmInstance}\0${challenge}\0${envelopeSha256}`));
      if (holdReceipt) continue;
      const tag = mac(`turnlink-vm-checkpoint-receipt-v1\0${vmInstance}\0${challenge}\0${envelopeSha256}\0${envelope.digest}\0quarantined`);
      guest.write(frame({ version: 1, type: 'receipt', vmInstance, challenge, envelopeSha256, checkpointDigest: envelope.digest,
        status: 'quarantined', tag: badTag ? 'f'.repeat(64) : tag }));
    }
  });
  queueMicrotask(() => guest.write(frame({ version: 1, type: 'challenge', vmInstance: foreignVM ? 'c'.repeat(64) : vmInstance, challenge })));
  const threadId = randomUUID(), transitionId = randomUUID(), reservation = { generation: randomUUID(), revision: 1 };
  const rollout = Buffer.from('fixture rollout'), journal = Buffer.from('fixture journal'), config = Buffer.from('fixture config');
  const grant = { id: transitionId, channel: 'dev', taskID: randomUUID(), agentId: `codex:${threadId}`, previewID: randomUUID(),
    claimGeneration: 1, from: '/source', to: '/destination', configurationDigest: 'c'.repeat(64), authorityDigest: 'd'.repeat(64),
    checkpointConfigSha256: hash(config), status: 'prepared', preparedAt: 1 };
  const metadata = { version: 1, threadId, transitionId, reservation, rolloutSha256: hash(rollout), journalSha256: hash(journal),
    rolloutBytes: rollout.length, journalBytes: journal.length };
  metadata.digest = hash(`${threadId}:${transitionId}:${reservation.generation}:${reservation.revision}:${metadata.rolloutSha256}:${metadata.journalSha256}:${rollout.length}`);
  return { stream, guest, key, vmInstance, grant, config, checkpoint: { ...metadata, rollout, journal, releaseAllowed: false } };
}
test('VM fixture transfer authenticates the instance and returns a digest-bound quarantined receipt', async () => {
  const f = fixture(); const receipt = await transferCheckpointToVMFixture(f);
  assert.equal(receipt.vmInstance, vmInstance); assert.equal(receipt.checkpointDigest, f.checkpoint.digest);
  assert.equal(receipt.status, 'quarantined'); assert.equal(receipt.releaseAllowed, false);
});
test('VM fixture transfer aborts an in-flight delivery without returning a receipt', async () => {
  const f = fixture({ holdReceipt: true }), controller = new AbortController();
  const result = transferCheckpointToVMFixture({ ...f, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(result, /CHECKPOINT_TRANSFER_UNAVAILABLE/);
});
for (const options of [{ badTag: true }, { foreignVM: true }]) test('VM fixture transfer rejects a foreign instance or altered receipt', async () => {
  const f = fixture(options); await assert.rejects(transferCheckpointToVMFixture(f), /CHECKPOINT_TRANSFER_UNAVAILABLE/);
});
test('VM fixture transfer refuses changed config and an aborted lease', async () => {
  const first = fixture(); first.config = Buffer.from('changed');
  await assert.rejects(transferCheckpointToVMFixture(first), /CHECKPOINT_TRANSFER_UNAVAILABLE/); first.stream.destroy(); first.guest.destroy();
  const second = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(transferCheckpointToVMFixture({ ...second, signal: controller.signal }), /CHECKPOINT_TRANSFER_UNAVAILABLE/); second.stream.destroy(); second.guest.destroy();
});
